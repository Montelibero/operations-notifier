const pkgInfo = require('../package'),
    {signer} = require('../util/signer'),
    observer = require('../logic/observer'),
    storage = require('../logic/storage'),
    {elapsed} = require('../util/elapsed-time'),
    auth = require('./authorization-handler'),
    roles = require('../models/user/roles'),
    errors = require('../util/errors')

function processResponse(promiseOrData, res) {
    if (!(promiseOrData instanceof Promise)) promiseOrData = Promise.resolve(promiseOrData)
    promiseOrData
        .then(data => {
            if (!data) return res.status(200).end()
            res.json(data)
        })
        .catch(e => {
            if (typeof e === 'object' || (e instanceof Error && e.status)) {
                return res.status(e.status || 400)
                    .json({
                        error: e.error || e.message,
                        details: e.details
                    })
            }
            console.error(e)
            res.status(500).end()
        })
}

const started = new Date()

function getUserPubKey(req) {
    return req.user ? req.user.pubkey : null
}

module.exports = function (app) {
    //get application status
    app.get('/api/status', (req, res) => {
        Promise.all([
            observer.loadSubscriptions(),
            storage.getLastIngestedTx()
        ])
            .then(([subscriptions, lastIngestedTx]) => res.json({
                version: pkgInfo.version,
                uptime: elapsed(new Date(), started),
                publicKey: signer.getPublicKey(),
                observing: observer.observing,
                subscriptions: subscriptions ? subscriptions.length : 0,
                lostNotifications: subscriptions
                    ? subscriptions.reduce((sum, s) => sum + (s.lost_notifications || 0), 0)
                    : 0,
                lastIngestedTx,
                stream: observer.transactionWatcher && observer.transactionWatcher.getStatus
                    ? observer.transactionWatcher.getStatus()
                    : null,
                notifier: observer.notifier && observer.notifier.getStatus
                    ? observer.notifier.getStatus()
                    : null
            }))
            .catch(e => {
                console.error(e)
                res.status(500).end()
            })
    })

    //get all subscriptions for current user
    app.get('/api/subscription', auth.userRequiredMiddleware, (req, res) => {
        observer.getActiveSubscriptions()
            .then(all => {
                if (auth.isInRole(req, roles.ADMIN)) return all
                return all.filter(s => s.pubkey === getUserPubKey(req))
            })
            .then(subscriptions => processResponse(subscriptions, res))
    })

    //get subscription by id
    app.get('/api/subscription/:id', auth.userRequiredMiddleware, (req, res) => {
        observer.getSubscription(req.params.id)
            .then(subscription => {
                if (subscription.pubkey === getUserPubKey(req)) return processResponse(subscription, res)
                res.status(404).json({
                    error: `Subscription ${req.params.id} not found.`
                })
            })
    })

    //create new subscription
    app.post('/api/subscription', auth.userRequiredMiddleware, (req, res) => {
        processResponse(observer.subscribe(req.body, req.user), res)
    })

    //unsubscribe
    app.delete('/api/subscription/:id', auth.userRequiredMiddleware, (req, res, next) => {
        observer.getSubscription(req.params.id)
            .then(subscription => {
                if (!subscription) throw errors.notFound()
                if (!subscription.pubkey && !auth.isInRole(req, roles.ADMIN))
                    throw errors.forbidden()
                if (subscription.pubkey && !auth.canEdit(req, subscription.pubkey))
                    throw errors.forbidden()
                return observer.unsubscribe(req.params.id)
            })
            .then(() => res.status(200).end())
            .catch(next)
    })

    //block modifications
    app.put('/api/subscription', (req, res) => res.status(405).json({
        error: 'Subscription cannot be modified'
    }))

    app.put('/api/subscription/:id', (req, res) => res.status(405).json({
        error: 'Subscription cannot be modified'
    }))
}
