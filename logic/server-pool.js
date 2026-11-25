const {EventEmitter} = require('events'),
    logger = require('../util/logger')

/**
 * Failure types used by ServerPool:
 * - `retry`: temporary problem of this server (network error, timeout, 5xx) — retry on the same server, then fail over
 * - `rate_limited`: 429 — fail over immediately, the server is skipped until the rate limit resets
 * - `lagging`: 404 for a resource that exists on the network — the server is behind, fail over for this request
 * - `fatal`: our request is wrong (other 4xx, malformed response) — do not fail over
 */
class PoolError extends Error {
    /**
     * @param {string} message
     * @param {Object} options
     * @param {'retry'|'rate_limited'|'lagging'|'fatal'} [options.type]
     * @param {number|null} [options.status] - HTTP status
     * @param {number|null} [options.resetAt] - rate limit reset time in ms (rate_limited)
     * @param {Array} [options.attempts] - per-server attempt log
     * @param {Error|null} [options.cause]
     */
    constructor(message, {type = 'fatal', status = null, resetAt = null, attempts = [], cause = null} = {}) {
        super(message)
        this.name = 'PoolError'
        this.type = type
        this.status = status
        this.resetAt = resetAt
        this.attempts = attempts
        this.cause = cause
    }
}

function parseList(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
    if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean)
    return []
}

function normalizeUrl(url) {
    return String(url).replace(/\/+$/, '')
}

/** Get a header value from a fetch Headers instance or a plain object (case-insensitive). */
function getHeader(headers, name) {
    if (!headers) return undefined
    if (typeof headers.get === 'function') return headers.get(name)
    const lower = name.toLowerCase()
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) return headers[key]
    }
    return undefined
}

/**
 * Parse `Retry-After` (seconds or HTTP date) and `X-RateLimit-Reset` (epoch seconds) headers
 * into an absolute timestamp in ms, or null when absent/invalid.
 * @returns {number|null}
 */
function rateLimitResetMs(headers, now = Date.now()) {
    const reset = parseInt(getHeader(headers, 'X-RateLimit-Reset'))
    if (!isNaN(reset) && reset > 0) return reset * 1000
    const retryAfter = getHeader(headers, 'Retry-After')
    if (!retryAfter) return null
    const seconds = parseInt(retryAfter)
    if (!isNaN(seconds)) return now + seconds * 1000
    const date = Date.parse(retryAfter)
    return isNaN(date) ? null : date
}

/**
 * fetch() with a hard timeout. Rejects with a PoolError of type `retry` on network errors and timeouts.
 * @returns {Promise<{status: number, headers: Headers, text: string, responseMs: number}>}
 */
async function fetchWithTimeout(url, {method = 'GET', headers = {}, body = null, timeoutMs = 15000} = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()
    try {
        const res = await fetch(url, {method, headers, body, signal: controller.signal})
        const text = await res.text()
        return {status: res.status, headers: res.headers, text, responseMs: Date.now() - startedAt}
    } catch (e) {
        if (e && e.name === 'AbortError') throw new PoolError(`timeout after ${timeoutMs}ms: ${url}`, {type: 'retry', cause: e})
        throw new PoolError(`network error: ${e && e.message}`, {type: 'retry', cause: e})
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Map an HTTP status to a failure type.
 * @returns {'ok'|'rate_limited'|'lagging'|'retry'|'fatal'}
 */
function classifyStatus(status) {
    if (status >= 200 && status < 300) return 'ok'
    if (status === 429) return 'rate_limited'
    if (status === 404) return 'lagging'
    if (status >= 500) return 'retry'
    return 'fatal'
}

/**
 * Generic failover pool over a list of identical HTTP servers.
 *
 * - strict order: the first healthy server in the list is the active one;
 * - `retries` attempts on the same server for `retry` failures, then the server is marked down
 *   and the next one is used;
 * - 429 skips the server until `Retry-After`/`X-RateLimit-Reset` (or the cooldown) expires;
 * - 404 is treated as "the server is behind" (lagging): the request is retried on the next server,
 *   the server itself is not marked down;
 * - a background probe (running only while some server is down) brings servers back after
 *   `probeSuccessesToRecover` consecutive successes, so the pool returns to the preferred server;
 *   as a safety net a down server becomes eligible again once the cooldown elapsed;
 * - emits `switch` ({from, to, reason}) whenever the active server changes.
 *
 * The transport is pluggable: `transport(url, request) => Promise<any>` resolves with the result
 * or rejects with a PoolError carrying the failure type.
 */
class ServerPool extends EventEmitter {
    /**
     * @param {Object} options
     * @param {string[]|string} options.urls - server base URLs, the first one is preferred
     * @param {string} [options.name] - pool name for logs
     * @param {Function} options.transport - `(url, request) => Promise<any>`, rejects with PoolError
     * @param {Object} [options.failover] - {retries, retryDelayMs, cooldownMs, probeIntervalMs, probeSuccessesToRecover}
     * @param {Function} [options.now] - clock in ms (tests)
     * @param {Object} [options.logger] - logger (tests)
     */
    constructor({urls, name = 'pool', transport, failover = {}, now = Date.now, logger: log = logger} = {}) {
        super()
        if (!parseList(urls).length) throw new TypeError(`${name} pool: at least one server URL is required`)
        if (typeof transport !== 'function') throw new TypeError(`${name} pool: transport function is required`)
        this.name = name
        this.transport = transport
        this.retries = failover.retries ?? 2
        this.retryDelayMs = failover.retryDelayMs ?? 400
        this.cooldownMs = failover.cooldownMs ?? 120000
        this.probeIntervalMs = failover.probeIntervalMs ?? 60000
        this.probeSuccessesToRecover = failover.probeSuccessesToRecover ?? 2
        this.now = now
        this.logger = log
        this.probeTimer = null
        this.probeInProgress = false
        this.lastSwitchAt = null

        this.servers = parseList(urls).map(url => ({
            url: normalizeUrl(url),
            state: 'ok', // ok | down | rate_limited
            consecutiveFailures: 0,
            requests: 0,
            failures: 0,
            lastError: null,
            lastErrorAt: null,
            lastErrorStatus: null,
            lastSuccessAt: null,
            lastResponseMs: null,
            rateLimitedUntil: null,
            downUntil: null,
            probeSuccesses: 0,
            lastProbeAt: null,
            lag: {count: 0, lastAt: null, lastLedger: null}
        }))
        this._lastActiveUrl = this.activeUrl
    }

    /** First healthy server in strict order (preferred first). */
    get active() {
        return this.servers.find(server => this.isAvailable(server)) || null
    }

    get activeUrl() {
        return this.active ? this.active.url : null
    }

    isAvailable(server) {
        const t = this.now()
        if (server.state === 'down') return t >= (server.downUntil ?? 0)
        if (server.state === 'rate_limited') return t >= (server.rateLimitedUntil ?? 0)
        return true
    }

    /**
     * Execute a request on the active server with failover.
     * @param {Object} request - opaque payload passed to the transport
     * @param {Object} [options] - {maxLagHops: number} how many lagging (404) servers to try before giving up
     * @returns {Promise<any>} transport result
     */
    async call(request = {}, {maxLagHops = this.servers.length - 1} = {}) {
        const attempts = []
        let lagHops = 0
        let lastError = null
        for (const server of this.orderedFromActive()) {
            if (!this.isAvailable(server)) continue
            const attempt = {url: server.url}
            attempts.push(attempt)
            let result
            try {
                result = await this.requestWithRetries(server, request, attempt)
            } catch (e) {
                lastError = e
                if (e instanceof PoolError && e.type === 'fatal') throw e
                if (e instanceof PoolError && e.type === 'lagging') {
                    if (lagHops >= maxLagHops) throw e
                    lagHops++
                    this.markLagging(server, e)
                    continue // the next server may already have the resource
                }
                continue // down / rate-limited — marked by requestWithRetries
            }
            this.markSuccess(server)
            return result
        }
        if (lastError instanceof PoolError) lastError.attempts = attempts
        throw lastError || new PoolError(`${this.name}: no healthy server available`, {type: 'retry', attempts})
    }

    /** Servers starting from the active one, then the rest in list order. */
    orderedFromActive() {
        const start = this.servers.indexOf(this.active || this.servers[0])
        return this.servers.slice(start).concat(this.servers.slice(0, start))
    }

    /** Preferred (first) server URL — used as a fallback target when every server is down. */
    get fallbackUrl() {
        return this.servers[0].url
    }

    async requestWithRetries(server, request, attempt) {
        let lastError = null
        for (let i = 0; i <= this.retries; i++) {
            if (i > 0) await this.sleep(this.retryDelayMs)
            const startedAt = this.now()
            server.requests++
            try {
                const result = await this.transport(server.url, {...request, probe: false})
                server.lastResponseMs = this.now() - startedAt
                attempt.ok = true
                return result
            } catch (e) {
                lastError = e
                const err = e instanceof PoolError ? e : new PoolError(`${this.name} ${server.url}: ${e && e.message}`, {type: 'retry', cause: e})
                attempt.error = {type: err.type, status: err.status, message: err.message}
                if (err.type === 'rate_limited') {
                    this.markRateLimited(server, err.resetAt, err.status)
                    throw err
                }
                if (err.type === 'lagging' || err.type === 'fatal') throw err
                // retry: next attempt on the same server
            }
        }
        this.markDown(server, lastError && lastError.message)
        throw lastError
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    markSuccess(server) {
        const recovered = server.state !== 'ok'
        server.state = 'ok'
        server.consecutiveFailures = 0
        server.downUntil = null
        server.rateLimitedUntil = null
        server.probeSuccesses = 0
        server.lastSuccessAt = this.now()
        if (recovered) {
            this.logger.info(`${this.name} ${server.url} recovered`)
            this.emitSwitch('recovered')
        }
    }

    markDown(server, message) {
        server.consecutiveFailures++
        server.failures++
        server.lastError = message || 'failed'
        server.lastErrorAt = this.now()
        server.state = 'down'
        server.downUntil = this.now() + this.cooldownMs
        server.probeSuccesses = 0
        this.logger.warn(`${this.name} ${server.url} marked down (${server.lastError})`)
        this.emitSwitch('down')
        this.ensureProbe()
    }

    markRateLimited(server, resetAt, status) {
        // a reset time in the past (clock skew) must not make the server instantly available again
        const until = resetAt && resetAt > this.now() ? resetAt : this.now() + this.cooldownMs
        server.consecutiveFailures++
        server.failures++
        server.state = 'rate_limited'
        server.rateLimitedUntil = until
        server.lastError = `rate limited (${status})`
        server.lastErrorAt = this.now()
        server.lastErrorStatus = status
        const seconds = Math.max(0, Math.round((until - this.now()) / 1000))
        this.logger.warn(`${this.name} ${server.url} rate limited, skipped for ${seconds}s`)
        this.emitSwitch('rate_limited')
        this.ensureProbe()
    }

    markLagging(server, err) {
        server.lag.count++
        server.lag.lastAt = this.now()
        server.lag.lastLedger = err.ledger ?? null
        this.logger.warn(`${this.name} ${server.url} is behind (404 for ledger ${err.ledger ?? '?'}), trying the next server`)
    }

    /**
     * Report a failure observed outside `call()` (e.g. by the SSE stream on a specific server).
     * @param {string} url
     * @param {{type: 'retry'|'rate_limited', message: string}} failure
     */
    reportStreamFailure(url, failure) {
        const server = this.servers.find(s => s.url === normalizeUrl(url))
        if (!server) return
        if (failure.type === 'rate_limited') this.markRateLimited(server, null, 429)
        else if (failure.type === 'retry') this.markDown(server, failure.message)
    }

    /** Mark the server as behind the network and switch away from it for the cooldown period. */
    markBehind(server, ledger, otherLedger) {
        server.consecutiveFailures++
        server.state = 'down'
        server.downUntil = this.now() + this.cooldownMs
        server.probeSuccesses = 0
        server.lastError = `behind by ${otherLedger - ledger} ledgers (${ledger} vs ${otherLedger})`
        server.lastErrorAt = this.now()
        server.lag.count++
        server.lag.lastAt = this.now()
        server.lag.lastLedger = ledger
        this.logger.warn(`${this.name} ${server.url} is ${server.lastError}`)
        this.emitSwitch('lagging')
        this.ensureProbe()
    }

    emitSwitch(reason) {
        const active = this.activeUrl
        const previous = this._lastActiveUrl
        this._lastActiveUrl = active
        if (previous === active) return
        this.lastSwitchAt = this.now()
        this.logger.info(`${this.name} active server: ${previous} -> ${active} (${reason})`)
        this.emit('switch', {from: previous, to: active, reason})
    }

    /** Keep probing down servers (only while there are any) so the pool returns to the preferred one. */
    ensureProbe() {
        if (this.probeTimer) return
        if (!this.servers.some(server => server.state !== 'ok')) return
        this.probeTimer = setTimeout(() => this.runProbe(), this.probeIntervalMs)
        if (this.probeTimer.unref) this.probeTimer.unref()
    }

    async runProbe() {
        this.probeTimer = null
        const down = this.servers.filter(server => server.state !== 'ok')
        if (!down.length) return
        if (this.probeInProgress) return this.ensureProbe()
        this.probeInProgress = true
        try {
            for (const server of down) {
                server.lastProbeAt = this.now()
                try {
                    const {responseMs} = await this.transport(server.url, {probe: true})
                    server.lastResponseMs = responseMs ?? null
                    server.probeSuccesses++
                    if (server.probeSuccesses >= this.probeSuccessesToRecover) this.markSuccess(server)
                } catch (e) {
                    server.probeSuccesses = 0
                    if (!(e instanceof PoolError)) continue
                    if (e.type === 'rate_limited') {
                        this.markRateLimited(server, e.resetAt, e.status)
                    } else if (e.type === 'retry') {
                        // the probe confirmed the server is down (even if it was only rate-limited so far):
                        // keep it out of rotation for another cooldown
                        server.state = 'down'
                        server.downUntil = this.now() + this.cooldownMs
                        server.lastError = e.message
                        server.lastErrorAt = this.now()
                    }
                }
            }
        } finally {
            this.probeInProgress = false
            this.ensureProbe()
        }
    }

    /**
     * Check every server in parallel with `probeFn(url) -> Promise<latestLedger|null>` (admin UI "check pool").
     * A down server that answers is brought back through `markSuccess`.
     * @returns {Promise<Array<{url: string, active: boolean, state: string, latestLedger: number|null, responseMs: number|null, lag: number|null, error: string|null}>>}
     */
    async checkServers(probeFn) {
        const activeUrl = this.activeUrl
        const results = await Promise.all(this.servers.map(async server => {
            const startedAt = this.now()
            try {
                const latestLedger = await probeFn(server.url)
                return {url: server.url, active: server.url === activeUrl, state: server.state, latestLedger: latestLedger ?? null, responseMs: this.now() - startedAt, error: null}
            } catch (e) {
                return {url: server.url, active: server.url === activeUrl, state: server.state, latestLedger: null, responseMs: this.now() - startedAt, error: e.message}
            }
        }))
        const maxLedger = Math.max(0, ...results.map(r => r.latestLedger || 0))
        for (const r of results) {
            r.lag = r.latestLedger !== null && maxLedger > 0 ? maxLedger - r.latestLedger : null
            const server = this.servers.find(s => s.url === r.url)
            if (server && server.state !== 'ok' && !r.error) this.markSuccess(server)
        }
        // reflect the state after the recovery
        const activeAfter = this.activeUrl
        for (const r of results) {
            const server = this.servers.find(s => s.url === r.url)
            r.state = server.state
            r.active = server.url === activeAfter
        }
        return results
    }

    /** Stop background activity. */
    close() {
        if (this.probeTimer) {
            clearTimeout(this.probeTimer)
            this.probeTimer = null
        }
    }

    getStatus() {
        const active = this.active
        return {
            active: active ? active.url : null,
            lastSwitchAt: this.lastSwitchAt ? new Date(this.lastSwitchAt).toISOString() : null,
            servers: this.servers.map(server => ({
                url: server.url,
                active: server === active,
                state: server.state,
                consecutiveFailures: server.consecutiveFailures,
                requests: server.requests,
                failures: server.failures,
                lastError: server.lastError,
                lastErrorAt: server.lastErrorAt ? new Date(server.lastErrorAt).toISOString() : null,
                lastSuccessAt: server.lastSuccessAt ? new Date(server.lastSuccessAt).toISOString() : null,
                lastResponseMs: server.lastResponseMs,
                rateLimitedUntil: server.rateLimitedUntil ? new Date(server.rateLimitedUntil).toISOString() : null,
                lagCount: server.lag.count,
                lastLagAt: server.lag.lastAt ? new Date(server.lag.lastAt).toISOString() : null
            }))
        }
    }
}

module.exports = {ServerPool, PoolError, getHeader, parseList, rateLimitResetMs, fetchWithTimeout, classifyStatus}
