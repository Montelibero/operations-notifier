# Gemini Context: Stellar Operations Notifier

## Project Overview
This project is a standalone **Stellar Operations Notifier** service. It tracks operations on the Stellar Network and streams notifications to subscribers via JSON-encoded HTTP POST requests. It acts as a bridge between the Stellar blockchain (via Horizon) and external applications that need to react to on-chain events.

**Key Features:**
*   **Filtering:** Supports filtering by account, asset, transaction memo, and operation type.
*   **Reliability:** Guaranteed delivery with retry logic and state persistence (resumes from last known transaction).
*   **Storage:** Supports MongoDB for persistence and in-memory storage for testing/ephemeral use.
*   **Security:** Signs notifications with an ED25519 secret key and supports API authentication.

## Architecture & Tech Stack

*   **Runtime:** Node.js (>=20)
*   **Framework:** Express.js (API)
*   **Database:** MongoDB (via Mongoose) or In-Memory
*   **Stellar Integration:** `@stellar/stellar-sdk` for interacting with Horizon.
*   **Test Framework:** Mocha + Chai + Sinon

### Directory Structure
*   `app.js`: Application entry point. Wires up config, storage, observer, and API.
*   `api/`: Express route handlers (`observer-routes.js`, `user-routes.js`) and server initialization.
*   `logic/`: Core business logic:
    *   `observer.js`: Orchestrates tracking.
    *   `notifier.js`: Handles sending HTTP notifications to subscribers.
    *   `stream-processor.js`: Processes the Stellar transaction stream.
    *   `stellar-connector.js`: Manages connection to Horizon.
*   `persistence-layer/`: Storage provider implementations (`mongodb-storage-provider`, `memory-storage-provider`).
*   `models/`: Domain models and schemas.
*   `util/`: Helper utilities (signing, asset parsing, error handling).
*   `test/`: Unit and integration tests.

## Development Workflow

### Prerequisites
*   Node.js v20+
*   MongoDB (optional, for persistence)
*   Docker (optional, for containerization)

### Key Commands

**Setup & Installation:**
```bash
npm install
```

**Running the Application:**
*   **Development:** `npm run dev` (sets `NODE_ENV=development`)
*   **Production:** `npm run start` (sets `NODE_ENV=production`)

**Testing:**
*   **Run Tests:** `npm test` (Runs Mocha tests in `test/` with `NODE_ENV=test`)

**Docker (via `just`):**
*   **Build Image:** `just build`
*   **Run Container:** `just run` (Exposes port 4021)

### Configuration
Configuration is managed via `app.config.json` and can be overridden by environment variables.
*   **File:** `app.config.json`
*   **Key Env Vars:**
    *   `STORAGE_PROVIDER`: `memory` or `mongodb`
    *   `STORAGE_CONNECTION_STRING`: Connection string for MongoDB.
    *   `HORIZON`: Stellar Horizon URL (default: `https://horizon.stellar.org`)
    *   `SIGNATURE_SECRET`: Secret key for signing notifications.
    *   `ADMIN_AUTHENTICATION_TOKEN`: Token for admin API access.

## Coding Conventions
*   **Style:** Standard Node.js CommonJS (`require`).
*   **Formatting:** 4-space indentation, no semicolons.
*   **Testing:** New features should include tests in `test/`. Use `test/test-helper.js` for setup.
*   **Logging:** Minimal logging in production; use descriptive logs in logic modules.
