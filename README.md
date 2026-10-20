# FullStar

Lessons from your own school book. A home-learning app for children in Class 1–5 (launch: Class 3, CBSE) that turns a child's school books into animated lessons, practice, reading tests and printable worksheets, in Hindi and English.

## Documents (`docs/`)

| File | Document | Online version |
|---|---|---|
| `00-prompts.md` | Original prompts used to create the documents | — |
| `01-prd.html` | PRD v1.2 | https://claude.ai/artifact/Eufj7w6VJNMBmt7UW5yS8N |
| `02-app-flow.html` | App Flow v1 | https://claude.ai/artifact/GYXx8tVcAXWSSFuNEzq1u8 |
| `03-tech-stack.html` | Tech Stack v2.0 (locked versions) | https://claude.ai/artifact/75PVCeJRTdXqbQCnae9Qxe |
| `04-content-guidelines.html` | Content Guidelines v1.0 (design system) | https://claude.ai/artifact/1HocH6w2Sff3jjJGYkFVyW |
| `05-backend-schema.html` | Backend Schema v1.0 | https://claude.ai/artifact/HmAP2rkZ1sgnGxkk2JYNkY |
| `06-implementation-plan.html` | Implementation Plan v1.0 | https://claude.ai/artifact/CRKs75dtXB3u1e3WkJd6YD |
| `design/mock-screens/` | Mock screens K1, K3, P1 (design canvas source) | https://claude.ai/artifact/4gVprgrurjqzw99LygUUDV |

The online versions are private to you until shared. Diagrams show as source text in the local files; open the online version to see them drawn.

## Repository layout

```
apps/            Angular 22 apps: family-app (PWA), content-studio
libs/ui/         shared UI library, imported as @fullstar/ui
services/        Spring Boot 4.1.1: api, book-reader
workers/         Python 3.12: reading-checker, voice-maker
infra/           Keycloak email-otp SPI; docker compose from step 0.5
e2e/             Playwright end-to-end tests
docs/            product and technical documents (source of truth)
CLAUDE.md        instructions for Claude Code
```

## Requirements

- Node.js 24.21.0 (`.nvmrc`), Java 21 (Temurin 21.0.12.1), Docker with Compose v5, GNU Make
- Maven is not needed: use `./mvnw` (Maven Wrapper, pinned to Maven 3.9.16)
- Python 3.12 is optional: without it, `make` runs the workers in `python:3.12.15-slim` (Docker must be running)
- First time: `npm ci` and `npx playwright install chromium`
- Copy `.env.example` to `.env` and fill in values locally. Never commit `.env`.

## Commands

| Command | What it does |
|---|---|
| `make up` / `make down` | start / stop local services (docker compose) |
| `make test` | all tests |
| `make lint` | all linters |
| `make api` / `make family` / `make studio` | run one app locally |

`make lint` and `make test` skip parts of the repository that do not exist yet.

## Run locally

1. Start Docker Desktop. Copy `.env.example` to `.env` and set at least `KEYCLOAK_ADMIN_USERNAME`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_DB_PASSWORD` and `GRAFANA_ADMIN_PASSWORD` (long random values).
2. `make up`: builds the Keycloak image (with `email-otp`), starts every service from `infra/docker-compose.yml` and waits until all are healthy (limit 3 minutes; the first start downloads the ClamAV signatures).
3. In separate terminals, as needed: `make family`, `make studio`, `make api` (reads `.env`, local profile; API docs at http://localhost:8081/swagger-ui.html, never through Caddy).
4. Open http://localhost:8080. Studio: /studio/. Keycloak admin: /auth/admin/. Grafana: http://localhost:3001 (user `admin`).
5. `make down` stops everything. Data stays in named Docker volumes; `docker compose -f infra/docker-compose.yml down -v` deletes it.

| Service | Address |
|---|---|
| Caddy (app, Studio, API, Keycloak) | http://localhost:8080 |
| SeaweedFS S3 / ElasticMQ SQS | http://localhost:8333 / http://localhost:9324 (UI :9325) |
| Gotenberg / ClamAV | http://localhost:3000 / localhost:3310 |
| Grafana / Prometheus / Alloy | http://localhost:3001 / :9090 / :12345 |

All ports bind to 127.0.0.1. Alloy reads container logs through the Docker socket, so run this stack only on your own laptop.

## Database (Neon, trial)

1. Put the Neon owner connection string in `.env` as `NEON_OWNER_URL` (Neon Console → Connect, dev branch).
2. `make db-bootstrap`: creates the roles `app_owner`, `app_api` and `app_system` with new random passwords and writes the `DB_*` settings into `.env`. Passwords are never printed. Re-running it rotates the passwords.
3. `make db-migrate`: runs Flyway V1–V11 (`services/api/src/main/resources/db/migration`) as `app_owner` over the direct connection.

Database tests (`make test`) use a throwaway PostgreSQL 18.6 container (Testcontainers), prepared the same way.

## CI

GitHub Actions in `.github/workflows/`. Path filters run only the parts a change touches:

| Workflow | Runs |
|---|---|
| `frontend` | npm ci, lint, format check, unit tests, build, Playwright |
| `backend` | `mvn verify` for api, book-reader, email-otp |
| `python` | Ruff and pytest for the workers |
| `docker` | build every image for linux/amd64 and linux/arm64 (no push) |
| `security` | gitleaks over the full git history and `npm audit --audit-level=high` (every PR, push and weekly) |

Dependabot (`.github/dependabot.yml`) proposes weekly updates, only for releases at least 14 days old.

## Working on a step

Each step in `docs/06-implementation-plan.html` is done on a branch `step/<id>-<short-name>` and merged into `main` by squash merge through a pull request using the template.

## Next step

Ask Claude Code: "Do step 1.4 of docs/06-implementation-plan.html."
