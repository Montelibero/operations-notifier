const sinon = require('sinon')
const TransactionWatcher = require('../logic/transaction-watcher')
const { horizon } = require('../logic/stellar-connector')
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
        sinon.stub(horizon, 'transactions').returns({
            cursor() { return this },
            order() { return this },
            limit() { return this },
            call: sinon.stub().rejects({
                message: 'Service Unavailable',
                response: { status: 503, headers: {} }
            })
        })

        watcher.trackTransactions()
        await Promise.resolve()
        await Promise.resolve()

        await clock.tickAsync(1000)

        expect(watcher.watch.calledOnce).to.equal(true)
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
})
