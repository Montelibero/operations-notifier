const config = require('../models/config'),
    {PoolError, fetchWithTimeout, classifyStatus, rateLimitResetMs} = require('./server-pool')

let requestId = 0

/**
 * JSON-RPC transport for ServerPool. Resolves with the `result` field (may be null),
 * rejects with a PoolError. JSON-RPC errors (e.g. "transaction not found") are `fatal`:
 * they describe the request, not the server, and never trigger a failover.
 */
async function rpcTransport(baseUrl, request) {
    const body = {
        jsonrpc: '2.0',
        id: ++requestId,
        method: request.probe ? 'getLatestLedger' : request.method,
        params: request.probe ? {} : (request.params || {})
    }
    const res = await fetchWithTimeout(baseUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify(body),
        timeoutMs: config.failoverRequestTimeoutMs
    })
    const type = classifyStatus(res.status)
    if (type !== 'ok') {
        // 404 means "not an RPC endpoint" here rather than "ledger not ingested yet"
        throw new PoolError(`HTTP ${res.status} from Soroban RPC ${baseUrl}`, {type: type === 'lagging' ? 'fatal' : type, status: res.status, resetAt: rateLimitResetMs(res.headers)})
    }
    let json
    try {
        json = JSON.parse(res.text)
    } catch (e) {
        throw new PoolError(`malformed JSON from Soroban RPC ${baseUrl}`, {type: 'retry', cause: e})
    }
    if (json.error) {
        throw new PoolError(`Soroban RPC error ${json.error.code}: ${json.error.message}`, {type: 'fatal'})
    }
    if (request.probe) return {responseMs: res.responseMs, result: json.result}
    return json.result ?? null
}

module.exports = {rpcTransport}
