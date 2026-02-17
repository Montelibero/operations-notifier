const { isValidAsset, parseAsset } = require('../util/asset-helper')
const { elapsed } = require('../util/elapsed-time')
const { verifySignature, signer } = require('../util/signer')
const { matches } = require('../util/subscription-match-helper')
const SubscriptionIndex = require('../util/subscription-index')

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

describe('SubscriptionIndex', function () {
    const ACCOUNT_A = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234'
    const ACCOUNT_B = 'GAKKEOZP54PTYUX2UV3DC6NSFVKFXIINXUUGDLDKFFLSQC6QHIKY74IC'
    const ACCOUNT_C = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEBD9AFZQ7TM4JRS9A'
    const ISSUER = 'GAG36IX3EZ34PG4TYY5OJIIDACHXOFVQ6IZUWLMJNKJYY2B7DYZJWEJV'

    it('indexes subscriptions by account', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_A }
        index.add(sub)

        const operation = { account: ACCOUNT_A, type_i: 1 }
        const result = index.findMatches(operation)
        expect(result).to.have.lengthOf(1)
        expect(result[0]).to.equal(sub)
    })

    it('matches by destination', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_A }
        index.add(sub)

        const operation = { account: 'GOTHER', destination: ACCOUNT_A, type_i: 1 }
        const result = index.findMatches(operation)
        expect(result).to.have.lengthOf(1)
        expect(result[0]).to.equal(sub)
    })

    it('matches by trades seller_id', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_B }
        index.add(sub)

        const operation = {
            account: 'GSOURCE',
            destination: 'GDEST',
            type_i: 13,
            trades: [{ seller_id: ACCOUNT_B }]
        }
        const result = index.findMatches(operation)
        expect(result).to.have.lengthOf(1)
    })

    it('matches by manage_data value', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_A }
        index.add(sub)

        const operation = { account: 'GOTHER', type_i: 10, value: ACCOUNT_A }
        const result = index.findMatches(operation)
        expect(result).to.have.lengthOf(1)
    })

    it('matches by manage_data value (Buffer)', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_A }
        index.add(sub)

        const operation = { account: 'GOTHER', type_i: 10, value: Buffer.from(ACCOUNT_A, 'utf8') }
        const result = index.findMatches(operation)
        expect(result).to.have.lengthOf(1)
    })

    it('always includes catch-all subscriptions (no account filter)', function () {
        const index = new SubscriptionIndex()
        const catchAllSub = { id: '1' }
        const accountSub = { id: '2', account: ACCOUNT_A }
        index.add(catchAllSub)
        index.add(accountSub)

        // Operation for ACCOUNT_A should match both
        const op1 = { account: ACCOUNT_A, type_i: 1 }
        expect(index.findMatches(op1)).to.have.lengthOf(2)

        // Operation for unrelated account should match only catch-all
        const op2 = { account: 'GUNRELATED', type_i: 1 }
        expect(index.findMatches(op2)).to.have.lengthOf(1)
        expect(index.findMatches(op2)[0]).to.equal(catchAllSub)
    })

    it('does not return unrelated subscriptions', function () {
        const index = new SubscriptionIndex()
        index.add({ id: '1', account: ACCOUNT_A })
        index.add({ id: '2', account: ACCOUNT_B })

        const operation = { account: ACCOUNT_A, type_i: 1 }
        const result = index.findMatches(operation)
        expect(result).to.have.lengthOf(1)
        expect(result[0].account).to.equal(ACCOUNT_A)
    })

    it('remove() keeps index in sync', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_A }
        index.add(sub)
        expect(index.findMatches({ account: ACCOUNT_A, type_i: 1 })).to.have.lengthOf(1)

        index.remove(sub)
        expect(index.findMatches({ account: ACCOUNT_A, type_i: 1 })).to.have.lengthOf(0)
    })

    it('remove() cleans up empty Map entries', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_A }
        index.add(sub)
        expect(index.accountIndex.has(ACCOUNT_A)).to.be.true

        index.remove(sub)
        expect(index.accountIndex.has(ACCOUNT_A)).to.be.false
    })

    it('remove() works for catch-all subscriptions', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1' }
        index.add(sub)
        expect(index.catchAll.size).to.equal(1)

        index.remove(sub)
        expect(index.catchAll.size).to.equal(0)
    })

    it('buildFrom() replaces previous index', function () {
        const index = new SubscriptionIndex()
        index.add({ id: 'old', account: ACCOUNT_A })

        index.buildFrom([
            { id: 'new1', account: ACCOUNT_B },
            { id: 'new2' }
        ])

        expect(index.findMatches({ account: ACCOUNT_A, type_i: 1 })).to.have.lengthOf(1) // only catch-all
        expect(index.findMatches({ account: ACCOUNT_B, type_i: 1 })).to.have.lengthOf(2) // account + catch-all
    })

    it('caches _cachedAsset on subscriptions with asset_type', function () {
        const index = new SubscriptionIndex()
        const sub = {
            id: '1',
            account: ACCOUNT_A,
            asset_type: 1,
            asset_code: 'USD',
            asset_issuer: ISSUER
        }
        expect(sub._cachedAsset).to.be.undefined

        index.add(sub)
        expect(sub._cachedAsset).to.not.be.undefined
        expect(sub._cachedAsset.asset_code).to.equal('USD')
        expect(sub._cachedAsset.asset_type).to.equal(1)
    })

    it('does not cache asset for subscriptions without asset_type', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_A }
        index.add(sub)
        expect(sub._cachedAsset).to.be.undefined
    })

    it('does not duplicate subscriptions when operation matches via multiple paths', function () {
        const index = new SubscriptionIndex()
        const sub = { id: '1', account: ACCOUNT_A }
        index.add(sub)

        // Operation where account AND destination both equal ACCOUNT_A
        const operation = { account: ACCOUNT_A, destination: ACCOUNT_A, type_i: 1 }
        const result = index.findMatches(operation)
        expect(result).to.have.lengthOf(1)
    })

    it('handles many subscriptions efficiently', function () {
        const index = new SubscriptionIndex()
        // Add 1000 subscriptions with unique accounts
        for (let i = 0; i < 1000; i++) {
            index.add({ id: String(i), account: `GACCOUNT${String(i).padStart(48, '0')}` })
        }
        // Add the target subscription
        const target = { id: 'target', account: ACCOUNT_A }
        index.add(target)

        const operation = { account: ACCOUNT_A, type_i: 1 }
        const result = index.findMatches(operation)
        expect(result).to.have.lengthOf(1)
        expect(result[0]).to.equal(target)
    })
})
