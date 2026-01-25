const auth = require('../api/authorization-handler'),
    roles = require('../models/user/roles'),
    storage = require('../logic/storage'),
    errors = require('../util/errors')

function notImplementedError(req, res) {
    res.status(501).json({
        error: 'Endpoint not implemented'
    })
}

module.exports = function (app) {

    //get current nonce for authenticated user (nonceless auth)
    app.get('/api/nonce', auth.nonceLookupMiddleware, (req, res, next) => {
        const isAdmin = auth.isInRole(req, roles.ADMIN)
        const pubkey = isAdmin && req.query.pubkey ? req.query.pubkey : (req.user && req.user.pubkey)
        if (!pubkey) return next(errors.unauthorized())

        storage.provider.userProvider.getUserByPublicKey(pubkey)
            .catch(e => next(e))
            .then(user => {
                if (!user) return res.status(404).json({ error: 'User not found' })
                res.json({ pubkey: user.pubkey, nonce: user.nonce || 0 })
            })
    })

    //register new user (admin action)
    app.post('/api/user', [auth.userRequiredMiddleware, auth.isInRoleMiddleware(roles.ADMIN)], (req, res, next) => {
        let user = req.body
        if (!user.pubkey && user.token) {
            user.pubkey = user.token
        }
        storage.provider.userProvider.addUser(user)
            .catch(e => next(e))
            .then(() => res.end())
    })

    //list all registered users (admin action)
    app.get('/api/user', [auth.userRequiredMiddleware, auth.isInRoleMiddleware(roles.ADMIN)], (req, res, next) => {
        storage.provider.userProvider.getAllUsers()
            .catch(e => next(e))
            .then(users => res.json(users))
    })

    //get user by pubkey (admin action)
    app.get('/api/user/:pubkey', auth.userRequiredMiddleware, (req, res, next) => {
        if (!auth.canEdit(req, req.params.pubkey))
            return next(errors.forbidden())
        storage.provider.userProvider.getUserByPublicKey(req.params.pubkey)
            .catch(e => next(e))
            .then(user => res.json(user))
    })

    //update user settings
    app.put('/api/user/:pubkey', auth.userRequiredMiddleware, notImplementedError)

    //delete user
    app.delete('/api/user/:pubkey', auth.userRequiredMiddleware, (req, res, next) => {
        if (!auth.canEdit(req, req.params.pubkey))
            return next(errors.forbidden())
        storage.provider.userProvider.deleteUserByPubkey(req.params.pubkey)
            .catch(e => next(e))
            .then(() => res.end())
    })
}
