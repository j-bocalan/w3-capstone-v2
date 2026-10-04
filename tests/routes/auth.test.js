/**
 * Feature tests for auth routes request validation.
 *
 * Encodes SPEC.md: invalid payloads are rejected with a 422 and
 * { error: "Validation failed", inputs: { <field>: <message> } } before
 * any DB lookup; valid payloads continue to the route handler unchanged.
 */

jest.mock("../../src/models/User");
jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const request = require("supertest");
const app = require("../../src/index");
const User = require("../../src/models/User");

const activeUser = {
  id: 2,
  email: "alice@example.com",
  name: "Alice Johnson",
  role: "customer",
  customer_tier: "gold",
  status: "active",
  password_hash: "$2a$10$hash",
};

const validLogin = { email: "alice@example.com", password: "password123" };

const validRegister = {
  name: "Jane Doe",
  email: "jane@example.com",
  password: "Str0ng!Pass",
};

// A well-formed email (64-char local part, 195-char domain) that is 260
// characters long, so only the max(255) rule can reject it — not the
// email format check.
const tooLongEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`;

function expectValidationError(res, fields) {
  expect(res.status).toBe(422);
  expect(res.body.error).toBe("Validation failed");
  expect(res.body.inputs).toBeDefined();
  for (const field of fields) {
    expect(res.body.inputs).toHaveProperty(field);
  }
  expect(User.findByEmail).not.toHaveBeenCalled();
}

describe("auth routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/auth/login", () => {
    beforeEach(() => {
      User.findByEmail.mockResolvedValue(activeUser);
      User.verifyPassword.mockResolvedValue(true);
    });

    it("should be able to login with valid email and password", async () => {
      const res = await request(app).post("/api/auth/login").send(validLogin);

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(activeUser.email);
      expect(User.findByEmail).toHaveBeenCalledWith(validLogin.email);
    });

    it("should not be able to login with null values", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: null, password: null });

      expectValidationError(res, ["email", "password"]);
    });

    it("should not be able to login with empty string values", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "", password: "" });

      expectValidationError(res, ["email", "password"]);
    });

    it("should not be able to login with empty body", async () => {
      const res = await request(app).post("/api/auth/login").send({});

      expectValidationError(res, ["email", "password"]);
    });

    it("should not be able to login with invalid email format", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "not-an-email", password: "password123" });

      expectValidationError(res, ["email"]);
    });

    it("should accept possible escape strings in the payload when email is valid", async () => {
      const password = "p'\"\\; DROP TABLE users;-- <script>";
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: validLogin.email, password });

      expect(res.status).toBe(200);
      expect(User.verifyPassword).toHaveBeenCalledWith(
        password,
        activeUser.password_hash
      );
    });

    it.each([
      ["email", { password: validLogin.password }],
      ["password", { email: validLogin.email }],
    ])(
      "should not be able to login when %s is missing",
      async (field, payload) => {
        const res = await request(app).post("/api/auth/login").send(payload);

        expectValidationError(res, [field]);
      }
    );

    it("should not be able to login with an email longer than 255 characters", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: tooLongEmail, password: "password123" });

      expectValidationError(res, ["email"]);
    });

    it("should not be able to login with a password longer than 255 characters", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: validLogin.email, password: "a".repeat(256) });

      expectValidationError(res, ["password"]);
    });

    it("should not be able to login with unknown extra fields", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ ...validLogin, role: "admin" });

      expectValidationError(res, ["role"]);
    });

    it.each([
      ["email", "an object", { $ne: "" }],
      ["email", "an array", ["alice@example.com"]],
      ["email", "a number", 123],
      ["password", "an object", { $ne: "" }],
      ["password", "an array", ["password123"]],
      ["password", "a number", 12345678],
    ])(
      "should not be able to login when %s is %s",
      async (field, _label, value) => {
        const res = await request(app)
          .post("/api/auth/login")
          .send({ ...validLogin, [field]: value });

        expectValidationError(res, [field]);
      }
    );

    it("should not be able to login when the body is an array", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send([validLogin]);

      expectValidationError(res, ["body"]);
    });
  });

  describe("POST /api/auth/register", () => {
    beforeEach(() => {
      User.findByEmail.mockResolvedValue(null);
      User.create.mockImplementation(({ email, name }) =>
        Promise.resolve({ id: 11, email, name, role: "customer" })
      );
    });

    it("should be able to register when all fields are valid", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send(validRegister);

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(validRegister.email);
      expect(User.create).toHaveBeenCalledWith(validRegister);
    });

    it.each(["name", "email", "password"])(
      "should not be able to register when %s is missing",
      async (field) => {
        const payload = { ...validRegister };
        delete payload[field];

        const res = await request(app).post("/api/auth/register").send(payload);

        expectValidationError(res, [field]);
      }
    );

    it("should not be able to register with an invalid email", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, email: "jane@" });

      expectValidationError(res, ["email"]);
    });

    it.each([
      ["missing a digit", "NoDigits!!"],
      ["missing an uppercase letter", "n0upper!!"],
      ["missing a symbol", "NoSymbol123"],
      ["shorter than 8 characters", "Sh0rt!"],
      ["longer than 30 characters", `Aa1!${"x".repeat(27)}`],
    ])(
      "should not be able to register when password is %s",
      async (_label, password) => {
        const res = await request(app)
          .post("/api/auth/register")
          .send({ ...validRegister, password });

        expectValidationError(res, ["password"]);
      }
    );

    it("should not echo the submitted password back in the validation error", async () => {
      const password = "secretpassword";
      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, password });

      expectValidationError(res, ["password"]);
      expect(JSON.stringify(res.body)).not.toContain(password);
    });

    it("should not be able to register with empty string values", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "", email: "", password: "" });

      expectValidationError(res, ["name", "email", "password"]);
    });

    it("should not be able to register with null values", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: null, email: null, password: null });

      expectValidationError(res, ["name", "email", "password"]);
    });

    it("should not be able to register with a name shorter than 3 characters", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, name: "Jo" });

      expectValidationError(res, ["name"]);
    });

    it("should not be able to register with a whitespace-only name", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, name: "   " });

      expectValidationError(res, ["name"]);
    });

    it("should not be able to register with a name longer than 255 characters", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, name: "a".repeat(256) });

      expectValidationError(res, ["name"]);
    });

    it("should not be able to register with an email longer than 255 characters", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, email: tooLongEmail });

      expectValidationError(res, ["email"]);
    });

    it.each([
      ["an 8-character password", { password: "Abcde1!x" }],
      ["a 30-character password", { password: `Aa1!${"x".repeat(26)}` }],
      ["a 3-character name", { name: "Joe" }],
    ])(
      "should be able to register with boundary value: %s",
      async (_label, overrides) => {
        const res = await request(app)
          .post("/api/auth/register")
          .send({ ...validRegister, ...overrides });

        expect(res.status).toBe(201);
      }
    );

    it("should not be able to register with unknown extra fields", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, role: "admin" });

      expectValidationError(res, ["role"]);
    });

    it.each([
      ["name", "an object", { $ne: "" }],
      ["name", "an array", ["Jane Doe"]],
      ["name", "a number", 12345],
      ["email", "an object", { $ne: "" }],
      ["email", "an array", ["jane@example.com"]],
      ["email", "a number", 123],
      ["password", "an object", { $ne: "" }],
      ["password", "an array", ["Str0ng!Pass"]],
      ["password", "a number", 12345678],
    ])(
      "should not be able to register when %s is %s",
      async (field, _label, value) => {
        const res = await request(app)
          .post("/api/auth/register")
          .send({ ...validRegister, [field]: value });

        expectValidationError(res, [field]);
      }
    );

    it("should not be able to register when the body is an array", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send([validRegister]);

      expectValidationError(res, ["body"]);
    });
  });
});
