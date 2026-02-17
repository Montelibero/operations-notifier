const errors = require('../util/errors'),
    TransactionWatcher = require('./transaction-watcher'),
    Notifier = require('./notifier'),
    SubscriptionIndex = require('../util/subscription-index'),
    storage = require('./storage'),
    config = require('../models/config'),
    logger = require('../util/logger')

function arraysEqual(a, b) {
    if (a === b) return true
    if (!a && !b) return true
    if (!a || !b) return false
    if (a.length !== b.length) return false
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()
    return sortedA.every((v, i) => v === sortedB[i])
}

const DEDUP_FIELDS = ['pubkey', 'reaction_url', 'account', 'memo', 'asset_type', 'asset_code', 'asset_issuer']

function subscriptionHash(s) {
    const opTypes = s.operation_types ? [...s.operation_types].sort().join(',') : ''
    return JSON.stringify(DEDUP_FIELDS.map(f => s[f] || '').concat(opTypes))
}

/**
 *
 */
class Observer {
    constructor() {
        this.notifier = new Notifier(this)
        this.transactionWatcher = new TransactionWatcher(this)
        this.subscriptionIndex = new SubscriptionIndex()
        this.observing = false
    }

    loadSubscriptions() {
        //return subscriptions if they were fetched already
        if (this.subscriptions) return Promise.resolve(this.subscriptions)
        // return the loading promise if the loading is already in progress
        if (this.__loadingSubscriptionPromise) return this.__loadingSubscriptionPromise
        //load only active subscriptions
        this.__loadingSubscriptionPromise = storage.fetchSubscriptions()
            .then(fetched => {
                this.subscriptions = fetched || []
                this.subscriptionIndex.buildFrom(this.subscriptions)
                this.__loadingSubscriptionPromise = undefined
                if (this.transactionWatcher && typeof this.transactionWatcher.processQueue === 'function') {
                    this.transactionWatcher.processQueue()
                }
                return this.subscriptions
            })
        return this.__loadingSubscriptionPromise
    }

    getActiveSubscriptionsCount() {
        return this.subscriptions.length
    }

    getUserActiveSubscriptionsCount(user) {
        return this.subscriptions.filter(s => s.pubkey === user.pubkey).length
    }

    _buildDedupSet() {
        const set = new Set()
        for (const s of this.subscriptions) {
            set.add(subscriptionHash(s))
        }
        return set
    }

    subscribe(subscriptionParams, user) {
        return this.loadSubscriptions()
            .then(() => {
                if (this.getActiveSubscriptionsCount() >= config.maxActiveSubscriptions) {
                    return Promise.reject(errors.forbidden('Max active subscriptions exceeded.'))
                }
                const maxPerUser = config.maxActiveSubscriptionsPerUser || config.maxUserActiveSubscriptions
                if (config.authorization && maxPerUser && this.getUserActiveSubscriptionsCount(user) >= maxPerUser) {
                    return Promise.reject(errors.forbidden('Max active subscriptions exceeded.'))
                }
                const hash = subscriptionHash(subscriptionParams)
                const dedupSet = this._buildDedupSet()
                if (dedupSet.has(hash)) {
                    return this.subscriptions.find(s => subscriptionHash(s) === hash)
                }
                return storage.createSubscription(subscriptionParams, user)
            })
            .then(subscription => {
                if (!this.subscriptions.includes(subscription)) {
                    this.subscriptions.push(subscription)
                    this.subscriptionIndex.add(subscription)
                    logger.info(`Subscription created: id=${subscription.id} pubkey=${subscription.pubkey || 'anonymous'}`)
                }
                return subscription
            })
    }

    subscribeBatch(paramsArray, user) {
        if (!Array.isArray(paramsArray) || paramsArray.length === 0) {
            return Promise.reject(errors.badRequest('Expected a non-empty array of subscription params.'))
        }
        return this.loadSubscriptions()
            .then(() => {
                const totalAfter = this.getActiveSubscriptionsCount() + paramsArray.length
                if (totalAfter > config.maxActiveSubscriptions) {
                    return Promise.reject(errors.forbidden('Max active subscriptions exceeded.'))
                }
                const maxPerUser = config.maxActiveSubscriptionsPerUser || config.maxUserActiveSubscriptions
                if (config.authorization && maxPerUser) {
                    const userCount = this.getUserActiveSubscriptionsCount(user)
                    if (userCount + paramsArray.length > maxPerUser) {
                        return Promise.reject(errors.forbidden('Max active subscriptions exceeded.'))
                    }
                }

                const dedupSet = this._buildDedupSet()
                const results = []
                const toCreate = []
                const batchHashMap = new Map() // hash → index in toCreate

                for (let i = 0; i < paramsArray.length; i++) {
                    const params = paramsArray[i]
                    const hash = subscriptionHash(params)
                    if (dedupSet.has(hash)) {
                        // existing subscription or within-batch duplicate
                        const existing = this.subscriptions.find(s => subscriptionHash(s) === hash)
                        if (existing) {
                            results.push({existing})
                        } else {
                            // within-batch duplicate — reference first occurrence
                            results.push({createIndex: batchHashMap.get(hash)})
                        }
                    } else {
                        dedupSet.add(hash)
                        batchHashMap.set(hash, toCreate.length)
                        results.push({createIndex: toCreate.length})
                        toCreate.push(params)
                    }
                }

                if (toCreate.length === 0) {
                    return results.map(r => r.existing)
                }

                return storage.createSubscriptions(toCreate, user)
                    .then(created => {
                        for (const sub of created) {
                            this.subscriptions.push(sub)
                            this.subscriptionIndex.add(sub)
                            logger.info(`Subscription created: id=${sub.id} pubkey=${sub.pubkey || 'anonymous'}`)
                        }
                        return results.map(r => r.existing != null ? r.existing : created[r.createIndex])
                    })
            })
    }

    unsubscribe(subscriptionId) {
        return this.loadSubscriptions()
            .then(() => {
                for (let i = 0; i < this.subscriptions.length; i++) {
                    let s = this.subscriptions[i]
                    //match subscription by id
                    if (s.id == subscriptionId) { //intended non-strict comparision
                        s.status = 1
                        this.subscriptionIndex.remove(s)
                        this.subscriptions.splice(i, 1)
                        logger.info(`Subscription removed: id=${s.id} pubkey=${s.pubkey || 'anonymous'}`)
                        if (typeof s.save === 'function') return s.save()
                        return Promise.resolve(s)
                    }
                }

                return Promise.reject(errors.notFound())
            })
    }

    getActiveSubscriptions() {
        return this.loadSubscriptions()
            .then(subscriptions => subscriptions.slice(0)) //copy array with subscriptions
    }

    getSubscription(subscriptionId) {
        return this.loadSubscriptions()
            .then(() => {
                let subscription = this.subscriptions.find(s => s.id == subscriptionId)
                if (subscription) return subscription
                //try to load the subscription from db (it may be disabled or expired)
                return storage.fetchSubscription(subscriptionId)
            })
    }

    start() {
        if (this.observing) throw new Error('Observer has been started already.')
        this.observing = true
        this.transactionWatcher.watch()
        this.loadSubscriptions()
            .then(() => {
                this.transactionWatcher.processQueue()
                this.notifier.startNewNotifierThread()
            })
    }

    stop() {
        this.observing = false
        this.transactionWatcher.stopWatching()
    }
}

module.exports = new Observer()
