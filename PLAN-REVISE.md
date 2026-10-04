# Plan revisions: Auth request validation with Joi

This file records where the implementation departs from the approved `PLAN.md` (commit `f34dfef`). `PLAN.md` is left as it was approved; each change below says what the plan said, what was done instead, why, and how it was checked.

## Summary

| # | Area | PLAN.md said | Implemented | Reason |
|---|---|---|---|---|
| R1 | Joi version | `joi` `^17.x` | `joi` `^18.2.9` | `npm install joi` installed the current major version |
| R2 | Node version | `engines.node` left at `>=18.0.0` | `engines.node` `>=22.0.0` and a new `.nvmrc` containing `22` | Joi 18 needs Node 20 or later; Node 20 has been end-of-life since 2026-04-30 |
| R3 | Password error messages | Joi's default messages | Custom `string.pattern.name` message on the register password | The default message put the submitted password in the 422 response |
| R4 | Schema header comment | "Joi rejects unknown keys on objects by default" | "Unknown keys are rejected by bodyValidate (allowUnknown: false)" | The middleware options do the rejecting, not Joi's default |
| R5 | Tests | 31 auth tests, 75 in total | 49 auth tests, 93 in total | Added a password-not-echoed test and wrong-type tests |

Steps 0, 2, 4 and 6 of `PLAN.md` were implemented exactly as written. Step 3 changed as described in R3 and R4.

---

## R1: Joi 18 instead of Joi 17 (Step 1)

**PLAN.md (Step 1):**
> Adds `"joi": "^17.x"` to `dependencies` in `package.json` and updates `package-lock.json`.

**Implemented:** `npm install joi` installed **18.2.9**, the current major version, and wrote `"joi": "^18.2.9"` to `package.json`.

**Check:** Joi 18 is still CommonJS (no `"type": "module"`). Every API the plan uses works unchanged: `Joi.string().email().max()`, `.trim()`, `.pattern(regex, name)`, and the `abortEarly`, `allowUnknown`, `stripUnknown` and `errors.wrap.label` options. The code from Steps 2–4 needed no changes for the new version.

**Consequence:** Joi 18 declares `"engines": { "node": ">= 20" }`, which conflicts with the project's `>=18.0.0`. R2 resolves this.

**Install note:** the first `npm install joi` failed inside the sandbox with `EROFS` because `~/.npm/_cacache` is read-only there. It was re-run with `--cache "$TMPDIR/npm-cache"`. The registry itself was reachable, and only the cache location changed.

## R2: Node 22 requirement (new, not in PLAN.md)

**PLAN.md:** no Node version change. `package.json` was meant to keep `"node": ">=18.0.0"`.

**Implemented:**
```diff
   "engines": {
-    "node": ">=18.0.0"
+    "node": ">=22.0.0"
   }
```
New file `.nvmrc`:
```
22
```

**Why 22 and not 20:** Joi 18 needs Node 20 or later, but Node 20 reached end-of-life on 2026-04-30. Node 22 is the oldest line still supported (until April 2027) and was already the local default under nvm (v22.23.1). `.nvmrc` makes `nvm use` in the repo pick it.

**Check:** with nvm, the full suite was run on each installed version:

| Node | Result |
|---|---|
| v22.23.1 (`.nvmrc`) | 93/93 pass |
| v20.20.2 | 93/93 pass |
| v18.20.8 | 93/93 pass (Joi does not support Node 18; the `engines` field now steers away from it) |

**Files changed beyond PLAN.md's list:** `package.json` (`engines`) and `.nvmrc` (new).

## R3: Password error messages no longer include the password (Step 3)

**PLAN.md (Step 3), register password rule:**
```js
  password: Joi.string()
    .min(8)
    .max(30)
    .pattern(/[0-9]/, "digit")
    .pattern(/[A-Z]/, "uppercase letter")
    .pattern(/[^A-Za-z0-9]/, "symbol")
    .required(),
```

**Problem found in review:** `specs-reviewer` reported that Joi's default `string.pattern.name` message includes the submitted value. A register request with `password: "secretpassword"` returned:
```json
{
  "error": "Validation failed",
  "inputs": {
    "password": "password with value secretpassword fails to match the digit pattern"
  }
}
```
So the 422 response sent the user's plaintext password back to them, and to any proxy or monitoring tool that records response bodies. The plan didn't check what Joi's default messages contain.

**Implemented:** `src/schemas/authSchemas.js:19-30`:
```js
  password: Joi.string()
    .min(8)
    .max(30)
    .pattern(/[0-9]/, "digit")
    .pattern(/[A-Z]/, "uppercase letter")
    .pattern(/[^A-Za-z0-9]/, "symbol")
    .required()
    // Joi's default pattern message includes the submitted value, which
    // would echo the plaintext password back in the 422 response.
    .messages({
      "string.pattern.name": "{{#label}} must contain at least one {{#name}}",
    }),
```
The same request now returns:
```
password must contain at least one digit
```
The uppercase-letter and symbol rules report the same way.

**Check (fail → fix → pass):**
1. Added the test `should not echo the submitted password back in the validation error` (`tests/routes/auth.test.js`). It asserts that `JSON.stringify(res.body)` does not contain the submitted password.
2. Ran it against the plan's code: **failed**, and the received body contained `secretpassword`.
3. Added the `.messages(...)` override and ran it again: **passed**.
4. `specs-reviewer` then checked every other rule in use (`string.base`, `string.empty`, `any.required`, `string.min`, `string.max`, `string.email`, `object.base`, `object.unknown`). None of them include the submitted value. `object.unknown` only names the extra key, which the client sent itself.

## R4: Schema header comment (Step 3)

**PLAN.md (Step 3):**
```js
/**
 * Request body schemas for /api/auth routes.
 * Rules follow SPEC.md "Expected Validation rules". Joi rejects unknown keys
 * on objects by default, which covers "reject extra inputs".
 */
```

**Implemented:** `src/schemas/authSchemas.js:3-7`:
```js
/**
 * Request body schemas for /api/auth routes.
 * Rules follow SPEC.md "Expected Validation rules". Unknown keys are rejected
 * by bodyValidate (allowUnknown: false), which covers "reject extra inputs".
 */
```

**Why:** after the plan was revised to set `allowUnknown: false` and `stripUnknown: false` explicitly in `src/middleware/validate.js`, the comment pointed to the wrong place. This change is to the comment only; behaviour is unchanged.

## R5: Additional tests (Step 5's definition of PASSED)

**PLAN.md:**
> **Definition of PASSED:** `npm test` shows **75/75 green**.

**Implemented:** `npm test` shows **93/93 green** (8 suites). `tests/routes/auth.test.js` went from 31 to 49 tests. Tests were only added; no existing assertion was removed or loosened.

| Added test | Count | Purpose |
|---|---|---|
| `should not echo the submitted password back in the validation error` | 1 | Guards R3 |
| `should not be able to login when {email,password} is {an object,an array,a number}` | 6 | SPEC "string" rule; covers `{ "$ne": "" }`-style payloads |
| `should not be able to register when {name,email,password} is {an object,an array,a number}` | 9 | Same, for register |
| `should not be able to {login,register} when the body is an array` | 2 | A body that isn't an object fails with `inputs.body`, which exercises the `"body"` fallback key in `bodyValidate` |

**Check:** the 17 wrong-type tests passed on their first run against the implementation, which shows the schemas already enforced the rule. They now guard against regressions. `test-auditor` confirmed none of the tests are empty or assertion-free.

---

## Current status
- `npm test`: **8 suites, 93/93 passing** on Node v22.23.1.
- `test-auditor`: **GREEN**.
- `specs-reviewer`: **PASS**, with no high or medium findings.

**Open (low severity, not yet done):**
- `package-lock.json` root `engines` still says `>=18.0.0`. It needs `npm install --package-lock-only` to match R2.
- `SPEC.md`'s "Affected Files" list doesn't yet include `package.json`, `package-lock.json` and `.nvmrc` (R1/R2).