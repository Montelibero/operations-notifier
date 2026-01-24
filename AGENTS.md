# Repository Guidelines

## Project Structure & Module Organization
- `app.js` is the entry point; it loads config via `models/config.js` and wires storage, observer, and API.
- `api/` contains Express route handlers and server setup (e.g., `observer-routes.js`).
- `logic/` holds core services: observer, notifier, stream processor, and Stellar connectors.
- `persistence-layer/` implements storage providers (MongoDB and in-memory).
- `models/` defines domain models and config objects.
- `util/` contains shared helpers (signing, URL encoding, asset utilities).
- `test/` contains Mocha tests and `test/app.config-test.json`.
- `Dockerfile` and `justfile` provide container workflows.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run dev` starts the service in development mode.
- `npm run start` starts the service in production mode.
- `npm test` runs Mocha tests (`test/**/*.js`) with `NODE_ENV=test`.
- `just build` builds the Docker image (requires `just` and Docker).
- `just run` runs the Docker container on port `4021`.

## Coding Style & Naming Conventions
- Node.js 20+, CommonJS modules (`require`/`module.exports`).
- 4-space indentation and no semicolons, matching existing files.
- Test files follow `*.test.js` naming.
- No formatter/linter configured; keep changes consistent with nearby code.

## Testing Guidelines
- Test stack: Mocha + Chai (+ Sinon in dev deps).
- Place new tests in `test/` and name them `something.test.js`.
- Use `test/test-helper.js` for shared setup when adding new suites.
- No explicit coverage target—add tests for new behavior and bug fixes.

## Commit & Pull Request Guidelines
- Commit messages typically follow a conventional style with optional emoji and scope, e.g.  
  `🔧 observer(logic/observer.js): add logs for subscription creation` or `fix: refactor watcher`.
- Keep commits focused; update README when API/config behavior changes.
- PRs should include a clear summary, testing notes (`npm test`), and any config or migration steps.

## Configuration & Security Tips
- Primary config lives in `app.config.json`; most settings can be overridden via env vars.
- Set `SIGNATURE_SECRET` and `ADMIN_AUTHENTICATION_TOKEN` via env for production; do not commit secrets.
- For durable delivery, use MongoDB via `STORAGE_PROVIDER=mongodb` and `STORAGE_CONNECTION_STRING=...`.
