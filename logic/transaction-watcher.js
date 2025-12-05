const {horizon} = require('./stellar-connector'),
    {parseTransaction} = require('./stream-processor'),
    {matches} = require('../util/subscription-match-helper'),
    storage = require('./storage')


/**
 * Tracks transactions using event streaming from Horizon server
 */
class TransactionWatcher {
    constructor(observer) {
        this.queue = []
        this.processing = false
        this.observer = observer
    }

    /**
     * Add transactions to the processing queue
     * @param {Array<Transaction>}transactions
     */
    enqueue(transactions) {
        if (!transactions || !transactions.length) return
        Array.prototype.push.apply(this.queue, transactions)
        this.processQueue()
    }

    /**
     * Pick the entry from the queue and process it
     */
    processQueue() {
        //TODO: check method performance under the maximum load
        if (!this.observer.subscriptions || !this.observer.observing || !this.queue.length || this.processing) return
        this.processing = true
        const rawTx = this.queue.pop(),
            tx = parseTransaction(rawTx),
            notifications = [],
            relevantSubscriptions = new Set()

        if (!tx) { //failed to parse transaction
            this.processing = false
            return this.processQueue()
        }
        for (const operation of tx.operations) {
            //create a notification
            let notification = {
                payload: operation,
                subscriptions: []
            }
            //iterate through subscriptions
            for (const subscription of this.observer.subscriptions) {
                //TODO: ignore subscriptions that were added AFTER the tx ledger close date to prevent false notifications on fast-forwarding
                //find subscriptions that match an operation
                if (matches(subscription, operation)) {
                    //associate a subscription with current notification
                    notification.subscriptions.push(subscription.id)
                    //will use it once notifications are persisted
                    relevantSubscriptions.add(subscription)
                    //mark subscription as ready to be processed
                    subscription.processed = false
                }
            }

            //process a notification if at least one match was found
            if (notification.subscriptions.length) {
                notifications.push(notification)
            }
        }

        this.observer.notifier.createNotifications(notifications)
            .then(notifications => {
                storage.updateLastIngestedTx(tx.details.paging_token)
                    .catch(err => console.error(err))
                //iterate through processed subscriptions
                for (let subscription of relevantSubscriptions) {
                    //cache notifications directly inside the subscription
                    if (!subscription.notifications) {
                        subscription.notifications = new Set()
                    }
                    for (let notification of notifications) {
                        if (notification.subscriptions.some(s => s == subscription.id)) {
                            subscription.notifications.add(notification)
                        }
                    }
                }

                this.processing = false
                setImmediate(() => this.processQueue())
                this.observer.notifier.startNewNotifierThread()
            })
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
        this.trackLiveStream()
    }

    /**
     * Track live transactions stream from the Horizon server
     */
    trackLiveStream() {
        //subscribe to transactions live stream
        this.releaseStream = horizon
            .transactions()
            .order('asc')
            .cursor(this.cursor || 'now')
            .stream({
                onmessage: rawTx => {
                    this.reconnectDelay = undefined
                    this.enqueue([rawTx])
                },
                onerror: err => {
                    this.stopWatching()
                    if (err.response && err.response.status === 429) {
                        const retryAfter = (parseInt(err.response.headers['x-ratelimit-reset']) || 10) * 1000
                        console.log(`Horizon rate limit reached. Resuming in ${retryAfter / 1000} seconds.`)
                        this.reconnectDelay = retryAfter
                    }
                    else {
                        //initiate reconnection sequence with exponential backoff
                        if (this.reconnectDelay) {
                            this.reconnectDelay *= 2
                        } else {
                            this.reconnectDelay = 1000
                        }
                        if (this.reconnectDelay > 60000) {
                            this.reconnectDelay = 60000
                        }
                    }
                    setTimeout(() => this.watch(), this.reconnectDelay)
                }
            })
    }

    /**
     * Terminates watching stream
     */
    stopWatching() {
        this.releaseStream && this.releaseStream()
    }
}

module.exports = TransactionWatcher