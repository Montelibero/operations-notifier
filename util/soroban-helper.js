const {xdr, StrKey, scValToNative} = require('@stellar/stellar-sdk')
const logger = require('./logger')

/**
 * Recursively convert BigInt values to strings for JSON serialization.
 * scValToNative returns bigints for i128/u128/i64/u64 — the webhook payload
 * is later JSON.stringified, and bigint would throw.
 */
function stringifyBigInts(value) {
    if (typeof value === 'bigint') return value.toString()
    if (value === null || value === undefined) return value
    if (Array.isArray(value)) return value.map(stringifyBigInts)
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
        return Buffer.from(value).toString('base64')
    }
    if (typeof value === 'object') {
        const out = {}
        for (const k of Object.keys(value)) out[k] = stringifyBigInts(value[k])
        return out
    }
    return value
}

function scValToJson(sv) {
    try {
        return stringifyBigInts(scValToNative(sv))
    } catch (e) {
        return null
    }
}

/**
 * Decode a Soroban ContractEvent xdr object to a plain JSON shape.
 */
function decodeEvent(e) {
    const out = {type: null, contract: null, topics: null, data: null}
    try {
        // ContractEventType is an enum instance in stellar-sdk v17 (system | contract | diagnostic)
        out.type = typeof e.type === 'string' ? e.type : e.type?.name
    } catch (_) {}
    try {
        const cid = e.contractId
        if (cid) out.contract = StrKey.encodeContract(cid.toBytes())
    } catch (_) {}
    try {
        const body = e.body.v0
        out.topics = body.topics.map(scValToJson)
        out.data = scValToJson(body.data)
    } catch (_) {}
    return out
}

/**
 * Decode Soroban transaction meta into {events, return_value}.
 *
 * Supports both TransactionMetaV3 (events live in sorobanMeta.events,
 * return value in sorobanMeta.returnValue) and TransactionMetaV4
 * (events live per-operation at v4.operations[i].events, return value
 * still at sorobanMeta.returnValue).
 *
 * @param {string} resultMetaXdrBase64
 * @param {number} opIndex - operation application order (0-based)
 * @returns {{events: Array|null, return_value: *}}
 */
function decodeMeta(resultMetaXdrBase64, opIndex = 0) {
    if (!resultMetaXdrBase64) return {events: null, return_value: null}
    let meta
    try {
        meta = xdr.TransactionMeta.fromXdr(resultMetaXdrBase64, 'base64')
    } catch (e) {
        logger.warn(`soroban-helper: failed to parse TransactionMeta: ${e.message}`)
        return {events: null, return_value: null}
    }
    const variant = meta.type === 'v3' ? meta.v3 : meta.type === 'v4' ? meta.v4 : null
    if (!variant) return {events: null, return_value: null}
    let events = []
    let returnValue = null

    // sorobanMeta — present in both v3 and v4 (null for non-Soroban transactions)
    const sm = variant.sorobanMeta
    if (sm) {
        try {
            if (sm.returnValue) returnValue = scValToJson(sm.returnValue)
        } catch (_) {}
        // v3: events list directly on sorobanMeta
        if (Array.isArray(sm.events)) {
            for (const e of sm.events) events.push(decodeEvent(e))
        }
    }

    // v4: per-operation events
    try {
        const ops = variant.operations
        if (ops && ops[opIndex] && Array.isArray(ops[opIndex].events)) {
            for (const e of ops[opIndex].events) events.push(decodeEvent(e))
        }
    } catch (_) {}

    return {events: events.length ? events : null, return_value: returnValue}
}

module.exports = {decodeMeta, stringifyBigInts}
