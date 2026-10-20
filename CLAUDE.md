# FullStar – instructions for Claude Code

## Source of truth (read the sections a step names; never contradict them)
docs/01-prd.html                PRD v1.2           – what the product does
docs/02-app-flow.html           App Flow v1        – every screen (IDs A*, B*, C*, K*, P*, S*)
docs/03-tech-stack.html         Tech Stack v2.0    – locked versions; no other dependencies
docs/04-content-guidelines.html Content Guidelines – tokens, components, shells, copy
docs/05-backend-schema.html     Backend Schema     – SQL, RLS, auth flows, endpoints, jobs
docs/06-implementation-plan.html This plan         – do one step per session

## Always
- Exact versions only (no ^ ~ latest). Docker tags pinned. Multi-arch images (amd64 + arm64).
- API: /api/v1, envelope { status, data, error }, error codes from Schema §10.
- Java 21, Spring Boot 4.1.1, constructor injection, custom exceptions, Bean Validation,
  SLF4J structured logs (no personal data), Resilience4j on every outside call.
- SQS jobs: idempotency key, DLQ, max 3 receives. Only the API touches the database.
- Angular 22: standalone components, reactive forms, signals, OnPush, no `any`,
  UI only from libs/ui, text only from libs/ui/strings/en.ts.
- Never commit secrets; update .env.example with new variable names.
- Stop and ask if a document is silent or two documents disagree.

## Commands
make up / make down        start / stop local services (docker compose)
make test                  all tests          make lint      all linters
make api / make family / make studio          run one app locally
