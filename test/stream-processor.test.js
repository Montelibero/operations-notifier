const expect = require('chai').expect;
const sinon = require('sinon');
const { TransactionBuilder } = require('@stellar/stellar-sdk');
const { parseTransaction, parsePathPaymentTrades, parseManageOfferResult } = require('../logic/stream-processor');

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

    describe('parsePathPaymentTrades', function () {
        // Real result_xdr from a path_payment_strict_send transaction on mainnet
        // Transaction 8d861b3d0c1e8501f150ca0d2f5bd7621b81c909f3b1615a8b8e73b3801c81cb
        // Contains 4 liquidity pool trades and 2 order book trades
        const pathPaymentResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAANAAAAAAAAAAYAAAACL5Qn+uJYb74IrdtGCko+fLFr2yojKLu3m36C6/8H5TcAAAABWExNAAAAAAAIFKTA1/lfmfT8cLAEmz2xeS2Z3zh4u1mhED+hjNFuzAAABq+EG70QAAAAAAAAAAAAAM0UAAAAApPcmoq4J6AZean6PySVw3PxDj6VWyQRRbU5DW+OVdbdAAAAAU9MVAAAAAAAL67mruJq8g1bj8lCiNVHbidAzKmg3NSrNjUbTCiAbawAAAAADhIvngAAAAFYTE0AAAAAAAgUpMDX+V+Z9PxwsASbPbF5LZnfOHi7WaEQP6GM0W7MAAAGr4QbvRAAAAACgg2uOCvWZHWpZVFxcCGp5X3zwjCOH479kPp3TX9Nf3YAAAACeFJVTkVTAAAAAAAAAAAAAJcJfuPGW8U+3ZTTWqzylg/R4DC4xMybrxWCad9EBRHeAAAAAAFZa70AAAABTkxUAAAAAAAvruau4mryDVuPyUKI1UduJ0DMqaDc1Ks2NRtMKIBtrAAAAAAOEi+eAAAAAihQrEoo1cdE4p+BpW/Oix6Hk06JrJIYvE2pZ/OZ0anJAAAAAlNERVhFWAAAAAAAAAAAAABgdg42ru1O4AINKCDjmPPfYKb27YUjdun2yi4e6WmvggAAAAAODtlCAAAAAnhSVU5FUwAAAAAAAAAAAACXCX7jxlvFPt2U01qs8pYP0eAwuMTMm68VgmnfRAUR3gAAAAABWWu9AAAAAQAAAACdd7Jzw2JRgO7qhWkiKm7tcVghjplqnuZH5XQMjp1mGgAAAABjLOCDAAAAAAAAAAAAANAuAAAAAlNERVhFWAAAAAAAAAAAAABgdg42ru1O4AINKCDjmPPfYKb27YUjdun2yi4e6WmvggAAAAAODtlCAAAAAQAAAABtfzycOy3ID8X/LBcX0lb34EUi64MDCS6264IMhli7JQAAAABjKo3+AAAAAXlYTE0AAAAAIjbXcP4NPgFSGXXVz3rEhCtwldaxqddo0+mmMumZBr4AAAAAAADQLgAAAAAAAAAAAADQLgAAAAAZuKPiuNAtcn2d682XJkONZHHDPYRIu5MemLtevYBqSwAAAAF5WExNAAAAACI213D+DT4BUhl11c96xIQrcJXWsanXaNPppjLpmQa+AAAAAAAA0C4AAAAA';

        it('should return empty trades array for invalid XDR', function () {
            const result = parsePathPaymentTrades('invalid_xdr', 0, 'path_payment_strict_send');
            expect(result.trades).to.deep.equal([]);
        });

        it('should return empty trades array for non-path-payment operations', function () {
            // This is a result_xdr from a simple payment operation
            const paymentResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=';
            const result = parsePathPaymentTrades(paymentResultXdr, 0, 'path_payment_strict_send');
            expect(result.trades).to.deep.equal([]);
        });

        it('should return empty trades array when operation index is out of bounds', function () {
            const result = parsePathPaymentTrades(pathPaymentResultXdr, 99, 'path_payment_strict_send');
            expect(result.trades).to.deep.equal([]);
        });

        it('should parse trades from path_payment result', function () {
            const result = parsePathPaymentTrades(pathPaymentResultXdr, 0, 'path_payment_strict_send');
            expect(result.trades).to.be.an('array');
            expect(result.trades.length).to.equal(6);
            // First 4 are liquidity pool trades
            expect(result.trades[0].type).to.equal('liquidity_pool');
            expect(result.trades[0]).to.have.property('pool_id');
            expect(result.trades[0]).to.have.property('amount_sold');
            expect(result.trades[0]).to.have.property('amount_bought');
            // Last 2 are order book trades
            expect(result.trades[4].type).to.equal('order_book');
            expect(result.trades[4]).to.have.property('seller_id');
            expect(result.trades[4]).to.have.property('offer_id');
        });

        it('should correctly decode seller_id as Stellar public key', function () {
            const result = parsePathPaymentTrades(pathPaymentResultXdr, 0, 'path_payment_strict_send');
            // Find order book trades
            const orderBookTrades = result.trades.filter(t => t.type === 'order_book');
            expect(orderBookTrades.length).to.equal(2);
            // Seller ID should be a valid Stellar public key starting with 'G'
            expect(orderBookTrades[0].seller_id).to.match(/^G[A-Z0-9]{55}$/);
            // Verify the actual seller_id from the transaction
            expect(orderBookTrades[0].seller_id).to.equal('GCOXPMTTYNRFDAHO5KCWSIRKN3WXCWBBR2MWVHXGI7SXIDEOTVTBU323');
            expect(orderBookTrades[1].seller_id).to.equal('GBWX6PE4HMW4QD6F74WBOF6SK336ARJC5OBQGCJOW3VYEDEGLC5SL2WU');
        });

        it('should parse liquidity pool trades correctly', function () {
            const result = parsePathPaymentTrades(pathPaymentResultXdr, 0, 'path_payment_strict_send');
            const lpTrades = result.trades.filter(t => t.type === 'liquidity_pool');
            expect(lpTrades.length).to.equal(4);
            expect(lpTrades[0].pool_id).to.be.a('string');
            expect(lpTrades[0].pool_id.length).to.equal(64); // hex encoded 32-byte pool id
        });

        it('should return dest_amount for path_payment_strict_send', function () {
            const result = parsePathPaymentTrades(pathPaymentResultXdr, 0, 'path_payment_strict_send');
            expect(result).to.have.property('dest_amount');
            // XDR last.amount = 53294 stroops = 0.0053294
            expect(result.dest_amount).to.equal('0.0053294');
        });

        it('should return source_amount for path_payment_strict_receive', function () {
            const result = parsePathPaymentTrades(pathPaymentResultXdr, 0, 'path_payment_strict_receive');
            expect(result).to.have.property('source_amount');
            // source_amount is the first trade's amount_bought
            expect(result.source_amount).to.be.a('string');
            // The first trade's amount_bought from the XDR = 0.0052500
            expect(result.source_amount).to.equal('0.0052500');
        });

        it('should return object with trades array', function () {
            const result = parsePathPaymentTrades(pathPaymentResultXdr, 0, 'path_payment_strict_send');
            expect(result).to.have.property('trades');
            expect(result.trades).to.be.an('array');
            expect(result.trades.length).to.equal(6);
        });
    });

    describe('parseManageOfferResult', function () {
        // Real result_xdr from transaction fbd09b1aabac9d37ddec7cd8f751d76ddb1c31b25c0b5177b3dff6f7b453f3a3
        // Contains manage_sell_offer with created offer_id: 1821833749
        const manageOfferResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAADAAAAAAAAAAAAAAAAAAAAANcz8UpgOR0kygfupHRrOkNJ80PsT1V6UvYPnKz1WKyQAAAAAGyW+hUAAAACRVVSTVRMAAAAAAAAAAAAAASpt6MGTWvGwdWWzznhGcDJ+klplpy+DCZDSPE0MG+qAAAAAVVTRE0AAAAAzjFwwWvYRuQOCHjRQ12ZsvHFXsmtQ0ka1OpQTcuL5UoAAAAABfXhAAAAAAIAAAABAAAAAAAAAAAAAAAA';

        it('should return empty object for invalid XDR', function () {
            const result = parseManageOfferResult('invalid_xdr', 0);
            expect(result).to.deep.equal({});
        });

        it('should return empty object for non-manage-offer operations', function () {
            // This is a result_xdr from a simple payment operation
            const paymentResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=';
            const result = parseManageOfferResult(paymentResultXdr, 0);
            expect(result).to.deep.equal({});
        });

        it('should return empty object when operation index is out of bounds', function () {
            const result = parseManageOfferResult(manageOfferResultXdr, 99);
            expect(result).to.deep.equal({});
        });

        it('should parse created_offer_id from manage_sell_offer result', function () {
            const result = parseManageOfferResult(manageOfferResultXdr, 0);
            expect(result).to.have.property('created_offer_id');
            expect(result.created_offer_id).to.equal('1821833749');
        });

        it('should return empty object when offer is deleted (fully filled)', function () {
            // result_xdr with manageOfferDeleted result
            // Transaction where offer was fully filled immediately
            const deletedOfferResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAADAAAAAAAAAAEAAAAAnXeycMNiUYDu6oVpIipu7XFYIo6Zap7mR+V0DI6dZhoAAAAAYyzggwAAAAFZRVNCVQAAAAAAAAAAAAAABKm3owZNa8bB1ZbPOeEZwMn6SWmWnL4MJkNI8TQwb6oAAAAADWSwQAAAAAF4WExNAAAAACI213D+DT4BUhl11c96xIQrcJXWsanXaNPppjLpmQa+AAABJWv0gDQAAAAAAAAAAAAAAAA=';
            const result = parseManageOfferResult(deletedOfferResultXdr, 0);
            expect(result).to.deep.equal({});
        });
    });
});