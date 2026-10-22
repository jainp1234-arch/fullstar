# FullStar security checklist (OWASP Top 10:2021)

Plan 9.2. Reviewed 22 Oct 2026 against `main` plus step 9.2. Each line names the control and the test or
CI job that proves it. Review again before phase G and at every new endpoint, job or third-party service.

Legend: **Done** = in place and tested. **Phase G** = needs the go-live setup (domain, TLS, Cloudflare).

## A01 Broken access control

- [x] **Done.** Deny by default. Only `/api/v1/family/**` (Keycloak `family-api` audience), `/api/v1/studio/**` (`studio-api`), `GET /api/v1/public/**` and Actuator health are routed; everything else is 401/403 (`SecurityConfig`; `TokenValidationTest`, `StaffGuardTest`).
- [x] **Done.** Row-level security is forced on every table; the API connects as `app_api` with the family set per transaction, and only job results run as `app_system` (V10; `RowLevelSecurityTest`, `RlsSessionTest`).
- [x] **Done.** Parent mode needs the short-lived HS256 parent grant from the PIN (`X-Parent-Grant`); kid mode needs a child of the signed-in family (`X-Child-Id`) (`FamilyGuards`; `FamilyAccountTest`, `SetupFlowTest`).
- [x] **Done.** Staff roles (`content_admin`, `super_admin`) are checked per Studio endpoint (`StaffGuard`; `StaffGuardTest`, `StaffManagementTest`).
- [x] **Done.** Another family's ids answer 404, never 403, so ids cannot be probed (`BookManagementTest`, `ChildrenManagementTest`, `SupportRoundTripTest`).
- [x] **Done.** CORS allow-list: browsers may call the API only from `CORS_ALLOWED_ORIGINS` (exact origins, no wildcard, no credentials) (`CorsConfig`; `CorsTest`).
- [x] **Done.** Files are reached only through 10-minute signed URLs under the family's own key prefix; workers read only their job's keys (`StorageKeysTest`, `FileStorageTest`).

## A02 Cryptographic failures

- [x] **Done.** PINs are bcrypt hashes; parent grants are HMAC-signed with a 32+ character secret from `.env`.
- [x] **Done.** No secrets in the repository: `.env` is git-ignored and gitleaks runs on every PR (`security.yml`). The voice model token reaches the image build only as a BuildKit secret.
- [x] **Done.** Database connections use `sslmode=require` (Neon).
- [x] **Done.** The API sends HSTS (1 year, subdomains); browsers apply it once it is served over HTTPS.
- [ ] **Phase G.** TLS everywhere: Cloudflare Pages for the apps, Caddy with automatic certificates for `api.` and `auth.`. No plain-HTTP origin is exposed.

## A03 Injection

- [x] **Done.** SQL goes only through `JdbcTemplate` with `?` parameters. The SQL strings that are built from pieces join only constants in the code (column lists, fixed filters), never request data.
- [x] **Done.** Every request body has Bean Validation; content bodies are also checked against JSON Schemas (`ContentFormatsTest`, `ContentApiTest`).
- [x] **Done.** Cross-site scripting: Angular escapes every binding; no `innerHTML` or `bypassSecurityTrust*` is used; the apps' CSP has a fresh nonce per response and no `unsafe-inline` or `unsafe-eval` (`infra/caddy/security-headers.caddy`; `e2e/csp-headers.spec.ts` in the zap workflow).
- [x] **Done.** Worksheet PDFs: every text from content is HTML-escaped before Gotenberg renders it (`WorksheetHtml`; `WorksheetTest`).
- [x] **Done.** Claude prompts take content as data inside fixed templates; the model's output is parsed as JSON and validated before use (`DraftWithClaudeTest`, `ContentCheckAgentTest`).

## A04 Insecure design

- [x] **Done.** Per-family rate limits from Schema §10: PIN verify 5/min, uploads 20/hour, worksheet create 30/hour, sync 60/min, support 10/day, each answering 429 `RATE_LIMITED` with `Retry-After` (`@RateLimited`; `RateLimitsTest`, `FamilyAccountTest`). Before Plan 9.2 only the PIN limit was enforced.
- [x] **Done.** Reading tests: 2 a day per child, enforced by a trigger (`READING_LIMIT`; `ReadingTest`).
- [x] **Done.** PIN lockout after repeated wrong PINs (`FamilyAccountTest`).
- [x] **Done.** Writes that may be retried carry `Idempotency-Key`; jobs carry idempotency keys and are applied once (`IdempotencyTest`, `JobFlowTest`).
- [x] **Done.** Uploads: type checked by content, size and page limits, ClamAV scan before any processing (`BookUploadTest`, `UploadScanResultTest`, `RealToolsImageTest`).

## A05 Security misconfiguration

- [x] **Done.** Apps: CSP (nonce), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera and microphone for this site only), COOP and CORP same-origin, no `Server` header. API: CSP `default-src 'none'`, the same frame, type and referrer headers (`CorsTest`).
- [x] **Done.** OWASP ZAP 2.17.0 baseline on every PR against the built apps and the API: no medium or high alert (`zap.yml`).
- [x] **Done.** Errors never return stack traces or internal messages (`ErrorMappingTest`).
- [x] **Done.** Actuator: health and Prometheus metrics only, on the management port bound to 127.0.0.1, which Caddy never proxies (`MetricsTest`). Swagger only with the local profile.
- [x] **Done.** Local services bind to 127.0.0.1 only; Grafana has its own admin password and no sign-up.
- [ ] **Phase G.** The apps on Cloudflare Pages need the same headers; the nonce comes from a small Pages Function (the static `_headers` file cannot make one). Set `CORS_ALLOWED_ORIGINS` to the two app origins.

## A06 Vulnerable and outdated components

- [x] **Done.** Exact versions everywhere (Maven, npm, pip, Docker tags, GitHub Actions by commit), each released at least 14 days before use (Tech Stack §1).
- [x] **Done.** `npm audit` on every PR (`security.yml`); Dependabot alerts on the repository.
- [ ] **Open (dev tool only).** `tools/vendor-assets` pins Pillow 12.3.0, which has 9 Dependabot alerts (1 critical). The fix, Pillow 13.0.0, was released 16 Oct 2026 and passes the 14-day rule on 30 Oct 2026; it is on the Tech Stack upgrade watch list. The tool is run by hand to download assets and is never shipped or run by the services.

## A07 Identification and authentication failures

- [x] **Done.** Sign-in is Keycloak with an emailed one-time code (no passwords to steal); access tokens are checked for RS256 signature, issuer, expiry and audience (`TokenValidationTest`).
- [x] **Done.** The parent PIN gates parent mode on a shared device; it is rate-limited and locks after repeated failures.
- [x] **Done.** Staff accounts are created by a super admin only (`StaffManagementTest`, `SuperAdminBootstrapTest`).

## A08 Software and data integrity failures

- [x] **Done.** CI actions pinned by full commit SHA; images pinned by exact tag; pip installs of GitHub sources pinned to commits.
- [x] **Done.** Worker results are checked before they are applied: the file key must belong to the job's own record and every id must exist (for example `LessonNarrateResultHandler`; `LessonNarrationTest`, `BookProcessResultTest`).
- [x] **Done.** A job that fails 3 times goes to its dead-letter queue and raises the DLQ alert (Plan 9.1).

## A09 Security logging and monitoring failures

- [x] **Done.** Structured JSON logs with a request id; no names, phone numbers, recordings or book text are logged (Tech Stack §10).
- [x] **Done.** Logs in Loki; metrics in Prometheus; alerts for API down, any DLQ above 0, error rate over 2% and disk over 80% (Plan 9.1; `monitoring.yml`, `make alert-check`).
- [x] **Done.** Studio drafts, content checks and publishing are written to `audit_log`.

## A10 Server-side request forgery

- [x] **Done.** The API and workers call only configured endpoints (Claude, R2/SeaweedFS, SQS/ElasticMQ, Gotenberg, Keycloak admin). No endpoint fetches a URL given by a user.
- [x] **Done.** Gotenberg gets self-contained HTML (escaped text, the font file sent with it), so a worksheet cannot make it fetch anything.
