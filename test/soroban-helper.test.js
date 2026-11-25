const expect = require('chai').expect
const {xdr, StrKey} = require('@stellar/stellar-sdk')
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

    it('decodes Protocol 30 events with a muxed contract (W…) address in topics', function () {
        // TransactionMetaV3 built with stellar-sdk 17: contract event topics [transfer, G…, W…], data {amount, to_muxed_id}
        const fixture = require('./fixtures/protocol30-muxed-contract.json')
        const {events, return_value} = decodeMeta(fixture.metaXdr, 0)
        expect(return_value).to.equal(true)
        expect(events).to.be.an('array').with.length(1)
        const [ev] = events
        expect(ev.type).to.equal('contract')
        expect(ev.contract).to.equal(fixture.cAddress)
        expect(ev.topics).to.deep.equal(['transfer', fixture.gAddress, fixture.wAddress])
        expect(ev.data).to.deep.equal({amount: '5000000', to_muxed_id: '123456789'})
    })

    it('decodes TransactionMetaV3 with a system event that has no contract id', function () {
        const ext = xdr.ExtensionPoint.v0()
        const transferEvent = new xdr.ContractEvent({
            ext,
            contractId: new xdr.ContractId(Buffer.alloc(32, 7)),
            type: xdr.ContractEventType.fromName('contract'),
            body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
                topics: [xdr.ScVal.scvSymbol('transfer'), xdr.ScVal.scvU64(10n)],
                data: xdr.ScVal.scvMap([])
            }))
        })
        const systemEvent = new xdr.ContractEvent({
            ext,
            contractId: null,
            type: xdr.ContractEventType.fromName('system'),
            body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
                topics: [xdr.ScVal.scvSymbol('fee')],
                data: xdr.ScVal.scvI128(new xdr.Int128Parts({hi: 0n, lo: 12340n}))
            }))
        })
        const meta = xdr.TransactionMeta.v3(new xdr.TransactionMetaV3({
            ext,
            txChangesBefore: [],
            operations: [new xdr.OperationMeta({changes: []})],
            txChangesAfter: [],
            sorobanMeta: new xdr.SorobanTransactionMeta({
                ext: xdr.SorobanTransactionMetaExt.v0(),
                consumedContractDataSize: 0n,
                consumedContractDataEntries: 0n,
                consumedEventSize: 10n,
                consumedEventsCount: 2n,
                returnValue: xdr.ScVal.scvBool(true),
                events: [transferEvent, systemEvent],
                diagnosticEvents: [],
                rentCharged: 0n
            })
        }))
        const {events, return_value} = decodeMeta(meta.toXdr('base64'), 0)
        expect(return_value).to.equal(true)
        expect(events).to.have.length(2)
        expect(events[0]).to.deep.equal({
            type: 'contract',
            contract: StrKey.encodeContract(Buffer.alloc(32, 7)),
            topics: ['transfer', '10'],
            data: {}
        })
        expect(events[1]).to.deep.equal({
            type: 'system',
            contract: null,
            topics: ['fee'],
            data: '12340'
        })
        // v3 has no per-operation events: a different op index yields the same list
        expect(decodeMeta(meta.toXdr('base64'), 5).events).to.have.length(2)
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
