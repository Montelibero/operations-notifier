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
- Web-based admin interface for subscription management and system monitoring.

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

#### NodeJS 22.12+

The service requires NodeJS 22.12 or later (the CommonJS build of
`@stellar/stellar-sdk` v17 depends on `require(esm)`, available from Node 22.12).

#### (Optional) MongoDB 3.2+ or other storage provider

For the production deployment all notification queues are stored in the database.

MongoDB was selected as the most convenient option in terms of fast read/writes
alongside with minimum memory/IO overhead. 

#### Supported platforms

Linux, Windows, MacOS.  
Effectively any other platforms where you can run NodeJS and MongoDB.

#### Docker

This repository includes `Dockerfile` and `docker-compose.yml`.

Build and run locally:

```
docker build -t stellar_notifier:latest .
docker compose up -d
```

The bundled `docker-compose.yml` includes a container healthcheck against
`GET /health`. If ingestion stalls while the HTTP process is still alive, the
container becomes `unhealthy`, so an external watchdog can restart it.

## Installation

1\. Clone the repository.

```
git clone https://github.com/Montelibero/operations-notifier
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
- **horizonPool**\
List of Horizon server URLs for failover, the first one is preferred (see
[Server pools and failover](#server-pools-and-failover)). When empty, the pool
consists of the single `horizon` URL.\
Default value: `[]`.\
Env parameter: `HORIZON_POOL` (comma-separated)
- **sorobanRpcPool**\
List of Soroban RPC server URLs for failover, the first one is preferred. When
empty, the pool consists of the single `sorobanRpcUrl` (or nothing if it is empty).\
Default value: `[]`.\
Env parameter: `SOROBAN_RPC_POOL` (comma-separated)
- **failoverRetries**\
Attempts on the same server for temporary failures (5xx, network errors,
timeouts) before the server is marked down and the next one is used.\
Default value: `2`.\
Env parameter: `FAILOVER_RETRIES`
- **failoverRetryDelayMs**\
Delay between those attempts.\
Default value: `400`.\
Env parameter: `FAILOVER_RETRY_DELAY_MS`
- **failoverRequestTimeoutMs**\
Hard timeout for a single Horizon / Soroban RPC request.\
Default value: `15000`.\
Env parameter: `FAILOVER_REQUEST_TIMEOUT_MS`
- **failoverCooldownSeconds**\
How long a failed server stays out of rotation (unless the background probe
brings it back earlier).\
Default value: `120`.\
Env parameter: `FAILOVER_COOLDOWN_SECONDS`
- **failoverProbeIntervalSeconds**\
Interval of the recovery probe — it runs only while some server is down and
targets only the down servers.\
Default value: `60`.\
Env parameter: `FAILOVER_PROBE_INTERVAL_SECONDS`
- **failoverProbeSuccesses**\
Consecutive successful probes needed to consider a server recovered.\
Default value: `2`.\
Env parameter: `FAILOVER_PROBE_SUCCESSES`
- **horizonStallSeconds**\
Silence of the ledger stream after which another pool server is asked for its
latest ledger to detect a stuck Horizon (see below).\
Default value: `20`.\
Env parameter: `HORIZON_STALL_SECONDS`
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
- **ledgerWorkers**\
Maximum number of parallel ledger fetch workers for transaction ingestion.\
Default value: `10`.\
Env parameter: `LEDGER_WORKERS`
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
- **resetCursor**\
When set to `true`, ignores the saved cursor on startup and begins from the
live stream (current ledger). The cursor continues to be saved normally.
Useful for skipping large backlogs after extended downtime.\
Default value: `false`.\
Env parameter: `RESET_CURSOR`
- **healthMaxNoSuccessSeconds**\
Maximum allowed time without a successful Horizon fetch before `/health`
reports the service as unhealthy.\
Default value: `120`.\
Env parameter: `HEALTH_MAX_NO_SUCCESS_SECONDS`
- **healthMaxNoLedgerSeconds**\
Maximum allowed time without seeing a new ledger before `/health`
reports the service as unhealthy.\
Default value: `180`.\
Env parameter: `HEALTH_MAX_NO_LEDGER_SECONDS`
- **healthMaxNoProgressSeconds**\
Maximum allowed time without processing ledger progress before `/health`
reports the service as unhealthy.\
Default value: `180`.\
Env parameter: `HEALTH_MAX_NO_PROGRESS_SECONDS`
- **healthStartupGraceSeconds**\
Startup grace period before strict health checks are enforced. Useful to avoid
false negatives during initial catch-up.\
Default value: `120`.\
Env parameter: `HEALTH_STARTUP_GRACE_SECONDS`

- **logLevel**\
Log verbosity level (DEBUG, INFO, WARN, ERROR).\
Default value: `"INFO"`.\
Env parameter: `LOG_LEVEL`

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
  "ledgerWorkers": 10,
  "maxDeliveryFailures": 100,
  "maxNotificationAgeSeconds": 604800,
  "maxConsecutiveLostNotifications": 10,
  "reactionResponseTimeout": 20,
  "healthMaxNoSuccessSeconds": 120,
  "healthMaxNoLedgerSeconds": 180,
  "healthMaxNoProgressSeconds": 180,
  "healthStartupGraceSeconds": 120,
  "userTokens": [],
  "adminAuthenticationToken": "98c12910bf35c79a800e9ea893a93b078ea92fc7a26ca76c0cd2f6003464d781"
}
```

#### Local HTTP Horizon (tests/mocks)

If you run a local Horizon mock over HTTP (e.g., `http://127.0.0.1:1234`), set:

- `horizonAllowHttp: true` in `app.config.json`, or
- `HORIZON_ALLOW_HTTP=true` in the environment.

#### Server pools and failover

Several identical Horizon servers (and several Soroban RPC servers) can be
configured as a pool. The first URL is preferred; the service switches between
them automatically:

| Event | Action |
|---|---|
| `429` | fail over immediately; the server is skipped until `Retry-After` / `X-RateLimit-Reset` (or the cooldown) |
| `5xx`, network error, timeout | `failoverRetries` attempts on the same server, then it is marked down and the next server is used |
| `404` for a ledger that just closed | the server is behind: the request is repeated on the next server, the server itself is not marked down |
| other `4xx` | the request is wrong — no failover, the error is handled as before |
| every server failed | the watcher recovery backoff (1 → 60 s) as before, servers are probed in the background |

When a failed server is marked down, the pool starts probing it (and only the
down servers) every `failoverProbeIntervalSeconds`; after
`failoverProbeSuccesses` successful probes the server is back and the pool
switches to the preferred server automatically. As a safety net a down server
becomes eligible again after `failoverCooldownSeconds` even without a probe.

The ledger stream (SSE) follows the active server: on every switch the stream
is restarted on the new server (with a 15 s grace period against flapping).
When no ledger arrives for `horizonStallSeconds`, the stall check asks both the
streaming server (over REST) and a peer server for their latest ledgers:

- the server is 2+ ledgers behind its peer → it stopped ingesting: marked down,
  the stream moves to the next server;
- the server does not answer REST either → marked down, the stream moves on;
- the server has ingested ledgers the stream never delivered → the SSE
  connection is stuck: the stream is restarted on the same server;
- nothing new anywhere → the network is slow, nothing is switched.

If the whole pool is unavailable or rate limited while a ledger is being
loaded, the ledger is retried (up to 10 times, waiting for the rate-limit
reset) instead of being dropped; the catch-up cursor is dropped only when
Horizon rejects the cursor itself, never on temporary failures.

Pool state is exposed in `GET /health` (`servers`), in `GET /api/status`
(`stream.horizon`, `stream.sorobanRpc`) and in the admin UI ("Проверить пул"
button runs an on-demand check of every server: latest ledger, lag, response
time) via `GET /api/status/pool-check` (admin token required).

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
  - `stream.horizon`, `stream.sorobanRpc` — pool status: active server and per-server
    counters/state (see [Server pools and failover](#server-pools-and-failover)).
  - `stream.skippedTransactions`, `stream.lastSkippedTransaction` — transactions that could
    not be parsed (unknown XDR, malformed envelope) and were skipped: count and the last one.
  - `notifier` — notifier status (in-flight notifications).
- `GET /api/status/pool-check` — admin only: on-demand check of every Horizon and
  Soroban RPC server (latest ledger, lag, response time, error).

### Healthcheck

- `GET /health` — strict liveness/readiness endpoint for container orchestration
  and external watchdogs.
- Returns `200` with `{"status":"ok"}` when the API is up and transaction
  ingestion is making progress. The response also carries `servers` with the
  currently active Horizon / Soroban RPC server URLs.
- Returns `503` with `{"status":"unhealthy","reason":"watcher_stalled"}` when
  the watcher is no longer ingesting data, even if the HTTP process itself is
  still running.
- Health evaluation uses `healthMaxNoSuccessSeconds`,
  `healthMaxNoLedgerSeconds`, `healthMaxNoProgressSeconds`, and
  `healthStartupGraceSeconds`.

#### Status response schema

```
{
  "version": "0.9.1",
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
    "reconnectDelay": 1000,
    "horizon": {
      "active": "https://horizon.example.com",
      "lastSwitchAt": null,
      "servers": [
        {"url": "https://horizon.example.com", "active": true, "state": "ok", "requests": 1234, "failures": 0}
      ]
    },
    "sorobanRpc": null
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
    signature = Buffer.from(keyPair.sign(Buffer.from(payload))).toString('hex')

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
    signature = Buffer.from(keyPair.sign(Buffer.from(encodeUriParams(body)))).toString('hex')

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
- **contract** [*string*] (optional) - a Soroban contract address (`C...`) to
track. Matches `invokeHostFunction` operations whose target contract equals
this address. Combined with other filters by AND.
- **memo** [*string*] (optional) - expected transaction memo
- **asset_code** [*string*] (optional) - asset code to track (specify XLM and no
issuer to track operations involving XLM)
- **asset_issuer** [*string*] (optional) - asset issuer to track
- **operation_types** [*Array\<Number\>*] (optional) - operation types to track (currently 0..26),
array or comma-separated string. You can find numbers at
https://developers.stellar.org/docs/data/analytics/hubble/data-catalog/data-dictionary/bronze/history-operations
- **filter_version** [*number*] (optional) - version of the matching rules, `2` for new
subscriptions by default, `1` keeps the original rules (see [Matching rules](#matching-rules))
- **expires** [*date/epoch*] (optional) - expiration date for subscription

Note: several filters in one subscription are combined with AND (all of them must hold).

<a id="matching-rules"></a>

#### Matching rules

Subscriptions created before v0.12.0 (no `filter_version`) keep the original
rules (`1`); new subscriptions get `2` by default:

| Rule | v1 | v2 |
|---|---|---|
| **account** matches the operation source account (or the transaction source) | ✓ | ✓ |
| … the destination of `create_account`, `payment`, `account_merge` | ✓ | ✓ |
| … the destination of `path_payment_*` (always the base `G…` account, even if paid to an `M…` address) | – | ✓ |
| … the `from` of `clawback`, `trustor` of `set_trustline_flags`, `sponsoredId` of `begin_sponsoring_future_reserves`, claimants of `create_claimable_balance` | – | ✓ |
| … the `seller_id` of an order book fill in `trades` (the account's offer was filled by someone else's transaction, including passive offers) | ✓ | ✓ |
| … the value of a `manage_data` entry that equals the account | ✓ | ✓ |
| **asset** matches `asset` or `source_asset` of the operation | ✓ | ✓ |
| … the intermediate assets in `path` and the `asset_sold`/`asset_bought` of `trades` | – | ✓ |
| … the asset pair of a liquidity pool: `assets` on `liquidity_pool_deposit`/`liquidity_pool_withdraw` and on a pool share trustline, `pool_assets` on pool trades | – | ✓ |
| an **XLM** asset subscription (`asset_code: XLM`) really filters by XLM | catch-all (any operation) | ✓ |
| **memo** matches the transaction memo value (hash/return memos may be given as hex) | never matched (such subscriptions need to be recreated as v2) | ✓ |
| **contract**, **operation_types** | ✓ | ✓ |

Addresses in the webhook payload follow the Horizon convention: `destination`,
`account`, `from` (clawback) are always the base `G…` account; muxed addresses also
carry `<field>_muxed` (`M…`) and `<field>_muxed_id` (`destination_muxed`,
`account_muxed`, `from_muxed`, `source_muxed` of the transaction).

#### Liquidity pools

A transaction envelope carries only the pool id for deposits, withdrawals and pool
trades, so the notifier keeps the pair of assets of every pool it has seen
(MongoDB collection `liquidity_pool`, in-memory cache; `pool_id → assets, fee`) and
attaches it to the operations before matching:

- `liquidity_pool_deposit` / `liquidity_pool_withdraw` / pool share trustline →
  `assets: [...]`, `fee`;
- `trades[]` of type `liquidity_pool` → `pool_assets: [...]`.

A pool share trustline (`change_trust` to a pool share, i.e. creating or joining a
pool) carries the pool parameters in the envelope itself — such pools are registered
for free. For any other unknown pool id the notifier makes a single
`GET /liquidity_pools/{id}` request (cached forever: the pair never changes), so after
the warm-up the number of extra requests is one per new pool on the network. When the
pool is not available yet, the operation is still delivered without `assets` and the
lookup is retried on the next sighting. A pool share is reported as
`{"asset_type": 3, "liquidity_pool_id": "..."}` (previously it was mistaken for XLM).

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

### Bulk create subscriptions

```
POST /api/subscription
```

The same endpoint accepts an array of subscription objects for batch creation.
All subscriptions are created in a single database operation, which is
significantly faster than creating them one by one.

**Important**: the request body must be a JSON **array at the root level**, not
an object with a nested array. Each element has the same parameters as single
creation above. Authorization is passed via the `Authorization` header as usual.

Request example:

```
POST /api/subscription
Authorization: <token>
Content-Type: application/json

[
  {
    "reaction_url": "http://example.com/webhook",
    "account": "GCFX...ACCOUNT1...",
    "operation_types": [0, 1]
  },
  {
    "reaction_url": "http://example.com/webhook",
    "account": "GDLV...ACCOUNT2...",
    "operation_types": [0, 1]
  },
  {
    "reaction_url": "http://example.com/webhook",
    "account": "GDUQ...ACCOUNT3...",
    "asset_code": "EURMTL",
    "asset_issuer": "GACKTN5DAZGWXRWB2WLM6OPBDHAMT6SJNGLJZPQMEZBUR4JUGBX2UK7V"
  }
]
```

Response: an array of created/existing subscription objects in the same order
as the request.

```
[
  {
    "id": "5ae88ef89a9e5d4a589cf27d",
    "pubkey": null,
    "status": 0,
    "reaction_url": "http://example.com/webhook",
    "account": "GCFX...ACCOUNT1...",
    "operation_types": [0, 1],
    "lost_notifications": 0
  },
  {
    "id": "5ae88f54397cbf2474ef27e1",
    "pubkey": null,
    "status": 0,
    "reaction_url": "http://example.com/webhook",
    "account": "GDLV...ACCOUNT2...",
    "operation_types": [0, 1],
    "lost_notifications": 0
  },
  {
    "id": "5ae89a12397cbf2474ef28b3",
    "pubkey": null,
    "status": 0,
    "reaction_url": "http://example.com/webhook",
    "account": "GDUQ...ACCOUNT3...",
    "asset_code": "EURMTL",
    "asset_issuer": "GACKTN5DAZGWXRWB2WLM6OPBDHAMT6SJNGLJZPQMEZBUR4JUGBX2UK7V",
    "lost_notifications": 0
  }
]
```

Limits and deduplication:
- Maximum request body size: 2MB (~10000 subscriptions per request).
- Duplicates within the batch are deduplicated automatically.
- Subscriptions that already exist are returned as-is (not recreated).
- Subscription limits (`maxActiveSubscriptions`, `maxActiveSubscriptionsPerUser`)
  are checked once for the entire batch.
- An empty array returns 400 Bad Request.

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

### Get recent delivery log

```
GET /api/delivery-log
```

Returns the last 50 webhook deliveries (stored in memory, resets on restart).
Admin users see all entries; regular users see only deliveries for their own subscriptions.

Response example:

```
[
  {
    "timestamp": "2026-02-06T20:44:09.955Z",
    "status": "ok",
    "subscriptionId": "698626823b066f0320172af7",
    "pubkey": "JHG675FD3wLJ76GH4dSKY",
    "reaction_url": "http://example.com/webhook",
    "notificationId": "698651fc0c95143647a0580c",
    "payload": {
      "id": "698651fc0c95143647a0580c",
      "subscription": "698626823b066f0320172af7",
      "type": "operation",
      "created": "2026-02-06T20:41:32.405Z",
      "sent": "2026-02-06T20:44:09.955Z",
      "operation": { "..." : "..." },
      "transaction": { "..." : "..." }
    }
  }
]
```

Error entries also include an `error` field (e.g. `"HTTP 500"`, `"ECONNREFUSED"`).

## Admin UI

The service includes a web-based admin interface for easy subscription management and system monitoring.

### Access the Admin UI

The admin UI is accessible at:
```
http://your-server:4021/admin
```

The admin interface will load without authentication, allowing you to enter your admin token in the web interface. Authentication to the API happens when you:

1. Enter your admin token in the settings panel
2. Save the configuration

Your token is stored securely in the browser's local storage for future sessions.

### Admin UI Features

- System status monitoring (uptime, subscriptions count, ledger status)
- Server pools: live pool state and an on-demand check of every Horizon / Soroban
  RPC server (latest ledger, lag, response time)
- Create, view and delete subscriptions
- Real-time API logs
- Automatic server address detection

### Admin UI Configuration

The admin UI is enabled by default. You can control it with the following configuration:

- `adminUiEnabled` in `app.config.json` (default: `true`)
- or `ADMIN_UI_ENABLED` environment variable

The admin interface uses the existing `adminAuthenticationToken` for access control.

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
    },
    "result_xdr": "AAAAAAAAAJQA...",
    "envelope_xdr": "AAAAAgAAAAB..."
  }
}
```

See [RESPONSE_EXAMPLES.md](RESPONSE_EXAMPLES.md) for examples of all operation types.

### Soroban contract invocations (operation type 24)

For `invoke_host_function` operations, the notifier decodes the host function
from the transaction envelope and attaches the following fields to
`operation`:

- **host_function_type** — one of `invoke_contract`, `create_contract`, `upload_wasm`.
- **contract** — Soroban contract address (`C...`) being invoked. Only set
  for `invoke_contract`.
- **function_name** — the contract method being called (e.g. `transfer`).
- **args** — array of arguments, decoded via `scValToNative`. `i128`/`u128`/
  `i64`/`u64` values are returned as decimal **strings** (JSON can't hold
  bigints). Buffers become base64 strings. Addresses are returned as strkeys:
  `G…` (account), `C…` (contract), `M…` (muxed account, CAP-67) and `W…`
  (muxed contract, Protocol 30 / CAP-84) — see [Muxed contract addresses](#muxed-contract-addresses-w-protocol-30).

If `sorobanRpcUrl` is configured, the notifier additionally fetches the
transaction meta from the Soroban RPC (Horizon does not expose it) **only
when at least one subscription matches the operation** and attaches:

- **events** — array of contract events emitted during the invocation. Each
  entry has `{contract, type, topics, data}`. Events are returned unfiltered
  (including those emitted by SAC contracts of tokens transferred inside the
  call) — filter by `event.contract` on the receiver side if needed.
- **return_value** — the decoded contract return value.

#### Muxed contract addresses (`W…`, Protocol 30)

Since Protocol 30 a Stellar Asset Contract `transfer` accepts a muxed
contract address as the destination: `W…` = a `C…` contract address plus a
64-bit multiplexing identifier (SEP-23). Tokens always land on the underlying
`C…` contract; the identifier is only routing metadata for off-chain systems
(exchanges, custodians). The notifier exposes it in two places:

- in `operation.args` — the `W…` strkey itself (`StrKey.decodeMuxedContract`
  in the SDK splits it back into the contract id and the muxed id);
- in `events` of the `transfer` — the Stellar Asset Contract puts the plain `C…`
  address in the topics and carries the identifier in `event.data.to_muxed_id` as
  a decimal string, exactly like `to_muxed_id` for muxed accounts. Other contracts
  may emit the `W…` address itself in `topics`/`data` — it is decoded to the `W…`
  strkey as-is.

Subscriptions keep matching by the plain `C…` contract address.

```json
{
  "operation": {
    "id": "266797664711667713",
    "type": "invoke_host_function",
    "type_i": 24,
    "host_function_type": "invoke_contract",
    "contract": "CAFXUALXFPTBTLSRCDSMJXNPSN3AVL2ZPXJUDDHVTUTLRX5SCNP2SISM",
    "function_name": "capture",
    "args": [
      "GBYH3M3REQM3WQOJY26FYORN23EXY22FWBHVZ74TT5GYOF22IIA7YSOX",
      "10",
      "Всё летит по плану!"
    ],
    "events": [
      {
        "type": "contract",
        "contract": "CDUYP3U6HGTOBUNQD2WTLWNMNADWMENROKZZIHGEVGKIU3ZUDF42CDOK",
        "topics": ["transfer", "GBYH...", "CAFXUALX...", "EURMTL:GACKTN5D..."],
        "data": "10"
      }
    ],
    "return_value": true
  }
}
```

Configure the RPC endpoint via `sorobanRpcUrl` in `app.config.json` or the
`SOROBAN_RPC_URL` environment variable. Default is
`https://mainnet.sorobanrpc.com`. Set it to an empty string to disable Soroban
meta decoding entirely — contract/function_name/args are still populated
since they come from the transaction envelope. Several RPC servers can be
listed in `sorobanRpcPool` / `SOROBAN_RPC_POOL` for failover with the same
rules as the Horizon pool.

Request headers:

- `X-Request-ED25519-Signature` – the ED25519 signature for the notification body (base64).
- `X-Subscription` – corresponding subscription id.

## Testing

Run all tests with

```
npm run test
```
