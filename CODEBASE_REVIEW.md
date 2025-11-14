# GPTHost Builder Staging — Codebase Review (MVP)

Date: 2025-08-20
Reviewer: Codex CLI

## Overview

This repository is a Cloudflare Workers API backend for an MVP that orchestrates uploads, simulated builds, and R2 deployments. The codebase is organized and testable, but not production-ready due to security concerns, simulation-only build paths, and some configuration/operational risks.

## Strengths

- Modular structure: clear separation of routes, middleware, and utils.
- Consistent response helpers: `utils/responses.ts` with unified CORS and JSON shape.
- Input safety: comprehensive `utils/inputSanitization.ts` and request content-type checks.
- Infra config: `wrangler.jsonc` binds R2 + Queues with sensible defaults, observability on.
- Tests: Vitest Workers pool with R2/queue simulation and isolation.
- Explicit README warning that build steps are simulated, not real CI.

## Critical Issues (Blockers)

- Secrets committed to repo
  - Files: `.dev.vars`, `.dev.vars.spare` contain live-looking credentials and tokens (e.g., GitHub PAT, Cloudflare API token, R2 access keys, account ID, etc.).
  - Action: Immediately rotate all exposed secrets; remove/replace with `.dev.vars.example` and secret management via `wrangler secret` / CI vault.

- Unauthenticated privileged endpoints
  - `GET /test-r2` (src/routes/test.ts) writes to both R2 buckets without auth (also listed as public in `isPublicRoute`).
  - `POST /api/projects/:projectId/manual-deploy` (src/routes/manualDeploy.ts) explicitly bypasses auth.
  - `POST /api/emergency/deploy/:projectId` (src/routes/directDeploy.ts) allowed as public in `isPublicRoute`.
  - Risk: Any caller can write/overwrite R2 data or deploy files. Must be removed or protected with strict auth/RBAC.

- CORS wildcard in production paths
  - All API responses include `Access-Control-Allow-Origin: *`.
  - Action: Restrict to trusted origins per environment. Avoid `*` on authenticated endpoints.

- GitHub callback authentication accepts multiple tokens
  - `POST /api/github/build-callback` accepts a dedicated callback token OR the GitHub token OR the MVP token.
  - Action: Use only a dedicated callback token (least privilege). Do not accept PAT/MVP token here.

## High/Medium Risks

- Hard-coded service URLs
  - `manualDeploy.ts` and `directDeploy.ts` embed worker URLs; use env vars instead.

- Debugging endpoints
  - `GET /api/debug/r2-structure` enumerates bucket keys (currently behind auth) — disable or admin-gate for production.

- Dependency bloat
  - `playwright` and `puppeteer` are declared but unused in `src/`/tests; remove if not actually required.

- Logging
  - Authentication logs include token length and short prefixes. Consider scrubbing token details entirely.

## MVP Quality

- Router (`src/routes/router.ts`) is explicit and readable. Dynamic matching handled carefully.
- Middleware `auth.ts` and `authUtils.ts` provide a decent baseline with constant-time compare.
- Validation exists for selected endpoints; broader schema validation (e.g., Zod) would tighten contracts.
- Build system is explicitly simulation-only (per README); real builds intended through GitHub Actions bridge.

## Redundancies / Cleanups

- Remove test routes and references in router for production:
  - `/test-r2`, `/message`, `/random`.
- Remove temporary/public bypasses in `isPublicRoute` for manual/emergency deploy.
- Replace hard-coded known build paths in `directDeploy.ts` with metadata-driven discovery.
- Consolidate repeated content-type maps and cache-control logic if used in multiple files.

## Production Readiness Checklist

- Secrets & Config
  - Rotate all exposed secrets from `.dev.vars*` immediately.
  - Remove secret files from repo; keep `.dev.vars.example` only.
  - Add secret scanning to CI (e.g., gitleaks) and pre-commit.
  - Move all service URLs (worker base, callback URLs) to env vars.

- AuthN/AuthZ
  - Require auth for all mutating endpoints; remove/public exceptions in `isPublicRoute`.
  - Lock down GitHub callback to a single, dedicated callback token.
  - Consider simple RBAC or admin token for debug/maintenance endpoints.

- Network & CORS
  - Restrict `Access-Control-Allow-Origin` to known origins by environment.
  - Consider rate-limiting and abuse protections for POST/DELETE routes.

- Validation & Safety
  - Apply schema validation (Zod/Yup) to all POST bodies; reuse `requestValidation` and `inputSanitization`.
  - Ensure logs never include secrets or token characteristics.

- Dependencies & Tooling
  - Remove `playwright`/`puppeteer` if not used.
  - Keep Wrangler up-to-date; pin critical versions as needed.
  - CI: typecheck, lint, test, and secret scan on every PR.

- Observability
  - Maintain structured logging; add request IDs; log auth failures without sensitive data.
  - Collect build/deploy metrics (latency, error rates) via Workers Logs/Analytics.

## Notable Files

- Auth: `src/middleware/auth.ts`, `src/utils/authUtils.ts`
- Risky routes: `src/routes/test.ts`, `src/routes/manualDeploy.ts`, `src/routes/directDeploy.ts`
- Config: `wrangler.jsonc`, `.dev.vars*` (secrets present), `.gitignore`
- Security helpers: `src/middleware/requestValidation.ts`, `src/utils/inputSanitization.ts`
- README clearly notes simulation-only build system.

## Items Referenced but Missing

- The repository mention suggested checking `CLAUDE.md` and `.claude/steering` in the root, but these files are not present in this workspace.

## Recommended Next Actions

1) Rotate/remove secrets and purge them from git history; add gitleaks to CI.
2) Remove or protect test/manual/emergency deploy endpoints with strict auth; delete public route exceptions.
3) Lock GitHub callback to a dedicated callback token.
4) Tighten CORS by environment and restrict to trusted origins.
5) Replace hard-coded URLs/paths with environment variables.
6) Remove unused dependencies; add CI gates (typecheck, tests, secret scan).
7) Expand request schema validation across all POST routes.

---

If desired, I can follow up with targeted PRs that:
- Remove or gate high-risk routes and public exceptions.
- Externalize URLs into `wrangler.jsonc` vars and update usages.
- Trim unused dependencies and add a `.dev.vars.example` template.
- Add a gitleaks config and a minimal GitHub Action for secret scanning.

