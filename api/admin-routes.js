const express = require('express'),
    config = require('../models/config'),
    path = require('path'),
    errors = require('../util/errors'),
    auth = require('./authorization-handler'),
    logger = require('../util/logger')

module.exports = function (app) {
    // Check if admin UI is enabled
    if (!config.adminUiEnabled) {
        logger.info('Admin UI is disabled. Enable it by setting ADMIN_UI_ENABLED=true in environment or config.')
        return
    }
    
    // Get host and port information for logging
    const port = process.env.PORT || config.apiPort || 3000
    const host = process.env.API_HOST || config.apiHost || 'localhost'
    
    // Log admin UI access information
    logger.info('✨ Admin UI is available at:')
    logger.info(`🔗 http://${host}:${port}/admin`)
    logger.info(`🔑 Use admin token for access: ${config.adminAuthenticationToken ? config.adminAuthenticationToken.substring(0, 8) + '...' : 'not set'}`)
    logger.info('📖 Documentation: https://github.com/Montelibero/operations-notifier')

    // Admin UI access route without authentication (auth will happen client-side)
    app.get('/admin', (req, res) => {
        // Always serve the admin UI - authentication will happen client-side
        return res.sendFile(path.resolve(__dirname, '../public/admin.html'))
    })
}