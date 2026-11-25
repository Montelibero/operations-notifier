const Model = require('./base-model')

const SUBSCRIPTION_STATUS = {
    ACTIVE: 1,
    DELETED: 2,
    EXPIRED: 3
}

class SubscriptionModel extends Model {
    /**
     * Who created the subscription
     */
    pubkey
    /**
     * Subscription status (0 - active, 1- deleted, 2-expired)
     */
    status = 0
    /**
     * Version of the filter rules applied to this subscription (see util/subscription-match-helper.js).
     * Missing/1 — original rules, 2 — extended rules. Existing subscriptions are never upgraded implicitly
     * (records without the field are read as 1 by the matcher).
     */
    filter_version = require('../util/subscription-match-helper').CURRENT_FILTER_VERSION
    /**
     * Account to track
     */
    account
    /**
     * Asset type to track (0-native, 1-alphanum4, 2-alphanum12)
     */
    asset_type
    /**
     * Asset code to track
     */
    asset_code
    /**
     * Asset issuer to track
     */
    asset_issuer
    /**
     * Tx memo to track
     */
    memo
    /**
     * Soroban contract address to track (C... — matches invoke_host_function operations)
     */
    contract
    /**
     * Operation types to track
     */
    operation_types
    /**
     * Reaction URL
     */
    reaction_url
    /**
     * Delivery failures counter. Set to 0 on successful delivery
     */
    delivery_failures = 0
    /**
     * Consecutive lost notifications counter. Reset to 0 on successful delivery
     */
    lost_notifications = 0
    /**
     * Notifications sent
     */
    sent = 0
    /**
     * Subscription become inactive after the expiration date (not implemented)
     */
    expires
    /**
     * Created date
     */
    created
    /**
     * Last updated date
     */
    updated
    /**
     * Cached notifications, associated with the subscription
     */
    notifications
}

module.exports = SubscriptionModel

module.exports.CURRENT_FILTER_VERSION = require('../util/subscription-match-helper').CURRENT_FILTER_VERSION
