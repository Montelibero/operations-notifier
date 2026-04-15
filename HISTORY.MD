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
