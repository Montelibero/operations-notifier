const logger = require('../util/logger')
const config = require('../models/config')

/**
 * Minimal Soroban RPC client — fetches transaction meta (resultMetaXdr)
 * that public Horizon instances do not expose.
 *
 * In-flight deduplication: concurrent getTransaction(hash) calls share a
 * single HTTP request. Resolved entries are cached for a short TTL so that
 * several matching operations within the same tx don't each hit the RPC.
 */

const DEFAULT_TTL_MS = 30_000
const REQUEST_TIMEOUT_MS = 10_000

class SorobanRpcClient {
    constructor(url) {
        this.url = url
        this.cache = new Map() // hash -> {expires, promise}
        this.requestId = 0
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
        const body = {
            jsonrpc: '2.0',
            id: ++this.requestId,
            method: 'getTransaction',
            params: {hash}
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        let res
        try {
            res = await fetch(this.url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body),
                signal: controller.signal
            })
        } finally {
            clearTimeout(timer)
        }
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json()
        if (json.error) {
            throw new Error(`${json.error.code}: ${json.error.message}`)
        }
        return json.result || null
    }
}

let instance = null
if (config.sorobanRpcUrl) {
    instance = new SorobanRpcClient(config.sorobanRpcUrl)
    logger.info(`Using Soroban RPC ${config.sorobanRpcUrl}`)
} else {
    logger.info('Soroban RPC not configured — Soroban meta decoding disabled.')
}

module.exports = instance
