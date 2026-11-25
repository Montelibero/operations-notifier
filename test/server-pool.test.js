const http = require('http')
const sinon = require('sinon')
const {ServerPool, PoolError, fetchWithTimeout} = require('../logic/server-pool')
const {horizonTransport} = require('../logic/stellar-connector')
const {rpcTransport} = require('../logic/soroban-rpc-transport')

/**
 * Minimal Horizon-like mock: behaviour per server is a function of (req, attempt number).
 */
class MockServer {
    constructor(handler) {
        this.handler = handler
        this.requests = []
        this.server = http.createServer((req, res) => {
            this.requests.push(req.url)
            const respond = (status, body, headers = {}) => {
                res.writeHead(status, {'Content-Type': 'application/json', ...headers})
                res.end(typeof body === 'string' ? body : JSON.stringify(body))
            }
            Promise.resolve(this.handler(req, respond, this.requests.length)).catch(() => respond(500, {error: 'mock'}))
        })
    }

    listen() {
        return new Promise(resolve => this.server.listen(0, '127.0.0.1', () => {
            this.url = `http://127.0.0.1:${this.server.address().port}`
            resolve(this.url)
        }))
    }

    close() {
        return new Promise(resolve => this.server.close(() => resolve()))
    }

    get count() {
        return this.requests.length
    }
}

const okPage = (records = [{sequence: 1}]) => ({_embedded: {records}, _links: {}})

module.exports = {MockServer}

describe('ServerPool', function () {
    let mocks

    beforeEach(function () {
        mocks = []
    })

    afterEach(async function () {
        sinon.restore()
        for (const m of mocks) await m.close()
    })

    async function mock(handler) {
        const m = new MockServer(handler)
        mocks.push(m)
        await m.listen()
        return m
    }

    function pool(urls, overrides = {}) {
        const events = []
        const p = new ServerPool({
            urls,
            name: 'test',
            transport: horizonTransport,
            failover: {retries: 2, retryDelayMs: 5, cooldownMs: 300, probeIntervalMs: 30, probeSuccessesToRecover: 2, ...overrides.failover},
            logger: {info() {}, warn() {}},
            now: overrides.now
        })
        p.on('switch', e => events.push(e))
        return {p, events}
    }

    it('fails over to the next server after retrying a 5xx on the same server', async function () {
        const a = await mock((req, respond) => respond(503, {error: 'unavailable'}))
        const b = await mock((req, respond) => respond(200, okPage([{sequence: 7}])))
        const {p, events} = pool([a.url, b.url])
        const result = await p.call({path: '/ledgers?order=desc&limit=1'})
        expect(result.records[0].sequence).to.equal(7)
        expect(a.count).to.equal(3) // 1 + 2 retries
        expect(b.count).to.equal(1)
        expect(p.activeUrl).to.equal(b.url)
        expect(p.servers[0].state).to.equal('down')
        expect(events).to.deep.equal([{from: a.url, to: b.url, reason: 'down'}])
        p.close()
    })

    it('fails over on 429 immediately and skips the server until the rate limit resets', async function () {
        const a = await mock((req, respond) => respond(429, {error: 'slow down'}, {'Retry-After': '60'}))
        const b = await mock((req, respond) => respond(200, okPage()))
        const {p, events} = pool([a.url, b.url])
        await p.call({path: '/transactions'})
        expect(a.count).to.equal(1) // no same-server retries for 429
        expect(p.servers[0].state).to.equal('rate_limited')
        expect(p.servers[0].rateLimitedUntil - Date.now()).to.be.above(50_000)
        expect(events[0].reason).to.equal('rate_limited')
        // still skipped on the next request
        await p.call({path: '/transactions'})
        expect(a.count).to.equal(1)
        expect(b.count).to.equal(2)
        p.close()
    })

    it('treats 404 as a lagging server: tries the next server for the same request without marking it down', async function () {
        const a = await mock((req, respond) => respond(404, {status: 404, title: 'Not Found'}))
        const b = await mock((req, respond) => respond(200, okPage([{sequence: 5}])))
        const {p, events} = pool([a.url, b.url])
        const result = await p.call({path: '/transactions?ledger=5', ledger: 5})
        expect(result.records[0].sequence).to.equal(5)
        expect(p.servers[0].state).to.equal('ok')
        expect(p.servers[0].lag).to.include({count: 1, lastLedger: 5})
        expect(events).to.deep.equal([]) // no switch, the preferred server stays active
        p.close()
    })

    it('throws a lagging error when every server lacks the resource', async function () {
        const a = await mock((req, respond) => respond(404, {}))
        const b = await mock((req, respond) => respond(404, {}))
        const {p} = pool([a.url, b.url])
        let error
        try { await p.call({path: '/transactions?ledger=9', ledger: 9}) } catch (e) { error = e }
        expect(error).to.be.instanceOf(PoolError)
        expect(error.type).to.equal('lagging')
        expect(error.status).to.equal(404)
        expect(a.count).to.equal(1)
        expect(b.count).to.equal(1)
        p.close()
    })

    it('fails over on network errors and timeouts', async function () {
        this.timeout(5000)
        const dead = 'http://127.0.0.1:1' // connection refused
        const hanging = await mock(() => {}) // never responds
        const good = await mock((req, respond) => respond(200, okPage()))
        const {p} = pool([dead, hanging.url, good.url], {failover: {cooldownMs: 10000}})
        sinon.stub(require('../models/config'), 'failoverRequestTimeoutMs').value(300)
        const result = await p.call({path: '/transactions'})
        expect(result.records).to.be.an('array')
        expect(p.activeUrl).to.equal(good.url)
        expect(p.servers[0].state).to.equal('down')
        expect(p.servers[1].state).to.equal('down')
        p.close()
    })

    it('does not fail over on 4xx errors caused by the request itself', async function () {
        const a = await mock((req, respond) => respond(400, {status: 400, title: 'Bad Request'}))
        const b = await mock((req, respond) => respond(200, okPage()))
        const {p, events} = pool([a.url, b.url])
        let error
        try { await p.call({path: '/transactions?cursor=abc'}) } catch (e) { error = e }
        expect(error).to.be.instanceOf(PoolError)
        expect(error.type).to.equal('fatal')
        expect(error.status).to.equal(400)
        expect(a.count).to.equal(1)
        expect(b.count).to.equal(0)
        expect(events).to.deep.equal([])
        p.close()
    })

    it('throws when all servers are down and recovers the preferred server through probes', async function () {
        this.timeout(5000)
        let aHealthy = false
        const a = await mock((req, respond) => aHealthy ? respond(200, okPage()) : respond(503, {}))
        const b = await mock((req, respond) => respond(503, {}))
        const {p, events} = pool([a.url, b.url])
        let error
        try { await p.call({path: '/transactions'}) } catch (e) { error = e }
        expect(error).to.be.instanceOf(PoolError)
        expect(error.type).to.equal('retry')
        expect(p.active).to.equal(null)
        expect(a.count).to.equal(3)
        expect(b.count).to.equal(3)

        // the probe brings the preferred server back once it starts answering
        aHealthy = true
        const deadline = Date.now() + 3000
        while (p.activeUrl !== a.url && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
        expect(p.activeUrl).to.equal(a.url)
        expect(p.servers.map(s => s.state)).to.deep.equal(['ok', 'down']) // b still answers 503
        const reasons = events.map(e => `${e.from}->${e.to}:${e.reason}`)
        expect(reasons).to.deep.equal([`${a.url}->${b.url}:down`, `${b.url}->null:down`, `null->${a.url}:recovered`])
        p.close()
    })

    it('marks a rate-limited server down when its probe fails with a server error', async function () {
        const a = await mock((req, respond) => respond(req.url === '/' ? 503 : 200, req.url === '/' ? {} : okPage()))
        const b = await mock((req, respond) => respond(200, okPage()))
        const {p} = pool([a.url, b.url], {failover: {cooldownMs: 5000, probeIntervalMs: 30}})
        p.markRateLimited(p.servers[0], Date.now() + 100, 429)
        expect(p.servers[0].state).to.equal('rate_limited')
        const deadline = Date.now() + 3000
        while (p.servers[0].state !== 'down' && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
        expect(p.servers[0].state).to.equal('down')
        expect(p.servers[0].lastError).to.match(/503/)
        expect(p.activeUrl).to.equal(b.url)
        p.close()
    })

    it('brings a down server back after the cooldown elapsed even without a probe (safety net)', async function () {
        let t = 1000000
        const a = await mock((req, respond) => respond(200, okPage()))
        const pl = new ServerPool({urls: [a.url], name: 'test', transport: horizonTransport, failover: {cooldownMs: 1000, probeIntervalMs: 60000}, now: () => t, logger: {info() {}, warn() {}}})
        pl.markDown(pl.servers[0], 'boom')
        expect(pl.active).to.equal(null)
        expect(pl.activeUrl).to.equal(null)
        expect(pl.fallbackUrl).to.equal(a.url)
        t += 999
        expect(pl.active).to.equal(null)
        t += 2
        expect(pl.activeUrl).to.equal(a.url)
        pl.close()
    })

    it('marks the streaming server as behind and switches away from it', async function () {
        const a = await mock((req, respond) => respond(200, okPage()))
        const b = await mock((req, respond) => respond(200, okPage()))
        const {p, events} = pool([a.url, b.url])
        p.markBehind(p.servers[0], 100, 110)
        expect(p.activeUrl).to.equal(b.url)
        expect(p.servers[0].lastError).to.equal('behind by 10 ledgers (100 vs 110)')
        expect(events).to.deep.equal([{from: a.url, to: b.url, reason: 'lagging'}])
        p.close()
    })

    it('reports a stream failure on a specific server', async function () {
        const a = await mock((req, respond) => respond(200, okPage()))
        const b = await mock((req, respond) => respond(200, okPage()))
        const {p} = pool([a.url, b.url])
        p.reportStreamFailure(a.url, {type: 'rate_limited', message: 'Non-200 status code (429)'})
        expect(p.servers[0].state).to.equal('rate_limited')
        expect(p.activeUrl).to.equal(b.url)
        p.reportStreamFailure('http://unknown', {type: 'retry', message: 'x'}) // ignored
        p.close()
    })

    it('fetchWithTimeout rejects with a retry PoolError on timeout', async function () {
        const hanging = await mock(() => {})
        let error
        try { await fetchWithTimeout(hanging.url, {timeoutMs: 100}) } catch (e) { error = e }
        expect(error).to.be.instanceOf(PoolError)
        expect(error.type).to.equal('retry')
        expect(error.message).to.match(/timeout/)
    })

    it('falls back to the cooldown when the rate limit reset time is already in the past (clock skew)', async function () {
        const a = await mock((req, respond) => respond(200, okPage()))
        const b = await mock((req, respond) => respond(200, okPage()))
        const {p} = pool([a.url, b.url], {failover: {cooldownMs: 5000}})
        p.markRateLimited(p.servers[0], Date.now() - 1000, 429)
        expect(p.servers[0].state).to.equal('rate_limited')
        expect(p.servers[0].rateLimitedUntil - Date.now()).to.be.above(4000)
        expect(p.activeUrl).to.equal(b.url)
        p.close()
    })

    it('tries every other server on 404 before giving up', async function () {
        const a = await mock((req, respond) => respond(404, {}))
        const b = await mock((req, respond) => respond(404, {}))
        const c = await mock((req, respond) => respond(200, okPage([{sequence: 3}])))
        const {p} = pool([a.url, b.url, c.url])
        const result = await p.call({path: '/transactions?ledger=3', ledger: 3})
        expect(result.records[0].sequence).to.equal(3)
        expect(a.count).to.equal(1)
        expect(b.count).to.equal(1)
        expect(c.count).to.equal(1)
        p.close()
    })

    it('keeps a server out of rotation while the probe keeps failing, but not when the probe endpoint is missing', async function () {
        this.timeout(5000)
        let health = 503
        const a = await mock((req, respond) => respond(req.url === '/' ? health : 200, req.url === '/' ? {} : okPage()))
        const b = await mock((req, respond) => respond(200, okPage()))
        const {p} = pool([a.url, b.url], {failover: {cooldownMs: 200, probeIntervalMs: 50, probeSuccessesToRecover: 2}})
        p.markDown(p.servers[0], 'boom')
        const firstDownUntil = p.servers[0].downUntil
        // two probe rounds fail with 503 → the cooldown is extended, the server stays unavailable
        await new Promise(r => setTimeout(r, 150))
        expect(p.servers[0].state).to.equal('down')
        expect(p.servers[0].downUntil).to.be.above(firstDownUntil)
        expect(p.servers[0].lastError).to.match(/503/)
        // the probe endpoint is missing on this server (404 on /): the safety-net cooldown still applies
        health = 404
        const before = p.servers[0].downUntil
        await new Promise(r => setTimeout(r, 150))
        expect(p.servers[0].downUntil).to.equal(before) // not extended by non-retry probe failures
        // once the server answers, two successful probes bring it back
        health = 200
        const deadline = Date.now() + 3000
        while (p.servers[0].state !== 'ok' && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
        expect(p.activeUrl).to.equal(a.url)
        p.close()
    })

    it('checkServers probes every server in parallel and recovers the ones that answer', async function () {
        let health = 503
        const a = await mock((req, respond) => respond(health, req.url === '/' ? {} : okPage([{sequence: 10}])))
        const b = await mock((req, respond) => respond(200, okPage([{sequence: 12}])))
        const {p} = pool([a.url, b.url])
        await p.call({path: '/transactions'})
        expect(p.servers[0].state).to.equal('down')
        health = 200
        const rows = await p.checkServers(async url => {
            const page = await horizonTransport(url, {path: '/ledgers?order=desc&limit=1'})
            return page.records[0].sequence
        })
        expect(rows.map(r => [r.url, r.active, r.state, r.latestLedger, r.lag, r.error])).to.deep.equal([[a.url, true, 'ok', 10, 2, null], [b.url, false, 'ok', 12, 0, null]])
        expect(p.servers[0].state).to.equal('ok') // answered → recovered
        expect(p.activeUrl).to.equal(a.url) // preferred server is active again
        p.close()
    })

    it('status lists servers with counters', async function () {
        const a = await mock((req, respond) => respond(503, {}))
        const b = await mock((req, respond) => respond(200, okPage()))
        const {p} = pool([a.url, b.url])
        await p.call({path: '/transactions'})
        const status = p.getStatus()
        expect(status.active).to.equal(b.url)
        expect(status.servers).to.have.length(2)
        expect(status.servers[0]).to.include({url: a.url, active: false, state: 'down', requests: 3, failures: 1})
        expect(status.servers[1]).to.include({url: b.url, active: true, state: 'ok', requests: 1})
        expect(status.lastSwitchAt).to.be.a('string')
        p.close()
    })
})

describe('Soroban RPC transport', function () {
    let m
    beforeEach(async function () {
        m = new MockServer((req, respond, n) => {
            let body = ''
            req.on('data', chunk => body += chunk)
            req.on('end', () => {
                const {id, method} = JSON.parse(body)
                if (method === 'getLatestLedger') return respond(200, {jsonrpc: '2.0', id, result: {sequence: 42}})
                if (m.failWith) return respond(m.failWith.status, m.failWith.body, m.failWith.headers)
                respond(200, {jsonrpc: '2.0', id, result: {resultMetaXdr: 'meta'}})
            })
        })
        await m.listen()
    })
    afterEach(async function () {
        m.failWith = null
        await m.close()
    })

    it('classifies failures without failing over on request errors', async function () {
        this.timeout(5000)
        const transport = rpcTransport
        const result = await transport(m.url, {method: 'getTransaction', params: {hash: 'abc'}})
        expect(result).to.deep.equal({resultMetaXdr: 'meta'})
        const probe = await transport(m.url, {probe: true})
        expect(probe.result.sequence).to.equal(42)

        m.failWith = {status: 404, body: {error: 'nope'}}
        let error
        try { await transport(m.url, {method: 'getTransaction', params: {}}) } catch (e) { error = e }
        expect(error.type).to.equal('fatal') // 404 on RPC is a wrong endpoint, not a lagging server

        m.failWith = {status: 503, body: {}}
        try { await transport(m.url, {method: 'getTransaction', params: {}}) } catch (e) { error = e }
        expect(error.type).to.equal('retry')

        m.failWith = {status: 429, body: {}, headers: {'Retry-After': '30'}}
        try { await transport(m.url, {method: 'getTransaction', params: {}}) } catch (e) { error = e }
        expect(error.type).to.equal('rate_limited')
        expect(error.resetAt).to.be.closeTo(Date.now() + 30000, 2000) // Retry-After is honoured

        m.failWith = {status: 200, body: {jsonrpc: '2.0', id: 1, error: {code: -32602, message: 'transaction not found'}}}
        try { await transport(m.url, {method: 'getTransaction', params: {}}) } catch (e) { error = e }
        expect(error.type).to.equal('fatal')
        expect(error.message).to.match(/transaction not found/)
    })

    it('fails over between RPC servers and degrades to null when all of them are down', async function () {
        this.timeout(5000)
        const {SorobanRpcClient} = require('../logic/soroban-rpc-client')
        
        const broken = new MockServer((req, respond) => respond(503, {}))
        await broken.listen()
        const pool = new ServerPool({urls: [broken.url, m.url], name: 'rpc-test', transport: rpcTransport, failover: {retries: 1, retryDelayMs: 5, cooldownMs: 10000, probeIntervalMs: 60000}, logger: {info() {}, warn() {}}})
        const client = new SorobanRpcClient(pool)
        expect(await client.getTransaction('abc')).to.deep.equal({resultMetaXdr: 'meta'})
        expect(broken.count).to.equal(2)
        expect(pool.activeUrl).to.equal(m.url)

        const allDown = new ServerPool({urls: ['http://127.0.0.1:1'], name: 'rpc-test', transport: rpcTransport, failover: {retries: 0, cooldownMs: 10000, probeIntervalMs: 60000}, logger: {info() {}, warn() {}}})
        expect(await new SorobanRpcClient(allDown).getTransaction('abc')).to.equal(null)
        pool.close()
        allDown.close()
        await broken.close()
    })
})
