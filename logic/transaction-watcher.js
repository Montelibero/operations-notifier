const config = require('../models/config'),
    {horizon} = require('./stellar-connector'),
    {parseTransaction} = require('./stream-processor'),
    {matches} = require('../util/subscription-match-helper'),
    storage = require('./storage')

const transactionsBatchSize = 200

/**
 * Get header value case-insensitively
 * @param {Object} headers - HTTP headers object
 * @param {string} name - Header name to find
 * @returns {string|undefined} Header value or undefined
 */
function getHeader(headers, name) {
    if (!headers) return undefined
    // Try exact match first
    if (headers[name] !== undefined) return headers[name]
    // Try lowercase (axios normalizes to lowercase)
    const lower = name.toLowerCase()
    if (headers[lower] !== undefined) return headers[lower]
    // Try uppercase
    const upper = name.toUpperCase()
    if (headers[upper] !== undefined) return headers[upper]
    // Search through all keys case-insensitively
    const lowerName = name.toLowerCase()
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lowerName) {
            return headers[key]
        }
    }
    return undefined
}

function fetchTransactions(cursor, ledgerSequence = undefined) {
    let builder = horizon
        .transactions()
    if (ledgerSequence !== undefined) {
        builder = builder.forLedger(ledgerSequence)
    }
    if (cursor !== undefined) {
        builder = builder.cursor(cursor)
    }
    return builder
        .order('asc')
        .limit(transactionsBatchSize)
        .call()
}

/**
 * Tracks transactions using event streaming from Horizon server
 */
class TransactionWatcher {
    constructor(observer) {
        this.queue = []
        this.ledgerQueue = []
        this.ledgerInProgress = 0
        this.maxLedgerWorkers = Math.max(1, parseInt(config.ledgerWorkers || 10))
        this.txInProgress = 0
        this.maxTxWorkers = Math.max(1, parseInt(config.transactionWorkers || 10))
        this.observer = observer
        this.lastLedger = null
        this.lastLedgerSeen = null
        this.lastLedgerProcessed = null
        this.lastTxPagingToken = null
        this.lastTxHash = null
        this.highestProcessedPagingToken = null
        this.lastLagLogAt = 0
        this.streaming = false
    }

    /**
     * Add transactions to the processing queue
     * @param {Array<Transaction>}transactions
     */
    enqueue(transactions) {
        if (!transactions || !transactions.length) return
        Array.prototype.push.apply(this.queue, transactions)
        // Spawn multiple workers
        const workersToStart = Math.min(this.maxTxWorkers, transactions.length)
        for (let i = 0; i < workersToStart; i++) {
            setImmediate(() => this.processQueue())
        }
    }

    enqueueLedger(sequence) {
        if (!sequence) return
        this.ledgerQueue.push(sequence)
        this.processLedgerQueue()
    }

    processLedgerQueue() {
        if (!this.streaming) return
        while (this.ledgerInProgress < this.maxLedgerWorkers && this.ledgerQueue.length) {
            const sequence = this.ledgerQueue.shift()
            this.ledgerInProgress++
            this.loadLedgerTransactions(sequence)
                .catch(err => console.error(err))
                .finally(() => {
                    this.ledgerInProgress--
                    setImmediate(() => this.processLedgerQueue())
                })
        }
    }

    /**
     * Pick entries from the queue and process them with worker pool
     */
    processQueue() {
        if (!this.observer.subscriptions || !this.observer.observing) return

        // Spawn workers up to the limit
        while (this.txInProgress < this.maxTxWorkers && this.queue.length > 0) {
            const rawTx = this.queue.shift() // FIFO order
            if (!rawTx) break

            this.txInProgress++
            this.processTransaction(rawTx)
                .catch(err => console.error('Transaction processing error:', err))
                .finally(() => {
                    this.txInProgress--
                    setImmediate(() => this.processQueue())
                })
        }
    }

    /**
     * Process a single transaction
     * @param {Object} rawTx - Raw transaction from Horizon
     * @returns {Promise}
     */
    processTransaction(rawTx) {
        return new Promise((resolve, reject) => {
            const tx = parseTransaction(rawTx),
                notifications = [],
                relevantSubscriptions = new Set()

            if (!tx) { // Failed to parse transaction
                return resolve()
            }

            const txLedger = rawTx && rawTx.ledger_attr
            if (typeof this.lastLedgerSeen === 'number' && typeof txLedger === 'number') {
                const lag = this.lastLedgerSeen - txLedger
                if (lag > 20) {
                    const now = Date.now()
                    if (!this.lastLagLogAt || now - this.lastLagLogAt > 5000) {
                        console.log(`Lagging by ${lag} ledgers (tx ledger ${txLedger}, latest ${this.lastLedgerSeen}).`)
                        this.lastLagLogAt = now
                    }
                }
            }

            for (const operation of tx.operations) {
                // Create a notification
                let notification = {
                    payload: operation,
                    subscriptions: []
                }
                // Iterate through subscriptions
                for (const subscription of this.observer.subscriptions) {
                    // TODO: ignore subscriptions that were added AFTER the tx ledger close date to prevent false notifications on fast-forwarding
                    // Find subscriptions that match an operation
                    if (matches(subscription, operation)) {
                        // Associate a subscription with current notification
                        notification.subscriptions.push(subscription.id)
                        // Will use it once notifications are persisted
                        relevantSubscriptions.add(subscription)
                        // Mark subscription as ready to be processed
                        subscription.processed = false
                    }
                }

                // Process a notification if at least one match was found
                if (notification.subscriptions.length) {
                    notifications.push(notification)
                }
            }

            this.observer.notifier.createNotifications(notifications)
                .then(createdNotifications => {
                    const savedNotifications = createdNotifications || notifications

                    // Thread-safe update of highest paging token
                    this.updateHighestPagingToken(tx.details.paging_token)

                    // Iterate through processed subscriptions
                    for (let subscription of relevantSubscriptions) {
                        // Cache notifications directly inside the subscription
                        if (!subscription.notifications) {
                            subscription.notifications = new Set()
                        }
                        for (let notification of savedNotifications) {
                            if (notification.subscriptions.some(s => s == subscription.id)) {
                                subscription.notifications.add(notification)
                            }
                        }
                    }

                    this.observer.notifier.startNewNotifierThread()
                    resolve()
                })
                .catch(err => {
                    console.error(err)
                    resolve() // Don't reject, continue processing other transactions
                })
        })
    }

    /**
     * Thread-safe update of highest processed paging token
     * @param {string} pagingToken - Paging token from processed transaction
     */
    updateHighestPagingToken(pagingToken) {
        const current = BigInt(this.highestProcessedPagingToken || '0')
        const incoming = BigInt(pagingToken || '0')

        if (incoming > current) {
            this.highestProcessedPagingToken = pagingToken
            storage.updateLastIngestedTx(pagingToken)
                .catch(err => console.error('Failed to update last ingested tx:', err))
        }
    }

    /**
     * Start watching
     */
    watch() {
        if (this.releaseStream) return
        storage.getLastIngestedTx()
            .then(cursor => {
                this.cursor = cursor
                this.trackTransactions()
            })
    }

    /**
     * Fast-forward transaction tracking from the last known tx
     */
    trackTransactions() {
        if (!this.observer.observing) return // redundant check
        if (!this.cursor || this.cursor === '0') return this.trackLiveStream()

        fetchTransactions(this.cursor)
            .then(({records}) => {
                if (!records || !records.length) {
                    this.trackLiveStream()
                } else {
                    const lastTx = records[records.length - 1]
                    this.lastTxPagingToken = lastTx.paging_token
                    this.lastTxHash = lastTx.hash
                    this.lastLedger = lastTx.ledger_attr
                    this.enqueue(records)
                    setImmediate(() => this.trackTransactions())
                }
            })
            .catch(err => {
                const delay = this.getRateLimitDelay(err)
                if (delay !== null) {
                    this.reconnectDelay = delay
                    return setTimeout(() => this.trackTransactions(), delay)
                }
                console.error(err)
                this.stopWatching()
            })
    }

    /**
     * Track live transactions stream from the Horizon server
     */
    trackLiveStream() {
        this.streaming = true
        console.log('Starting ledger stream...')
        this.releaseStream = horizon
            .ledgers()
            .order('asc')
            .cursor('now')
            .stream({
                onmessage: rawLedger => {
                    this.reconnectDelay = undefined
                    this.lastLedger = rawLedger.sequence
                    this.lastLedgerSeen = rawLedger.sequence
                    console.log(`Ledger received: ${rawLedger.sequence}`)
                    this.enqueueLedger(rawLedger.sequence)
                },
                onerror: err => {
                    const status = err && (err.status || (err.response && err.response.status))
                    const headers = err && err.response && err.response.headers
                    const reset = getHeader(headers, 'X-RateLimit-Reset')
                    this.stopWatching()
                    if (status === 429) {
                        const resetValue = parseInt(reset)
                        this.reconnectDelay = (!isNaN(resetValue) && resetValue > 0 ? resetValue : 10) * 1000
                        console.log(`Ledger stream error (status 429). Waiting ${this.reconnectDelay / 1000}s before reconnect.`)
                    }
                    else {
                        const detail = status ? `status ${status}` : (err && err.message ? err.message : 'unknown error')
                        //initiate reconnection sequence with exponential backoff
                        if (this.reconnectDelay) {
                            this.reconnectDelay *= 2
                        } else {
                            this.reconnectDelay = 1000
                        }
                        if (this.reconnectDelay > 60000) {
                            this.reconnectDelay = 60000
                        }
                        console.log(`Ledger stream error (${detail}). Reconnecting in ${this.reconnectDelay / 1000}s...`)
                    }
                    setTimeout(() => this.watch(), this.reconnectDelay)
                }
            })
    }

    getRateLimitDelay(err) {
        if (!err || !err.response || err.response.status !== 429) return null
        const headers = err.response.headers || {}
        const resetHeader = getHeader(headers, 'X-RateLimit-Reset')
        const reset = parseInt(resetHeader)
        const delaySeconds = !isNaN(reset) && reset > 0 ? reset : 10
        console.log(`Horizon rate limit reached. Retrying in ${delaySeconds} seconds.`)
        return delaySeconds * 1000
    }

    loadLedgerTransactions(sequence, txCursor) {
        return new Promise((resolve, reject) => {
            let notFoundRetries = 0
            const fetchLedgerTxBatch = () => {
                fetchTransactions(txCursor, sequence)
                    .then(({records}) => {
                        const txCount = records?.length || 0
                        if (!records || !records.length) {
                            this.lastLedgerProcessed = sequence
                            if (sequence % 10 === 0) {
                                console.log(`Ledger ${sequence} processed (0 transactions)`)
                            }
                            return resolve()
                        }
                        this.enqueue(records)
                        const fetchedCount = records.length
                        const lastTx = records[fetchedCount - 1]
                        this.lastTxPagingToken = lastTx.paging_token
                        this.lastTxHash = lastTx.hash
                        this.lastLedgerProcessed = lastTx.ledger_attr
                        if (this.lastLedgerSeen === null && typeof lastTx.ledger_attr === 'number') {
                            this.lastLedgerSeen = lastTx.ledger_attr
                            this.lastLedger = lastTx.ledger_attr
                        }
                        if (fetchedCount < transactionsBatchSize) {
                            console.log(`Ledger ${sequence} processed (${txCount} transactions)`)
                            return resolve()
                        }
                        fetchLedgerTxBatch(lastTx.paging_token)
                    })
                    .catch(e => {
                        const delay = this.getRateLimitDelay(e)
                        if (delay !== null) {
                            this.reconnectDelay = delay
                            return setTimeout(fetchLedgerTxBatch, delay)
                        }
                        const status = e && e.response && e.response.status
                        if ((status === 404 || status === 502 || status === 503 || status === 504) && notFoundRetries < 5) {
                            notFoundRetries++
                            return setTimeout(fetchLedgerTxBatch, 1000)
                        }
                        reject(e)
                    })
            }
            fetchLedgerTxBatch(txCursor)
        })
    }

    /**
     * Terminates watching stream
     */
    stopWatching() {
        this.streaming = false
        if (this.releaseStream) {
            this.releaseStream()
            this.releaseStream = null
        }
    }

    /**
     * Returns current watcher status
     */
    getStatus() {
        const ledgerLag = (typeof this.lastLedgerSeen === 'number' && typeof this.lastLedgerProcessed === 'number')
            ? this.lastLedgerSeen - this.lastLedgerProcessed
            : null
        return {
            streaming: this.streaming && !!this.releaseStream,
            lastLedger: this.lastLedgerSeen ?? this.lastLedger ?? null,
            lastLedgerSeen: this.lastLedgerSeen ?? null,
            lastLedgerProcessed: this.lastLedgerProcessed ?? null,
            ledgerLag,
            lastTxPagingToken: this.lastTxPagingToken,
            lastTxHash: this.lastTxHash,
            queueLength: this.queue.length,
            ledgerQueueLength: this.ledgerQueue.length,
            ledgerInProgress: this.ledgerInProgress,
            ledgerWorkers: this.maxLedgerWorkers,
            txInProgress: this.txInProgress,
            txWorkers: this.maxTxWorkers,
            reconnectDelay: this.reconnectDelay
        }
    }
}

module.exports = TransactionWatcher
