const {matches, CURRENT_FILTER_VERSION, getFilterVersion} = require('../util/subscription-match-helper')
const SubscriptionIndex = require('../util/subscription-index')
const {parseAsset} = require('../util/asset-helper')

const A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
const B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBS' // not a valid strkey, only used as an opaque id in mocks
const USDC = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const usd = {asset_type: 1, asset_code: 'USDC', asset_issuer: USDC}
const eur = {asset_type: 1, asset_code: 'EUR', asset_issuer: USDC}
const xlm = {asset_type: 0}

describe('subscription filters v2 (filter_version)', function () {
    const sub = (overrides = {}) => ({account: A, ...overrides})
    const assetSub = (overrides = {}) => ({asset_type: 1, asset_code: 'USDC', asset_issuer: USDC, ...overrides})

    it('applies v1 to subscriptions without filter_version and the current version to new ones', function () {
        expect(getFilterVersion({})).to.equal(1)
        expect(getFilterVersion({filter_version: 1})).to.equal(1)
        expect(getFilterVersion({filter_version: 2})).to.equal(2)
        expect(CURRENT_FILTER_VERSION).to.equal(2)
    })

    it('matches the path payment recipient only with v2', function () {
        const op = {type_i: 2, account: B, destination: A, asset: usd, source_asset: xlm, path: [eur]}
        expect(matches(sub(), op)).to.equal(false)
        expect(matches(sub({filter_version: 2}), op)).to.equal(true)
    })

    it('keeps v1 matching payments and account merges by destination', function () {
        for (const type_i of [0, 1, 8]) {
            expect(matches(sub(), {type_i, account: B, destination: A})).to.equal(true)
            expect(matches(sub({filter_version: 2}), {type_i, account: B, destination: A})).to.equal(true)
        }
    })

    it('matches the clawback target, trustor, sponsored account and claimants only with v2', function () {
        const cases = [
            [{type_i: 19, account: B, from: A}],
            [{type_i: 21, account: B, trustor: A}],
            [{type_i: 16, account: B, sponsoredId: A}],
            [{type_i: 14, account: B, claimants: [{destination: B}, {destination: A}]}]
        ]
        for (const [op] of cases) {
            expect(matches(sub(), op), `v1 ${op.type_i}`).to.equal(false)
            expect(matches(sub({filter_version: 2}), op), `v2 ${op.type_i}`).to.equal(true)
        }
    })

    it('matches order book fills of the account\'s offer in both versions', function () {
        const op = {type_i: 4, account: B, trades: [{seller_id: A, asset_sold: xlm, asset_bought: usd}]}
        expect(matches(sub(), op)).to.equal(true)
        expect(matches(sub({filter_version: 2}), op)).to.equal(true)
    })

    it('matches the asset in path and in trades only with v2', function () {
        const pathOp = {type_i: 2, account: B, destination: B, asset: eur, source_asset: xlm, path: [usd]}
        expect(matches(assetSub(), pathOp)).to.equal(false)
        expect(matches(assetSub({filter_version: 2}), pathOp)).to.equal(true)
        const tradeOp = {type_i: 3, account: B, asset: eur, source_asset: xlm, trades: [{seller_id: B, asset_sold: usd, asset_bought: xlm}]}
        expect(matches(assetSub(), tradeOp)).to.equal(false)
        expect(matches(assetSub({filter_version: 2}), tradeOp)).to.equal(true)
    })

    it('compares the transaction memo value (the v1 check never matched)', function () {
        const op = {type_i: 1, account: B, destination: B, transaction_details: {memo: {type: 'text', value: 'invoice 42'}}}
        expect(matches({account: undefined, memo: 'invoice 42', filter_version: 2}, op)).to.equal(true)
        expect(matches({memo: 'invoice 43', filter_version: 2}, op)).to.equal(false)
        // v1 subscriptions with a memo keep the legacy behavior (no match on real operations)
        expect(matches({memo: 'invoice 42'}, op)).to.equal(false)
        const idOp = {type_i: 1, account: B, destination: B, transaction_details: {memo: {type: 'id', value: '123456789012345'}}}
        expect(matches({memo: '123456789012345', filter_version: 2}, idOp)).to.equal(true)
        expect(matches({memo: '999', filter_version: 2}, {type_i: 1, account: B})).to.equal(false) // no memo at all
        // hash memos may be given as hex: the payload carries base64
        const hash = Buffer.alloc(32, 7)
        const hashOp = {type_i: 1, account: B, destination: B, transaction_details: {memo: {type: 'hash', value: hash.toString('base64')}}}
        expect(matches({memo: hash.toString('hex'), filter_version: 2}, hashOp)).to.equal(true)
        expect(matches({memo: hash.toString('base64'), filter_version: 2}, hashOp)).to.equal(true)
    })

    it('matches the memo end-to-end: a transaction built with the SDK → parseTransaction → matches', function () {
        const sdk = require('@stellar/stellar-sdk')
        const src = sdk.Keypair.random()
        const G = src.publicKey()
        const build = memo => sdk.TransactionBuilder.fromXdr(new sdk.TransactionBuilder(new sdk.Account(G, '1'), {fee: '100', networkPassphrase: sdk.Networks.PUBLIC, memo})
            .addOperation(sdk.Operation.payment({destination: G, asset: sdk.Asset.native(), amount: '1'})).setTimeout(0).build().toXDR(), sdk.Networks.PUBLIC).toXDR('base64')
        const parse = envelope_xdr => require('../logic/stream-processor').parseTransaction({
            hash: 'deadbeef', paging_token: '1', envelope_xdr, result_xdr: '', memo_type: 'none'
        }).operations[0]
        const text = parse(build(sdk.Memo.text('invoice 42')))
        expect(matches({memo: 'invoice 42', filter_version: 2}, text)).to.equal(true)
        expect(matches({memo: 'invoice 43', filter_version: 2}, text)).to.equal(false)
        const id = parse(build(sdk.Memo.id('123456789012345')))
        expect(matches({memo: '123456789012345', filter_version: 2}, id)).to.equal(true)
        const hash = require('crypto').createHash('sha256').update('payload').digest()
        const hashOp = parse(build(sdk.Memo.hash(hash)))
        expect(matches({memo: Buffer.from(hash).toString('hex'), filter_version: 2}, hashOp)).to.equal(true) // hex from the user
        expect(matches({memo: Buffer.from(hash).toString('base64'), filter_version: 2}, hashOp)).to.equal(true) // base64 as in the payload
    })

    it('keeps v1 matching of allow_trust by the trustor (destination)', function () {
        const op = {type_i: 7, account: B, destination: A}
        expect(matches(sub(), op)).to.equal(true)
        expect(matches(sub({filter_version: 2}), op)).to.equal(true)
    })

    it('index finds manage_data subscriptions when the value is a raw Uint8Array', function () {
        const index = new SubscriptionIndex()
        index.buildFrom([sub({id: 's1', account: undefined, ...{account: A}})])
        const value = new Uint8Array(Buffer.from(A, 'utf8'))
        expect(index.findMatches({type_i: 10, account: B, value}).map(s => s.id)).to.deep.equal(['s1'])
    })

    it('keeps the AND semantics of several rules in one subscription (unchanged)', function () {
        const asset = parseAsset(usd)
        const sub2 = {account: A, asset_type: asset.asset_type, asset_code: asset.asset_code, asset_issuer: asset.asset_issuer, filter_version: 2}
        expect(matches(sub2, {type_i: 1, account: A, destination: B, asset: usd})).to.equal(true) // both rules hold
        expect(matches(sub2, {type_i: 1, account: B, destination: B, asset: usd})).to.equal(false) // asset only
        expect(matches(sub2, {type_i: 1, account: A, destination: B, asset: eur})).to.equal(false) // account only
    })

    it('index offers v2 candidates so findMatches finds them', function () {
        const index = new SubscriptionIndex()
        index.buildFrom([sub({filter_version: 2, id: 's1'}), sub({id: 's0'}), assetSub({id: 's2', filter_version: 2})])
        const found = op => index.findMatches(op).map(s => s.id).sort()
        expect(found({type_i: 2, account: B, destination: A, asset: eur, source_asset: xlm, path: [usd]})).to.deep.equal(['s1', 's2'])
        expect(found({type_i: 19, account: B, from: A, asset: eur})).to.deep.equal(['s1'])
        expect(found({type_i: 21, account: B, trustor: A})).to.deep.equal(['s1'])
        expect(found({type_i: 16, account: B, sponsoredId: A})).to.deep.equal(['s1'])
        expect(found({type_i: 14, account: B, claimants: [{destination: A}], asset: usd})).to.deep.equal(['s1', 's2'])
        // v1 subscription by the same account does not match those operations
        expect(found({type_i: 2, account: B, destination: A})).to.deep.equal(['s1'])
    })
})
