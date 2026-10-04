# Feature: Authentication Request Validation

## Goal:
Harden the input boundary for the authentication routes by moving them to a JOI reusable middleware.
Using schemas for consistent workflow and implementation for future endpoints. Primary focusing on the auth part for the spec.

## Scope:

- Login & Register endpoints will be updated.
- Adding middleware and removing validation code within in the auth routes files.

### Affected Files & Routes

- POST /api/login
- POST /api/register

- src/middlewares/* new files only
- src/routes/auth.js existing
- tests/ new files only, none exists for this
- schemas/* new files only, none exists for this

### Implementing Order

1. inspect the existing auth and validation behavior
2. Define what validations are to be extracted to a schema
3. Write tests for valid and invalid requests, expected to fail
4. Commit tests
5. Install Joi into the project
6. Add reusable validation middleware
7. Create schemas for auth routes
8. Remove validation logic in auth routes
9. apply validation middleware with reference to newly schemas for auth
10. clean up extra files related to validation
11. run tests
12. review diff vs this SPEC

### Expected Validation rules

- email
  - required
  - string
  - email
  - max:255
- password
  - required
  - string
  - min:8 register only
  - max:30 register only
  - at least one digit, one uppercase letter, and one symbol — register only
  - max:255 login
- name
  - required
  - string
  - max:255
  - min: 3
  - trimmed before length checks (whitespace-only is rejected)
- reject empty values
- reject extra inputs

### Behavior

- always returns a 400 when validation fails
- has default error message when error is due to validation
- issues with input will be kept in `inputs: {}` object 
- when inputs are valid they will go within the route file to continue it's process
- client/consumers interaction with the endpoint remains to be unchanged.

### When to mark as "DONE"

- Joi is installed, and utilized in the auth routes 
- Implementation cna be used for future improvements
- All Tests passed
  - Missing email must be rejected
  - Missing password must be rejected
  - Values too long must be rejected
  - malformed values must be rejected
  - Empty values are must be rejected
- Valid inputs must be accepted but still checked by the DB process.
- Invalid requests returns a 400 and valid error mapping response.
- specs reviewer passes
- test auditor passes

### Verification

- run `npm test`
