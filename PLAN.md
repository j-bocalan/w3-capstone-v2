# Plan: Auth request validation with Joi

## Context
`SPEC.md` asks for request-body validation on `POST /api/auth/login` and `POST /api/auth/register`. The work moves out of the inline `if (!email || ...)` checks in `src/routes/auth.js` into a reusable Joi middleware, `bodyValidate(schema)`, with one schema per route.

Status at the start of this plan:
- Branch `feature/auth-login`. `SPEC.md` and the failing tests are already committed (`8db6285`, `c5d6b5c`).
- `tests/routes/auth.test.js` has 31 tests: 25 fail (expected red) and 6 pass (guard tests that must stay green).
- The other 7 suites (44 tests) pass.

**Definition of PASSED:** `npm test` shows **75/75 green**. Every test in `tests/routes/auth.test.js` passes, including the 422 change from Step 0, and none of the existing 44 tests regress.

**Status code: 422, not 400.** A failed validation returns **422 Unprocessable Entity**. That frees `400` for errors the route itself raises, so a client (or a test) can tell from the status alone whether the request was rejected by validation or by the route's own logic. The committed tests and SPEC still say 400, so Step 0 changes them before any implementation.

## Contract the tests enforce
From `expectValidationError` in `tests/routes/auth.test.js:43-51`:

| Requirement | Where it comes from |
|---|---|
| Status `422` on any validation failure (after Step 0) | SPEC "Behavior" |
| `res.body.error === "Validation failed"` | SPEC "default error message" |
| `res.body.inputs` is an object with one key per field that failed | SPEC "`inputs: {}`" |
| Unknown keys such as `role` show up in `inputs` too | SPEC "reject extra inputs" |
| `User.findByEmail` is **not** called when validation fails | Validation runs before the handler |
| Valid input reaches the handler unchanged (the escape-string password reaches `verifyPassword` exactly as sent; `User.create` receives `{ email, password, name }`) | SPEC "valid inputs … go within the route file" |

## Files

| File | Status | Purpose |
|---|---|---|
| `tests/routes/auth.test.js`, `SPEC.md` | modified in Step 0 | change the expected validation status from 400 to 422 |
| `package.json`, `package-lock.json` | modified by `npm install` | add `joi` dependency |
| `src/middleware/validate.js` | **new** | reusable `bodyValidate(schema)` middleware |
| `src/schemas/authSchemas.js` | **new** | `loginSchema`, `registerSchema` |
| `src/routes/auth.js` | **modified** | remove inline checks, attach `bodyValidate(...)` |

Folder names: the middleware goes in the existing `src/middleware/` (singular, next to `auth.js` and `errorHandler.js`). Schemas go in a new `src/schemas/`, because all source code lives under `src/`. `SPEC.md` lines 17 and 20 say `src/middlewares/*` and `schemas/*`. Step 6 updates those two lines, and the route paths on lines 14–15 (`/api/auth/...`), to match.

## Steps

### Step 0: Change the contract from 400 to 422 (before any implementation)
The tests are the contract, so the status change goes into the tests and SPEC first, in its own commit, before Joi is installed. This changes the agreed behaviour, not the strength of any test: every test still checks the same fields and that the database is never reached.

`tests/routes/auth.test.js`:
```diff
 /**
  * Feature tests for auth routes request validation.
  *
- * Encodes SPEC.md: invalid payloads are rejected with a 400 and
+ * Encodes SPEC.md: invalid payloads are rejected with a 422 and
  * { error: "Validation failed", inputs: { <field>: <message> } } before
  * any DB lookup; valid payloads continue to the route handler unchanged.
  */
@@
 function expectValidationError(res, fields) {
-  expect(res.status).toBe(400);
+  expect(res.status).toBe(422);
   expect(res.body.error).toBe("Validation failed");
```

`SPEC.md` ("Behavior" and "When to mark as DONE"):
```diff
-- always returns a 400 when validation fails
+- always returns a 422 when validation fails (400 stays free for errors raised by the route itself)
@@
-- Invalid requests returns a 400 and valid error mapping response.
+- Invalid requests returns a 422 and valid error mapping response.
```

Then:
- Run `npx jest tests/routes/auth.test.js`. It should be the same 6 passing and 25 failing, now with "Expected: 422" instead of 400, so the tests are still failing for the right reason.
- Commit: `Change validation failure status to 422 in tests and SPEC`.
- Note in `PROCESS.md` that the contract changed after the first test commits, and why.

### Step 1: Install Joi
```bash
npm install joi
```
- Adds `"joi": "^17.x"` to `dependencies` in `package.json` and updates `package-lock.json`.
- Joi 17 is CommonJS, which matches the project's `require` style. Nothing else is needed: Joi has no peer dependencies, and the email TLD list is built in.
- This needs access to the npm registry. `.claude/settings.json` asks for approval on `npm install:*`.
- Commit: `Install joi for request validation`.

### Step 2: Reusable middleware, `src/middleware/validate.js`

```js
/**
 * Request body validation middleware.
 *
 * Usage:
 *   router.post('/login', bodyValidate(loginSchema), handler)
 *
 * Validates req.body against a Joi schema. On failure responds 422 with
 *   { error: "Validation failed", inputs: { <field>: <message> } }
 * and the route handler is never reached. On success, req.body is replaced
 * with Joi's validated value (e.g. trimmed strings) and the request continues.
 *
 * 422 is reserved for validation failures so routes can keep using 400 for
 * their own errors, and clients can tell the two apart by status code.
 */

const VALIDATION_OPTIONS = {
  abortEarly: false, // collect every failing field, not just the first
  allowUnknown: false, // fail the request when the body has keys the schema doesn't declare
  stripUnknown: false, // never silently drop extra keys and continue
  errors: { wrap: { label: false } }, // "email is required" instead of "\"email\" is required"
};

function bodyValidate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body || {}, VALIDATION_OPTIONS);

    if (error) {
      const inputs = {};
      for (const detail of error.details) {
        const field = detail.path.join(".") || "body";
        if (!inputs[field]) {
          inputs[field] = detail.message;
        }
      }

      return res.status(422).json({ error: "Validation failed", inputs });
    }

    req.body = value;
    next();
  };
}

module.exports = { bodyValidate };
```

Design notes:
- **The middleware takes the schema as an argument,** so it knows nothing about auth. Any future route uses it as `bodyValidate(someSchema)`, which meets SPEC's "can be used for future improvements".
- **`abortEarly: false` is required.** The empty-string, null and empty-body tests expect every failing field (`email`, `password`, and `name` on register) in `inputs` at once. Joi's default stops at the first error.
- **Extra keys fail the whole request.** `allowUnknown: false` and `stripUnknown: false` are set explicitly in the middleware rather than left to Joi's defaults. Every schema passed to `bodyValidate` therefore rejects undeclared keys (e.g. `role: "admin"`) with a 422, and can never quietly drop them and carry on, even if a future schema or a change in Joi's defaults would allow it. The extra key appears in `inputs` under its own name.
- **Only the first message per field is kept.** A value can break more than one rule (for example `""` is both empty and not an email). The response keeps one readable message per key; the tests only check the key exists.
- **`detail.path.join(".")`** gives `"email"`, `"name"`, `"password"`, or `"role"` for an unknown key, which is what the extra-field tests check. If the whole body has the wrong type (e.g. a JSON array), the path is empty and the error goes under `"body"`, so it never ends up under an empty key.
- **`req.body || {}`:** Express's `express.json()` already sets `req.body = {}` when the request has no body (`node_modules/body-parser/lib/types/json.js:108`). The fallback just makes the middleware safe to use without a body parser.
- **Replacing `req.body` with `value`** means the handler gets the cleaned data (e.g. the trimmed `name`). Unknown keys never get this far because they're rejected.
- **The error shape `{ error, inputs }`** follows the project's other non-auth routes, which return `{ error }` (see `CLAUDE.md`), with `inputs` added as SPEC requires.
- **No `try/catch`:** `schema.validate` is synchronous and returns errors instead of throwing.

### Step 3: Schemas, `src/schemas/authSchemas.js`

```js
const Joi = require("joi");

/**
 * Request body schemas for /api/auth routes.
 * Rules follow SPEC.md "Expected Validation rules". Joi rejects unknown keys
 * on objects by default, which covers "reject extra inputs".
 */

const email = Joi.string().email().max(255).required();

const loginSchema = Joi.object({
  email,
  password: Joi.string().max(255).required(),
});

const registerSchema = Joi.object({
  name: Joi.string().trim().min(3).max(255).required(),
  email,
  password: Joi.string()
    .min(8)
    .max(30)
    .pattern(/[0-9]/, "digit")
    .pattern(/[A-Z]/, "uppercase letter")
    .pattern(/[^A-Za-z0-9]/, "symbol")
    .required(),
});

module.exports = { loginSchema, registerSchema };
```

How each SPEC rule maps to Joi:

| SPEC rule | Joi | Tests it satisfies |
|---|---|---|
| required | `.required()` | missing email / password / name, empty body |
| string | `Joi.string()` (rejects `null`, numbers, arrays and objects with `string.base`; doesn't convert them to strings) | null values |
| reject empty values | `Joi.string()` rejects `""` by default (`string.empty`) | empty string values |
| email | `.email()` (format plus a known TLD; `example.com` passes, `not-an-email` and `jane@` fail) | invalid email format / invalid email |
| email max 255 | `.max(255)` | email longer than 255 (login and register) |
| login password max 255 | `.max(255)` | login password longer than 255 |
| register password 8–30 | `.min(8).max(30)` | shorter than 8, longer than 30, both boundaries accepted |
| digit / uppercase / symbol | three `.pattern(regex, name)` calls; each reports its own named rule | missing a digit / uppercase / symbol |
| name 3–255, trimmed | `.trim().min(3).max(255)` | name too short, too long, 3-character boundary |
| whitespace-only name rejected | `.trim()` turns `"   "` into `""`, which `string.empty` rejects | whitespace-only name |
| reject extra inputs | `allowUnknown: false` / `stripUnknown: false` in the middleware options (`object.unknown`) | unknown `role` on both routes |

Notes:
- **The password is not trimmed or changed in any way.** The escape-string test checks that `verifyPassword` receives the exact string. `p'"\; DROP TABLE users;-- <script>` is a plain string under 255 characters, so it passes untouched. It is never interpolated into SQL anyway, because `User.findByEmail` uses parameterized queries.
- **The symbol rule is `[^A-Za-z0-9]`,** so any non-alphanumeric character counts as a symbol, including spaces and Unicode punctuation. All the valid fixtures (`Str0ng!Pass`, `Abcde1!x`, `Aa1!xxxx…`) use `!`.
- **The `email` rule is shared** between the two schemas so their email rules can't drift apart.

### Step 4: Apply to the routes, `src/routes/auth.js`
This is the only existing file edited.

```diff
 const express = require("express");
 const router = express.Router();
 const User = require("../models/User");
 const { signToken } = require("../utils/jwt");
 const logger = require("../utils/logger");
+const { bodyValidate } = require("../middleware/validate");
+const { loginSchema, registerSchema } = require("../schemas/authSchemas");

 /**
  * POST /api/auth/register
  * Create a new user account and return a JWT.
  */
-router.post("/register", async (req, res, next) => {
+router.post("/register", bodyValidate(registerSchema), async (req, res, next) => {
   try {
     const { email, password, name } = req.body;

-    if (!email || !password || !name) {
-      return res.status(400).json({
-        error: "Missing required fields: email, password, name",
-      });
-    }
-
     // Check for existing user
     const existing = await User.findByEmail(email);
@@
-router.post("/login", async (req, res, next) => {
+router.post("/login", bodyValidate(loginSchema), async (req, res, next) => {
   try {
     const { email, password } = req.body;

-    if (!email || !password) {
-      return res.status(400).json({
-        error: "Missing required fields: email, password",
-      });
-    }
-
     const user = await User.findByEmail(email);
```

Everything after validation stays the same: the 409 duplicate-email check, the 401 for an unknown user or wrong password, the 403 for an inactive account, token signing, logging and the response shapes. That keeps SPEC's "valid inputs still checked by the DB process" and "client interaction unchanged" for valid requests.

### Step 5: Run the tests
```bash
npx jest tests/routes/auth.test.js   # expect 31/31
npm test                             # expect 8 suites, 75/75
```
If anything is red, fix the implementation, never the tests. The tests are the committed contract.

### Step 6: Bring SPEC.md in line with the implementation
- Lines 14–15: `POST /api/login` / `POST /api/register` become `POST /api/auth/login` / `POST /api/auth/register`.
- Line 17: `src/middlewares/*` becomes `src/middleware/validate.js`.
- Line 20: `schemas/*` becomes `src/schemas/authSchemas.js`.
- Line 63: name the default message, `"Validation failed"`.

### Step 7: Commit (no squashing)
Each step gets its own commit, all after the failing-test commits:
0. `Change validation failure status to 422 in tests and SPEC` (`tests/routes/auth.test.js`, `SPEC.md`), made before anything below
1. `Install joi for request validation` (`package.json`, `package-lock.json`)
2. `Add reusable bodyValidate middleware and auth schemas` (`src/middleware/validate.js`, `src/schemas/authSchemas.js`)
3. `Validate auth request bodies with Joi schemas` (`src/routes/auth.js`)
4. `Align SPEC paths with implementation` (`SPEC.md`)

### Step 8: Reviews
- **`test-auditor`:** expected **GREEN** (all pass, new tests present on the branch).
- **`specs-reviewer`:** review the full `git diff master`, then fix → re-review until **PASS**. #4 (no wrong-type tests) may still come up. The schemas do enforce `Joi.string()`, so the behaviour is there, and you decide whether to add those tests.
- Then write `REVIEW.md` and `PROCESS.md` as the capstone requires.

## Verification checklist (SPEC "DONE")
- [ ] `joi` is in `package.json` dependencies and used in `src/schemas/authSchemas.js`.
- [ ] `bodyValidate(schema)` lives in `src/middleware/validate.js` with no auth-specific code.
- [ ] `src/routes/auth.js` has no inline field checks; both routes use `bodyValidate(...)`.
- [ ] `npm test`: 75/75 passing.
- [ ] An invalid request returns 422 `{ error: "Validation failed", inputs: {...} }` and doesn't touch the DB.
- [ ] A request with an extra key is rejected with 422, with that key listed in `inputs`.
- [ ] Valid requests reach the existing DB logic unchanged.
- [ ] `test-auditor` GREEN; `specs-reviewer` PASS.

## Risks
- **`npm install` needs registry access.** A read-only `npm view joi version` from the sandbox failed with an npm error while this plan was being written, so the install will probably be blocked there too. If so, run `! npm install joi` yourself. The `!` prefix runs it in this session, and the rest of the plan continues from there.
- **Behaviour change for API clients:** invalid requests that used to get `400 { error: "Missing required fields: ..." }` now get `422 { error: "Validation failed", inputs }`. A client that checks specifically for 400 on a missing field has to handle 422 instead. Successful responses and the route's other statuses (401, 403, 409) are unchanged. Note this in `REVIEW.md`.
- **Email max(255) vs Joi's email check:** the 260-character test email is well-formed, but Joi's `.email()` may also reject addresses over 254 characters (the RFC limit). Either way the result is 422 with `inputs.email`, so the test passes. `max(255)` is kept as an explicit guard matching the `VARCHAR(255)` column.
