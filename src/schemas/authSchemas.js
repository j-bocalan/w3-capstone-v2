const Joi = require("joi");

/**
 * Request body schemas for /api/auth routes.
 * Rules follow SPEC.md "Expected Validation rules". Unknown keys are rejected
 * by bodyValidate (allowUnknown: false), which covers "reject extra inputs".
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
    .required()
    // Joi's default pattern message includes the submitted value, which
    // would echo the plaintext password back in the 422 response.
    .messages({
      "string.pattern.name": "{{#label}} must contain at least one {{#name}}",
    }),
});

module.exports = { loginSchema, registerSchema };