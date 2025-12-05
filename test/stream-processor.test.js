const expect = require('chai').expect;
const sinon = require('sinon');
const { TransactionBuilder } = require('@stellar/stellar-sdk');
const { parseTransaction } = require('../logic/stream-processor');

describe('stream-processor', function () {
    afterEach(() => {
        sinon.restore();
    });

    function mockTransaction(operations) {
        return {
            hash: 'cad61356f932b504959ed3f81152a51187d9b9365c19069d25514b1f486d3e8e',
            paging_token: '315886634123265',
            successful: true,
            source_account: 'GA7QYNF7SOWQ3GLR2BGMZEP2QWK7NG4V4QYP5S2PL6ADTLK2GGFE9XPQ',
            source_account_sequence: '23730319388819499',
            created_at: '2020-08-06T14:42:32Z',
            envelope_xdr: 'dummy_xdr',
            operations: operations,
            memo: { _type: 'none' }
        };
    }

    function createTxMock(operation) {
        const tx = mockTransaction([operation]);
        sinon.stub(TransactionBuilder, 'fromXDR').returns(tx);
        return tx;
    }

    it('should parse FeeBumpTransaction', function () {
        const feeBumpTx = {
            "hash": "cad61356f932b504959ed3f81152a51187d9b9365c19069d25514b1f486d3e8e",
            "paging_token": "315886634123265",
            "successful": true,
            "source_account": "GA7QYNF7SOWQ3GLR2BGMZEP2QWK7NG4V4QYP5S2PL6ADTLK2GGFE9XPQ",
            "source_account_sequence": "23730319388819499",
            "created_at": "2020-08-06T14:42:32Z",
            "envelope_xdr": "AAAABQAAAACCJlW7ueRmDLBz243XUjsyaloHY2Xb+Ecg8qAt7Cz8nAAAAAAAAADIAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO5rKAAAAAAAAAAAAAAAAAAAAAAA=",
            "result_xdr": "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAACAAAAAAAAAAAAAABveIjTbtog0LzKbdNoKsfNoBEoEOeY9h29H6qpH6CASAAAAA8aXJgAAAkgAAAEAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAA==",
            "result_meta_xdr": "AAAAAQAAAAAAAAACAAAAAwAAAAAAAAAAYvwdC9CX8OPOdDy...",
            "fee_meta_xdr": "AAAAAgAAAAMAAAAAYvwdC9CX8OPOdDy...",
            "memo_type": "none",
            "signatures": [
                "h8k/31S4MlfvO9L1F2D6tA4ypBf2kLwN0E/5sL3E0aW1A/3QnCxTo3Y5h/yJ4csy5BBMxYSVn+H2Dg=="
            ],
            "valid_after": "1970-01-01T00:00:00Z",
            "valid_before": "2020-08-06T15:12:31Z",
            "fee_account": "GA7QYNF7SOWQ3GLR2BGMZEP2QWK7NG4V4QYP5S2PL6ADTLK2GGFE9XPQ",
            "fee_charged": 500,
            "max_fee": 200000000
        }
        const parsed = parseTransaction(feeBumpTx)
        expect(parsed).to.not.be.null
        expect(parsed.operations.length).to.equal(1)
        const op = parsed.operations[0]
        expect(op.type).to.equal('payment')
    })

    it('should parse createClaimableBalance', function () {
        const operation = { type: 'createClaimableBalance', asset: { code: 'USD', issuer: 'GDUN55P4M332X24DYIUI64HLM3224525Y4DO6T43Y443P2P5C5Z5Y5N5' }, amount: '1000', claimants: [{ destination: 'GA7QYNF7SOWQ3GLR2BGMZEP2QWK7NG4V4QYP5S2PL6ADTLK2GGFE9XPQ', predicate: {} }] };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('create_claimable_balance');
    });

    it('should parse claimClaimableBalance', function () {
        const operation = { type: 'claimClaimableBalance', balanceId: '0000000052667421c75a7a514b8a2e3b2b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b' };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('claim_claimable_balance');
    });

    it('should parse beginSponsoringFutureReserves', function () {
        const operation = { type: 'beginSponsoringFutureReserves', sponsoredId: 'GA7QYNF7SOWQ3GLR2BGMZEP2QWK7NG4V4QYP5S2PL6ADTLK2GGFE9XPQ' };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('begin_sponsoring_future_reserves');
    });

    it('should parse endSponsoringFutureReserves', function () {
        const operation = { type: 'endSponsoringFutureReserves' };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('end_sponsoring_future_reserves');
    });

    it('should parse revokeSponsorship', function () {
        const operation = { type: 'revokeSponsorship', ledgerKey: '0000000052667421c75a7a514b8a2e3b2b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b' };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('revoke_sponsorship');
    });

    it('should parse clawback', function () {
        const operation = { type: 'clawback', from: 'GA7QYNF7SOWQ3GLR2BGMZEP2QWK7NG4V4QYP5S2PL6ADTLK2GGFE9XPQ', asset: { code: 'USD', issuer: 'GDUN55P4M332X24DYIUI64HLM3224525Y4DO6T43Y443P2P5C5Z5Y5N5' }, amount: '1000' };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('clawback');
    });

    it('should parse clawbackClaimableBalance', function () {
        const operation = { type: 'clawbackClaimableBalance', balanceId: '0000000052667421c75a7a514b8a2e3b2b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b' };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('clawback_claimable_balance');
    });

    it('should parse setTrustLineFlags', function () {
        const operation = { type: 'setTrustLineFlags', trustor: 'GA7QYNF7SOWQ3GLR2BGMZEP2QWK7NG4V4QYP5S2PL6ADTLK2GGFE9XPQ', asset: { code: 'USD', issuer: 'GDUN55P4M332X24DYIUI64HLM3224525Y4DO6T43Y443P2P5C5Z5Y5N5' }, setFlags: 1, clearFlags: 2 };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('set_trustline_flags');
    });

    it('should parse liquidityPoolDeposit', function () {
        const operation = { type: 'liquidityPoolDeposit', liquidityPoolId: 'dd7b1ab831c273310ddb296220aa40b3807525a25c82253fe59550b0a36a430a', maxAmountA: '1000', maxAmountB: '2000', minPrice: { n: 1, d: 2 }, maxPrice: { n: 2, d: 1 } };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('liquidity_pool_deposit');
    });

    it('should parse liquidityPoolWithdraw', function () {
        const operation = { type: 'liquidityPoolWithdraw', liquidityPoolId: 'dd7b1ab831c273310ddb296220aa40b3807525a25c82253fe59550b0a36a430a', amount: '1000', minAmountA: '500', minAmountB: '1000' };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('liquidity_pool_withdraw');
    });

    it('should parse invokeHostFunction', function () {
        const operation = { type: 'invokeHostFunction', function: 'HostFunctionTypeHostFunctionTypeInvokeContract', parameters: [], footprint: { readOnly: [], readWrite: [] }, authority: [] };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('invoke_host_function');
    });

    it('should parse extendFootprintTTL', function () {
        const operation = { type: 'extendFootprintTTL', extendTo: 123456 };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('extend_footprint_ttl');
    });

    it('should parse restoreFootprint', function () {
        const operation = { type: 'restoreFootprint' };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('restore_footprint');
    });
});