const expect = require('chai').expect,
    {parseTransaction} = require('../logic/stream-processor')

describe('stream-processor', function () {
    describe('parseTransaction', function () {
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
    })
})