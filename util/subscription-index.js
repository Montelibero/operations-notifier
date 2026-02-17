const {parseAsset} = require('./asset-helper')
const {matches} = require('./subscription-match-helper')

/**
 * Index subscriptions by account for O(1) lookup instead of O(N) linear scan.
 *
 * Structure:
 *   accountIndex: Map<account, Set<subscription>>  — subscriptions filtered by account
 *   catchAll: Set<subscription>                    — subscriptions without account filter (checked for every operation)
 */
class SubscriptionIndex {
    constructor() {
        this.accountIndex = new Map()
        this.catchAll = new Set()
    }

    /**
     * Build index from an array of subscriptions (replaces any previous index).
     * @param {Array} subscriptions
     */
    buildFrom(subscriptions) {
        this.accountIndex = new Map()
        this.catchAll = new Set()
        for (const sub of subscriptions) {
            this.add(sub)
        }
    }

    /**
     * Add a single subscription to the index and cache its parsed asset.
     * @param {Object} subscription
     */
    add(subscription) {
        this._cacheAsset(subscription)
        if (subscription.account) {
            let set = this.accountIndex.get(subscription.account)
            if (!set) {
                set = new Set()
                this.accountIndex.set(subscription.account, set)
            }
            set.add(subscription)
        } else {
            this.catchAll.add(subscription)
        }
    }

    /**
     * Remove a subscription from the index.
     * @param {Object} subscription
     */
    remove(subscription) {
        if (subscription.account) {
            const set = this.accountIndex.get(subscription.account)
            if (set) {
                set.delete(subscription)
                if (set.size === 0) {
                    this.accountIndex.delete(subscription.account)
                }
            }
        } else {
            this.catchAll.delete(subscription)
        }
    }

    /**
     * Find all subscriptions that match an operation.
     * Uses the index to narrow candidates, then runs full matches() on each.
     * @param {Object} operation
     * @returns {Array} matched subscriptions
     */
    findMatches(operation) {
        const candidates = this._getCandidates(operation)
        const result = []
        for (const sub of candidates) {
            if (matches(sub, operation)) {
                result.push(sub)
            }
        }
        return result
    }

    /**
     * Gather candidate subscriptions from the index based on accounts in the operation.
     * Always includes catchAll subscriptions.
     * @param {Object} operation
     * @returns {Set} candidate subscriptions
     */
    _getCandidates(operation) {
        const candidates = new Set(this.catchAll)

        // Primary: operation.account
        if (operation.account) {
            const set = this.accountIndex.get(operation.account)
            if (set) {
                for (const sub of set) candidates.add(sub)
            }
        }

        // Destination (payments, path_payments, etc.)
        if (operation.destination) {
            const set = this.accountIndex.get(operation.destination)
            if (set) {
                for (const sub of set) candidates.add(sub)
            }
        }

        // manage_data (type_i=10): value may contain a subscribed account
        if (operation.type_i === 10 && operation.value) {
            const valueStr = Buffer.isBuffer(operation.value)
                ? operation.value.toString('utf8')
                : String(operation.value)
            const set = this.accountIndex.get(valueStr)
            if (set) {
                for (const sub of set) candidates.add(sub)
            }
        }

        // Trades: seller_id for path_payment operations
        if (operation.trades && operation.trades.length) {
            for (const trade of operation.trades) {
                if (trade.seller_id) {
                    const set = this.accountIndex.get(trade.seller_id)
                    if (set) {
                        for (const sub of set) candidates.add(sub)
                    }
                }
            }
        }

        return candidates
    }

    /**
     * Pre-compute parseAsset() and store on the subscription object.
     * @param {Object} subscription
     */
    _cacheAsset(subscription) {
        if (subscription.asset_type && !subscription._cachedAsset) {
            subscription._cachedAsset = parseAsset(subscription)
        }
    }
}

module.exports = SubscriptionIndex
