const { Horizon } = require('@stellar/stellar-sdk'),
    config = require('../models/config'),
    logger = require('../util/logger')

logger.info(`Using Horizon server ${config.horizon}`)

module.exports = {
    /**
     * Horizon wrapper instance
     */
    horizon: new Horizon.Server(config.horizon, {
        allowHttp: !!config.horizonAllowHttp
    })//a Horizon wrapper instance
}
