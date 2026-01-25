# Stellar Operations Notifier

A standalone service that tracks Stellar Network operations and streams
notifications to the subscribers. The notifications are delivered as
JSON-encoded HTTP POST requests. 
    
### Highlights

- Highly configurable.
- Supports operations filtering by account, asset, transaction memo, and 
operation type. 
- Guaranteed delivery with persistent storage, even if the notification recipient
or the Notifier itself is down for some time.
- Supports public and private Stellar networks.
- Can be used as a shared microservice that streams events to multiple endpoints.
- Predictable performance – tested with thousands of subscriptions.
- Reliable tracking and consistency (tracking is resumed from the same
transaction after restart).
- Does not require Stellar Core or Horizon node deployment.
- Notifications are signed with an ED25519 secret key to protect the recipient
from spoofing.

### So... Where can I use it?

- **Payment processing**.\
Never miss a payment, even if a user decided to pay one week later, or you have
some troubles with your server.
- **Anchors and ICOs**.\
Implement complex scenarios for your assets and track all user accounts. Track
all operations involving your asset to gather statistics or calculate dividends.
- **Trading platforms**.\
Observe trading activity, aggregate market data, gather statistics, build
market-making applications.
- **Monitoring tools**.\
Keep an eye on specific accounts or your favorite assets. Without pooling and
other inefficient techniques.
- **Inflation pools**.\
Subscribe to inflation operation and distribute rewards when the subscription
was triggered.
- And more...  

## System requirements

#### Stellar Horizon server

Notifier relies on an event stream from Horizon server, so you'll need to choose
a public Horizon service
(like https://horizon.stellar.org and https://horizon-testnet.stellar.org/), or
your own hosted Horizon instance. The latter option is preferable for production
setups. Nevertheless, public Horizon instances supported by SDF and other
community members work just fine as well.

#### NodeJS 20+

The service requires NodeJS 20 or later.

#### (Optional) MongoDB 3.2+ or other storage provider

For the production deployment all notification queues are stored in the database.

MongoDB was selected as the most convenient option in terms of fast read/writes
alongside with minimum memory/IO overhead. 

#### Supported platforms

Linux, Windows, MacOS.  
Effectively any other platforms where you can run NodeJS and MongoDB.

#### Docker

Docker image by [@sgehrman](https://github.com/sgehrman) can be found
[here](https://github.com/StellarKit/stellar-notifier-docker).

## Installation

1\. Clone the repository.

```
git clone https://github.com/stellar-expert/operations-notifier
```

2\. Install required NPM packages.

```
cd operations-notifier
npm i
```

3\. (For production deployments)
Ensure that MongoDB is running. 
Download it [here](https://www.mongodb.com/download-center?jmp=nav#community)
in case if it has not been installed yet.

4\. Set configuration parameters in `app.config.json` (see
[Configuration](#configuration) section).

5\. Start the service.

```
npm run start
```

## Configuration

All configuration parameters are located in `app.config.json` file.
The server also supports setting parameters using environment variables.
By default the server loads settings from `app.config.json` file, and
overwrites specific parameter if the corresponding environment variable found. 

- **storageProvider**\
Storage provider for persistence layer (see details in
[Storage providers](#storage-providers) section).\
Default value: `"memory"`\
Env parameter: `STORAGE_PROVIDER`
- **storageConnectionString**\
Connection string for storage provider.\
Default value: `""`\
Env parameter: `STORAGE_CONNECTION_STRING`
- **apiPort**\
API exposed by the notifier.\
Default value: `4021`\
Env parameter: `API_PORT`
- **apiHost**\
API bind host (useful for tests or restricted environments).\
Default value: `""` (bind all interfaces).\
Env parameter: `API_HOST`
- **horizon**\
Horizon server URL.\
Default value: `"https://horizon.stellar.org"`.\
Env parameter: `HORIZON`
- **networkPassphrase**\
Stellar network passphrase used to parse transaction XDR.\
Default value: `"Public Global Stellar Network ; September 2015"`.\
Env parameter: `NETWORK_PASSPHRASE`
- **horizonAllowHttp**\
Allow insecure HTTP Horizon URLs (use for local mocks).\
Default value: `false`.\
Env parameter: `HORIZON_ALLOW_HTTP`
- **reactionResponseTimeout**\
Maximum expected HTTP response timeout (in seconds). 
If the reaction URL takes more time to respond, the request is aborted and
notification is marked as failed.\
Default value: `20`.\
Env parameter: `REACTION_RESPONSE_TIMEOUT`
- **authorization**\
Server authorization mode.\
`disabled` mode turns off the authentication (recommended for local installations).\
Any other value enables ed25519 authentication (see
[API Authentication](#authentication)).\
Default value: `"disabled"`.\
Env parameter: `AUTHORIZATION`
- **adminAuthenticationToken**\
API authentication token for admin user. Leave empty to disable admin token auth.\
Default Value: `""`.\
Env parameter: `ADMIN_AUTHENTICATION_TOKEN`
- **userTokens**\
List of allowed user tokens for `authorization: "token"` mode. If empty, any
token is accepted.\
Default value: `[]`.\
Env parameter: `USER_TOKENS` (comma-separated)
- **signatureSecret**\
Secret key used to sign the notifications. Do not forget to set your own secret. 
It can be easily generated using [Stellar Laboratory](https://www.stellar.org/laboratory/#account-creator?network=test). 
Do not use the default value or a secret key from the funded account.\
Default value: `""`.\
Env parameter: `SIGNATURE_SECRET`
- **maxActiveSubscriptions**\
Maximum simultaneously tracked subscriptions.\
Default value: `10000`.\
Env parameter: `MAX_ACTIVE_SUBSCRIPTIONS`
- **maxActiveSubscriptionsPerUser**\
Maximum simultaneously tracked subscriptions per user.\
Default value: `100`.\
Env parameter: `MAX_ACTIVE_SUBSCRIPTIONS_PER_USER`
- **notificationConcurrency**\
Maximum concurrent notification threads (effectively, it equals the maximum
parallel pending HTTP requests).\
Default value: `100`.\
Env parameter: `NOTIFICATION_CONCURRENCY`
- **maxDeliveryFailures**\
Maximum consecutive delivery failures for a subscription before the current
notification is dropped as lost.\
Default value: `100`.\
Env parameter: `MAX_DELIVERY_FAILURES`
- **maxNotificationAgeSeconds**\
Maximum age (in seconds) of a notification before it is dropped as lost.\
Default value: `604800` (7 days).\
Env parameter: `MAX_NOTIFICATION_AGE_SECONDS`
- **maxConsecutiveLostNotifications**\
Maximum consecutive lost notifications for a subscription before it is
automatically removed.\
Default value: `10`.\
Env parameter: `MAX_CONSECUTIVE_LOST_NOTIFICATIONS`

Lost notifications are dropped when they exceed the max age or max consecutive
delivery failures. The lost counter resets to 0 after a successful delivery.

#### Storage providers

Notifier can store notification queues and operational information in the
database or in memory. The latter option is suited only for testing or
deployments without guaranteed delivery.

There are two built-in storage providers: `mongodb` and `memory`.
Other storage providers can be easily connected through the standard interface.

#### Config example:

```
{
  "authorization": "disabled",
  "storageProvider": "mongodb",
  "storageConnectionString": "mongodb://127.0.0.1:27017/notifier",
  "apiPort": 4021,
  "apiHost": "",
  "horizon": "https://horizon.stellar.org",
  "networkPassphrase": "Public Global Stellar Network ; September 2015",
  "horizonAllowHttp": false,
  "signatureSecret": "SDBT736EJIIRDC3RSN544NO6OSNMZAWAKRARLOMRP2XJAOGKTQLFFR3V",
  "maxActiveSubscriptions": 10000,
  "maxActiveSubscriptionsPerUser": 100,
  "notificationConcurrency": 100,
  "maxDeliveryFailures": 100,
  "maxNotificationAgeSeconds": 604800,
  "maxConsecutiveLostNotifications": 10,
  "reactionResponseTimeout": 20,
  "userTokens": [],
  "adminAuthenticationToken": "98c12910bf35c79a800e9ea893a93b078ea92fc7a26ca76c0cd2f6003464d781"
}
```

#### Local HTTP Horizon (tests/mocks)

If you run a local Horizon mock over HTTP (e.g., `http://127.0.0.1:1234`), set:

- `horizonAllowHttp: true` in `app.config.json`, or
- `HORIZON_ALLOW_HTTP=true` in the environment.

## API

### Authentication

With `authorization` config parameter set to `disabled`, there is no need to
bother about authentication. But it only works when the service is not exposed
to public networks (i.e. behind the firewall).

Authentication modes:

- `authorization: "disabled"` — no auth checks (local/dev only).
- `authorization: "ed25519"` or any truthy value except `"token"` — ed25519 signatures with nonce.
- `authorization: "token"` — simple per-user token auth (no nonce/signatures).

**ed25519 mode**

All requests must include `Authorization: ed25519 <public_key>.<signature>` (or
`X-Access-Token`). The signature is computed over urlencoded request params
serialized in hex format. All requests must include a `nonce` param that is
greater than the previously used nonce for this public key.

**token mode**

All requests must include `Authorization: <user_token>` (or `X-Access-Token`).
The token identifies the user; changing the token gives you a new empty account.

To restrict tokens, set `userTokens` (or `USER_TOKENS=token1,token2,token3`).

Admin requests can use `Authorization: <ADMIN_AUTHENTICATION_TOKEN>` in any mode.

### Status

- `GET /api/status` — lightweight health/info endpoint. Returns JSON with:
  - `version` — service version.
  - `uptime` — human-readable uptime.
  - `publicKey` — signer public key.
  - `observing` — whether the observer is running.
  - `subscriptions` — active subscription count.
  - `lostNotifications` — sum of consecutive lost notifications across active subscriptions.
  - `lastIngestedTx` — paging token of the last processed transaction.
  - `stream` — stream status (last ledger, last tx hash/paging token, queue length, reconnect delay).
  - `notifier` — notifier status (in-flight notifications).

#### Status response schema

```
{
  "version": "0.4.3",
  "uptime": "3h 10m 42s",
  "publicKey": "G...SIGNER...",
  "observing": true,
  "subscriptions": 123,
  "lostNotifications": 0,
  "lastIngestedTx": "1234567890",
  "stream": {
    "streaming": true,
    "lastLedger": 123456,
    "lastTxPagingToken": "1234567890",
    "lastTxHash": "abcdef...",
    "queueLength": 0,
    "processing": false,
    "reconnectDelay": 1000
  },
  "notifier": {
    "inProgress": 1
  }
}
```

#### Nonce lookup (ed25519 mode)

```
GET /api/nonce
```

Returns the current nonce for the authenticated public key.
Sign the static payload `nonce:<public_key>` and send it as:

```
Authorization: ed25519 <public_key>.<signature>
```

Admin requests can query another user:

```
GET /api/nonce?pubkey=<public_key>
Authorization: <ADMIN_AUTHENTICATION_TOKEN>
```

##### Example

```
const {Keypair} = require('@stellar/stellar-sdk')

//encode path components
function encodeUriParams(object) {
    if (!object) return ''
    return Object.keys(object)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(object[k])}`)
        .join('&')
}

//GET request

const payload = encodeUriParams({ 
    nonce: Date.now(),
    foo: 'foo'
})

const keyPair = Keypair.fromSecret('private_key'),
    signature = keyPair.sign(payload).toString('hex')

const authHeader = `ed25519 ${keyPair.publicKey()}.${signature}`,
    requestUrl = `<protected_api_endpoint>?${payload}`

//set header and make request

...

//POST request

const body = {
    nonce: Date.now(),
    foo: 'foo'
}

const keyPair = Keypair.fromSecret('private_key'),
    signature = keyPair.sign(encodeUriParams(body)).toString('hex')

const authHeader = `ed25519 ${keyPair.publicKey()}.${signature}`

//set header, body and make request
```

### Create subscription

```
POST /api/subscription
```

**Parameters**:

- **reaction_url** [*string*] (mandatory) - a full URL that should be requested
by notification
- **account** [*string*] (optional) - an account address to track
- **memo** [*string*] (optional) - expected transaction memo
- **asset_code** [*string*] (optional) - asset code to track (specify XLM and no
issuer to track operations involving XLM)
- **asset_issuer** [*string*] (optional) - asset issuer to track
- **operation_types** [*Array\<Number\>*] (optional) - operation types to track (currently 0..10),
array or comma-separated string. You can find numbers at
https://developers.stellar.org/docs/data/analytics/hubble/data-catalog/data-dictionary/bronze/history-operations
- **expires** [*date/epoch*] (optional) - expiration date for subscription

Note: if authentication is enabled, include a `nonce` param in the request body
that is greater than the previous nonce used for this public key.

Note: at least one operation filtering criteria should be specified.

Response example:

```
{
  "id": "5ae88ef89a9e5d4a589cf27d",
  "pubkey": "GCFX...PUBLIC_KEY...",
  "status": 0,
  "delivery_failures": 0,
  "lost_notifications": 0,
  "sent": 8,
  "reaction_url": "http://localhost:4022/test/reaction",
  "operation_types": [
    0,
    1
  ],
  "created": "2018-05-01T15:59:52.475Z",
  "updated": "2018-05-01T16:01:19.742Z"
}
``` 

The `id` value from response can be used to delete the subscription.

### Remove subscription

```
DELETE /api/subscription/:subscription_id
```

The endpoint returns 200 in case of successful unsubscription, and an error code
otherwise.

**Parameters**:

- **subscription_id** [*string*] (mandatory) - the subscription id to remove

### Get all active user subscriptions

```
GET /api/subscription
```

Response example:

```
[
  {
    "id": "5ae88ef89a9e5d4a589cf27d",
    "pubkey": "GCFX...PUBLIC_KEY...",
    "status": 0,
    "delivery_failures": 0,
    "lost_notifications": 0,
    "sent": 8,
    "reaction_url": "http://localhost:4022/test/reaction",
    "operation_types": [
      0,
      1
    ],
    "created": "2018-05-01T15:59:52.475Z",
    "updated": "2018-05-01T16:01:19.742Z"
  },
  {
    "id": "5ae88f54397cbf2474ef27e1",
    "pubkey": "GCFX...PUBLIC_KEY...",
    "status": 0,
    "operation_types": [],
    "delivery_failures": 4,
    "lost_notifications": 0,
    "sent": 0,
    "reaction_url": "http://localhost:4022/test/reaction2",
    "asset_type": 0,
    "created": "2018-05-01T16:01:24.336Z",
    "updated": "2018-05-01T16:02:01.036Z"
  }
]
```

#### Subscription response fields

Each subscription object may include:

- `id` — subscription id
- `pubkey` — owner public key (null for admin-created anonymous subscriptions)
- `status` — 0 active, 1 deleted
- `reaction_url` — webhook URL
- `account` / `asset_*` / `memo` / `operation_types` — filter fields (optional)
- `delivery_failures` — consecutive delivery failures
- `lost_notifications` — consecutive lost notifications (resets on success)
- `sent` — delivered notifications count
- `created` / `updated` — timestamps

## Notifications Format

Notifications are sent as JSON-encoded POST requests with the following format:

```
{
  "id": "5ae88ef89a9e5d4a589cf27d-757838947790641a6",
  "subscription": "5ae88ef89a9e5d4a589cf29d",
  "type": "operation",
  "created": "2018-05-01T16:45:37.529Z",
  "sent": "2018-05-01T16:45:37.991Z",
  "operation": {
    "id": "7578389477906432555",
    "type_i": 1,
    "type": "payment",
    "destination": "GC3UA6FHLDD7IFG3MXA7JCNC2YPW62AKMKV5H2CEEBWCLUNJR3OFJSNV",
    "asset": {
      "asset_code": "ETH",
      "asset_issuer": "GCNSGHUCG5VMGLT5RIYYZSO7VQULQKAJ62QA33DBC5PPBSO57LFWVV6P",
      "asset_type": "1"
    },
    "amount": "0.0012",
    "account": "GCUZSLQYXDXSOXC4DURSK3AJNAQEBDSYVGYE7BC7IXGTS32MJBW35QOU"
  },
  "transaction": {
    "hash": "7580614b4703704496173f578092a0b6a56e5906d7ad5f83e529af14bab2cdd3",
    "fee": 600,
    "source": "GCUZSLQYXDXSOXC4DURSK3AJNAQEBDSYVGYE7BC7IXGTS32MJBW35QOU",
    "paging_token": "757838947790643264",
    "source_account_sequence": "7196037745321120376",
    "created_at": "2018-05-01T16:45:37Z",
    "memo": { 
      "type": "text", 
      "value": "105683157"
    }
  }
}
```

Request headers:

- `X-Request-ED25519-Signature` – the ED25519 signature for the notification body (base64).
- `X-Subscription` – corresponding subscription id.

## Testing

Run all tests with

```
npm run test
```
