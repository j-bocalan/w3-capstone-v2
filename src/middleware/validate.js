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
