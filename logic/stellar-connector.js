const {Horizon} = require('@stellar/stellar-sdk'),
    config = require('../models/config'),
    {ServerPool, PoolError, fetchWithTimeout, classifyStatus, rateLimitResetMs} = require('./server-pool'),
    {sanitizeUrlForLogs} = require('../util/log-redaction'),
    logger = require('../util/logger')

const pkgInfo = require('../package')

/**
 * Failover parameters shared by all server pools (Horizon, Soroban RPC).
 */
function getFailoverOptions() {
    return {
        retries: config.failoverRetries,
        retryDelayMs: config.failoverRetryDelayMs,
        cooldownMs: (config.failoverCooldownSeconds || 120) * 1000,
        probeIntervalMs: (config.failoverProbeIntervalSeconds || 60) * 1000,
        probeSuccessesToRecover: config.failoverProbeSuccesses
    }
}

function poolUrls(primaryUrl, poolConfig) {
    if (poolConfig && poolConfig.length) return poolConfig
    return primaryUrl ? [primaryUrl] : []
}

const requestHeaders = {'User-Agent': `operations-notifier/${pkgInfo.version}`, Accept: 'application/json'}

/**
 * Horizon REST transport for ServerPool: `GET <baseUrl><path>` with a hard timeout.
 * Resolves with the parsed Horizon page (`records` + `_embedded` + `_links`), rejects with a PoolError.
 */
async function horizonTransport(baseUrl, request) {
    if (request.probe) {
        const res = await fetchWithTimeout(`${baseUrl}/`, {headers: requestHeaders, timeoutMs: 5000})
        const type = classifyStatus(res.status)
        if (type !== 'ok') throw new PoolError(`probe failed: HTTP ${res.status}`, {type, status: res.status, resetAt: rateLimitResetMs(res.headers)})
        return {responseMs: res.responseMs}
    }
    const res = await fetchWithTimeout(`${baseUrl}${request.path}`, {headers: requestHeaders, timeoutMs: config.failoverRequestTimeoutMs})
    const type = classifyStatus(res.status)
    if (type !== 'ok') {
        // Horizon answers with problem+json: {"title": "...", "detail": "..."} — include it for the logs
        let detail = '', title = ''
        try {
            const problem = JSON.parse(res.text)
            if (problem && typeof problem === 'object') {
                title = problem.title || ''
                detail = problem.detail || ''
            }
        } catch (_) {}
        const err = new PoolError(`HTTP ${res.status} from ${baseUrl}${request.path}${title || detail ? `: ${title} ${detail}`.trim() : ''}`, {type, status: res.status, resetAt: rateLimitResetMs(res.headers)})
        err.title = title
        err.detail = detail
        if (type === 'lagging') err.ledger = request.ledger
        throw err
    }
    let page
    try {
        page = JSON.parse(res.text)
    } catch (e) {
        throw new PoolError(`malformed JSON from ${baseUrl}${request.path}`, {type: 'retry', cause: e})
    }
    // the shape the SDK's call builders used to return
    if (page && page._embedded && Array.isArray(page._embedded.records)) page.records = page._embedded.records
    return page
}

const urls = poolUrls(config.horizon, config.horizonPool)
const horizonPool = new ServerPool({
    urls,
    name: 'Horizon',
    transport: horizonTransport,
    failover: getFailoverOptions()
})
logger.info(`Using Horizon pool: ${urls.map(sanitizeUrlForLogs).join(', ')}`)

const streamServers = new Map()

/**
 * SDK Horizon server instance (used for the SSE ledger stream) for the given pool URL.
 * @param {string} [url] - pool server URL, defaults to the active one
 */
function getHorizonServer(url = horizonPool.activeUrl || horizonPool.fallbackUrl) {
    if (!streamServers.has(url)) {
        // the SDK refuses plain http unless allowed; a pool URL with http is an explicit deployment choice
        const allowHttp = !!config.horizonAllowHttp || url.startsWith('http://')
        streamServers.set(url, new Horizon.Server(url, {allowHttp}))
    }
    return streamServers.get(url)
}

/**
 * Latest ledger sequence known to the active Horizon server (or null).
 * @returns {Promise<number|null>}
 */
async function fetchLatestLedger(url = horizonPool.activeUrl || horizonPool.fallbackUrl) {
    const page = await horizonTransport(url, {path: '/ledgers?order=desc&limit=1'})
    return page && page.records && page.records[0] ? page.records[0].sequence : null
}

/**
 * Ask the first available peer server (any pool server other than `excludeUrl`) for its latest ledger.
 * Used when the ledger stream stalls: a server that answers HTTP but stopped ingesting is detected
 * by comparing with its peers. Servers are tried one by until one answers.
 * @param {string} excludeUrl - the server the stream is running on
 * @returns {Promise<{url: string, ledger: number}|null>} null when there is no peer or none answered
 */
async function fetchPeerLatestLedger(excludeUrl) {
    for (const server of horizonPool.servers) {
        if (server.url === excludeUrl || !horizonPool.isAvailable(server)) continue
        try {
            const sequence = await fetchLatestLedger(server.url)
            horizonPool.markSuccess(server)
            if (sequence !== null) return {url: server.url, ledger: sequence}
        } catch (e) {
            if (e instanceof PoolError && e.type === 'rate_limited') horizonPool.markRateLimited(server, e.resetAt, e.status)
            else if (e instanceof PoolError && e.type === 'retry') horizonPool.markDown(server, e.message)
        }
    }
    return null
}

/**
 * On-demand check of every Horizon server in the pool (admin UI "check pool").
 * @returns {Promise<Array<Object>>} see ServerPool.checkServers
 */
function checkHorizonServers() {
    return horizonPool.checkServers(fetchLatestLedger)
}

module.exports = {horizonPool, getHorizonServer, horizonTransport, getFailoverOptions, poolUrls, fetchLatestLedger, fetchPeerLatestLedger, checkHorizonServers}
