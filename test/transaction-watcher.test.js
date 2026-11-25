const sinon = require('sinon')
const TransactionWatcher = require('../logic/transaction-watcher')
const stellarConnector = require('../logic/stellar-connector')
const { horizonPool } = stellarConnector
const { PoolError } = require('../logic/server-pool')
const storage = require('../logic/storage')
const config = require('../models/config')

describe('TransactionWatcher', function () {
    let watcher
    let observer
    let clock
    let originalConfig

    beforeEach(function () {
        observer = {
            observing: true,
            subscriptions: [],
            notifier: {
                createNotifications: sinon.stub().resolves([]),
                startNewNotifierThread: sinon.stub()
            },
            subscriptionIndex: {
                findMatches: sinon.stub().returns([])
            }
        }
        watcher = new TransactionWatcher(observer)
        clock = sinon.useFakeTimers()
        originalConfig = {
            healthMaxNoSuccessSeconds: config.healthMaxNoSuccessSeconds,
            healthMaxNoLedgerSeconds: config.healthMaxNoLedgerSeconds,
            healthMaxNoProgressSeconds: config.healthMaxNoProgressSeconds,
            healthStartupGraceSeconds: config.healthStartupGraceSeconds
        }
        sinon.stub(storage, 'updateLastIngestedTx').resolves()
    })

    afterEach(function () {
        Object.assign(config, originalConfig)
        sinon.restore()
    })

    it('retries watcher recovery after temporary trackTransactions failure', async function () {
        watcher.cursor = '123'
        sinon.stub(watcher, 'watch')
        // the pool already failed over across all servers and exhausted its retries
        sinon.stub(horizonPool, 'call').rejects(new PoolError('HTTP 503 from all servers', {type: 'retry', status: 503}))

        watcher.trackTransactions()
        await Promise.resolve()
        await Promise.resolve()

        await clock.tickAsync(1000)

        expect(watcher.watch.calledOnce).to.equal(true)
    })

    it('requests ledger transactions through the ledger sub-resource (the ?ledger= filter is ignored by Horizon)', async function () {
        const call = sinon.stub(horizonPool, 'call').resolves({records: []})
        const {fetchTransactions} = require('../logic/transaction-watcher')
        await fetchTransactions(undefined, 65664138)
        await fetchTransactions('123456789', undefined, watcher)
        await fetchTransactions('not-a-cursor', 7)
        expect(call.args.map(a => a[0])).to.deep.equal([
            {path: '/ledgers/65664138/transactions?order=asc&limit=200', ledger: 65664138},
            {path: '/transactions?order=asc&limit=200&cursor=123456789', ledger: undefined},
            {path: '/ledgers/7/transactions?order=asc&limit=200', ledger: 7} // invalid cursor dropped
        ])
    })

    it('keeps the catch-up cursor on temporary failures (the request URL contains "cursor")', async function () {
        watcher.cursor = '123'
        sinon.stub(watcher, 'watch')
        sinon.stub(horizonPool, 'call').rejects(new PoolError('HTTP 503 from https://horizon.stellar.org/transactions?order=asc&limit=200&cursor=123: Service Unavailable', {type: 'retry', status: 503}))
        sinon.stub(watcher, 'trackLiveStream')

        watcher.trackTransactions()
        await Promise.resolve()
        await Promise.resolve()
        await clock.tickAsync(1000)

        expect(watcher.trackLiveStream.called).to.equal(false)
        expect(watcher.cursor).to.equal('123')
        expect(watcher.watch.calledOnce).to.equal(true)
    })

    it('drops the catch-up cursor only when Horizon rejects the cursor itself', async function () {
        watcher.cursor = 'abc'
        sinon.stub(watcher, 'watch')
        const err = new PoolError('HTTP 400 from https://horizon.stellar.org/transactions?cursor=abc: Bad Request', {type: 'fatal', status: 400})
        err.title = 'Bad Request'
        err.detail = 'Cursor: abc is not a valid cursor'
        sinon.stub(horizonPool, 'call').rejects(err)
        sinon.stub(watcher, 'trackLiveStream')

        watcher.trackTransactions()
        await clock.tickAsync(10)

        expect(watcher.cursor).to.equal(null)
        expect(watcher.trackLiveStream.calledOnce).to.equal(true)
        expect(watcher.watch.called).to.equal(false)
    })

    function stalledStream(lastLedgerSeen) {
        const server = horizonPool.servers[0]
        watcher.streaming = true
        watcher.streamUrl = server.url
        watcher.lastLedgerSeen = lastLedgerSeen
        watcher.lastLedgerSeenAt = lastLedgerSeen ? new Date(Date.now() - 30000) : null
        watcher.lastStreamStartAt = Date.now() - 30000
        return server
    }

    it('switches away from a stalled streaming server when a peer is ahead', async function () {
        const server = stalledStream(100)
        sinon.stub(stellarConnector, 'fetchPeerLatestLedger').resolves({url: 'https://peer', ledger: 107})
        sinon.stub(stellarConnector, 'fetchLatestLedger').resolves(100) // the server itself stopped ingesting
        sinon.stub(watcher, 'trackLiveStream')

        await watcher.checkStreamStall()

        expect(server.state).to.equal('down')
        expect(server.lastError).to.equal('behind by 7 ledgers (100 vs 107)')
        expect(watcher.trackLiveStream.called).to.equal(false) // the switch event restarts the stream, not the stall check
        horizonPool.markSuccess(server)
    })

    it('does not switch when nothing new was ingested anywhere (slow network)', async function () {
        const server = stalledStream(100)
        sinon.stub(stellarConnector, 'fetchPeerLatestLedger').resolves({url: 'https://peer', ledger: 101})
        sinon.stub(stellarConnector, 'fetchLatestLedger').resolves(100)
        sinon.stub(watcher, 'trackLiveStream')

        await watcher.checkStreamStall()

        expect(server.state).to.equal('ok')
        expect(watcher.trackLiveStream.called).to.equal(false)
    })

    it('restarts the stream (without switching) when the server ingests ledgers the stream never delivered', async function () {
        const server = stalledStream(100)
        sinon.stub(stellarConnector, 'fetchPeerLatestLedger').resolves({url: 'https://peer', ledger: 106})
        sinon.stub(stellarConnector, 'fetchLatestLedger').resolves(105) // current, but SSE is stuck
        sinon.stub(watcher, 'trackLiveStream')

        await watcher.checkStreamStall()

        expect(server.state).to.equal('ok')
        expect(watcher.trackLiveStream.calledOnceWithExactly(true)).to.equal(true)
    })

    it('marks the server down when the stream stalled and the server does not answer REST either', async function () {
        const server = stalledStream(100)
        sinon.stub(stellarConnector, 'fetchPeerLatestLedger').resolves({url: 'https://peer', ledger: 110})
        sinon.stub(stellarConnector, 'fetchLatestLedger').rejects(new PoolError('timeout', {type: 'retry'}))

        await watcher.checkStreamStall()

        expect(server.state).to.equal('down')
        expect(server.lastError).to.equal('stalled stream, REST timeout')
        horizonPool.markSuccess(server)
    })

    it('marks the server down when the stream stalled, no peers exist and the server does not answer REST (single-server pool)', async function () {
        const server = stalledStream(100)
        sinon.stub(stellarConnector, 'fetchPeerLatestLedger').resolves(null) // nobody to compare with
        sinon.stub(stellarConnector, 'fetchLatestLedger').rejects(new PoolError('timeout', {type: 'retry'}))

        await watcher.checkStreamStall()

        expect(server.state).to.equal('down')
        expect(server.lastError).to.equal('stalled stream, REST timeout')
        horizonPool.markSuccess(server)
    })

    it('restarts the stream when no peers exist but the server keeps ingesting (single-server pool)', async function () {
        const server = stalledStream(100)
        sinon.stub(stellarConnector, 'fetchPeerLatestLedger').resolves(null)
        sinon.stub(stellarConnector, 'fetchLatestLedger').resolves(103)
        sinon.stub(watcher, 'trackLiveStream')

        await watcher.checkStreamStall()

        expect(server.state).to.equal('ok')
        expect(watcher.trackLiveStream.calledOnceWithExactly(true)).to.equal(true)
    })

    it('fetchLatestLedger() falls back to the preferred server when every server is down', async function () {
        clock.restore() // a real HTTP request does not complete under fake timers
        const {MockServer} = require('./server-pool.test')
        const m = new MockServer((req, respond) => respond(200, {_embedded: {records: [{sequence: 777}]}}))
        await m.listen()
        try {
            const server = horizonPool.servers[0]
            const originalUrl = server.url
            server.url = m.url // fallbackUrl = first server
            sinon.stub(horizonPool, 'activeUrl').get(() => null) // every server is down
            expect(await stellarConnector.fetchLatestLedger()).to.equal(777)
            server.url = originalUrl
        } finally {
            await m.close()
        }
    })

    it('handles a cold start: no ledger seen yet, the server itself is current → restart the stream', async function () {
        const server = stalledStream(null)
        sinon.stub(stellarConnector, 'fetchPeerLatestLedger').resolves({url: 'https://peer', ledger: 50})
        sinon.stub(stellarConnector, 'fetchLatestLedger').resolves(50)
        sinon.stub(watcher, 'trackLiveStream')

        await watcher.checkStreamStall()

        expect(server.state).to.equal('ok') // not "behind from genesis"
        expect(watcher.trackLiveStream.calledOnceWithExactly(true)).to.equal(true)
    })

    it('handles a cold start: no ledger seen yet, the server is behind its peer → switch', async function () {
        const server = stalledStream(null)
        sinon.stub(stellarConnector, 'fetchPeerLatestLedger').resolves({url: 'https://peer', ledger: 60})
        sinon.stub(stellarConnector, 'fetchLatestLedger').resolves(50)
        sinon.stub(watcher, 'trackLiveStream')

        await watcher.checkStreamStall()

        expect(server.state).to.equal('down')
        expect(server.lastError).to.equal('behind by 10 ledgers (50 vs 60)')
        horizonPool.markSuccess(server)
    })

    it('follows the pool only while watching', function () {
        const before = horizonPool.listenerCount('switch')
        const w = new TransactionWatcher(observer)
        expect(horizonPool.listenerCount('switch')).to.equal(before) // constructor does not subscribe
        sinon.stub(w, 'trackTransactions')
        sinon.stub(storage, 'getLastIngestedTx').resolves('1')
        w.watch()
        expect(horizonPool.listenerCount('switch')).to.equal(before + 1)
        w.stopWatching(true) // recovery restart keeps the subscription
        expect(horizonPool.listenerCount('switch')).to.equal(before + 1)
        w.stopWatching() // full stop unsubscribes
        expect(horizonPool.listenerCount('switch')).to.equal(before)
    })

    it('counts transactions skipped because of unparseable envelopes', async function () {
        expect(watcher.getStatus().skippedTransactions).to.equal(0)
        await watcher.processTransaction({hash: 'badbeef', ledger: 42, envelope_xdr: 'AAAA', paging_token: '1'})
        expect(watcher.getStatus().skippedTransactions).to.equal(1)
        expect(watcher.getStatus().lastSkippedTransaction).to.include({hash: 'badbeef', ledger: 42})
    })

    it('reports unhealthy when watcher has no recent successful activity', function () {
        config.healthStartupGraceSeconds = 0
        config.healthMaxNoSuccessSeconds = 10
        config.healthMaxNoLedgerSeconds = 10
        config.healthMaxNoProgressSeconds = 10

        watcher.startedAt = new Date(Date.now() - 60000)
        watcher.lastSuccessfulFetchAt = new Date(Date.now() - 60000)
        watcher.lastLedgerSeenAt = new Date(Date.now() - 60000)
        watcher.lastLedgerProcessedAt = new Date(Date.now() - 60000)
        watcher.lastErrorMessage = 'Service Unavailable'
        watcher.lastErrorAt = new Date(Date.now() - 5000)

        const health = watcher.getHealth()

        expect(health.healthy).to.equal(false)
        expect(health.reason).to.equal('watcher_stalled')
    })

    it('stays healthy during catch-up when progress is recent', function () {
        config.healthStartupGraceSeconds = 0
        config.healthMaxNoSuccessSeconds = 10
        config.healthMaxNoLedgerSeconds = 10
        config.healthMaxNoProgressSeconds = 10

        watcher.state = 'catching_up'
        watcher.startedAt = new Date(Date.now() - 60000)
        watcher.lastSuccessfulFetchAt = new Date(Date.now() - 5000)
        watcher.lastLedgerSeenAt = new Date(Date.now() - 60000)
        watcher.lastLedgerProcessedAt = new Date(Date.now() - 5000)

        const health = watcher.getHealth()

        expect(health.healthy).to.equal(true)
        expect(health.reason).to.equal('ok')
    })
})
