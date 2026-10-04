# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OrderFlow API — Express 4 + PostgreSQL (`pg`, raw SQL, no ORM) order-management API with JWT auth and Stripe payments. Node 18+, CommonJS. This repo is the Week 3 capstone codebase; `CAPSTONE.md` is the full brief.

## Commands

- `npm test` — Jest (verbose); runs `tests/**/*.test.js`
- Single file: `npx jest tests/services/orderService.test.js`
- Single test by name: `npx jest -t "throws when a productId"`
- `npm run test:watch`, `npx jest --coverage` (coverage from `src/**`)
- `npm run dev` (nodemon) / `npm start` — server on `PORT` (default 3000), `GET /health`
- `npm run migrate` — runs every `migrations/*.sql` in filename order (no tracking table; SQL uses `IF NOT EXISTS`)
- `npm run seed` — sample data; all seed users use password `password123` (admin: `admin@orderflow.dev`)
- `npm run lint` — `eslint src/`; note there is currently no ESLint config file in the repo

Tests need no database or Stripe: they mock `src/config/database` and models with `jest.mock`. Env comes from `.env` (copy `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `STRIPE_SECRET_KEY`, `LOG_LEVEL`, `AUTH_AUDIT_LOG`.

## Architecture

Request flow: `src/index.js` (helmet, cors, json, morgan) → router → `authenticate(permission)` → handler → model/service → `db.query`. Errors go to `next(err)` and are rendered by `middleware/errorHandler.js` (`{ error, stack? }`, status from `err.status`). `index.js` exports `app` and only listens when run directly, so it can be used with Supertest.

- **Routers live in two places**: `src/routes/*` and `src/handlers/*` (payment, orderHistory) — both are Express routers mounted in `index.js`. `/api/orders/history` is mounted *before* `/api/orders` so it isn't captured by `/:id`.
- **Data access**: `src/config/database.js` exposes `query(text, params)` (logs queries >500ms) and `getClient()` for transactions (BEGIN/COMMIT/ROLLBACK + `release()` — see `Order.create`). Models (`src/models/*`) are plain modules of async functions returning rows; `Cart` is the exception — an in-memory class with no DB.
- **Auth/authz** (`src/middleware/auth.js`): `authenticate(perm?)` verifies the Bearer JWT, re-loads the user from the DB on every request (rejects missing/inactive), applies an in-memory per-user rate limit (100/min), sets `req.user = { id, email, name, role, customerTier }`, then checks `perm` against `ROLE_PERMISSIONS` (roles: admin, manager, customer, guest; perms like `orders:write`). `optionalAuth()` sets `req.user` if possible but never blocks. Ownership checks (customer may only see own orders) are done inline in route handlers, not in middleware. Auth errors return `{ error, message, code }` with `AUTH_*` codes; other routes return just `{ error }`.
- **Pricing**: `services/orderService.createOrder` validates stock, computes subtotal → `pricing/discountCalculator` (tier-based) → `utils/taxCalculator` (per US state, default 5%), inserts via `Order.create`, writes discount/tax/total via `Order.update` (which whitelists updatable columns), then decrements stock. Money is rounded to cents with `Math.round(x * 100) / 100`. Route maps service errors containing "not found"/"Insufficient stock" to 400.
- **Logging**: `utils/logger.js` (winston) writes JSON to `logs/` plus console outside production. The `activity_logs` table (migration 006) exists but nothing in `src/` writes to it yet.
- `utils/batchUserLoader.loadUsersByIds` exists for avoiding N+1 user lookups.

This is a training codebase with deliberate defects (e.g. string-interpolated SQL and no auth in `routes/search.js`, N+1 queries in `handlers/orderHistory.js`, discount rates that disagree with their doc comment, placeholder payment tests). Don't fix them in passing — only change what the current task covers.

## Test conventions

Tests mirror `src/` under `tests/`. Mock the DB with `jest.mock("../../src/config/database", () => ({ query: jest.fn() }))` and drive it with `db.query.mockResolvedValue({ rows: [...] })`; service tests auto-mock models (`jest.mock('../../src/models/Order')`) and the logger. Middleware tests call the middleware directly with hand-built `req`/`res` (`status: jest.fn().mockReturnThis()`) and sign real tokens with the same fallback secret.

## Capstone workflow constraints (from CAPSTONE.md)

- `SPEC.md` (repo root) must be committed before implementation; failing tests committed before implementation commits and never weakened afterwards.
- No squashing, amending of pushed commits, or force-pushing — git history is the evidence.
- Keep diffs small and matching existing patterns; no drive-by refactors.
- `REVIEW.md` and `PROCESS.md` are written alongside the work; reviewer agents go in `.claude/agents/`.
- Session export: `node .claude/skills/arcanys-session-export/scripts/export-session.js --zip` from repo root.
