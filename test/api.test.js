const axios = require('axios')
const app = require('../app')
const config = require('../models/config')
const { Keypair } = require('@stellar/stellar-sdk')
const storage = require('../logic/storage')
const { encodeUrlParams } = require('../util/url-encoder')
const roles = require('../models/user/roles')
const observer = require('../logic/observer')
const sinon = require('sinon')
const {expect} = require('chai')


describe('API', function () {
    let server
    let axiosInstance
    let subscriptions = null
    const newUserKeyPair = Keypair.random()
    const adminKeyPair = Keypair.random()


    function signData(key, data) {
        data = typeof data === 'object' ? JSON.stringify(data) : data.toString()
        // stellar-sdk v17: Keypair.sign() takes and returns Uint8Array (not Buffer)
        return Buffer.from(key.sign(Buffer.from(data))).toString('hex')
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

            it('it should deduplicate subscriptions of an authenticated user (ed25519 and token auth)', async () => {
                const postSigned = async (data) => {
                    const nonce = Date.now()
                    const body = {...data, nonce}
                    return axiosInstance.post('/api/subscription', body, {
                        headers: {authorization: `${newUserKeyPair.publicKey()}.${signData(newUserKeyPair, encodeUrlParams(body))}`}
                    })
                }
                const data = {reaction_url: 'http://fake.url/dedup-user', operation_types: [1]}
                const first = await postSigned(data)
                const second = await postSigned(data)
                expect(first.status).to.equal(200)
                expect(second.data.id).to.equal(first.data.id) // the same owner and filters → the same subscription
                // the same filters owned by the admin token are a different subscription
                const admin = await axiosInstance.post('/api/subscription', data, {headers: {authorization: config.adminAuthenticationToken}})
                expect(admin.data.id).to.not.equal(first.data.id)
            })

            it('it should return existing subscription on duplicate POST (idempotent)', async () => {
                const data = {
                    reaction_url: 'http://fake.url/dedup-test',
                    operation_types: [0, 2]
                }

                const res1 = await axiosInstance.post('/api/subscription', data, {
                    headers: {
                        authorization: config.adminAuthenticationToken
                    }
                })
                expect(res1.status).to.equal(200)

                const res2 = await axiosInstance.post('/api/subscription', data, {
                    headers: {
                        authorization: config.adminAuthenticationToken
                    }
                })
                expect(res2.status).to.equal(200)
                expect(res2.data.id).to.equal(res1.data.id)
            })

            it('it should create new subscription when reaction_url differs', async () => {
                const data1 = {
                    reaction_url: 'http://fake.url/unique-a',
                    operation_types: [0]
                }
                const data2 = {
                    reaction_url: 'http://fake.url/unique-b',
                    operation_types: [0]
                }

                const res1 = await axiosInstance.post('/api/subscription', data1, {
                    headers: {
                        authorization: config.adminAuthenticationToken
                    }
                })
                const res2 = await axiosInstance.post('/api/subscription', data2, {
                    headers: {
                        authorization: config.adminAuthenticationToken
                    }
                })
                expect(res1.data.id).to.not.equal(res2.data.id)
            })
        })

        describe('/POST bulk subscriptions', () => {
            it('it should POST an array of 3 subscriptions', async () => {
                const data = [
                    {reaction_url: 'http://fake.url/bulk1', operation_types: [0]},
                    {reaction_url: 'http://fake.url/bulk2', operation_types: [1]},
                    {reaction_url: 'http://fake.url/bulk3', operation_types: [2]}
                ]
                const res = await axiosInstance.post('/api/subscription', data, {
                    headers: {authorization: config.adminAuthenticationToken}
                })
                expect(res.status).to.equal(200)
                expect(res.data).to.be.an('array')
                expect(res.data.length).to.equal(3)
                const ids = res.data.map(s => s.id)
                expect(new Set(ids).size).to.equal(3)
            })

            it('it should deduplicate within batch', async () => {
                const sub = {reaction_url: 'http://fake.url/bulk-dedup', operation_types: [0]}
                const data = [sub, sub]
                const res = await axiosInstance.post('/api/subscription', data, {
                    headers: {authorization: config.adminAuthenticationToken}
                })
                expect(res.status).to.equal(200)
                expect(res.data).to.be.an('array')
                expect(res.data.length).to.equal(2)
                expect(res.data[0].id).to.equal(res.data[1].id)
            })

            it('it should return existing subscriptions for duplicates against existing', async () => {
                const sub = {reaction_url: 'http://fake.url/bulk-exist', operation_types: [0]}
                // create one first
                const res1 = await axiosInstance.post('/api/subscription', sub, {
                    headers: {authorization: config.adminAuthenticationToken}
                })
                const existingId = res1.data.id

                // batch with existing + new
                const data = [
                    sub,
                    {reaction_url: 'http://fake.url/bulk-exist-new', operation_types: [1]}
                ]
                const res2 = await axiosInstance.post('/api/subscription', data, {
                    headers: {authorization: config.adminAuthenticationToken}
                })
                expect(res2.status).to.equal(200)
                expect(res2.data.length).to.equal(2)
                expect(res2.data[0].id).to.equal(existingId)
                expect(res2.data[1].id).to.not.equal(existingId)
            })

            it('it should reject empty array with 400', async () => {
                try {
                    await axiosInstance.post('/api/subscription', [], {
                        headers: {authorization: config.adminAuthenticationToken}
                    })
                } catch (err) {
                    expect(err.response.status).to.equal(400)
                }
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
                expect(res.data.length).to.be.eql(13)
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
                expect(res.data.length).to.be.eql(2)
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

        describe('/POST subscription filter_version', () => {
            const post = async (data) => axiosInstance.post('/api/subscription', {
                reaction_url: 'http://fake.url/reaction', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', ...data
            }, {headers: {authorization: config.adminAuthenticationToken}})

            it('new subscriptions get the current filter version by default', async () => {
                const res = await post({})
                expect(res.status).to.equal(200)
                expect(res.data.filter_version).to.equal(2)
            })

            it('filter_version 1 keeps the original rules', async () => {
                const res = await post({filter_version: 1, reaction_url: 'http://fake.url/reaction-v1'})
                expect(res.status).to.equal(200)
                expect(res.data.filter_version).to.equal(1)
            })

            it('rejects unknown filter versions', async () => {
                for (const value of [3, 0, -1, 'abc', '1.5']) {
                    try {
                        await post({filter_version: value, reaction_url: 'http://fake.url/reaction-bad'})
                        throw new Error('should have failed for ' + value)
                    } catch (err) {
                        expect(err.response.status, String(value)).to.equal(400)
                        expect(JSON.stringify(err.response.data)).to.match(/filter_version/i)
                    }
                }
                // null means "not provided"
                const res = await post({filter_version: null, reaction_url: 'http://fake.url/reaction-null'})
                expect(res.data.filter_version).to.equal(2)
            })

            it('deduplicates a request that carries a pubkey in the body', async () => {
                const filters = {account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', reaction_url: 'http://fake.url/reaction-pubkey'}
                const first = await post({...filters, pubkey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'})
                const second = await post({...filters, pubkey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'})
                expect(second.data.id).to.equal(first.data.id)
            })

            it('subscriptions with different filter versions are not duplicates', async () => {
                const filters = {account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', reaction_url: 'http://fake.url/reaction-dedup'}
                const v1 = await post({...filters, filter_version: 1})
                const v2 = await post(filters) // defaults to 2
                expect(v1.status).to.equal(200)
                expect(v2.status).to.equal(200)
                expect(v2.data.id).to.not.equal(v1.data.id)
                expect(v2.data.filter_version).to.equal(2)
                const again = await post({...filters, filter_version: 1})
                expect(again.data.id).to.equal(v1.data.id) // still idempotent within the same version
            })
        })

        describe('/GET operation-types', () => {
            it('it should list all XDR operation types', async () => {
                const res = await axiosInstance.get('/api/operation-types')
                expect(res.status).to.equal(200)
                expect(res.data).to.be.an('array').with.length(27)
                expect(res.data[0]).to.deep.equal({type: 0, name: 'createAccount', horizon_name: 'create_account'})
                expect(res.data.map(o => o.type)).to.deep.equal([...Array(27).keys()])
                expect(res.data[24]).to.deep.equal({type: 24, name: 'invokeHostFunction', horizon_name: 'invoke_host_function'})
            })
        })

        describe('/GET status/pool-check', () => {
            const stellarConnector = require('../logic/stellar-connector')
            afterEach(() => sinon.restore())

            it('requires authentication', async () => {
                try {
                    await axiosInstance.get('/api/status/pool-check')
                    throw new Error('should have failed')
                } catch (err) {
                    expect(err.response.status).to.equal(401)
                }
            })

            it('is forbidden for non-admin users', async () => {
                const payload = encodeUrlParams({ nonce: Date.now() })
                const signature = signData(newUserKeyPair, payload)
                try {
                    await axiosInstance.get('/api/status/pool-check?' + payload, {
                        headers: { authorization: `${newUserKeyPair.publicKey()}.${signature}` }
                    })
                    throw new Error('should have failed')
                } catch (err) {
                    expect(err.response.status).to.equal(403)
                }
            })

            it('checks every pool server for admins', async () => {
                sinon.stub(stellarConnector, 'checkHorizonServers').resolves([
                    {url: 'https://hz1', active: true, state: 'ok', latestLedger: 100, responseMs: 20, lag: 0, error: null},
                    {url: 'https://hz2', active: false, state: 'down', latestLedger: 98, responseMs: 30, lag: 2, error: null}
                ])
                const res = await axiosInstance.get('/api/status/pool-check', {
                    headers: { authorization: config.adminAuthenticationToken }
                })
                expect(res.status).to.equal(200)
                expect(res.data.checkedAt).to.be.a('string')
                expect(res.data.horizon).to.have.length(2)
                expect(res.data.horizon[1]).to.include({url: 'https://hz2', state: 'down', lag: 2})
                expect(res.data.sorobanRpc).to.equal(null) // not configured in the test config
            })
        })

        describe('/GET status', () => {
            it('exposes skipped transactions counters', async () => {
                const res = await axiosInstance.get('/api/status')
                expect(res.status).to.equal(200)
                expect(res.data.stream.skippedTransactions).to.equal(0)
                expect(res.data.stream.lastSkippedTransaction).to.equal(null)
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

        it('it should deduplicate subscriptions created with a user token', async () => {
            const data = {reaction_url: 'http://fake.url/dedup-token', operation_types: [1]}
            const first = await axiosInstance.post('/api/subscription', data, {headers: {authorization: tokenA}})
            const second = await axiosInstance.post('/api/subscription', data, {headers: {authorization: tokenA}})
            expect(first.status).to.equal(200)
            expect(second.data.id).to.equal(first.data.id)
            const other = await axiosInstance.post('/api/subscription', data, {headers: {authorization: tokenB}})
            expect(other.data.id).to.not.equal(first.data.id) // another owner → their own subscription
            // batch: a subscription the user already has is returned as `existing`, not duplicated
            const batch = [data, {reaction_url: 'http://fake.url/dedup-token-2', operation_types: [1]}]
            const batchRes = await axiosInstance.post('/api/subscription', batch, {headers: {authorization: tokenA}})
            expect(batchRes.status).to.equal(200)
            expect(batchRes.data[0].id).to.equal(first.data.id) // the existing one is returned as is
            expect(batchRes.data[1].id).to.not.equal(first.data.id) // the new one is created
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
            expect(res.data.length).to.equal(3)
            expect(res.data.some(s => s.id === tokenASub.id)).to.equal(true)
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

    describe('Health', () => {
        let originalHealthConfig

        beforeEach(function () {
            originalHealthConfig = {
                healthMaxNoSuccessSeconds: config.healthMaxNoSuccessSeconds,
                healthMaxNoLedgerSeconds: config.healthMaxNoLedgerSeconds,
                healthMaxNoProgressSeconds: config.healthMaxNoProgressSeconds,
                healthStartupGraceSeconds: config.healthStartupGraceSeconds
            }
        })

        afterEach(function () {
            Object.assign(config, originalHealthConfig)
            sinon.restore()
        })

        it('it should return 200 from /health when watcher is healthy', async () => {
            sinon.stub(observer.transactionWatcher, 'getHealth').returns({
                healthy: true,
                reason: 'ok',
                state: 'streaming'
            })

            const res = await axiosInstance.get('/health')

            expect(res.status).to.equal(200)
            expect(res.data.status).to.equal('ok')
        })

        it('it should return 503 from /health when watcher is stalled', async () => {
            sinon.stub(observer.transactionWatcher, 'getHealth').returns({
                healthy: false,
                reason: 'watcher_stalled',
                state: 'recovering'
            })

            try {
                await axiosInstance.get('/health')
                expect.fail('Expected /health to return 503')
            } catch (err) {
                expect(err.response.status).to.equal(503)
                expect(err.response.data.reason).to.equal('watcher_stalled')
            }
        })
    })
})
