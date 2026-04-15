const expect = require('chai').expect
const {decodeMeta, stringifyBigInts} = require('../util/soroban-helper')
const fixture = require('./fixtures/soroban-tx-dbf9a5c2.json')

describe('soroban-helper.stringifyBigInts', function () {
    it('converts bigints to strings', function () {
        expect(stringifyBigInts(10n)).to.equal('10')
    })
    it('walks arrays and objects', function () {
        const input = {a: 1n, b: [2n, {c: 3n}]}
        expect(stringifyBigInts(input)).to.deep.equal({a: '1', b: ['2', {c: '3'}]})
    })
    it('encodes buffers as base64', function () {
        const buf = Buffer.from([1, 2, 3])
        expect(stringifyBigInts(buf)).to.equal(Buffer.from([1, 2, 3]).toString('base64'))
    })
    it('leaves primitives untouched', function () {
        expect(stringifyBigInts('x')).to.equal('x')
        expect(stringifyBigInts(42)).to.equal(42)
        expect(stringifyBigInts(null)).to.equal(null)
        expect(stringifyBigInts(true)).to.equal(true)
    })
})

describe('soroban-helper.decodeMeta', function () {
    it('decodes events and return_value from a real Soroban tx meta', function () {
        const {events, return_value} = decodeMeta(fixture.resultMetaXdr, 0)
        expect(return_value).to.equal(true)
        expect(events).to.be.an('array').with.length.greaterThan(0)
        const transferEvent = events.find(e =>
            Array.isArray(e.topics) && e.topics[0] === 'transfer'
        )
        expect(transferEvent, 'transfer event').to.exist
        expect(transferEvent.contract).to.match(/^C[A-Z0-9]{55}$/)
        // amount is emitted as i128 (10) — must be stringified
        expect(transferEvent.data).to.equal('10')
        // topics include the contract being invoked as the destination
        expect(transferEvent.topics).to.include('CAFXUALXFPTBTLSRCDSMJXNPSN3AVL2ZPXJUDDHVTUTLRX5SCNP2SISM')
    })

    it('returns null fields on empty input', function () {
        expect(decodeMeta(null, 0)).to.deep.equal({events: null, return_value: null})
    })

    it('returns null events on malformed base64', function () {
        const {events, return_value} = decodeMeta('not-valid-base64-xdr', 0)
        expect(events).to.equal(null)
        expect(return_value).to.equal(null)
    })
})
