0.11.0 / 2026-11-26
==================

* Server pools with automatic failover for Horizon (`horizonPool` / `HORIZON_POOL`) and
  Soroban RPC (`sorobanRpcPool` / `SOROBAN_RPC_POOL`): 429 skips the server until its rate
  limit resets, 5xx/network/timeout fail over after `failoverRetries` attempts, 404 for a
  freshly closed ledger is treated as a lagging server and retried on the next one.
  Down servers are probed in the background and the pool returns to the preferred server
  automatically. Horizon REST requests now go through a `fetch` client with a hard timeout
  (`failoverRequestTimeoutMs`) instead of the SDK call builders.
* Ledger stream follows the active server (restarted on every switch with a 15 s grace
  period); a server that stops ingesting is detected by the stall check
  (`horizonStallSeconds`, including the cold start) and comparing its ledger height with the peers.
* When the whole pool is unavailable or rate limited, a ledger is retried (up to 10 times,
  waiting for the rate-limit reset) instead of being dropped; the catch-up cursor is dropped
  only when Horizon rejects the cursor itself (400 with a problem+json detail), never on
  temporary failures.
* `/health` reports the active servers, `/api/status` reports pool state, admin UI gets a
  "Проверить пул" button backed by `GET /api/status/pool-check` (admin token).

0.10.0 / 2026-11-25
==================

* Upgrade `@stellar/stellar-sdk` to `17.4.0` (Protocol 30 / "Bell"): the bundled XDR
  now knows muxed contract addresses (CAP-84), ML-DSA cost types (CAP-87) and
  millisecond close times (CAP-88). With the previous 16.3.0 any transaction carrying
  a `W…` address in `invoke_host_function` arguments failed to decode with
  `XDR Read Error: unknown ScAddressType member for value 5` and the **whole
  transaction was silently dropped**.
* `invoke_host_function` args: muxed contract addresses are decoded as `W…` strkeys
  (muxed accounts as `M…`). SAC `transfer` events to `W…` carry the multiplexing id
  in `data.to_muxed_id` (previously the whole `args` array became `null`).
* Fix: `revoke_sponsorship` operations were never normalized (the SDK exposes seven
  distinct operation types) and were dropped as "unsupported". All seven are now
  normalized to `revoke_sponsorship` with a `revoke_type` discriminator.
* Fix: `extend_footprint_ttl` operations were never normalized (the SDK type string is
  `extendFootprintTtl`) and were dropped as "unsupported".
* Fix: `set_options.signer_key` was always `undefined` (the SDK exposes the signer as
  `{weight, ed25519PublicKey | sha256Hash | preAuthTx | ed25519SignedPayload}`).
* `create_claimable_balance.claimants` are normalized to a stable shape:
  `{destination, predicate}` where `predicate` is `"unconditional"` or
  `{and|or|not|before_absolute_time|before_relative_time}` (previously raw SDK
  private fields leaked into the payload).
* Requires Node.js >= 22.12 (stellar-sdk v17 CommonJS build relies on `require(esm)`).

0.9.3 / 2026-09-10
==================

* Upgrade `@stellar/stellar-sdk` to `16.3.0` to support new Protocol 22/23 Soroban authorization credentials XDR types (`sorobanCredentialsAddressV2`, etc.).

0.9.2 / 2026-09-10
==================

* Fix operation type for `manageBuyOffer` (`manage_buy_offer` instead of `manage_sell_offer`).
* Update response examples and result XDR parsing for `manage_buy_offer`.

0.9.1 / 2026-06-09
==================

* Fix `source_amount` for multi-fill `path_payment_strict_receive` operations.
* Document source amount calculation for path payment webhook payloads.

0.9.0 / 2026-04-15
==================

* Add Soroban contract subscription filter — `contract` (C...) field on
  subscriptions matches `invokeHostFunction` operations by target contract.
* Decode `host_function_type`, `contract`, `function_name` and `args` from
  the transaction envelope for all `invoke_host_function` operations.
* Fetch Soroban transaction meta via Soroban RPC (new `sorobanRpcUrl` config)
  and attach decoded `events` + `return_value` to matching notifications.
* Webhook payload serializes Soroban i128/u128/i64/u64 values as decimal
  strings (JSON bigint-safe) and buffers as base64.
* Admin UI: contract input in subscription form and contract badge on cards.

0.8.0 / 2026-03-21
==================

* Add watcher self-recovery after temporary Horizon failures.
* Add strict `/health` endpoint for external restart automation.
* Add Docker Compose container healthcheck based on `/health`.
* Add watcher health thresholds via config and environment variables.

0.7.0 / 2026-02-17
==================

* Add bulk subscription creation — POST /api/subscription accepts an array.
* Batch insert via single DB operation (insertMany for MongoDB).
* Hash-based O(1) deduplication for subscriptions.
* Increase request body limit to 2MB (~10000 subscriptions per request).

0.6.1 / 2026-01-27
==================

* Add asset_sold and asset_bought to path_payment trades.
* Convert text memo and manage_data value to UTF-8 strings.
* Update operation_types validation to use dynamic values from Stellar SDK.
* Add RESPONSE_EXAMPLES.md with notification payload examples.

0.6.0 / 2026-01-25
==================

* Added web-based admin interface for subscription management and monitoring.
* Added admin UI configuration (`adminUiEnabled` / `ADMIN_UI_ENABLED`).
* Enhanced server initialization to serve static files.
* Implemented auto-detection of server address in admin UI.
* Updated documentation with admin UI usage information.

0.5.4 / 2026-01-25
==================

* Restore ledger-based streaming with limited worker concurrency.
* Add rate-limit backoff logging and ledger lag logs.
* Add ledger worker config (`LEDGER_WORKERS`) and document it.
* Add `lastLedger` to status output.

0.5.3 / 2026-01-25
==================

* Add lost-notification handling with auto-drop and auto-disable thresholds.
* Add status metric for lost notifications.
* Allow HTTP Horizon in local/test environments via config flag.
* Add network passphrase configuration and nonce lookup endpoint.
* Add token auth mode, user token allowlist, and subscription delete ownership checks.
* Add Docker image version metadata and bump package version.

0.4.4 /2020-03-17
=================

* Implementing graceful exit.

0.4.3 / 2020-03-17
==================

* Adding fee_charged and max_fee fields to the stream procesor.

0.4.2 / 2020-02-16
==================

* Fixed test cases.
* Code cleanup - simple func for displaying elapsed time instead of 3 bundled modules.
* Code cleanup - redundant modules cleanup.
* Code cleanup - redundant promises removed.

0.4.1 / 2020-02-16
==================

* Updated live stream listening routine to address Horizon throttling.

0.4.0 / 2020-02-16
==================

* Handlers for new operations: PathPaymentStrictReceive, ManageBuyOffer. 
* Dependencies updated to the latest versions.
