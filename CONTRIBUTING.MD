# Contributing

## Release checklist

When bumping the version, update **all** of the following files:

| # | File | What to change |
|---|------|----------------|
| 1 | `package.json` | `"version"` field |
| 2 | `HISTORY.MD` | Add new entry at the top with version, date, and changes |
| 3 | `Dockerfile` | `SERVICE_VERSION` env and `org.opencontainers.image.version` label |
| 4 | `README.MD` | Version in the status response example |

### Versioning

We follow [SemVer](https://semver.org/):

- **patch** (0.7.x) — bug fixes, minor tweaks
- **minor** (0.x.0) — new features, backwards-compatible
- **major** (x.0.0) — breaking API changes

## Running tests

```
npm test
```

Note: 4 pre-existing test failures in `parseManageOfferResult` are known and unrelated to new changes.

## Project structure

```
api/              HTTP routes (Express)
logic/            Core business logic (observer, storage, notifier, watcher)
models/           Config, user roles
persistence-layer/  Storage providers (memory, mongodb)
public/           Admin UI (static HTML)
test/             Tests (Mocha + Chai)
util/             Helpers (logger, signer, asset parsing)
```

## Git conventions

- Main branch: `master`
- Remote `mtl` — Montelibero fork, `origin` — stellar-expert upstream
