const axios = require('axios')
const app = require('../app')
const config = require('../models/config')
const { Keypair } = require('@stellar/stellar-sdk')
const storage = require('../logic/storage')
const { encodeUrlParams } = require('../util/url-encoder')
const roles = require('../models/user/roles')
const observer = require('../logic/observer')


describe('API', function () {
    let server
    let axiosInstance
    let subscriptions = null
    const newUserKeyPair = Keypair.random()
    const adminKeyPair = Keypair.random()


    function signData(key, data) {
        data = typeof data === 'object' ? JSON.stringify(data) : data.toString()
        return key.sign(data).toString('hex')
    }

    before(async function () {
        this.timeout(20000)
        config.authorization = true
        server = await app
        axiosInstance = axios.create({ baseURL: `http://localhost:${server.address().port}` })
        await storage.provider.userProvider.addUser({
            pubkey: newUserKeyPair.publicKey()
        })
    })

    after(function (done) {
        this.timeout(20000)
        config.authorization = false
        Promise.all([
            storage.provider.userProvider.deleteAllUsers(),
            storage.provider.removeAllSubscriptions()
        ]).then(() => {
            server.close(() => {
                observer.stop()
                storage.finalize().then(() => done())
            })

        })
    })

    describe('Subscriptions', () => {
        describe('/POST subscriptions', () => {
            it('it should fail to POST new subscription (no auth token)', async () => {
                const data = {
                    reaction_url: 'http://fake.url/reaction',
                    operation_types: [0, 1, 3]
                }
                try {
                    await axiosInstance.post('/api/subscription', data)
                } catch (err) {
                    expect(err.response.status).to.equal(401)
                }
            })

            it('it should POST new subscription', async () => {
                const nonce = Date.now()

                const data = {
                    reaction_url: 'http://fake.url/reaction',
                    operation_types: [0, 1, 3],
                    nonce: nonce
                }

                const signature = signData(newUserKeyPair, encodeUrlParams(data))

                const res = await axiosInstance.post('/api/subscription', data, {
                    headers: {
                        authorization: `${newUserKeyPair.publicKey()}.${signature}`
                    }
                })
                expect(res.status).to.equal(200)
            })


            it('it should POST new subscription with admin token', async () => {
                const data = {
                    reaction_url: 'http://fake.url/reaction',
                    operation_types: [0, 1, 3]
                }

                const res = await axiosInstance.post('/api/subscription', data, {
                    headers: {
                        authorization: config.adminAuthenticationToken
                    }
                })
                expect(res.status).to.equal(200)
            })
        })

        describe('/GET subscriptions', () => {
            it('it should GET all the subscriptions', async () => {
                const res = await axiosInstance.get('/api/subscription', {
                    headers: {
                        authorization: config.adminAuthenticationToken
                    }
                })
                expect(res.status).to.equal(200)
                expect(res.data).to.be.an('array')
                expect(res.data.length).to.be.eql(2)
                subscriptions = res.data
            })

            it('it should GET all own subscriptions', async () => {
                const payload = encodeUrlParams({ nonce: Date.now() })
                const signature = signData(newUserKeyPair, payload)
                const res = await axiosInstance.get(`/api/subscription?${payload}`, {
                    headers: {
                        authorization: `${newUserKeyPair.publicKey()}.${signature}`
                    }
                })
                expect(res.status).to.equal(200)
                expect(res.data).to.be.an('array')
                expect(res.data.length).to.be.eql(1)
            })

            it('it should fail to GET subscription by another\'s id', async () => {
                const payload = encodeUrlParams({ nonce: Date.now() })
                const signature = signData(newUserKeyPair, payload)
                const anothersSubs = subscriptions.find(s => s.pubkey !== newUserKeyPair.publicKey())
                try {
                    await axiosInstance.get(`/api/subscription/${anothersSubs.id}?${payload}`, {
                        headers: {
                            authorization: `${newUserKeyPair.publicKey()}.${signature}`
                        }
                    })
                } catch (err) {
                    expect(err.response.status).to.equal(404)
                }
            })

            it('it should GET own subscription by id', async () => {
                const payload = encodeUrlParams({ nonce: Date.now() }),
                    signature = signData(newUserKeyPair, payload),
                    ownSubs = subscriptions.find(s => s.pubkey === newUserKeyPair.publicKey())

                const res = await axiosInstance.get(`/api/subscription/${ownSubs.id}?${payload}`, {
                    headers: {
                        authorization: `${newUserKeyPair.publicKey()}.${signature}`
                    }
                })
                expect(res.status).to.equal(200)
                expect(res.data.id).to.be.eql(ownSubs.id)
            })
        })

        describe('/DELETE subscription', () => {
            it('it should forbid deleting another user subscription', async () => {
                const payload = encodeUrlParams({ nonce: Date.now() })
                const signature = signData(newUserKeyPair, payload)
                const anothersSubs = subscriptions.find(s => s.pubkey !== newUserKeyPair.publicKey())
                try {
                    await axiosInstance.delete(`/api/subscription/${anothersSubs.id}?${payload}`, {
                        headers: {
                            authorization: `${newUserKeyPair.publicKey()}.${signature}`
                        }
                    })
                } catch (err) {
                    expect(err.response.status).to.equal(403)
                }
            })
        })

        describe('/GET nonce', () => {
            it('it should GET nonce without providing nonce param', async () => {
                const payload = `nonce:${newUserKeyPair.publicKey()}`
                const signature = signData(newUserKeyPair, payload)
                const res = await axiosInstance.get('/api/nonce', {
                    headers: {
                        authorization: `${newUserKeyPair.publicKey()}.${signature}`
                    }
                })
                expect(res.status).to.equal(200)
                expect(res.data.pubkey).to.equal(newUserKeyPair.publicKey())
                expect(res.data.nonce).to.be.a('number')
            })
        })
    })

    describe('Users API', () => {
        before(async function () {
            const user = await storage.provider.userProvider.getUserByPublicKey(adminKeyPair.publicKey())
            if (user) {
                await storage.provider.userProvider._deleteUserById(user.id)
            }
        })
        describe('/POST user', () => {
            it('it should fail to POST new user (no auth token)', async () => {
                try {
                    await axiosInstance.post('/api/user', { pubkey: 'testkey' })
                } catch (err) {
                    expect(err.response.status).to.equal(401)
                }
            })

            it('it should POST new admin user with config admin token', async () => {
                const res = await axiosInstance.post('/api/user', {
                    pubkey: adminKeyPair.publicKey(),
                    roles: [roles.ADMIN]
                }, {
                    headers: {
                        authorization: config.adminAuthenticationToken
                    }
                })
                expect(res.status).to.equal(200)
            })

            it('it should POST new user with new admin credentials', async () => {
                const newUser = {
                    pubkey: Keypair.random().publicKey(),
                    roles: [],
                    nonce: Date.now()
                }

                const signature = signData(adminKeyPair, encodeUrlParams(newUser))

                const res = await axiosInstance.post('/api/user', newUser, {
                    headers: {
                        authorization: `${adminKeyPair.publicKey()}.${signature}`
                    }
                })
                expect(res.status).to.equal(200)
            })
        })

        describe('/GET user', () => {
            it('it should GET all the users', async () => {
                const payload = encodeUrlParams({ nonce: Date.now() }),
                    signature = signData(adminKeyPair, payload)

                const res = await axiosInstance.get('/api/user?' + payload, {
                    headers: {
                        authorization: `${adminKeyPair.publicKey()}.${signature}`
                    }
                })
                expect(res.status).to.equal(200)
                expect(res.data).to.be.a('array')
                expect(res.data.length).to.be.eql(3)
            })

            it('it should GET own user', async () => {
                const payload = encodeUrlParams({ nonce: Date.now() }),
                    signature = signData(newUserKeyPair, payload)
                const res = await axiosInstance.get(`/api/user/${newUserKeyPair.publicKey()}?${payload}`, {
                    headers: {
                        authorization: `${newUserKeyPair.publicKey()}.${signature}`
                    }
                })
                expect(res.status).to.equal(200)
                expect(res.data).to.be.a('object')
                expect(res.data.pubkey).to.be.eql(newUserKeyPair.publicKey())
            })
        })

        describe('/DELETE user', () => {
            it('it fail to delete user', async () => {
                const nonce = Date.now(),
                    data = { nonce },
                    signature = signData(newUserKeyPair, encodeUrlParams(data))

                try {
                    await axiosInstance.delete(`/api/user/${adminKeyPair.publicKey()}`, {
                        headers: {
                            authorization: `${newUserKeyPair.publicKey()}.${signature}`
                        },
                        data
                    })
                } catch (err) {
                    expect(err.response.status).to.equal(403)
                }
            })

            it('it should delete user', async () => {
                const nonce = Date.now(),
                    data = { nonce },
                    signature = signData(newUserKeyPair, encodeUrlParams(data))

                const res = await axiosInstance.delete(`/api/user/${newUserKeyPair.publicKey()}`, {
                    headers: {
                        authorization: `${newUserKeyPair.publicKey()}.${signature}`
                    },
                    data
                })
                expect(res.status).to.equal(200)
            })
        })
    })

    describe('Token auth', () => {
        const tokenA = 'tokenA'
        const tokenB = 'tokenB'
        const tokenC = 'tokenC'
        let tokenASub
        let tokenBSub

        before(async function () {
            config.authorization = 'token'
            config.userTokens = [tokenA, tokenB]
            await storage.provider.userProvider.deleteAllUsers()
            await storage.provider.removeAllSubscriptions()
            observer.subscriptions = []
        })

        it('it should reject tokens not in allowlist', async () => {
            const data = {
                reaction_url: 'http://fake.url/reaction',
                operation_types: [0]
            }
            try {
                await axiosInstance.post('/api/subscription', data, {
                    headers: { authorization: tokenC }
                })
            } catch (err) {
                expect(err.response.status).to.equal(401)
            }
        })

        it('it should accept a single allowed token and reject others', async () => {
            const previous = config.userTokens
            config.userTokens = [tokenA]
            try {
                const res = await axiosInstance.get('/api/subscription', {
                    headers: { authorization: tokenA }
                })
                expect(res.status).to.equal(200)

                try {
                    await axiosInstance.get('/api/subscription', {
                        headers: { authorization: tokenB }
                    })
                } catch (err) {
                    expect(err.response.status).to.equal(401)
                }
            } finally {
                config.userTokens = previous
            }
        })

        it('it should create subscriptions for token users', async () => {
            const dataA = {
                reaction_url: 'http://fake.url/reactionA',
                operation_types: [0]
            }
            const dataB = {
                reaction_url: 'http://fake.url/reactionB',
                operation_types: [1]
            }

            const resA = await axiosInstance.post('/api/subscription', dataA, {
                headers: { authorization: tokenA }
            })
            const resB = await axiosInstance.post('/api/subscription', dataB, {
                headers: { authorization: tokenB }
            })

            expect(resA.status).to.equal(200)
            expect(resB.status).to.equal(200)
            tokenASub = resA.data
            tokenBSub = resB.data
        })

        it('it should list only own subscriptions for token user', async () => {
            const res = await axiosInstance.get('/api/subscription', {
                headers: { authorization: tokenA }
            })
            expect(res.status).to.equal(200)
            expect(res.data).to.be.an('array')
            expect(res.data.length).to.equal(1)
            expect(res.data[0].id).to.equal(tokenASub.id)
        })

        it('it should forbid deleting another token user subscription', async () => {
            try {
                await axiosInstance.delete(`/api/subscription/${tokenBSub.id}`, {
                    headers: { authorization: tokenA }
                })
            } catch (err) {
                expect(err.response.status).to.equal(403)
            }
        })

        it('it should delete own subscription', async () => {
            const res = await axiosInstance.delete(`/api/subscription/${tokenASub.id}`, {
                headers: { authorization: tokenA }
            })
            expect(res.status).to.equal(200)
        })
    })
})
