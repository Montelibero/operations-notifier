const sinon = require('sinon')
const Notifier = require('../logic/notifier')
const storage = require('../logic/storage')
const config = require('../models/config')

describe('Notifier lost notifications', function () {
    let notifier
    let observer
    let markStub
    let saveStub
    let originalConfig

    beforeEach(function () {
        observer = { observing: true, subscriptions: [] }
        notifier = new Notifier(observer)
        markStub = sinon.stub(storage, 'markAsProcessed').resolves()
        saveStub = sinon.stub(storage, 'saveSubscription').resolves()
        originalConfig = {
            maxNotificationAgeSeconds: config.maxNotificationAgeSeconds,
            maxDeliveryFailures: config.maxDeliveryFailures,
            maxConsecutiveLostNotifications: config.maxConsecutiveLostNotifications
        }
    })

    afterEach(function () {
        markStub.restore()
        saveStub.restore()
        Object.assign(config, originalConfig)
    })

    it('drops stale notification and increments lost_notifications', async function () {
        config.maxNotificationAgeSeconds = 1
        config.maxDeliveryFailures = 100
        config.maxConsecutiveLostNotifications = 10

        const subscription = {
            id: 's1',
            reaction_url: 'http://example.com',
            delivery_failures: 0,
            lost_notifications: 0,
            status: 0
        }
        observer.subscriptions.push(subscription)

        const notification = {
            id: 'n1',
            subscriptions: ['s1'],
            created: new Date(Date.now() - 2000)
        }

        await notifier.sendNotification(notification, subscription)

        expect(notification.subscriptions.length).to.equal(0)
        expect(subscription.lost_notifications).to.equal(1)
        expect(subscription.delivery_failures).to.equal(0)
        expect(subscription.status).to.equal(0)
    })

    it('disables subscription after consecutive lost notifications', async function () {
        config.maxNotificationAgeSeconds = 1
        config.maxConsecutiveLostNotifications = 2

        const subscription = {
            id: 's2',
            reaction_url: 'http://example.com',
            delivery_failures: 0,
            lost_notifications: 0,
            status: 0
        }
        observer.subscriptions.push(subscription)

        const notification1 = {
            id: 'n2',
            subscriptions: ['s2'],
            created: new Date(Date.now() - 2000)
        }
        const notification2 = {
            id: 'n3',
            subscriptions: ['s2'],
            created: new Date(Date.now() - 2000)
        }

        await notifier.sendNotification(notification1, subscription)
        expect(subscription.status).to.equal(0)

        await notifier.sendNotification(notification2, subscription)
        expect(subscription.status).to.equal(1)
        expect(observer.subscriptions.length).to.equal(0)
    })

    it('resets lost_notifications after successful delivery', async function () {
        const subscription = {
            id: 's3',
            reaction_url: 'http://example.com',
            delivery_failures: 2,
            lost_notifications: 3,
            sent: 0
        }
        const notification = {
            id: 'n4',
            subscriptions: ['s3']
        }

        await notifier.markAsProcessed(notification, subscription)

        expect(subscription.lost_notifications).to.equal(0)
    })
})
