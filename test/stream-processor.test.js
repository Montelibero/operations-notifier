const expect = require('chai').expect;
const sinon = require('sinon');
const { TransactionBuilder, Operation, Keypair, Account, Networks, Asset, Claimant, Memo, Address, StrKey, nativeToScVal } = require('@stellar/stellar-sdk');
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
            memo: { type: 'none', value: null }
        };
    }

    function createTxMock(operation) {
        const tx = mockTransaction([operation]);
        sinon.stub(TransactionBuilder, 'fromXdr').returns(tx);
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

    // the SDK exposes seven distinct operation types for revoke sponsorship
    const revokeSponsorshipCases = [
        [{type: 'revokeAccountSponsorship', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'},
            {revoke_type: 'account', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'}],
        [{type: 'revokeTrustlineSponsorship', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', asset: {code: 'USD', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'}},
            {revoke_type: 'trustline', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', asset: {asset_type: 1, asset_code: 'USD', asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'}}],
        [{type: 'revokeOfferSponsorship', seller: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', offerId: '1821833749'},
            {revoke_type: 'offer', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', offer_id: '1821833749'}],
        [{type: 'revokeDataSponsorship', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', name: 'config'},
            {revoke_type: 'data', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', data_name: 'config'}],
        [{type: 'revokeClaimableBalanceSponsorship', balanceId: '0'.repeat(64)},
            {revoke_type: 'claimable_balance', balance_id: '0'.repeat(64)}],
        [{type: 'revokeLiquidityPoolSponsorship', liquidityPoolId: 'ab'.repeat(32)},
            {revoke_type: 'liquidity_pool', liquidity_pool_id: 'ab'.repeat(32)}],
        [{type: 'revokeSignerSponsorship', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', signer: {ed25519PublicKey: 'GBYH3M3REQM3WQOJY26FYORN23EXY22FWBHVZ74TT5GYOF22IIA7YSOX'}},
            {revoke_type: 'signer', account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', signer_key: 'GBYH3M3REQM3WQOJY26FYORN23EXY22FWBHVZ74TT5GYOF22IIA7YSOX'}]
    ];
    for (const [operation, expected] of revokeSponsorshipCases) {
        it(`should parse ${operation.type}`, function () {
            const tx = createTxMock(operation);
            const parsed = parseTransaction(tx);
            const normalized = parsed.operations[0];
            expect(normalized.type).to.equal('revoke_sponsorship');
            expect(normalized.type_i).to.equal(18);
            for (const [key, value] of Object.entries(expected)) {
                expect(normalized[key], key).to.deep.equal(value);
            }
        });
    }

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

    it('should parse manageSellOffer', function () {
        const operation = {
            type: 'manageSellOffer',
            buying: { code: 'USD', issuer: 'GDUN55P4M332X24DYIUI64HLM3224525Y4DO6T43Y443P2P5C5Z5Y5N5' },
            selling: { code: 'EUR', issuer: 'GDUN55P4M332X24DYIUI64HLM3224525Y4DO6T43Y443P2P5C5Z5Y5N5' },
            amount: '100',
            price: '1.5',
            offerId: '123'
        };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type_i).to.equal(3);
        expect(parsed.operations[0].type).to.equal('manage_sell_offer');
    });

    it('should parse manageBuyOffer', function () {
        const operation = {
            type: 'manageBuyOffer',
            buying: { code: 'USD', issuer: 'GDUN55P4M332X24DYIUI64HLM3224525Y4DO6T43Y443P2P5C5Z5Y5N5' },
            selling: { code: 'EUR', issuer: 'GDUN55P4M332X24DYIUI64HLM3224525Y4DO6T43Y443P2P5C5Z5Y5N5' },
            buyAmount: '100',
            price: '1.5',
            offerId: '123'
        };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type_i).to.equal(12);
        expect(parsed.operations[0].type).to.equal('manage_buy_offer');
        expect(parsed.operations[0].amount).to.equal('100');
    });

    it('should parse invokeHostFunction', function () {
        const operation = { type: 'invokeHostFunction', function: 'HostFunctionTypeHostFunctionTypeInvokeContract', parameters: [], footprint: { readOnly: [], readWrite: [] }, authority: [] };
        const tx = createTxMock(operation);
        const parsed = parseTransaction(tx);
        expect(parsed.operations[0].type).to.equal('invoke_host_function');
    });

    it('should extract contract, function_name and args from a real invokeContract tx', function () {
        const CONTRACT = 'CAFXUALXFPTBTLSRCDSMJXNPSN3AVL2ZPXJUDDHVTUTLRX5SCNP2SISM';
        const FROM = 'GBYH3M3REQM3WQOJY26FYORN23EXY22FWBHVZ74TT5GYOF22IIA7YSOX';
        const src = Keypair.random();
        const account = new Account(src.publicKey(), '1');
        const op = Operation.invokeContractFunction({
            contract: CONTRACT,
            function: 'capture',
            args: [
                nativeToScVal(Address.fromString(FROM), { type: 'address' }),
                nativeToScVal(10n, { type: 'i128' }),
                nativeToScVal('hi')
            ]
        });
        const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.PUBLIC })
            .addOperation(op).setTimeout(30).build();
        const rawTx = {
            hash: 'deadbeef',
            paging_token: '1',
            successful: true,
            source_account: src.publicKey(),
            source_account_sequence: '1',
            created_at: '2026-04-15T00:00:00Z',
            envelope_xdr: tx.toEnvelope().toXDR('base64'),
            result_xdr: '',
            memo_type: 'none'
        };
        const parsed = parseTransaction(rawTx);
        const normalized = parsed.operations[0];
        expect(normalized.type).to.equal('invoke_host_function');
        expect(normalized.host_function_type).to.equal('invoke_contract');
        expect(normalized.contract).to.equal(CONTRACT);
        expect(normalized.function_name).to.equal('capture');
        expect(normalized.args).to.be.an('array').with.length(3);
        expect(normalized.args[0]).to.equal(FROM);
        expect(normalized.args[1]).to.equal('10'); // bigint converted to string
        expect(normalized.args[2]).to.equal('hi');
    });

    it('should parse Soroban transaction with credentials V2', function () {
        const rawTx = {
            hash: '4d03923c56a811d739b6e8284c7c88bdf5846175407b7b14d2ee9bdfbfa2ca85',
            paging_token: '276443864905879552',
            successful: true,
            source_account: 'GDLTH4KKMA4R2JGKA7XKI5DLHJBUT42D5RHVK6SS6YHZZLHVLCWJAYXI',
            source_account_sequence: '168734619223934659',
            created_at: '2026-09-10T12:33:00Z',
            envelope_xdr: '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',
            result_xdr: '',
            memo_type: 'none'
        };
        const parsed = parseTransaction(rawTx);
        expect(parsed).to.not.be.null;
        expect(parsed.operations.length).to.equal(1);
        expect(parsed.operations[0].type).to.equal('invoke_host_function');
    });

    it('should decode Protocol 30 muxed contract (W…) addresses in invokeContract args', function () {
        // envelope: invoke_host_function transfer(W…, i128, map{to_muxed_id, nested:[W…]}, C…) built with stellar-sdk 17
        const fixture = require('./fixtures/protocol30-muxed-contract.json');
        const rawTx = {
            hash: '4d03923c56a811d739b6e8284c7c88bdf5846175407b7b14d2ee9bdfbfa2ca85',
            paging_token: '276443864905879552',
            successful: true,
            source_account: fixture.gAddress,
            source_account_sequence: '2',
            created_at: '2026-11-23T17:00:00Z',
            envelope_xdr: fixture.envelopeXdr,
            result_xdr: '',
            memo_type: 'none'
        };
        const parsed = parseTransaction(rawTx);
        expect(parsed).to.not.be.null;
        const normalized = parsed.operations[0];
        expect(normalized.type).to.equal('invoke_host_function');
        expect(normalized.host_function_type).to.equal('invoke_contract');
        expect(normalized.contract).to.equal(fixture.cAddress);
        expect(normalized.function_name).to.equal('transfer');
        expect(normalized.args).to.be.an('array').with.length(4);
        // muxed contract address (CAP-84) is rendered as a W… strkey
        expect(normalized.args[0]).to.equal(fixture.wAddress);
        expect(normalized.args[1]).to.equal('10000000');
        // ScVal maps decode to plain objects
        expect(normalized.args[2]).to.deep.equal({
            to_muxed_id: '123456789',
            nested: [fixture.wAddress, 'x']
        });
        expect(normalized.args[3]).to.equal(fixture.cAddress);
    });

    it('should normalize claimants of create_claimable_balance to a stable shape', function () {
        const src = Keypair.random();
        const account = new Account(src.publicKey(), '1');
        const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.PUBLIC })
            .addOperation(Operation.createClaimableBalance({
                asset: Asset.native(),
                amount: '1',
                claimants: [
                    new Claimant(src.publicKey(), Claimant.predicateBeforeRelativeTime(86400)),
                    new Claimant(src.publicKey(), Claimant.predicateAnd(
                        Claimant.predicateBeforeRelativeTime(60),
                        Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(1700000000))
                    )),
                    new Claimant(src.publicKey())
                ]
            }))
            .addOperation(Operation.manageData({ name: 'config', value: Buffer.from('{"a":1}') }))
            .setTimeout(0)
            .build();
        const parsed = parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true,
            source_account: src.publicKey(), source_account_sequence: '1',
            created_at: '2026-11-23T17:00:00Z', envelope_xdr: tx.toXDR(), result_xdr: '', memo_type: 'none'
        });
        const [claim, data] = parsed.operations;
        expect(claim.claimants).to.deep.equal([
            { destination: src.publicKey(), predicate: { before_relative_time: '86400' } },
            { destination: src.publicKey(), predicate: { and: [{ before_relative_time: '60' }, { not: { before_absolute_time: '1700000000' } }] } },
            { destination: src.publicKey(), predicate: 'unconditional' }
        ]);
        expect(data.type).to.equal('manage_data');
        expect(data.value).to.equal('{"a":1}');
    });

    it('should parse extend_footprint_ttl and restore_footprint from a real envelope', function () {
        // the SDK exposes the type as `extendFootprintTtl` (lowercase `tl`)
        const src = Keypair.random();
        const tx = new TransactionBuilder(new Account(src.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.PUBLIC })
            .addOperation(Operation.extendFootprintTtl({ extendTo: 123456 }))
            .addOperation(Operation.restoreFootprint({}))
            .setTimeout(0)
            .build();
        const parsed = parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true,
            source_account: src.publicKey(), source_account_sequence: '1',
            created_at: '2026-11-25T00:00:00Z', envelope_xdr: tx.toXDR(), result_xdr: '', memo_type: 'none'
        });
        expect(parsed.operations.map(op => op.type)).to.deep.equal(['extend_footprint_ttl', 'restore_footprint']);
        expect(parsed.operations[0].type_i).to.equal(25);
        expect(parsed.operations[0].extendTo).to.equal(123456);
        expect(parsed.operations[1].type_i).to.equal(26);
    });

    it('should decode every memo type from a real envelope', function () {
        const src = Keypair.random();
        const parse = memo => {
            const tx = new TransactionBuilder(new Account(src.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.PUBLIC, memo })
                .addOperation(Operation.payment({ destination: src.publicKey(), asset: Asset.native(), amount: '1' }))
                .setTimeout(0)
                .build();
            return parseTransaction({
                hash: 'deadbeef', paging_token: '1', successful: true,
                source_account: src.publicKey(), source_account_sequence: '1',
                created_at: '2026-11-25T00:00:00Z', envelope_xdr: tx.toXDR(), result_xdr: '', memo_type: memo.type
            }).details.memo;
        };
        const hash = Buffer.alloc(32, 9);
        expect(parse(Memo.none())).to.equal(undefined);
        expect(parse(Memo.id('123456789012345'))).to.deep.equal({ type: 'id', value: '123456789012345' });
        expect(parse(Memo.text('депозит №42'))).to.deep.equal({ type: 'text', value: 'депозит №42' });
        expect(parse(Memo.hash(hash))).to.deep.equal({ type: 'hash', value: hash.toString('base64') });
        expect(parse(Memo.return(hash))).to.deep.equal({ type: 'return', value: hash.toString('base64') });
    });

    it('should decode set_options signer and home domain from a real envelope', function () {
        const src = Keypair.random();
        const tx = new TransactionBuilder(new Account(src.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.PUBLIC })
            .addOperation(Operation.setOptions({
                signer: { ed25519PublicKey: src.publicKey(), weight: 3 },
                homeDomain: 'example.com',
                masterWeight: 2, lowThreshold: 1, medThreshold: 2, highThreshold: 3,
                setFlags: 1, clearFlags: 2, inflationDest: src.publicKey()
            }))
            .addOperation(Operation.setOptions({signer: {sha256Hash: Buffer.alloc(32, 2), weight: 1}}))
            .addOperation(Operation.setOptions({signer: {preAuthTx: Buffer.alloc(32, 3), weight: 1}}))
            .setTimeout(0)
            .build();
        const [op, hashSigner, preAuthSigner] = parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true,
            source_account: src.publicKey(), source_account_sequence: '1',
            created_at: '2026-11-25T00:00:00Z', envelope_xdr: tx.toXDR(), result_xdr: '', memo_type: 'none'
        }).operations;
        expect(op.type).to.equal('set_options');
        expect(op.home_domain).to.equal('example.com');
        expect(op.signer_key).to.equal(src.publicKey());
        expect(op.signer_weight).to.equal(3);
        expect(op.inflation_dest).to.equal(src.publicKey());
        // byte signers are encoded as hex strings (SDK returns raw Uint8Array here)
        expect(hashSigner.signer_key).to.equal('02'.repeat(32));
        expect(preAuthSigner.signer_key).to.equal('03'.repeat(32));
    });

    it('should expose the path payment destination and muxed addresses in the Horizon convention', function () {
        const src = Keypair.random();
        const G = src.publicKey();
        const M = StrKey.encodeMed25519PublicKey(Buffer.concat([src.rawPublicKey(), Buffer.from('00000000075bcd15', 'hex')])); // id 123456789
        const build = operation => new TransactionBuilder(new Account(G, '1'), {fee: '100', networkPassphrase: Networks.PUBLIC})
            .addOperation(operation).setTimeout(0).build();
        const parse = tx => parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true, source_account: G, source_account_sequence: '1',
            created_at: '2026-11-26T00:00:00Z', envelope_xdr: tx.toXDR(), result_xdr: '', memo_type: 'none'
        }).operations[0];
        const asset = new Asset('USD', G);
        const usd = {asset_type: 1, asset_code: 'USD', asset_issuer: G};
        const pathPayment = parse(build(Operation.pathPaymentStrictReceive({sendAsset: Asset.native(), sendMax: '10', destination: M, destAsset: asset, destAmount: '1', path: [asset]})));
        expect(pathPayment.type).to.equal('path_payment_strict_receive');
        expect(pathPayment.destination).to.equal(G);
        expect(pathPayment.destination_muxed).to.equal(M);
        expect(pathPayment.destination_muxed_id).to.equal('123456789');
        expect(pathPayment.path).to.deep.equal([usd]);

        const payment = parse(build(Operation.payment({destination: M, asset: Asset.native(), amount: '1'})));
        expect(payment.destination).to.equal(G);
        expect(payment.destination_muxed).to.equal(M);
        const plain = parse(build(Operation.payment({destination: G, asset: Asset.native(), amount: '1'})));
        expect(plain.destination).to.equal(G);
        expect(plain).to.not.have.property('destination_muxed');
    });

    it('should normalize a muxed operation source account', function () {
        const src = Keypair.random();
        const G = src.publicKey();
        const M = StrKey.encodeMed25519PublicKey(Buffer.concat([src.rawPublicKey(), Buffer.from('0000000000000042', 'hex')])); // id 66
        const tx = new TransactionBuilder(new Account(G, '1'), {fee: '100', networkPassphrase: Networks.PUBLIC})
            .addOperation(Operation.payment({destination: G, asset: Asset.native(), amount: '1', source: M}))
            .setTimeout(0).build();
        const op = parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true, source_account: G, source_account_sequence: '1',
            created_at: '2026-11-26T00:00:00Z', envelope_xdr: tx.toXDR(), result_xdr: '', memo_type: 'none'
        }).operations[0];
        expect(op.account).to.equal(G);
        expect(op.account_muxed).to.equal(M);
        expect(op.account_muxed_id).to.equal('66');
    });

    it('should attach trades to a passive offer filled by another account', function () {
        const src = Keypair.random();
        const G = src.publicKey();
        // real create_passive_sell_offer result (its own result arm, type 4): one order book fill + manageOfferDeleted effect
        const fillResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAEAAAAAAAAAAEAAAABAAAAAHB9s3EkGbtByca8XDot1sl8a0WwT1z/k59NhxdaQgH8AAAAAAAAAGMAAAAAAAAAAABMS0AAAAABVVNEAAAAAABwfbNxJBm7QcnGvFw6LdbJfGtFsE9c/5OfTYcXWkIB/AAAAAAAJiWgAAAAAgAAAAA=';
        const tx = new TransactionBuilder(new Account(G, '1'), { fee: '100', networkPassphrase: Networks.PUBLIC })
            .addOperation(Operation.createPassiveSellOffer({ selling: Asset.native(), buying: new Asset('USD', G), amount: '1', price: '1' }))
            .setTimeout(0)
            .build();
        const [op] = parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true, source_account: G, source_account_sequence: '1',
            created_at: '2026-11-26T00:00:00Z', envelope_xdr: tx.toXDR(), result_xdr: fillResultXdr, memo_type: 'none'
        }).operations;
        expect(op.type).to.equal('create_passive_sell_offer');
        expect(op.trades).to.have.length(1);
        expect(op.trades[0].seller_id).to.equal('GBYH3M3REQM3WQOJY26FYORN23EXY22FWBHVZ74TT5GYOF22IIA7YSOX');
        expect(op).to.not.have.property('created_offer_id');
    });

    it('should keep the muxed transaction source for operations without their own source', function () {
        const sdk = require('@stellar/stellar-sdk');
        const src = Keypair.random();
        const G = src.publicKey();
        const M = StrKey.encodeMed25519PublicKey(Buffer.concat([src.rawPublicKey(), Buffer.from('000000000000002a', 'hex')])); // id 42
        const plain = new TransactionBuilder(new Account(G, '1'), { fee: '100', networkPassphrase: Networks.PUBLIC })
            .addOperation(Operation.payment({ destination: G, asset: Asset.native(), amount: '1' }))
            .setTimeout(0)
            .build();
        // the transaction source is a MuxedAccount in XDR: replace it with the muxed form of the same key (wire level)
        const wire = plain.toEnvelope().toXdrObject();
        wire.v1.tx.sourceAccount = {type: 256, med25519: {id: 42n, ed25519: src.rawPublicKey()}};
        const parsed = parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true, source_account: G, source_account_sequence: '1',
            created_at: '2026-11-26T00:00:00Z', envelope_xdr: sdk.xdr.TransactionEnvelope.fromXdrObject(wire).toXDR('base64'), result_xdr: '', memo_type: 'none'
        });
        expect(parsed.details.source).to.equal(G);
        expect(parsed.details.source_muxed).to.equal(M);
        expect(parsed.details.source_muxed_id).to.equal('42');
        const [op] = parsed.operations; // no operation source → inherits the tx source
        expect(op.account).to.equal(G);
        expect(op.account_muxed).to.equal(M);
        expect(op.account_muxed_id).to.equal('42');
    });

    it('should not attach the muxed transaction source to revoke_sponsorship operations (account is the target)', function () {
        const sdk = require('@stellar/stellar-sdk');
        const src = Keypair.random();
        const G = src.publicKey();
        const target = Keypair.random().publicKey();
        const plain = new TransactionBuilder(new Account(G, '1'), { fee: '100', networkPassphrase: Networks.PUBLIC })
            .addOperation(Operation.revokeAccountSponsorship({ account: target }))
            .setTimeout(0)
            .build();
        const wire = plain.toEnvelope().toXdrObject();
        wire.v1.tx.sourceAccount = {type: 256, med25519: {id: 5n, ed25519: src.rawPublicKey()}};
        const [op] = parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true, source_account: G, source_account_sequence: '1',
            created_at: '2026-11-26T00:00:00Z', envelope_xdr: sdk.xdr.TransactionEnvelope.fromXdrObject(wire).toXDR('base64'), result_xdr: '', memo_type: 'none'
        }).operations;
        expect(op.account).to.equal(target);
        expect(op).to.not.have.property('account_muxed');
        expect(op).to.not.have.property('account_muxed_id');
    });

    it('should normalize the muxed account of a clawback', function () {
        const sdk = require('@stellar/stellar-sdk');
        const src = Keypair.random();
        const G = src.publicKey();
        const M = StrKey.encodeMed25519PublicKey(Buffer.concat([src.rawPublicKey(), Buffer.from('0000000000000007', 'hex')])); // id 7
        const asset = new Asset('USD', G);
        const plain = new TransactionBuilder(new Account(G, '1'), { fee: '100', networkPassphrase: Networks.PUBLIC })
            .addOperation(Operation.clawback({ from: G, asset, amount: '1' }))
            .addOperation(Operation.setTrustLineFlags({ trustor: G, asset, flags: { authorized: true } }))
            .setTimeout(0)
            .build();
        // the builders accept G… only; patch the muxed account (MuxedAccount in XDR) into the clawback operation
        // (set_trustline_flags.trustor and begin_sponsoring_future_reserves.sponsoredId are AccountIDs, never muxed)
        const muxed = {type: 256, med25519: {id: 7n, ed25519: src.rawPublicKey()}};
        const wire = plain.toEnvelope().toXdrObject();
        wire.v1.tx.operations[0].body.clawbackOp.from = muxed;
        const [clawback] = parseTransaction({
            hash: 'deadbeef', paging_token: '1', successful: true, source_account: G, source_account_sequence: '1',
            created_at: '2026-11-26T00:00:00Z', envelope_xdr: sdk.xdr.TransactionEnvelope.fromXdrObject(wire).toXDR('base64'), result_xdr: '', memo_type: 'none'
        }).operations;
        expect(clawback.from).to.equal(G);
        expect(clawback.from_muxed).to.equal(M);
        expect(clawback.from_muxed_id).to.equal('7');
    });

    it('logs a diagnosable warning with the tx hash instead of dumping the envelope on parse failure', function () {
        const logger = require('../util/logger');
        const warn = sinon.stub(logger, 'warn');
        const debug = sinon.stub(logger, 'debug');
        const error = sinon.stub(console, 'error');
        const parsed = parseTransaction({hash: 'deadbeef', ledger: 65664138, paging_token: '1', envelope_xdr: 'AAAA', result_xdr: ''});
        expect(parsed).to.equal(null);
        expect(warn.calledOnce).to.equal(true);
        expect(warn.firstCall.args[0]).to.match(/deadbeef/);
        expect(warn.firstCall.args[0]).to.match(/65664138/);
        expect(debug.calledOnce).to.equal(true); // the envelope stays at debug level
        expect(error.called).to.equal(false);
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
        // Real result_xdr from operation 270379998148956161.
        // path_payment_strict_receive spent 2985.0526179 USDC via four order book trades.
        const multiTradeStrictReceiveResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAACAAAAAAAAAAQAAAABAAAAAP8DCB2vvCODV1lIzf6ZFjZZOltiGAlvPj24+4e76hrGAAAAAG3mJjwAAAACRVVSTVRMAAAAAAAAAAAAAASpt6MGTWvGwdWWzznhGcDJ+klplpy+DCZDSPE0MG+qAAAAAAAAAIoAAAABVVNEQwAAAAA7mRE4Dv6Yi6CokA6xz+RPNm99vpRr7QdyQPf2JN8VxQAAAAAAAAChAAAAAQAAAADlC4Lr/vutTpwFIJ0lduBSpYFLfNCr2lIozTPRXcdsJgAAAABt5bPbAAAAAkVVUk1UTAAAAAAAAAAAAAAEqbejBk1rxsHVls854RnAyfpJaZacvgwmQ0jxNDBvqgAAAAD3oAIIAAAAAVVTREMAAAAAO5kROA7+mIugqJAOsc/kTzZvfb6Ua+0HckD39iTfFcUAAAABJsqtFQAAAAEAAAAA8KsTN0t/qNpMJKZoJkozPh9w3C231SFgzlQmgJ4sBckAAAAAbdtJvAAAAAJFVVJNVEwAAAAAAAAAAAAABKm3owZNa8bB1ZbPOeEZwMn6SWmWnL4MJkNI8TQwb6oAAAAEZQGVmwAAAAFVU0RDAAAAADuZETgO/piLoKiQDrHP5E82b32+lGvtB3JA9/Yk3xXFAAAABUACscYAAAABAAAAABwLgMgri3gbo+uW1L2vjY6FVjE4TnO3SbaNHTbvigkgAAAAAG3hsbcAAAACRVVSTVRMAAAAAAAAAAAAAASpt6MGTWvGwdWWzznhGcDJ+klplpy+DCZDSPE0MG+qAAAAAHV8IdMAAAABVVNEQwAAAAA7mRE4Dv6Yi6CokA6xz+RPNm99vpRr7QdyQPf2JN8VxQAAAACMbYJnAAAAAGqL+Fnv5HuczwcAv4wCa3N+I0sSkABusKONM1sQxXEiAAAAAkVVUk1UTAAAAAAAAAAAAAAEqbejBk1rxsHVls854RnAyfpJaZacvgwmQ0jxNDBvqgAAAAXSHboAAAAAAA==';

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
            const result = parsePathPaymentTrades(multiTradeStrictReceiveResultXdr, 0, 'path_payment_strict_receive', {
                asset_type: 1,
                asset_code: 'USDC',
                asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
            });
            expect(result).to.have.property('source_amount');
            expect(result.source_amount).to.be.a('string');
            expect(result.source_amount).to.equal('2985.0526179');
        });

        it('should sum source_amount for multi-trade path_payment_strict_receive', function () {
            const result = parsePathPaymentTrades(multiTradeStrictReceiveResultXdr, 0, 'path_payment_strict_receive', {
                asset_type: 1,
                asset_code: 'USDC',
                asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
            });
            expect(result.trades.length).to.equal(4);
            expect(result.source_amount).to.equal('2985.0526179');
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
            expect(result).to.deep.equal({trades: []});
        });

        it('should return empty object for non-manage-offer operations', function () {
            // This is a result_xdr from a simple payment operation
            const paymentResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=';
            const result = parseManageOfferResult(paymentResultXdr, 0);
            expect(result).to.deep.equal({trades: []});
        });

        it('should return empty object when operation index is out of bounds', function () {
            const result = parseManageOfferResult(manageOfferResultXdr, 99);
            expect(result).to.deep.equal({trades: []});
        });

        it('should parse created_offer_id from manage_sell_offer result', function () {
            const result = parseManageOfferResult(manageOfferResultXdr, 0);
            expect(result).to.have.property('created_offer_id');
            expect(result.created_offer_id).to.equal('1821833749');
        });

        it('should parse trades without created_offer_id when offer is deleted (fully filled)', function () {
            // valid TransactionResult built with stellar-sdk 17: manage_sell_offer success,
            // one order book fill, effect = manageOfferDeleted
            const deletedOfferResultXdr = 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAADAAAAAAAAAAEAAAABAAAAAHB9s3EkGbtByca8XDot1sl8a0WwT1z/k59NhxdaQgH8AAAAAAAAAGMAAAAAAAAAAABMS0AAAAABVVNEAAAAAABwfbNxJBm7QcnGvFw6LdbJfGtFsE9c/5OfTYcXWkIB/AAAAAAAJiWgAAAAAgAAAAA=';
            const result = parseManageOfferResult(deletedOfferResultXdr, 0);
            expect(result).to.not.have.property('created_offer_id');
            expect(result.trades).to.have.length(1);
            expect(result.trades[0]).to.deep.equal({
                type: 'order_book',
                seller_id: 'GBYH3M3REQM3WQOJY26FYORN23EXY22FWBHVZ74TT5GYOF22IIA7YSOX',
                offer_id: '99',
                asset_sold: {asset_type: 0},
                amount_sold: '0.5000000',
                asset_bought: {
                    asset_type: 1,
                    asset_code: 'USD',
                    asset_issuer: 'GBYH3M3REQM3WQOJY26FYORN23EXY22FWBHVZ74TT5GYOF22IIA7YSOX'
                },
                amount_bought: '0.2500000'
            });
        });

        it('should unwrap fee-bump transactions', function () {
            // the pathPaymentResultXdr above wrapped as the inner result of a fee-bump transaction (stellar-sdk 17)
            const feeBumpResultXdr = 'AAAAAAAAAMgAAAABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAAAAAAAZAAAAAAAAAABAAAAAAAAAA0AAAAAAAAABgAAAAIvlCf64lhvvgit20YKSj58sWvbKiMou7ebfoLr/wflNwAAAAFYTEwAAAAAAAgUpMDX+V+Z9PxwsASbPbF5LZnfOHi7WaEQP6GM0W7MAAAGr4QbvRAAAAAAAAAAAAAAzRQAAAACk9yairgnoBl5qfo/JJXDc/EOPpVbJBFFtTkNb45V1t0AAAABT0xUAAAAAAAvruau4mryDVuPyUKI1UduJ0DMqaDc1Ks2NRtMKIBtrAAAAAAOEi+eAAAAAVhMTQAAAAAACBSkwNf5X5n0/HCwBJs9sXktmd84eLtZoRA/oYzRbswAAAavhBu9EAAAAAKCDa44K9ZkdallUXFwIanlffPCMI4fjv2Q+ndNf01/dgAAAAJ4UlVORVMAAAAAAAAAAAAAlwl+48ZbxT7dlNNarPKWD9HgMLjEzJuvFYJp30QFEd4AAAAAAVlrvQAAAAFOTFQAAAAAAC+u5q7iavINW4/JQojVR24nQMypoNzUqzY1G0wogG2sAAAAAA4SL54AAAACKFCsSijVx0Tin4Glb86LHoeTTomskhi8Taln85nRqckAAAACU0RFWEVYAAAAAAAAAAAAAGB2Djau7U7gAg0oIOOY899gpvbthSN26fbKLh7paa+CAAAAAA4O2UIAAAACeFJVTkVTAAAAAAAAAAAAAJcJfuPGW8U+3ZTTWqzylg/R4DC4xMybrxWCad9EBRHeAAAAAAFZa70AAAABAAAAAJ13snPDYlGA7uqFaSIqbu1xWCGOmWqe5kfldAyOnWYaAAAAAGMs4IMAAAAAAAAAAAAA0C4AAAACU0RFWEVYAAAAAAAAAAAAAGB2Djau7U7gAg0oIOOY899gpvbthSN26fbKLh7paa+CAAAAAA4O2UIAAAABAAAAAG1/PJw7LcgPxf8sFxfSVvfgRSLrgwMJLrbrggyGWLslAAAAAGMqjf4AAAABeVhMTQAAAAAiNtdw/g0+AVIZddXPesSEK3CV1rGp12jT6aYy6ZkGvgAAAAAAANAuAAAAAAAAAAAAANAuAAAAABm4o+K40C1yfZ3rzZcmQ41kccM9hEi7kx6Yu169gGpLAAAAAXlYTE0AAAAAIjbXcP4NPgFSGXXVz3rEhCtwldaxqddo0+mmMumZBr4AAAAAAADQLgAAAAAAAAAA';
            const result = parsePathPaymentTrades(feeBumpResultXdr, 0, 'path_payment_strict_send');
            expect(result.trades).to.have.length(6);
            expect(result.dest_amount).to.equal('0.0053294');
        });
    });
});
