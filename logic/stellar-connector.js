const { Horizon } = require('@stellar/stellar-sdk'),
    config = require('../models/config')

console.log(`Using Horizon server ${config.horizon}`)

module.exports = {
    /**
     * Horizon wrapper instance
     */
    horizon: new Horizon.Server(config.horizon)//a Horizon wrapper instance
}