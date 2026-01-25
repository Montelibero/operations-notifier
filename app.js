process.env.NODE_ENV = process.env.NODE_ENV || 'production'
const logger = require('./util/logger')

async function init() {
    const config = require('./models/config')
    //init storage and persistence layer
    const storage = require('./logic/storage')


    await storage.init(config)


    process.on('SIGINT', () => {
        shutdown()
    })

    process.on('SIGTERM', () => {
        shutdown()
    })

    //init and start observer
    const observer = require('./logic/observer')
    observer.start()

    //init HTTP server and map all API routes
    const server = await require('./api/server-initialization')(config)

    server.shutdown = shutdown

    function shutdown() {

        logger.info('Received kill signal')
        logger.info('Closing http server.')

        server.close(() => {
            observer.stop()
            logger.info('transaction observer stopped')
            storage.finalize()
                .then(() => {
                    logger.info('Storage provider connection closed.')
                    logger.info('Closed out remaining connections')
                    process.exit(0)
                })
                .catch((err) => {
                    logger.error('Error closing connection ' + err)
                    logger.error('Forcelly shutting down')
                    process.exit(1)
                })
        })
        setTimeout(() => {
            logger.error('Could not close connections in time, forcefully shutting down')
            process.exit(1)
        }, 10000)
    }
    return server
}

module.exports = init()