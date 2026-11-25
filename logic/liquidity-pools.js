const storage = require('./storage'),
    {horizonPool} = require('./stellar-connector'),
    {parseAsset, nativeAsset, isPoolShareAsset} = require('../util/asset-helper'),
    logger = require('../util/logger')

// pool ids that could not be loaded recently (Horizon behind/outage): retry after this delay, do not spam
const RETRY_FAILED_MS = 5 * 60 * 1000
const failedPools = new Map() // pool id → last failure timestamp
const inFlight = new Map() // pool id → pending Horizon request (concurrent transactions share one request)

/**
 * Normalize a Horizon liquidity pool record (`GET /liquidity_pools/{id}`).
 * @param {Object} data - Horizon record with `reserves: [{asset: "native" | "CODE:ISSUER", amount}]`
 * @returns {Object} {pool_id, assets, fee, source}
 */
function normalizeHorizonPool(data) {
    if (!data || typeof data.id !== 'string') throw new Error('malformed liquidity pool record')
    const assets = (data.reserves || []).map(reserve => {
        if (reserve.asset === 'native') return nativeAsset()
        const [code, issuer] = String(reserve.asset).split(':')
        return parseAsset({asset_code: code, asset_issuer: issuer})
    }).filter(Boolean)
    if (assets.length !== 2) throw new Error(`malformed liquidity pool record: expected 2 reserves, got ${assets.length}`)
    return {pool_id: data.id, assets, fee: data.fee_bp, source: 'horizon'}
}

/**
 * One Horizon request per pool id at a time: concurrent transactions share the pending request.
 * @param {string} poolId
 * @param {number} [ledger] - ledger of the transaction that mentioned the pool (for lag diagnostics)
 */
function fetchPoolFromHorizon(poolId, ledger) {
    if (inFlight.has(poolId)) return inFlight.get(poolId)
    const promise = (async () => {
        const data = await horizonPool.call({path: `/liquidity_pools/${poolId}`, ledger})
        const pool = normalizeHorizonPool(data)
        try {
            await storage.saveLiquidityPool(pool)
        } catch (e) {
            logger.warn(`Failed to persist liquidity pool ${poolId}: ${e.message}`) // the pool is still usable this time
        }
        return pool
    })().finally(() => inFlight.delete(poolId))
    inFlight.set(poolId, promise)
    return promise
}

/**
 * Make sure the pools with the given ids are known (cache → storage → Horizon).
 * Unknown pools stay unknown (null) until the next sighting; a failure never throws.
 * @param {string[]} poolIds
 * @param {number} [ledger]
 * @returns {Promise<Map<string, Object|null>>}
 */
async function ensurePools(poolIds, ledger) {
    const result = new Map()
    const ids = [...new Set(poolIds.filter(Boolean))]
    if (!ids.length) return result
    let known = []
    try {
        known = await storage.fetchLiquidityPools(ids)
    } catch (e) {
        logger.warn(`Failed to load liquidity pools from storage: ${e.message}`)
    }
    for (const pool of known) result.set(pool.pool_id, pool)
    const now = Date.now()
    // forget stale failures so the map does not grow forever
    for (const [id, at] of failedPools) if (now - at >= RETRY_FAILED_MS) failedPools.delete(id)
    const missing = ids.filter(id => !result.has(id) && now - (failedPools.get(id) || 0) >= RETRY_FAILED_MS)
    await Promise.all(missing.map(async id => {
        try {
            result.set(id, await fetchPoolFromHorizon(id, ledger))
            failedPools.delete(id)
        } catch (e) {
            failedPools.set(id, now)
            result.set(id, null)
            logger.warn(`Liquidity pool ${id} is not available yet (${e.message}), retrying later`)
        }
    }))
    for (const id of ids) if (!result.has(id)) result.set(id, null)
    return result
}

/**
 * Register a pool known from the envelope (change_trust to a pool share carries the parameters).
 * @param {Object} op - normalized change_trust operation with a pool share asset
 * @returns {Promise<boolean>} resolved when the pool is stored (or rejected: handled)
 */
async function rememberPoolFromEnvelope(op) {
    const poolId = op.asset.liquidity_pool_id
    if (!poolId || !Array.isArray(op.assets) || op.assets.length !== 2) return false
    try {
        await storage.saveLiquidityPool({pool_id: poolId, assets: op.assets, fee: op.fee, source: 'envelope'})
        return true
    } catch (e) {
        logger.warn(`Failed to save liquidity pool ${poolId}: ${e.message}`)
        return false
    }
}

/**
 * Collect the pool ids referenced by a parsed transaction's operations.
 */
function collectPoolIds(tx) {
    const ids = []
    for (const op of tx.operations || []) {
        if (op.type_i === 22 || op.type_i === 23) ids.push(op.liquidityPoolId)
        if (isPoolShareAsset(op.asset)) ids.push(op.asset.liquidity_pool_id)
        for (const trade of op.trades || []) if (trade.type === 'liquidity_pool') ids.push(trade.pool_id)
    }
    return ids
}

/**
 * Attach the asset pair of the referenced liquidity pools to the operations:
 * `assets` on deposit/withdraw/pool-share trustline operations, `pool_assets` on pool trades.
 * A failure to resolve a pool leaves the operation as is — it is still delivered (without the pair).
 * @param {Object} tx - parsed transaction (from parseTransaction)
 * @returns {Promise<Object>} the same transaction
 */
async function enrichTransaction(tx) {
    if (!tx || !Array.isArray(tx.operations)) return tx
    const ids = collectPoolIds(tx)
    if (!ids.length) return tx
    // pool share trustlines carry the pair in the envelope: remember them first so Horizon is not asked about them
    await Promise.all(tx.operations
        .filter(op => isPoolShareAsset(op.asset) && Array.isArray(op.assets))
        .map(op => rememberPoolFromEnvelope(op)))
    const pools = await ensurePools(ids, tx.details && tx.details.ledger)
    for (const op of tx.operations) {
        if (op.type_i === 22 || op.type_i === 23) {
            const pool = pools.get(op.liquidityPoolId)
            if (pool) {
                op.assets = pool.assets
                op.fee = pool.fee
            }
        } else if (isPoolShareAsset(op.asset) && !Array.isArray(op.assets)) {
            const pool = pools.get(op.asset.liquidity_pool_id)
            if (pool) {
                op.assets = pool.assets
                op.fee = pool.fee
            }
        }
        for (const trade of op.trades || []) {
            if (trade.type !== 'liquidity_pool') continue
            const pool = pools.get(trade.pool_id)
            if (pool) trade.pool_assets = pool.assets
        }
    }
    return tx
}

/** Test hook: forget the failed-pool backoff. */
function resetFailedPools() {
    failedPools.clear()
}

module.exports = {enrichTransaction, ensurePools, normalizeHorizonPool, collectPoolIds, resetFailedPools}
