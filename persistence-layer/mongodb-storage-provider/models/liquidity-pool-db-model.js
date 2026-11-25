const mongoose = require('mongoose'),
    Schema = mongoose.Schema

/**
 * Liquidity pools seen by the notifier: the pair of assets is immutable, so a record is written once.
 * The pair is needed to match deposit/withdraw operations by asset (the envelope carries only the pool id).
 */
const poolAssetSchema = new Schema({
    asset_type: Number,
    asset_code: String,
    asset_issuer: String
}, {_id: false}) // no per-element _id: the pair is copied into webhook payloads as is

const liquidityPoolSchema = new Schema({
    _id: {type: String}, // pool id (64-char hex)
    assets: [poolAssetSchema],
    fee: {type: Number},
    source: {type: String} // envelope | horizon
}, {
    timestamps: {createdAt: 'created', updatedAt: 'updated'}
})

liquidityPoolSchema.set('toJSON', {getters: true})

const LiquidityPool = mongoose.model('LiquidityPool', liquidityPoolSchema, 'liquidity_pool')

module.exports = LiquidityPool
