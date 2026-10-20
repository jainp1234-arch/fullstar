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

## Working on a step

Each step in `docs/06-implementation-plan.html` is done on a branch `step/<id>-<short-name>` and merged into `main` by squash merge through a pull request using the template.

## Next step

Ask Claude Code: "Do step 0.4 of docs/06-implementation-plan.html."
