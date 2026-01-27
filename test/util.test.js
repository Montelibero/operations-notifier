const { isValidAsset, parseAsset } = require('../util/asset-helper')
const { elapsed } = require('../util/elapsed-time')
const { verifySignature, signer } = require('../util/signer')
const { matches } = require('../util/subscription-match-helper')

describe('assetHelper.isValidAsset', function () {
    it('signs the data', function () {
        let testData = [
            { //positive
                input: {
                    asset_code: 'CODE',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 1
                },
                expected: true
            },
            { //positive - XLM
                input: {
                    asset_type: 0
                },
                expected: true
            },
            { //invalid issuer
                input: {
                    asset_code: 'CODE',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJC',
                    asset_type: 1
                },
                expected: false
            },
            { //invalid type
                input: {
                    asset_code: 'CODE',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 2
                },
                expected: false
            },
            { //code without issuer
                input: {
                    asset_code: 'CODE',
                },
                expected: false
            },
            { //issuer without code
                input: {
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 2
                },
                expected: false
            },
            { //empty code
                input: {
                    asset_code: '',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 1
                },
                expected: false
            },
            { //too long code
                input: {
                    asset_code: '12345678901234567890',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 1
                },
                expected: false
            },
            { //XLM with non-empty code
                input: {
                    asset_code: 'CODE',
                    asset_type: 0
                },
                expected: false
            },
            { //XLM with non-empty issuer
                input: {
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 0
                },
                expected: false
            }
        ]

        testData.forEach(entry => expect(isValidAsset(entry.input)).to.equal(entry.expected, `test case data: ${JSON.stringify(entry)}`))
    })
})

describe('assetHelper.parseAsset', function () {
    it('should parse assets and correct possible collisions', function () {
        let testData = [
            { //direct parsing without a prefix, with garbage check
                input: {
                    asset_code: 'CODE',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    garbage: 'some garbage',
                    asset_garbage: 'more garbage'
                },
                expected: {
                    asset_code: 'CODE',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 1
                }
            },
            { //with a prefix
                input: {
                    test_asset_code: 'CODE',
                    test_asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV'
                },
                prefix: 'test_',
                expected: {
                    asset_code: 'CODE',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 1
                }
            },
            { //XLM
                input: {
                    asset_code: 'XLM'
                },
                expected: {
                    asset_type: 0
                }
            },
            { //XLM with asset_type field
                input: {
                    asset_type: 'native'
                },
                expected: {
                    asset_type: 0
                }
            },
            { //automatic asset type correction
                input: {
                    asset_code: 'CODE',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 'credit_alphanum12'
                },
                expected: {
                    asset_code: 'CODE',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 1
                }
            },
            { //alphanum12 asset type
                input: {
                    asset_code: 'CODE123',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV'
                },
                expected: {
                    asset_code: 'CODE123',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV',
                    asset_type: 2
                }
            },
            { //invalid asset
                input: {
                    asset_code: 'CODE123',
                    asset_issuer: 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJA'
                },
                expected: null
            }
        ]

        testData.forEach(entry => expect(parseAsset(entry.input, entry.prefix)).to.be.deep.equal(entry.expected, `test case data: ${JSON.stringify(entry)}`))
    })
})

describe('elapsed', function () {
    it('formats timespans', function () {
        const to = new Date('2020-01-15T12:57:14.428Z')
        expect(elapsed(new Date('2020-01-15T12:57:13.429Z'), to)).to.eq('0s')
        expect(elapsed(new Date('2020-01-15T12:57:13.427Z'), to)).to.eq('1s')
        expect(elapsed(new Date('2020-01-15T12:57:16.428Z'), to)).to.eq('2s')
        expect(elapsed(new Date('2020-01-15T12:56:01.428Z'), to)).to.eq('1m 13s')
        expect(elapsed(new Date('2020-01-15T09:53:01.428Z'), to)).to.eq('3h 4m 13s')
        expect(elapsed(new Date('2020-01-15T09:53:01.427Z'), to)).to.eq('3h 4m 13s')
        expect(elapsed(new Date('2018-03-14T23:00:00.000Z'), to)).to.eq('671d 13h 57m 14s')
    })
})

describe('signer.sign', function () {
    it('fails to sign an empty data', function () {
        expect(() => signer.sign('')).to.throw(/Invalid data/)
    })

    it('signs the data', function () {
        const data = new Date().toJSON(),
            signature = signer.sign(data, 'utf8', 'base64')
        expect(signature.length).to.equal(88)
        expect(verifySignature(signer.getPublicKey(), data, signature, 'utf8', 'base64')).to.be.true
    })
})

describe('subscriptionMatchHelper.matches', function () {
    const testAccount = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234'

    it('matches when operation.account equals subscription.account', function () {
        const subscription = { account: testAccount }
        const operation = { account: testAccount, type_i: 1 }
        expect(matches(subscription, operation)).to.be.true
    })

    it('matches when operation.destination equals subscription.account', function () {
        const subscription = { account: testAccount }
        const operation = { account: 'GOTHER', destination: testAccount, type_i: 1 }
        expect(matches(subscription, operation)).to.be.true
    })

    it('does not match when account and destination differ from subscription', function () {
        const subscription = { account: testAccount }
        const operation = { account: 'GOTHER', destination: 'GANOTHER', type_i: 1 }
        expect(matches(subscription, operation)).to.be.false
    })

    it('matches manage_data when value (string) equals subscription.account', function () {
        const subscription = { account: testAccount }
        const operation = { account: 'GOTHER', type_i: 10, value: testAccount }
        expect(matches(subscription, operation)).to.be.true
    })

    it('matches manage_data when value (Buffer) equals subscription.account', function () {
        const subscription = { account: testAccount }
        const operation = { account: 'GOTHER', type_i: 10, value: Buffer.from(testAccount, 'utf8') }
        expect(matches(subscription, operation)).to.be.true
    })

    it('does not match manage_data when value differs from subscription.account', function () {
        const subscription = { account: testAccount }
        const operation = { account: 'GOTHER', type_i: 10, value: 'some_other_value' }
        expect(matches(subscription, operation)).to.be.false
    })

    it('does not match manage_data without value when account/destination differ', function () {
        const subscription = { account: testAccount }
        const operation = { account: 'GOTHER', type_i: 10, name: 'test_key' }
        expect(matches(subscription, operation)).to.be.false
    })

    it('matches when no account filter in subscription', function () {
        const subscription = {}
        const operation = { account: 'GANY', type_i: 1 }
        expect(matches(subscription, operation)).to.be.true
    })

    it('filters by operation_types', function () {
        const subscription = { operation_types: [1, 2] }
        expect(matches(subscription, { type_i: 1 })).to.be.true
        expect(matches(subscription, { type_i: 3 })).to.be.false
    })

    it('filters by memo', function () {
        const subscription = { memo: '12345' }
        expect(matches(subscription, { memo: '12345' })).to.be.true
        expect(matches(subscription, { memo: 12345 })).to.be.true // type casting
        expect(matches(subscription, { memo: '99999' })).to.be.false
    })

    describe('path_payment trades matching', function () {
        const sellerAccount = 'GAKKEOZP54PTYUX2UV3DC6NSFVKFXIINXUUGDLDKFFLSQC6QHIKY74IC'

        it('matches path_payment when trades contain subscription.account as seller_id', function () {
            const subscription = { account: sellerAccount }
            const operation = {
                account: 'GSOURCE123',
                destination: 'GDEST456',
                type_i: 13, // path_payment_strict_send
                trades: [
                    {
                        type: 'order_book',
                        seller_id: 'GOTHER111',
                        offer_id: '123',
                        amount_sold: '1000',
                        amount_bought: '500'
                    },
                    {
                        type: 'order_book',
                        seller_id: sellerAccount,
                        offer_id: '456',
                        amount_sold: '500',
                        amount_bought: '250'
                    }
                ]
            }
            expect(matches(subscription, operation)).to.be.true
        })

        it('does not match path_payment when trades do not contain subscription.account', function () {
            const subscription = { account: sellerAccount }
            const operation = {
                account: 'GSOURCE123',
                destination: 'GDEST456',
                type_i: 13,
                trades: [
                    {
                        type: 'order_book',
                        seller_id: 'GOTHER111',
                        offer_id: '123',
                        amount_sold: '1000',
                        amount_bought: '500'
                    }
                ]
            }
            expect(matches(subscription, operation)).to.be.false
        })

        it('does not match path_payment with empty trades array', function () {
            const subscription = { account: sellerAccount }
            const operation = {
                account: 'GSOURCE123',
                destination: 'GDEST456',
                type_i: 13,
                trades: []
            }
            expect(matches(subscription, operation)).to.be.false
        })

        it('matches path_payment_strict_receive with seller in trades', function () {
            const subscription = { account: sellerAccount }
            const operation = {
                account: 'GSOURCE123',
                destination: 'GDEST456',
                type_i: 2, // path_payment_strict_receive
                trades: [
                    {
                        type: 'order_book',
                        seller_id: sellerAccount,
                        offer_id: '789',
                        amount_sold: '2000',
                        amount_bought: '1000'
                    }
                ]
            }
            expect(matches(subscription, operation)).to.be.true
        })

        it('still matches when subscription.account is source or destination', function () {
            const subscription = { account: sellerAccount }
            const operation = {
                account: sellerAccount,
                destination: 'GDEST456',
                type_i: 13,
                trades: []
            }
            expect(matches(subscription, operation)).to.be.true
        })

        it('ignores liquidity_pool trades (no seller_id)', function () {
            const subscription = { account: sellerAccount }
            const operation = {
                account: 'GSOURCE123',
                destination: 'GDEST456',
                type_i: 13,
                trades: [
                    {
                        type: 'liquidity_pool',
                        pool_id: '5c27abcd',
                        amount_sold: '1000',
                        amount_bought: '500'
                    }
                ]
            }
            expect(matches(subscription, operation)).to.be.false
        })
    })
})
