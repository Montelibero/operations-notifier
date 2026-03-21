const { Horizon } = require('@stellar/stellar-sdk'),
    config = require('../models/config'),
    { sanitizeUrlForLogs } = require('../util/log-redaction'),
    logger = require('../util/logger')

logger.info(`Using Horizon server ${sanitizeUrlForLogs(config.horizon)}`)

module.exports = {
    /**
     * Horizon wrapper instance
     */
    horizon: new Horizon.Server(config.horizon, {
        allowHttp: !!config.horizonAllowHttp
    })//a Horizon wrapper instance
}
