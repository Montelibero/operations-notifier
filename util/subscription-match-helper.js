const {parseAsset, assetsEqual} = require('./asset-helper')

/**
 * Check if an operation matches the subscription filtering conditions.
 * @param {Object} subscription - subscription
 * @param {Object} operation - operation to test
 * @returns {Boolean}
 */
function matches(subscription, operation) {
    if (subscription.memo && operation.memo != subscription.memo) return false //intended type casting
    if (subscription.operation_types && subscription.operation_types.length && !subscription.operation_types.includes(operation.type_i)) return false
    if (subscription.account && operation.account !== subscription.account && operation.destination !== subscription.account) {
        // For manage_data operations, also check if value contains the subscribed address
        if (operation.type_i === 10 && operation.value) {
            const valueStr = Buffer.isBuffer(operation.value)
                ? operation.value.toString('utf8')
                : String(operation.value)
            if (valueStr !== subscription.account) return false
        // For path_payment operations, check if seller_id in trades matches subscription account
        } else if (operation.trades?.length) {
            const hasMatchingSeller = operation.trades.some(
                trade => trade.seller_id === subscription.account
            )
            if (!hasMatchingSeller) return false
        } else {
            return false
        }
    }
    if (subscription.asset_type) {
        const assetToFilter = parseAsset(subscription)
        return assetsEqual(assetToFilter, operation.asset) || assetsEqual(assetToFilter, operation.source_asset)
    }
    return true
}

module.exports = {matches}