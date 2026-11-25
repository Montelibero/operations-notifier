const {parseAsset, assetsEqual} = require('./asset-helper')

/**
 * Version of the subscription filters applied to newly created subscriptions.
 *
 * v1 — the original rules (subscriptions created before v0.12.0):
 *     account matches the operation source or the payment destination, the data entry value,
 *     order book `seller_id` in trades; asset matches `asset` or `source_asset` of the operation.
 * v2 — additionally:
 *     account matches `from` (clawback), `trustor` (set_trustline_flags), `sponsoredId`
 *     (begin_sponsoring_future_reserves), claimants of create_claimable_balance, and the
 *     (normalized) destination of path payments and muxed payments;
 *     asset matches the intermediate `path` assets and the assets of the trades;
 *     memo compares the transaction memo value (v1 never matched on memo; such subscriptions need to be recreated as v2).
 *
 * Existing subscriptions keep their behavior: a subscription without `filter_version` is v1.
 */
const CURRENT_FILTER_VERSION = 2

function getFilterVersion(subscription) {
    return subscription.filter_version || 1
}

/** UTF-8 string of a manage_data value (a normalized string or raw bytes). */
function dataValueToString(value) {
    return value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : String(value)
}

function memoValue(operation) {
    const memo = operation.memo ?? operation.transaction_details?.memo
    return memo && typeof memo === 'object' ? memo.value : memo
}

/** Compare the transaction memo value with the subscribed one; hash/return memos may be given as hex. */
function memoMatches(subscription, operation) {
    const value = memoValue(operation)
    if (value === undefined || value === null) return false
    const expected = String(subscription.memo)
    if (String(value) === expected) return true
    if (/^[0-9a-fA-F]{64}$/.test(expected)) return Buffer.from(expected, 'hex').toString('base64') === String(value)
    return false
}

/** Accounts referenced by the operation in roles other than the source, depending on the filter version. */
function referencedAccounts(operation, version) {
    const accounts = []
    // v1 only had a destination on create_account, payment and account_merge; path payments are v2
    const v1DestinationTypes = operation.type_i === undefined || [0, 1, 7, 8].includes(operation.type_i)
    if (operation.destination && (version >= 2 || v1DestinationTypes)) accounts.push(operation.destination)
    if (version >= 2) {
        if (operation.from) accounts.push(operation.from)
        if (operation.trustor) accounts.push(operation.trustor)
        if (operation.sponsoredId) accounts.push(operation.sponsoredId)
        for (const claimant of operation.claimants || []) if (claimant.destination) accounts.push(claimant.destination)
    }
    return accounts
}

function accountMatches(subscription, operation, version) {
    const account = subscription.account
    if (operation.account === account) return true
    if (referencedAccounts(operation, version).includes(account)) return true
    // manage_data: the value may contain the subscribed account
    if (operation.type_i === 10 && operation.value && dataValueToString(operation.value) === account) return true
    // order book trades: the subscribed account's offer was filled by this transaction
    return !!(operation.trades?.length && operation.trades.some(trade => trade.seller_id === account))
}

function assetMatches(subscription, operation, version) {
    const assetToFilter = subscription._cachedAsset || parseAsset(subscription)
    if (assetsEqual(assetToFilter, operation.asset) || assetsEqual(assetToFilter, operation.source_asset)) return true
    if (version >= 2) {
        if ((operation.path || []).some(asset => assetsEqual(assetToFilter, asset))) return true
        if ((operation.trades || []).some(trade => assetsEqual(assetToFilter, trade.asset_sold) || assetsEqual(assetToFilter, trade.asset_bought))) return true
    }
    return false
}

/**
 * Check if an operation matches the subscription filtering conditions.
 * @param {Object} subscription - subscription
 * @param {Object} operation - operation to test
 * @returns {Boolean}
 */
function matches(subscription, operation) {
    const version = getFilterVersion(subscription)
    if (subscription.memo) {
        // v1 compared a non-existent operation.memo field (never matched on real operations) — keep it verbatim
        if (version < 2 ? operation.memo != subscription.memo : !memoMatches(subscription, operation)) return false
    }
    if (subscription.operation_types && subscription.operation_types.length && !subscription.operation_types.includes(operation.type_i)) return false
    if (subscription.contract && operation.contract !== subscription.contract) return false
    if (subscription.account && !accountMatches(subscription, operation, version)) return false
    if (subscription.asset_type && !assetMatches(subscription, operation, version)) return false
    return true
}

module.exports = {matches, CURRENT_FILTER_VERSION, getFilterVersion, referencedAccounts, dataValueToString}
