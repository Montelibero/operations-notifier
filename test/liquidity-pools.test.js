const sinon = require('sinon')
const sdk = require('@stellar/stellar-sdk')
const {TransactionBuilder, Operation, Networks, Keypair, Asset, LiquidityPoolAsset} = sdk
const {parseTransaction} = require('../logic/stream-processor')
const {matches} = require('../util/subscription-match-helper')
const liquidityPools = require('../logic/liquidity-pools')
const storage = require('../logic/storage')
const {horizonPool, horizonTransport} = require('../logic/stellar-connector')
const {MockServer} = require('./server-pool.test')

describe('liquidity pools', function () {
    let src, G, usdc, poolId, mock

    before(async function () {
        mock = new MockServer((req, respond) => {
            const m = /^\/liquidity_pools\/([0-9a-f]{64})$/.exec(req.url)
            if (!m) return respond(404, {})
            if (mock.pools && mock.pools[m[1]]) return respond(200, mock.pools[m[1]])
            respond(404, {status: 404, title: 'Not Found'})
        })
        await mock.listen()
    })

    after(async function () {
        await mock.close()
    })

    beforeEach(function () {
        sinon.stub(horizonPool, 'call').callsFake(({path}) => horizonTransport(mock.url, {path}))
        liquidityPools.resetFailedPools()
        mock.pools = {}
        mock.requests = []
        src = Keypair.random()
        G = src.publicKey()
        usdc = new Asset('USD', G)
        poolId = Buffer.from(sdk.getLiquidityPoolId('constant_product', {assetA: Asset.native(), assetB: usdc, fee: 30})).toString('hex')
        mock.pools[poolId] = {
            id: poolId,
            type: 'constant_product',
            fee_bp: 30,
            reserves: [{asset: 'native', amount: '1'}, {asset: `USD:${G}`, amount: '2'}]
        }
    })

    afterEach(function () {
        sinon.restore()
    })

    function buildTx() {
        const share = new LiquidityPoolAsset(Asset.native(), usdc, 30)
        return new TransactionBuilder(new sdk.Account(G, '1'), {fee: '100', networkPassphrase: Networks.PUBLIC})
            .addOperation(Operation.changeTrust({asset: share, limit: '100'}))
            .addOperation(Operation.liquidityPoolDeposit({liquidityPoolId: poolId, maxAmountA: '1', maxAmountB: '1', minPrice: '0.5', maxPrice: '2'}))
            .addOperation(Operation.liquidityPoolWithdraw({liquidityPoolId: poolId, amount: '1', minAmountA: '0', minAmountB: '0'}))
            .setTimeout(0)
            .build()
    }

    function parse(tx) {
        return parseTransaction({hash: 'deadbeef', ledger: 65665000, paging_token: '1', envelope_xdr: tx.toXDR(), result_xdr: '', memo_type: 'none'})
    }

    it('normalizes a Horizon pool record into the internal pair', function () {
        const pool = liquidityPools.normalizeHorizonPool(mock.pools[poolId])
        expect(pool.pool_id).to.equal(poolId)
        expect(pool.fee).to.equal(30)
        expect(pool.assets).to.deep.equal([{asset_type: 0}, {asset_type: 1, asset_code: 'USD', asset_issuer: G}])
        expect(() => liquidityPools.normalizeHorizonPool({})).to.throw(/malformed/)
    })

    it('normalizes a pool share trustline as a pool share asset with the pair taken from the envelope', function () {
        const [trust] = parse(buildTx()).operations
        expect(trust.asset).to.deep.equal({asset_type: 3, liquidity_pool_id: poolId})
        expect(trust.assets).to.deep.equal([{asset_type: 0}, {asset_type: 1, asset_code: 'USD', asset_issuer: G}])
        expect(trust.fee).to.equal(30)
        expect(trust.asset.asset_type).to.equal(3) // the trustline asset itself is no longer reported as XLM
        expect(matches({asset_type: 0, filter_version: 2}, trust)).to.equal(true) // v2: the pool pair contains XLM
    })

    it('attaches the pool pair to deposits/withdrawals and trades from Horizon (once per pool), then from the cache', async function () {
        const tx = parse(buildTx())
        // a pool trade claimed by a path payment
        tx.operations.push({type_i: 2, type: 'path_payment_strict_receive', account: G, destination: G, asset: {asset_type: 0}, source_asset: {asset_type: 0},
            trades: [{type: 'liquidity_pool', pool_id: poolId, amount_sold: '1', amount_bought: '1'}]})

        await liquidityPools.enrichTransaction(tx)
        expect(mock.count).to.equal(0) // the pool share trustline carries the pair: registered from the envelope, Horizon not asked
        const [, deposit, withdraw, path] = tx.operations
        const pair = [{asset_type: 0}, {asset_type: 1, asset_code: 'USD', asset_issuer: G}]
        expect(deposit.assets).to.deep.equal(pair)
        expect(deposit.fee).to.equal(30)
        expect(withdraw.assets).to.deep.equal(pair)
        expect(path.trades[0].pool_assets).to.deep.equal(pair)

        // the second time everything comes from the in-memory cache: no requests
        await liquidityPools.enrichTransaction(parse(buildTx()))
        expect(mock.count).to.equal(0)

        // asset subscriptions (v2) now match deposits, withdrawals and pool trades
        for (const op of [deposit, withdraw]) {
            expect(matches({asset_type: 1, asset_code: 'USD', asset_issuer: G, filter_version: 2}, op)).to.equal(true)
            expect(matches({asset_type: 0, filter_version: 2}, op)).to.equal(true)
            expect(matches({asset_type: 1, asset_code: 'USD', asset_issuer: G}, op)).to.equal(false) // v1 keeps the old behavior
        }
        expect(matches({asset_type: 1, asset_code: 'USD', asset_issuer: G, filter_version: 2}, path)).to.equal(true)
    })

    it('v2: an XLM asset subscription really filters by XLM (v1 was a catch-all)', function () {
        const payment = {type_i: 1, account: G, destination: G, asset: {asset_type: 1, asset_code: 'EUR', asset_issuer: G}}
        expect(matches({asset_type: 0}, payment)).to.equal(true) // legacy v1 quirk: asset_type 0 = no filter
        expect(matches({asset_type: 0, filter_version: 2}, payment)).to.equal(false)
        expect(matches({asset_type: 0, filter_version: 2}, {...payment, asset: {asset_type: 0}})).to.equal(true)
    })

    it('registers the pool from a pool-share trustline without asking Horizon', async function () {
        const tx = parse(buildTx())
        tx.operations = [tx.operations[0]] // only the trustline (its pair comes from the envelope)
        mock.pools = {} // Horizon knows nothing about the pool yet
        await liquidityPools.enrichTransaction(tx)
        expect(mock.count).to.equal(0)
        const stored = await storage.fetchLiquidityPools([poolId])
        expect(stored).to.have.length(1)
        expect(stored[0].source).to.equal('envelope')
        expect(stored[0].assets).to.deep.equal([{asset_type: 0}, {asset_type: 1, asset_code: 'USD', asset_issuer: G}])
    })

    it('leaves the operation as is when the pool is not available and backs off before retrying', async function () {
        const unknown = 'cd'.repeat(32)
        mock.pools = {}
        const tx = parse(buildTx())
        tx.operations = [{type_i: 22, type: 'liquidity_pool_deposit', account: G, liquidityPoolId: unknown}]
        await liquidityPools.enrichTransaction(tx)
        expect(mock.count).to.equal(1)
        expect(tx.operations[0]).to.not.have.property('assets')
        await liquidityPools.enrichTransaction({operations: [{type_i: 22, liquidityPoolId: unknown}]})
        expect(mock.count).to.equal(1) // backed off: no second request within 5 minutes
        liquidityPools.resetFailedPools()
        await liquidityPools.enrichTransaction({operations: [{type_i: 22, liquidityPoolId: unknown}]})
        expect(mock.count).to.equal(2)
        // when the pool appears, it resolves
        mock.pools[unknown] = {id: unknown, fee_bp: 30, reserves: [{asset: 'native', amount: '1'}, {asset: `USD:${G}`, amount: '1'}]}
        liquidityPools.resetFailedPools()
        const op = {type_i: 22, liquidityPoolId: unknown}
        await liquidityPools.enrichTransaction({operations: [op]})
        expect(op.assets).to.have.length(2)
    })

    it('survives a storage failure without throwing', async function () {
        sinon.stub(storage, 'fetchLiquidityPools').rejects(new Error('db down'))
        sinon.stub(storage, 'saveLiquidityPool').rejects(new Error('db down'))
        const op = {type_i: 22, account: G, liquidityPoolId: poolId}
        const tx = {operations: [op]}
        await liquidityPools.enrichTransaction(tx) // no throw
        expect(op.assets).to.deep.equal([{asset_type: 0}, {asset_type: 1, asset_code: 'USD', asset_issuer: G}]) // still enriched from Horizon
    })

    it('parses a revoked trustline sponsorship of a pool share (LiquidityPoolId form)', function () {
        const hex = poolId
        const tx = new TransactionBuilder(new sdk.Account(G, '1'), {fee: '100', networkPassphrase: Networks.PUBLIC})
            .addOperation(Operation.revokeTrustlineSponsorship({account: G, asset: new sdk.LiquidityPoolId(hex)}))
            .setTimeout(0).build()
        const [op] = parse(tx).operations
        expect(op.type).to.equal('revoke_sponsorship')
        expect(op.revoke_type).to.equal('trustline')
        expect(op.asset).to.deep.equal({asset_type: 3, liquidity_pool_id: hex})
    })

    it('makes a single Horizon request for a pool referenced by concurrent transactions', async function () {
        const unknown = 'ef'.repeat(32)
        mock.pools[unknown] = {id: unknown, fee_bp: 30, reserves: [{asset: 'native', amount: '1'}, {asset: `USD:${G}`, amount: '1'}]}
        const jobs = Array.from({length: 5}, () => liquidityPools.enrichTransaction({details: {ledger: 1}, operations: [{type_i: 22, liquidityPoolId: unknown}]}))
        const results = await Promise.all(jobs)
        expect(mock.count).to.equal(1)
        for (const tx of results) expect(tx.operations[0].assets).to.have.length(2)
    })

    it('rejects a malformed Horizon pool record and does not cache it', async function () {
        const unknown = 'be'.repeat(32)
        mock.pools[unknown] = {id: unknown, fee_bp: 30, reserves: [{asset: 'native', amount: '1'}]}
        const op = {type_i: 22, liquidityPoolId: unknown}
        await liquidityPools.enrichTransaction({operations: [op]})
        expect(op).to.not.have.property('assets')
        expect(await storage.fetchLiquidityPools([unknown])).to.deep.equal([])
    })

    it('mongo schema: pool assets carry no per-element _id (the pair is copied into webhook payloads)', function () {
        const mongoose = require('mongoose')
        const LiquidityPool = require('../persistence-layer/mongodb-storage-provider/models/liquidity-pool-db-model')
        expect(LiquidityPool.schema.path('assets').schema.options._id).to.equal(false)
        expect(LiquidityPool.schema.path('_id').instance).to.equal('String')
        expect(LiquidityPool.collection.name).to.equal('liquidity_pool') // as documented
        expect(mongoose.models.LiquidityPool).to.equal(LiquidityPool) // model reuse is safe across requires
    })

    it('handles transactions without operations and invalid pool share ids', async function () {
        expect(await liquidityPools.enrichTransaction({details: {}})).to.deep.equal({details: {}})
        const {parseAsset} = require('../util/asset-helper')
        expect(parseAsset({asset_type: 3, liquidity_pool_id: 'not-hex'})).to.equal(null)
        expect(parseAsset({asset_type: 3, liquidity_pool_id: poolId})).to.deep.equal({asset_type: 3, liquidity_pool_id: poolId})
    })

    it('leaves pool_assets unset for unknown pools in manage_sell_offer trades without crashing', async function () {
        // a real result_xdr with a liquidity pool fill (path_payment fixture) is op-type agnostic for trades
        const fill = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAANAAAAAAAAAAYAAAACL5Qn+uJYb74IrdtGCko+fLFr2yojKLu3m36C6/8H5TcAAAABWExNAAAAAAAIFKTA1/lfmfT8cLAEmz2xeS2Z3zh4u1mhED+hjNFuzAAABq+EG70QAAAAAAAAAAAAAM0UAAAAApPcmoq4J6AZean6PySVw3PxDj6VWyQRRbU5DW+OVdbdAAAAAU9MVAAAAAAAL67mruJq8g1bj8lCiNVHbidAzKmg3NSrNjUbTCiAbawAAAAADhIvngAAAAFYTE0AAAAAAAgUpMDX+V+Z9PxwsASbPbF5LZnfOHi7WaEQP6GM0W7MAAAGr4QbvRAAAAACgg2uOCvWZHWpZVFxcCGp5X3zwjCOH479kPp3TX9Nf3YAAAACeFJVTkVTAAAAAAAAAAAAAJcJfuPGW8U+3ZTTWqzylg/R4DC4xMybrxWCad9EBRHeAAAAAAFZa70AAAABTkxUAAAAAAAvruau4mryDVuPyUKI1UduJ0DMqaDc1Ks2NRtMKIBtrAAAAAAOEi+eAAAAAihQrEoo1cdE4p+BpW/Oix6Hk06JrJIYvE2pZ/OZ0anJAAAAAlNERVhFWAAAAAAAAAAAAABgdg42ru1O4AINKCDjmPPfYKb27YUjdun2yi4e6WmvggAAAAAODtlCAAAAAnhSVU5FUwAAAAAAAAAAAACXCX7jxlvFPt2U01qs8pYP0eAwuMTMm68VgmnfRAUR3gAAAAABWWu9AAAAAQAAAACdd7Jzw2JRgO7qhWkiKm7tcVghjplqnuZH5XQMjp1mGgAAAABjLOCDAAAAAAAAAAAAANAuAAAAAlNERVhFWAAAAAAAAAAAAABgdg42ru1O4AINKCDjmPPfYKb27YUjdun2yi4e6WmvggAAAAAODtlCAAAAAQAAAABtfzycOy3ID8X/LBcX0lb34EUi64MDCS6264IMhli7JQAAAABjKo3+AAAAAXlYTE0AAAAAIjbXcP4NPgFSGXXVz3rEhCtwldaxqddo0+mmMumZBr4AAAAAAADQLgAAAAAAAAAAAADQLgAAAAAZuKPiuNAtcn2d682XJkONZHHDPYRIu5MemLtevYBqSwAAAAF5WExNAAAAACI213D+DT4BUhl11c96xIQrcJXWsanXaNPppjLpmQa+AAAAAAAA0C4AAAAA'
        const {parsePathPaymentTrades} = require('../logic/stream-processor')
        const trades = parsePathPaymentTrades(fill, 0, 'path_payment_strict_send').trades
        const op = {type_i: 3, type: 'manage_sell_offer', account: G, trades}
        await liquidityPools.enrichTransaction({operations: [op]})
        // the fixture's pool ids are unknown to the mock: resolved when Horizon knows them, otherwise left as is
        const poolTrades = op.trades.filter(t => t.type === 'liquidity_pool')
        expect(poolTrades).to.have.length(4)
        expect(mock.count).to.be.at.most(4) // one request per distinct unknown pool id, backoff afterwards
        mock.pools = {}
        for (const t of poolTrades) expect(t).to.not.have.property('pool_assets') // unknown → no pair, no crash
        expect(matches({asset_type: 1, asset_code: 'EURMTL', asset_issuer: G, filter_version: 2}, op)).to.equal(false)
    })

    it('attaches pool_assets to pool trades of a manage_sell_offer once the pools are known', async function () {
        const op = {type_i: 3, type: 'manage_sell_offer', account: G, trades: [{type: 'liquidity_pool', pool_id: poolId, amount_sold: '1', amount_bought: '1'}]}
        await liquidityPools.enrichTransaction({operations: [op]})
        expect(op.trades[0].pool_assets).to.deep.equal([{asset_type: 0}, {asset_type: 1, asset_code: 'USD', asset_issuer: G}])
        expect(matches({asset_type: 1, asset_code: 'USD', asset_issuer: G, filter_version: 2}, op)).to.equal(true)
    })

    it('does nothing for transactions without pool references', async function () {
        const tx = parse(new TransactionBuilder(new sdk.Account(G, '1'), {fee: '100', networkPassphrase: Networks.PUBLIC})
            .addOperation(Operation.payment({destination: G, asset: Asset.native(), amount: '1'})).setTimeout(0).build())
        expect(liquidityPools.collectPoolIds(tx)).to.deep.equal([])
        expect(await liquidityPools.enrichTransaction(tx)).to.equal(tx)
        expect(await liquidityPools.enrichTransaction(null)).to.equal(null)
        expect(mock.count).to.equal(0)
    })
})
