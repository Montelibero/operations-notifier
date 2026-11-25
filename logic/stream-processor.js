const {TransactionBuilder, xdr, StrKey, scValToNative} = require('@stellar/stellar-sdk'),
    BigNumber = require('bignumber.js'),
    {parseAsset, nativeAsset} = require('../util/asset-helper'),
    {stringifyBigInts} = require('../util/soroban-helper'),
    config = require('../models/config')

function stroopsToAmount(stroops) {
    return new BigNumber(stroops).dividedBy(10000000).toFixed(7)
}

function normalizeAsset(asset) {
    if (!asset) return null
    return parseAsset({
        asset_code: asset.code,
        asset_issuer: asset.issuer
    })
}

/**
 * Decode an XDR asset code (AssetCode4/AssetCode12 byte wrapper, NUL-padded) to a string.
 * @param {xdr.AssetCode4|xdr.AssetCode12} assetCode
 * @returns {string}
 */
function assetCodeToString(assetCode) {
    return Buffer.from(assetCode.toBytes()).toString('utf8').replace(/\0/g, '')
}

function normalizeXdrAsset(xdrAsset) {
    if (!xdrAsset) return null
    if (xdrAsset.type === 'assetTypeNative') {
        return nativeAsset()
    }
    if (xdrAsset.type === 'assetTypeCreditAlphanum4' || xdrAsset.type === 'assetTypeCreditAlphanum12') {
        const value = xdrAsset.value
        return {
            asset_type: xdrAsset.type === 'assetTypeCreditAlphanum4' ? 1 : 2,
            asset_code: assetCodeToString(value.assetCode),
            asset_issuer: StrKey.encodeEd25519PublicKey(value.issuer.ed25519.toBytes())
        }
    }
    return null
}

/**
 * Decode a single trade fill (ClaimAtom: an order book offer or a liquidity pool) to a plain object.
 * @param {xdr.ClaimAtom} claim
 * @returns {Object|null}
 */
function normalizeClaimAtom(claim) {
    if (claim.type === 'claimAtomTypeOrderBook') {
        const ob = claim.orderBook
        return {
            type: 'order_book',
            seller_id: StrKey.encodeEd25519PublicKey(ob.sellerId.ed25519.toBytes()),
            offer_id: ob.offerId.toString(),
            asset_sold: normalizeXdrAsset(ob.assetSold),
            amount_sold: stroopsToAmount(ob.amountSold.toString()),
            asset_bought: normalizeXdrAsset(ob.assetBought),
            amount_bought: stroopsToAmount(ob.amountBought.toString())
        }
    }
    if (claim.type === 'claimAtomTypeLiquidityPool') {
        const lp = claim.liquidityPool
        return {
            type: 'liquidity_pool',
            pool_id: Buffer.from(lp.liquidityPoolId.toBytes()).toString('hex'),
            asset_sold: normalizeXdrAsset(lp.assetSold),
            amount_sold: stroopsToAmount(lp.amountSold.toString()),
            asset_bought: normalizeXdrAsset(lp.assetBought),
            amount_bought: stroopsToAmount(lp.amountBought.toString())
        }
    }
    return null
}

/**
 * Decode a transaction result and return the per-operation results, unwrapping fee-bump transactions.
 * @param {string} resultXdr - Base64-encoded transaction result XDR
 * @returns {Array<xdr.OperationResult>|null} null when the result carries no per-operation results (e.g. txBadAuth)
 */
function getOperationResults(resultXdr) {
    const txResult = xdr.TransactionResult.fromXdr(resultXdr, 'base64').result
    if (txResult.type === 'txFeeBumpInnerSuccess' || txResult.type === 'txFeeBumpInnerFailed') {
        return txResult.innerResultPair.result.result.results || null
    }
    return txResult.results || null
}

function assetsEqual(a, b) {
    if (!a || !b || a.asset_type !== b.asset_type) return false
    if (a.asset_type === 0) return true
    return a.asset_code === b.asset_code && a.asset_issuer === b.asset_issuer
}

/**
 * Parse the inner result of a manage offer / path payment operation, unwrapping fee-bump transactions.
 * @param {string} resultXdr - Base64-encoded transaction result XDR
 * @param {number} operationIndex - Index of the operation in the transaction
 * @param {Array<string>} opTypes - Allowed inner result types (e.g. 'manageSellOffer')
 * @returns {Object|null} inner success payload or null if the operation is not one of opTypes or failed
 */
function getInnerSuccess(resultXdr, operationIndex, opTypes) {
    const opResults = getOperationResults(resultXdr)
    if (!opResults || operationIndex >= opResults.length) return null

    const opResult = opResults[operationIndex]
    const tr = opResult?.type === 'opInner' ? opResult.tr : null
    if (!tr || !opTypes.includes(tr.type)) return null

    const inner = tr.value
    if (!inner.success) return null
    return inner.success
}

/**
 * Parse manage offer result XDR to extract created_offer_id and claimed trades.
 * @param {string} resultXdr - Base64-encoded transaction result XDR
 * @param {number} operationIndex - Index of the operation in the transaction
 * @returns {Object} Object with created_offer_id and trades (if any)
 */
function parseManageOfferResult(resultXdr, operationIndex) {
    const emptyResult = {trades: []}
    try {
        const success = getInnerSuccess(resultXdr, operationIndex, ['manageSellOffer', 'manageBuyOffer'])
        if (!success) return emptyResult

        const resultObj = {trades: (success.offersClaimed || []).map(normalizeClaimAtom).filter(Boolean)}

        const offer = success.offer
        if (offer && (offer.type === 'manageOfferCreated' || offer.type === 'manageOfferUpdated')) {
            resultObj.created_offer_id = offer.offer.offerId.toString()
        }

        return resultObj
    } catch (e) {
        console.error('Failed to parse manage offer result:', e.message)
        return emptyResult
    }
}

/**
 * Parse trades (ClaimAtom) and actual amounts from path_payment result XDR.
 * @param {string} resultXdr - Base64-encoded transaction result XDR
 * @param {number} operationIndex - Index of the operation in the transaction
 * @param {string} opType - Operation type ('path_payment_strict_send' or 'path_payment_strict_receive')
 * @param {Object} sourceAsset - Source asset for strict receive source amount calculation
 * @returns {Object} Object with trades array and actual amounts (dest_amount for strict_send, source_amount for strict_receive)
 */
function parsePathPaymentTrades(resultXdr, operationIndex, opType, sourceAsset) {
    const emptyResult = {trades: []}
    try {
        const success = getInnerSuccess(resultXdr, operationIndex, ['pathPaymentStrictSend', 'pathPaymentStrictReceive'])
        if (!success) return emptyResult

        const trades = (success.offers || []).map(normalizeClaimAtom).filter(Boolean)

        // Extract actual amounts from the result
        const resultObj = {trades}

        // last contains SimplePaymentResult: { destination, asset, amount }
        const last = success.last
        if (last) {
            const destAmount = stroopsToAmount(last.amount.toString())

            if (opType === 'path_payment_strict_send') {
                // For strict_send: last.amount is the actual destination amount received
                resultObj.dest_amount = destAmount
            } else if (opType === 'path_payment_strict_receive') {
                if (trades.length > 0) {
                    const sourceTrades = sourceAsset
                        ? trades.filter(trade => assetsEqual(trade.asset_bought, sourceAsset))
                        : [trades[0]]
                    resultObj.source_amount = sourceTrades
                        .reduce((sum, trade) => sum.plus(trade.amount_bought || 0), new BigNumber(0))
                        .toFixed(7)
                }
            }
        }

        return resultObj
    } catch (e) {
        console.error('Failed to parse path payment trades:', e.message)
        return emptyResult
    }
}

/**
 * Normalize any of the seven revoke sponsorship operation flavors to a single shape.
 * `revoke_type` tells which ledger entry lost its sponsor.
 * @param {StellarBase.Operation} operation
 * @returns {Object}
 */
function normalizeRevokeSponsorship(operation) {
    const res = {type_i: 18, type: 'revoke_sponsorship'}
    switch (operation.type) {
        case 'revokeAccountSponsorship':
            return {...res, revoke_type: 'account', account: operation.account}
        case 'revokeTrustlineSponsorship':
            // plain {code, issuer} object here, not an Asset instance
            return {...res, revoke_type: 'trustline', account: operation.account, asset: normalizeAsset(operation.asset)}
        case 'revokeOfferSponsorship':
            return {...res, revoke_type: 'offer', account: operation.seller, offer_id: operation.offerId}
        case 'revokeDataSponsorship':
            return {...res, revoke_type: 'data', account: operation.account, data_name: operation.name}
        case 'revokeClaimableBalanceSponsorship':
            return {...res, revoke_type: 'claimable_balance', balance_id: operation.balanceId}
        case 'revokeLiquidityPoolSponsorship':
            return {...res, revoke_type: 'liquidity_pool', liquidity_pool_id: operation.liquidityPoolId}
        case 'revokeSignerSponsorship': {
            // signer is {ed25519PublicKey} | {preAuthTx} | {sha256Hash} | {ed25519SignedPayload}
            const signer = operation.signer || {}
            return {...res, revoke_type: 'signer', account: operation.account, signer_key: Object.values(signer)[0] || null}
        }
    }
    return null
}

/**
 * Normalize a claimable balance predicate to a plain JSON shape (same as SEP-0051 JSON):
 * "unconditional" | {and: [..]} | {or: [..]} | {not: ..} | {before_absolute_time: ".."} | {before_relative_time: ".."}
 * @param {xdr.ClaimPredicate|null} predicate
 * @returns {*}
 */
function normalizeClaimPredicate(predicate) {
    if (!predicate) return 'unconditional'
    switch (predicate.type) {
        case 'claimPredicateUnconditional':
            return 'unconditional'
        case 'claimPredicateAnd':
            return {and: (predicate.andPredicates || []).map(normalizeClaimPredicate)}
        case 'claimPredicateOr':
            return {or: (predicate.orPredicates || []).map(normalizeClaimPredicate)}
        case 'claimPredicateNot':
            return {not: predicate.notPredicate ? normalizeClaimPredicate(predicate.notPredicate) : null}
        case 'claimPredicateBeforeAbsoluteTime':
            return {before_absolute_time: predicate.absBefore.toString()}
        case 'claimPredicateBeforeRelativeTime':
            return {before_relative_time: predicate.relBefore.toString()}
    }
    return 'unconditional'
}

/**
 * Normalize claimants of a create_claimable_balance operation.
 * @param {Array<StellarBase.Claimant>} claimants
 * @returns {Array<{destination: string, predicate: *}>}
 */
function normalizeClaimants(claimants) {
    return (claimants || []).map(claimant => ({
        destination: claimant._destination ?? claimant.destination,
        predicate: normalizeClaimPredicate(claimant._predicate ?? claimant.predicate)
    }))
}

/**
 * Retrieve an object with unified parameter names from operation.
 * @param {StellarBase.Operation} operation
 * @returns {*}
 */
function normalizeOperation(operation) {
    switch (operation.type) {
        case 'createAccount':
            return {
                type_i: 0,
                type: 'create_account',
                destination: operation.destination,
                asset: nativeAsset(),
                amount: operation.startingBalance
            }
        case 'payment':
            return {
                type_i: 1,
                type: 'payment',
                destination: operation.destination,
                asset: normalizeAsset(operation.asset),
                amount: operation.amount
            }
        case 'pathPayment':
        case 'pathPaymentStrictReceive':
            return {
                type_i: 2,
                type: 'path_payment_strict_receive',
                asset: normalizeAsset(operation.destAsset),
                amount: operation.destAmount,
                source_asset: normalizeAsset(operation.sendAsset),
                source_max: operation.sendMax,
                path: operation.path.map(asset => normalizeAsset(asset))
            }
        case 'pathPaymentStrictSend':
            return {
                type_i: 13,
                type: 'path_payment_strict_send',
                asset: normalizeAsset(operation.destAsset),
                amount: operation.sendAmount,
                source_asset: normalizeAsset(operation.sendAsset),
                dest_min: operation.destMin,
                path: operation.path.map(asset => normalizeAsset(asset))
            }
        case 'manageOffer':
        case 'manageSellOffer':
            return {
                type_i: 3,
                type: 'manage_sell_offer',
                asset: normalizeAsset(operation.buying),
                amount: operation.amount,
                source_asset: normalizeAsset(operation.selling),
                price: operation.price,
                offerId: operation.offerId || '0'
            }
        case 'manageBuyOffer':
            return {
                type_i: 12,
                type: 'manage_buy_offer',
                asset: normalizeAsset(operation.buying),
                amount: operation.buyAmount,
                source_asset: normalizeAsset(operation.selling),
                price: operation.price,
                offerId: operation.offerId || '0'
            }
        case 'createPassiveOffer':
        case 'createPassiveSellOffer':
            return {
                type_i: 4,
                type: 'create_passive_sell_offer',
                asset: normalizeAsset(operation.buying),
                amount: operation.amount,
                source_asset: normalizeAsset(operation.selling),
                price: operation.price
            }
        case 'setOption':
        case 'setOptions':
            const res = {
                type_i: 5,
                type: 'set_options',
                inflation_dest: operation.inflationDest,
                clear_flags: operation.clearFlags,
                set_flags: operation.setFlags,
                master_weight: operation.masterWeight,
                low_threshold: operation.lowThreshold,
                med_threshold: operation.medThreshold,
                high_threshold: operation.highThreshold,
                home_domain: operation.homeDomain
            }
            if (operation.signer) {
                // signer is {weight, ed25519PublicKey | sha256Hash | preAuthTx | ed25519SignedPayload};
                // the hash/tx signers come as raw bytes (Uint8Array) — encode as hex like Horizon does
                const {weight, ...keys} = operation.signer
                const key = Object.values(keys).find(Boolean)
                res.signer_key = key instanceof Uint8Array ? Buffer.from(key).toString('hex') : (key || null)
                res.signer_weight = weight
            }
            return res
        case 'changeTrust':
            return {
                type_i: 6,
                type: 'change_trust',
                asset: normalizeAsset(operation.line),
                limit: operation.limit
            }
        case 'allowTrust':
            return {
                type_i: 7,
                type: 'allow_trust',
                destination: operation.trustor,
                asset: normalizeAsset({code: operation.assetCode, issuer: operation.trustor}),
                authorize: operation.authorize
            }
        case 'accountMerge':
            return {
                type_i: 8,
                type: 'account_merge',
                destination: operation.destination
            }
        case 'inflation':
            return {
                type_i: 9,
                type: 'inflation'
            }
        case 'manageDatum':
        case 'manageData':
            return {
                type_i: 10,
                type: 'manage_data',
                name: operation.name,
                // raw bytes (Uint8Array) in the SDK, null when the data entry is removed
                value: operation.value ? Buffer.from(operation.value).toString('utf8') : null
            }
        case 'bumpSequence':
            return {
                type: 'bump_sequence',
                type_i: 11,
                bump_to: operation.bumpTo
            }
        case 'createClaimableBalance':
            return {
                type: 'create_claimable_balance',
                type_i: 14,
                asset: normalizeAsset(operation.asset),
                amount: operation.amount,
                claimants: normalizeClaimants(operation.claimants)
            }
        case 'claimClaimableBalance':
            return {
                type: 'claim_claimable_balance',
                type_i: 15,
                balanceId: operation.balanceId
            }
        case 'beginSponsoringFutureReserves':
            return {
                type: 'begin_sponsoring_future_reserves',
                type_i: 16,
                sponsoredId: operation.sponsoredId
            }
        case 'endSponsoringFutureReserves':
            return {
                type: 'end_sponsoring_future_reserves',
                type_i: 17
            }
        // the SDK exposes seven distinct operation types for revoke sponsorship
        case 'revokeAccountSponsorship':
        case 'revokeTrustlineSponsorship':
        case 'revokeOfferSponsorship':
        case 'revokeDataSponsorship':
        case 'revokeClaimableBalanceSponsorship':
        case 'revokeLiquidityPoolSponsorship':
        case 'revokeSignerSponsorship':
            return normalizeRevokeSponsorship(operation)
        case 'clawback':
            return {
                type: 'clawback',
                type_i: 19,
                from: operation.from,
                asset: normalizeAsset(operation.asset),
                amount: operation.amount
            }
        case 'clawbackClaimableBalance':
            return {
                type: 'clawback_claimable_balance',
                type_i: 20,
                balanceId: operation.balanceId
            }
        case 'setTrustLineFlags':
            return {
                type: 'set_trustline_flags',
                type_i: 21,
                trustor: operation.trustor,
                asset: normalizeAsset(operation.asset),
                setFlags: operation.setFlags,
                clearFlags: operation.clearFlags
            }
        case 'liquidityPoolDeposit':
            return {
                type: 'liquidity_pool_deposit',
                type_i: 22,
                liquidityPoolId: operation.liquidityPoolId,
                maxAmountA: operation.maxAmountA,
                maxAmountB: operation.maxAmountB,
                minPrice: operation.minPrice,
                maxPrice: operation.maxPrice
            }
        case 'liquidityPoolWithdraw':
            return {
                type: 'liquidity_pool_withdraw',
                type_i: 23,
                liquidityPoolId: operation.liquidityPoolId,
                amount: operation.amount,
                minAmountA: operation.minAmountA,
                minAmountB: operation.minAmountB
            }
        case 'invokeHostFunction': {
            const normalized = {
                type: 'invoke_host_function',
                type_i: 24
            }
            const hf = operation.func
            if (hf) {
                // xdr.HostFunction is a discriminated union in stellar-sdk v17 (`.type` + arm properties)
                if (hf.type === 'hostFunctionTypeInvokeContract') {
                    normalized.host_function_type = 'invoke_contract'
                    try {
                        const inv = hf.invokeContract
                        // the contract address arm is always scAddressTypeContract on valid transactions, guard anyway
                        normalized.contract = inv.contractAddress?.contractId
                            ? StrKey.encodeContract(inv.contractAddress.contractId.toBytes())
                            : null
                        normalized.function_name = inv.functionName.toString()
                        try {
                            // addresses come as strkeys: G…/C… plain, M…/W… muxed (Protocol 27/30)
                            normalized.args = inv.args.map(a => stringifyBigInts(scValToNative(a)))
                        } catch (e) {
                            normalized.args = null
                        }
                    } catch (e) {
                        // fall through — partial decoding
                    }
                } else if (hf.type === 'hostFunctionTypeCreateContract' || hf.type === 'hostFunctionTypeCreateContractV2') {
                    normalized.host_function_type = 'create_contract'
                } else if (hf.type === 'hostFunctionTypeUploadContractWasm') {
                    normalized.host_function_type = 'upload_wasm'
                }
            }
            return normalized
        }
        case 'extendFootprintTTL':
        case 'extendFootprintTtl':
            return {
                type: 'extend_footprint_ttl',
                type_i: 25,
                extendTo: operation.extendTo
            }
        case 'restoreFootprint':
            return {
                type: 'restore_footprint',
                type_i: 26
            }
    }
}

function processOperation(operation, txDetails, applicationOrder) {
    let normalized = normalizeOperation(operation, txDetails.source)
    if (!normalized) {
        console.warn(`Unsupported operation type: ${operation.type}`)
        return null //ignore unsupported operation types
    }
    // assign operation generic ID
    // see https://github.com/stellar/go/blob/6a367049e8f9ad52798f5c8f69df8b875fde4a1a/services/horizon/internal/toid/main.go
    normalized.id = new BigNumber(txDetails.paging_token).plus(new BigNumber(applicationOrder + 1)).toString()
    normalized.account = normalized.account || operation.source || txDetails.source
    normalized.application_order = applicationOrder
    normalized.transaction_details = txDetails

    // Parse trades and actual amounts from result_xdr for path_payment operations
    if ((normalized.type === 'path_payment_strict_send' || normalized.type === 'path_payment_strict_receive') && txDetails.result_xdr) {
        const pathResult = parsePathPaymentTrades(txDetails.result_xdr, applicationOrder, normalized.type, normalized.source_asset)
        normalized.trades = pathResult.trades
        if (pathResult.dest_amount !== undefined) {
            normalized.dest_amount = pathResult.dest_amount
        }
        if (pathResult.source_amount !== undefined) {
            normalized.source_amount = pathResult.source_amount
        }
    }

    // Parse claimed trades and created_offer_id from result_xdr for manage offer operations
    if ((normalized.type === 'manage_sell_offer' || normalized.type === 'manage_buy_offer') && txDetails.result_xdr) {
        const offerResult = parseManageOfferResult(txDetails.result_xdr, applicationOrder)
        if (offerResult.trades?.length) {
            normalized.trades = offerResult.trades
        }
        if (normalized.offerId === '0' && offerResult.created_offer_id) {
            normalized.created_offer_id = offerResult.created_offer_id
        }
    }

    return normalized
}

/**
 * Normalize transaction memo
 * @param {StellarBase.Memo} rawMemo - SDK Memo (`.type` + `.value`, bytes as Uint8Array)
 * @returns {*}
 */
function processMemo(rawMemo) {
    if (!rawMemo) return undefined
    const value = rawMemo.value
    switch (rawMemo.type) {
        case 'id':
            return {
                type: 'id',
                value: value.toString()
            }
        case 'text':
            return {
                type: 'text',
                value: Buffer.from(value).toString('utf8')
            }
        case 'hash':
        case 'return':
            return {
                type: rawMemo.type,
                value: Buffer.from(value).toString('base64')
            }
    }
    return undefined
}

/**
 * Retrieve extended information from transaction object.
 * @param {StellarBase.Transaction} transaction
 * @returns {Object}
 */
function parseTransaction(transaction) {
    let xdrTx
    try {
        const networkPassphrase = config.networkPassphrase || 'Public Global Stellar Network ; September 2015'
        xdrTx = TransactionBuilder.fromXdr(transaction.envelope_xdr, networkPassphrase)
        if (xdrTx.innerTransaction) {
            xdrTx = xdrTx.innerTransaction
        }
    } catch (e) {
        console.error(e)
        console.error('Tx envelope: ' + transaction.envelope_xdr)
        return null
    }

    const txDetails = {
        hash: transaction.hash,
        fee: xdrTx.fee,
        fee_charged:transaction.fee_charged,
        max_fee:transaction.max_fee,
        source: xdrTx.source,
        paging_token: transaction.paging_token,
        source_account_sequence: transaction.source_account_sequence,
        created_at: transaction.created_at,
        memo: processMemo(xdrTx.memo),
        result_xdr: transaction.result_xdr,
        envelope_xdr: transaction.envelope_xdr
    }

    if (xdrTx.timeBounds) {
        txDetails.time_bounds = {
            min: xdrTx.timeBounds.minTime,
            max: xdrTx.timeBounds.maxTime
        }
    }

    return {
        id: txDetails.hash,
        details: txDetails,
        operations: xdrTx.operations.map((op, i) => processOperation(op, txDetails, i)).filter(op => !!op)
        //TODO: retrieve effects from transaction.result_xdr
    }
}

module.exports = {
    parseTransaction,
    parsePathPaymentTrades,
    parseManageOfferResult
}
