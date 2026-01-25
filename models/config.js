const config = process.env['NODE_ENV'] == 'test' ?  require('../test/app.config-test.json') :  require('../app.config.json')

function camelCase(value) {
    return value.toLowerCase().replace(/_([a-z])/g, (x, up) => up.toUpperCase())
}

function parseEnv(key) {
    let value = process.env[key]
    if (value) {
        const path = camelCase(key),
            defaultValue = config[path]
        if (typeof defaultValue === 'number') {
            value = parseInt(value)
        } else if (typeof defaultValue === 'boolean') {
            value = value === 'true' || value === '1'
        } else if (Array.isArray(defaultValue)) {
            value = value.split(',').map(v => v.trim()).filter(Boolean)
        }
        config[path] = value
    }
}

parseEnv('AUTHORIZATION')
parseEnv('STORAGE_PROVIDER')
parseEnv('STORAGE_CONNECTION_STRING')
parseEnv('API_PORT')
parseEnv('API_HOST')
parseEnv('HORIZON')
parseEnv('NETWORK_PASSPHRASE')
parseEnv('HORIZON_ALLOW_HTTP')
parseEnv('USER_TOKENS')
parseEnv('SIGNATURE_SECRET')
parseEnv('MAX_ACTIVE_SUBSCRIPTIONS')
parseEnv('MAX_ACTIVE_SUBSCRIPTIONS_PER_USER')
parseEnv('NOTIFICATION_CONCURRENCY')
parseEnv('REACTION_RESPONSE_TIMEOUT')
parseEnv('ADMIN_AUTHENTICATION_TOKEN')
parseEnv('MAX_DELIVERY_FAILURES')
parseEnv('MAX_NOTIFICATION_AGE_SECONDS')
parseEnv('MAX_CONSECUTIVE_LOST_NOTIFICATIONS')
parseEnv('LEDGER_WORKERS')
parseEnv('TRANSACTION_WORKERS')

module.exports = config
