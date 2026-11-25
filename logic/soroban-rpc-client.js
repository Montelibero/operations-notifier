const logger = require('../util/logger'),
    config = require('../models/config'),
    {ServerPool} = require('./server-pool'),
    {rpcTransport} = require('./soroban-rpc-transport'),
    {getFailoverOptions, poolUrls} = require('./stellar-connector'),
    {sanitizeUrlForLogs} = require('../util/log-redaction')

/**
 * Minimal Soroban RPC client — fetches transaction meta (resultMetaXdr)
 * that public Horizon instances do not expose.
 *
 * Failover: `sorobanRpcPool` may list several RPC servers (the first one is
 * preferred); the same failover rules as for Horizon apply (see server-pool.js).
 *
 * In-flight deduplication: concurrent getTransaction(hash) calls share a
 * single request. Resolved entries are cached for a short TTL so that
 * several matching operations within the same tx don't each hit the RPC.
 */

const DEFAULT_TTL_MS = 30_000

class SorobanRpcClient {
    constructor(pool) {
        this.pool = pool
        this.cache = new Map() // hash -> {expires, promise}
    }

    /**
     * Fetch a transaction by hash via JSON-RPC `getTransaction`.
     * Returns the raw `result` object from the RPC response (contains resultMetaXdr etc.)
     * or `null` if not available / request failed.
     */
    getTransaction(hash) {
        const now = Date.now()
        const cached = this.cache.get(hash)
        if (cached && cached.expires > now) {
            return cached.promise
        }
        const promise = this._fetchTransaction(hash).catch(err => {
            logger.warn(`Soroban RPC getTransaction(${hash}) failed: ${err.message}`)
            return null
        })
        this.cache.set(hash, {expires: now + DEFAULT_TTL_MS, promise})
        // best-effort GC of expired entries
        if (this.cache.size > 256) {
            for (const [k, v] of this.cache) {
                if (v.expires <= now) this.cache.delete(k)
            }
        }
        return promise
    }

    async _fetchTransaction(hash) {
        return this.pool.call({method: 'getTransaction', params: {hash}})
    }

    getStatus() {
        return this.pool.getStatus()
    }

    /**
     * On-demand check of every RPC server in the pool (admin UI "check pool"), see ServerPool.checkServers.
     */
    checkServers() {
        return this.pool.checkServers(async url => {
            const {result} = await rpcTransport(url, {probe: true})
            return result && result.sequence || null
        })
    }
}

let instance = null
const urls = poolUrls(config.sorobanRpcUrl, config.sorobanRpcPool)
if (urls.length) {
    instance = new SorobanRpcClient(new ServerPool({
        urls,
        name: 'Soroban RPC',
        transport: rpcTransport,
        failover: getFailoverOptions()
    }))
    logger.info(`Using Soroban RPC pool: ${urls.map(sanitizeUrlForLogs).join(', ')}`)
} else {
    logger.info('Soroban RPC not configured — Soroban meta decoding disabled.')
}

/**
 * `client` is null when Soroban RPC is not configured (`sorobanRpcUrl` / `sorobanRpcPool` empty).
 */
module.exports = {client: instance, SorobanRpcClient, rpcTransport}
