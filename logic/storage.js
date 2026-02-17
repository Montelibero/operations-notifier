const {StrKey, xdr} = require('@stellar/stellar-sdk'),
    BigNumber = require('bignumber.js'),
    {parseAsset} = require('../util/asset-helper'),
    errors = require('../util/errors'),
    logger = require('../util/logger')

let lastIngested,
    storageProviders = {
        mongodb: '../persistence-layer/mongodb-storage-provider',
        memory: '../persistence-layer/memory-storage-provider'
    }

function isLastIngestedCursorNewer(newIngestedTxSequence) {
    return new BigNumber(newIngestedTxSequence || '0').comparedTo(new BigNumber(lastIngested || '0')) === -1
}

class Storage {
    /**
     * Initialize the storage
     */
    init(config) {
        //get storage provider name from config
        let provider = storageProviders[config.storageProvider]
        //use in-memory storage provider by default
        if (!provider) {
            provider = 'memory'
        }
        //it can be a string containing a path to module
        if (typeof provider === 'string') {
            provider = require(provider)
        }
        //initialize storage provider
        this.provider = new provider()

        if (!(this.provider instanceof require('../persistence-layer/storage-provider'))) throw new TypeError('Invalid storage provider')
        logger.info(`Using "${config.storageProvider}" storage provider.`)

        return this.provider.init(config)
    }

    /**
     * Retrieve subscriptions from db
     * @returns {Promise<Subscription[]>}
     */
    fetchSubscriptions() {
        return this.provider.fetchSubscriptions()
    }

    /**
     * Retrieve subscription by id
     * @param {*} id - subscription id
     * @returns {Promise<Subscription>}
     */
    fetchSubscription(id) {
        return this.provider.fetchSubscription(id)
            .then(subscription => {
                if (!subscription) return Promise.reject(errors.notFound())
                return subscription
            })
    }

    /**
     * Load next notification from db
     * @param {*} subscriptionId - subscription id
     * @returns {Promise<Notification>}
     */
    fetchNextNotification(subscriptionId) {
        return this.provider.fetchNextNotification(subscriptionId)
    }

    /**
     * Store notifications in the database
     * @param notifications
     * @returns {Promise<int>}
     */
    createNotifications(notifications) {
        return this.provider.createNotifications(notifications)
    }

    /**
     * Retrieve last ingested tx sequence.
     * @returns {Promise<string>}
     */
    getLastIngestedTx() {
        if (lastIngested !== undefined) return Promise.resolve(lastIngested)
        return this.provider.getLastIngestedTx()
            .then(pointer => {
                lastIngested = pointer || null
                return lastIngested
            })
            .catch(e => {
                errors.handleSystemError(e)
                return null
            })
    }

    /**
     * Removes subscription from notification subscriptions set.
     * @param {Notification} notification - notification to save
     * @param {Subscription} subscription - processed subscription
     * @returns {Promise<Notification>}
     */
    markAsProcessed(notification, subscription) {
        //update the notification
        return this.provider.markAsProcessed(notification, subscription)
            .then(()=>{
                //notification was successfully sent to all recipients
                if (!notification.subscriptions.length) return this.provider.removeNotification(notification)
            })
    }

    saveSubscription(subscription) {
        return this.provider.saveSubscription(subscription)
    }

    /**
     * Persists last processed tx sequence to DB.
     * @param {string} ingestedTxSequence - last processed tx sequence
     * @returns {Promise<string>}
     */
    updateLastIngestedTx(ingestedTxSequence) {
        if (isLastIngestedCursorNewer(ingestedTxSequence)) return Promise.resolve(lastIngested)

        return this.provider.updateLastIngestedTx(ingestedTxSequence)
            .then(() => {
                if (!isLastIngestedCursorNewer(ingestedTxSequence)) {
                    lastIngested = ingestedTxSequence
                }
                return lastIngested
            })
    }

    /**
     * Stops the provider
     */

    finalize(){
        return this.provider.finalize()
    }

    /**
     * Create a subscription from request.
     * @param {Object} subscriptionParams - subscriptions filter params
     * @param {User} user - subscription owner
     * @returns {Promise<Subscription>}
     */
    createSubscription(subscriptionParams, user) {
        const result = this._validateSubscriptionParams(subscriptionParams, user)
        if (result.error) return Promise.reject(result.error)
        return this.provider.saveSubscription(result.subscription)
    }

    /**
     * Validate and build a subscription object from request params.
     * @param {Object} subscriptionParams
     * @param {User} user
     * @returns {{error: Object}|{subscription: Object}} - error or valid subscription
     */
    _validateSubscriptionParams(subscriptionParams, user) {
        if (!subscriptionParams)
            return {error: errors.badRequest('Subscription params were not provided.')}

        if (!subscriptionParams.reaction_url)
            return {error: errors.validationError('reaction_url', 'Reaction URL is required.')}

        if (!/^(?:http(s)?:\/\/)[\w\-\._~:/?#[\]@!\$&'\(\)\*\+,;=.]+$/.test(subscriptionParams.reaction_url))
            return {error: errors.validationError('reaction_url', 'Reaction URL is required.')}

        let subscription = {
                pubkey: user ? user.pubkey : null,
                reaction_url: subscriptionParams.reaction_url,
                lost_notifications: 0
            },
            isValid = false

        if (subscriptionParams.account) {
            if (!StrKey.isValidEd25519PublicKey(subscriptionParams.account))
                return {error: errors.validationError('account', 'Invalid Stellar account address.')}
            subscription.account = subscriptionParams.account
            isValid = true
        }

        if (subscriptionParams.memo) {
            if (typeof subscriptionParams.memo === 'string' && subscriptionParams.memo.length > 64)
                return {error: errors.validationError('memo', 'Invalid memo format. String is too long.')}
            subscription.memo = '' + subscriptionParams.memo
            isValid = true
        }

        if (subscriptionParams.operation_types) {
            let optypes = subscriptionParams.operation_types
            if (!(optypes instanceof Array)) {
                optypes = ('' + optypes).split(',')
            }
            if (optypes.length > 0) {
                optypes = optypes.map(v => parseInt(v))
                const validOpTypes = new Set(Object.values(xdr.OperationType._members).map(m => m.value))
                if (optypes.some(v => isNaN(v) || !validOpTypes.has(v)))
                    return {error: errors.validationError('operation_types', `Invalid operation type specified. Parameter operation_types should be an array of integers matching existing operation types (valid values: ${[...validOpTypes].sort((a, b) => a - b).join(', ')}).`)}
                subscription.operation_types = optypes
                isValid = true
            }
        }

        if (subscriptionParams.asset_code) {
            let assetProps = parseAsset(subscriptionParams)
            if (!assetProps)
                return {error: errors.validationError('asset', 'Invalid asset format. Check https://www.stellar.org/developers/guides/concepts/assets.html#anchors-issuing-assets.')}
            Object.assign(subscription, assetProps)
            isValid = true
        }

        if (!isValid) return {error: errors.badRequest('No operation filter params were provided.')}

        if (subscriptionParams.expires) {
            let rawDate = subscriptionParams.expires
            if (typeof rawDate === 'number' || typeof rawDate === 'string' && /^\d{1,13}$/.test(rawDate)) {
                rawDate = parseInt(rawDate)
            }
            let expirationDate = new Date(rawDate)
            if (isNaN(expirationDate.getTime()))
                return {error: errors.validationError('expires', 'Invalid expiration date format.')}
            if (expirationDate < new Date())
                return {error: errors.validationError('expires', 'Expiration date cannot be less than current date.')}
            subscription.expires = expirationDate
        }

        return {subscription}
    }

    /**
     * Create multiple subscriptions from request params (batch).
     * @param {Object[]} paramsArray - array of subscription filter params
     * @param {User} user - subscription owner
     * @returns {Promise<Object[]>}
     */
    createSubscriptions(paramsArray, user) {
        const subscriptions = []
        for (const params of paramsArray) {
            const result = this._validateSubscriptionParams(params, user)
            if (result.error) return Promise.reject(result.error)
            subscriptions.push(result.subscription)
        }
        return this.provider.saveSubscriptions(subscriptions)
    }

    static registerStorageProvider(providerName, provider) {
        storageProviders[providerName] = provider
    }

    
}

module.exports = new Storage()
