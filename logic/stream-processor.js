const {TransactionBuilder, xdr, StrKey} = require('@stellar/stellar-sdk'),
    BigNumber = require('bignumber.js'),
    {parseAsset, nativeAsset} = require('../util/asset-helper'),
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

function normalizeXdrAsset(xdrAsset) {
    if (!xdrAsset) return null
    const type = xdrAsset.switch().name
    if (type === 'assetTypeNative') {
        return nativeAsset()
    }
    const value = xdrAsset.value()
    if (type === 'assetTypeCreditAlphanum4') {
        return {
            asset_type: 1,
            asset_code: value.assetCode().toString().replace(/\0/g, ''),
            asset_issuer: StrKey.encodeEd25519PublicKey(value.issuer().ed25519())
        }
    }
    if (type === 'assetTypeCreditAlphanum12') {
        return {
            asset_type: 2,
            asset_code: value.assetCode().toString().replace(/\0/g, ''),
            asset_issuer: StrKey.encodeEd25519PublicKey(value.issuer().ed25519())
        }
    }
    return null
}

/**
 * Parse manage offer result XDR to extract created_offer_id and claimed trades.
 * @param {string} resultXdr - Base64-encoded transaction result XDR
 * @param {number} operationIndex - Index of the operation in the transaction
 * @returns {Object} Object with created_offer_id and trades (if any)
 */
function parseManageOfferResult(resultXdr, operationIndex) {
    const emptyResult = { trades: [] }
    try {
        const result = xdr.TransactionResult.fromXDR(resultXdr, 'base64')
        const resultType = result.result().switch().name

        // Handle fee-bump transactions
        let opResults
        if (resultType === 'txFeeBumpInnerSuccess' || resultType === 'txFeeBumpInnerFailed') {
            opResults = result.result().innerResultPair().result().result().results()
        } else {
            opResults = result.result().results()
        }
        if (!opResults || operationIndex >= opResults.length) return emptyResult

        const opResult = opResults[operationIndex]
        const tr = opResult?.tr?.()
        if (!tr) return emptyResult

        const xdrOpType = tr.switch().name
        if (xdrOpType !== 'manageSellOffer' && xdrOpType !== 'manageBuyOffer') return emptyResult

        const inner = tr.value()
        if (!inner?.success) return emptyResult

        const success = inner.success()

        const offersClaimed =
            typeof success.offersClaimed === 'function'
                ? success.offersClaimed()
                : typeof success.offers_claimed === 'function'
                    ? success.offers_claimed()
                    : []

        const trades = (offersClaimed || []).map(claim => {
            const type = claim.switch().name
            if (type === 'claimAtomTypeOrderBook') {
                const ob = claim.orderBook()
                return {
                    type: 'order_book',
                    seller_id: StrKey.encodeEd25519PublicKey(ob.sellerId().ed25519()),
                    offer_id: ob.offerId().toString(),
                    asset_sold: normalizeXdrAsset(ob.assetSold()),
                    amount_sold: stroopsToAmount(ob.amountSold().toString()),
                    asset_bought: normalizeXdrAsset(ob.assetBought()),
                    amount_bought: stroopsToAmount(ob.amountBought().toString())
                }
            } else if (type === 'claimAtomTypeLiquidityPool') {
                const lp = claim.liquidityPool()
                return {
                    type: 'liquidity_pool',
                    pool_id: lp.liquidityPoolId().toString('hex'),
                    asset_sold: normalizeXdrAsset(lp.assetSold()),
                    amount_sold: stroopsToAmount(lp.amountSold().toString()),
                    asset_bought: normalizeXdrAsset(lp.assetBought()),
                    amount_bought: stroopsToAmount(lp.amountBought().toString())
                }
            }
            return null
        }).filter(Boolean)

        const resultObj = { trades }

        const offer = typeof success.offer === 'function' ? success.offer() : null
        if (offer) {
            const offerSwitch = offer.switch().name
            if (offerSwitch === 'manageOfferCreated' || offerSwitch === 'manageOfferUpdated') {
                resultObj.created_offer_id = offer.offer().offerId().toString()
            }
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
 * @returns {Object} Object with trades array and actual amounts (dest_amount for strict_send, source_amount for strict_receive)
 */
function parsePathPaymentTrades(resultXdr, operationIndex, opType) {
    const emptyResult = { trades: [] }
    try {
        const result = xdr.TransactionResult.fromXDR(resultXdr, 'base64')
        const resultType = result.result().switch().name

        // Handle fee-bump transactions
        let opResults
        if (resultType === 'txFeeBumpInnerSuccess' || resultType === 'txFeeBumpInnerFailed') {
            opResults = result.result().innerResultPair().result().result().results()
        } else {
            opResults = result.result().results()
        }
        if (!opResults || operationIndex >= opResults.length) return emptyResult

        const opResult = opResults[operationIndex]
        const tr = opResult?.tr?.()
        if (!tr) return emptyResult

        const xdrOpType = tr.switch().name
        if (xdrOpType !== 'pathPaymentStrictSend' && xdrOpType !== 'pathPaymentStrictReceive') return emptyResult

        const inner = tr.value()
        if (!inner?.success) return emptyResult

        const success = inner.success()
        const offers = success?.offers?.() || []

        const trades = offers.map(claim => {
            const type = claim.switch().name
            if (type === 'claimAtomTypeOrderBook') {
                const ob = claim.orderBook()
                return {
                    type: 'order_book',
                    seller_id: StrKey.encodeEd25519PublicKey(ob.sellerId().ed25519()),
                    offer_id: ob.offerId().toString(),
                    asset_sold: normalizeXdrAsset(ob.assetSold()),
                    amount_sold: stroopsToAmount(ob.amountSold().toString()),
                    asset_bought: normalizeXdrAsset(ob.assetBought()),
                    amount_bought: stroopsToAmount(ob.amountBought().toString())
                }
            } else if (type === 'claimAtomTypeLiquidityPool') {
                const lp = claim.liquidityPool()
                return {
                    type: 'liquidity_pool',
                    pool_id: lp.liquidityPoolId().toString('hex'),
                    asset_sold: normalizeXdrAsset(lp.assetSold()),
                    amount_sold: stroopsToAmount(lp.amountSold().toString()),
                    asset_bought: normalizeXdrAsset(lp.assetBought()),
                    amount_bought: stroopsToAmount(lp.amountBought().toString())
                }
            }
            return null
        }).filter(Boolean)

        // Extract actual amounts from the result
        const resultObj = { trades }

        // last contains SimplePaymentResult: { destination, asset, amount }
        const last = success.last()
        if (last) {
            const destAmount = stroopsToAmount(last.amount().toString())

            if (opType === 'path_payment_strict_send') {
                // For strict_send: last.amount is the actual destination amount received
                resultObj.dest_amount = destAmount
            } else if (opType === 'path_payment_strict_receive') {
                // For strict_receive: calculate source_amount from first trade's amount_bought
                // The source_amount is what was actually spent from the source asset
                if (trades.length > 0) {
                    resultObj.source_amount = trades[0].amount_bought
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
                type: 'manage_sell_offer',
                asset: normalizeAsset(operation.buying),
                amount: operation.buyAmount ,
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
                res.signer_key = operation.signer.key
                res.signer_weight = operation.signer.weight
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
                value: operation.value ? operation.value.toString('utf8') : null
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
                claimants: operation.claimants
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
        case 'revokeSponsorship': {
            const res = {
                type: 'revoke_sponsorship',
                type_i: 18
            }
            if (operation.ledgerKey) {
                res.ledgerKey = operation.ledgerKey
            } else if (operation.signer) {
                res.signer = {
                    accountId: operation.signer.accountId,
                    signerKey: operation.signer.signerKey
                }
            } else {
                res.accountId = operation.account
            }
            return res
        }
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
        case 'invokeHostFunction':
            return {
                type: 'invoke_host_function',
                type_i: 24,
                function: operation.function,
                parameters: operation.parameters,
                footprint: operation.footprint,
                authority: operation.authority
            }
        case 'extendFootprintTTL':
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
    normalized.transaction_details = txDetails

    // Parse trades and actual amounts from result_xdr for path_payment operations
    if ((normalized.type === 'path_payment_strict_send' || normalized.type === 'path_payment_strict_receive') && txDetails.result_xdr) {
        const pathResult = parsePathPaymentTrades(txDetails.result_xdr, applicationOrder, normalized.type)
        normalized.trades = pathResult.trades
        if (pathResult.dest_amount !== undefined) {
            normalized.dest_amount = pathResult.dest_amount
        }
        if (pathResult.source_amount !== undefined) {
            normalized.source_amount = pathResult.source_amount
        }
    }

    // Parse claimed trades and created_offer_id from result_xdr for manage offer operations
    if (normalized.type === 'manage_sell_offer' && txDetails.result_xdr) {
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
 * @param {StellarBase.Memo} rawMemo - raw XDR memo
 * @returns {*}
 */
function processMemo(rawMemo) {
    switch (rawMemo._type) {
        case 'id':
            return {
                type: rawMemo._type,
                value: rawMemo._value
            }
        case 'text':
            return {
                type: rawMemo._type,
                value: rawMemo._value.toString('utf8')
            }
        case 'hash':
        case 'return':
            return {
                type: rawMemo._type,
                value: rawMemo._value.toString('base64')
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
        xdrTx = TransactionBuilder.fromXDR(transaction.envelope_xdr, networkPassphrase)
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
