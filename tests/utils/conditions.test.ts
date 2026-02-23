import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../../src/utils/conditions.js";

describe("Condition evaluation", () => {
  it("simple equality matching — equal returns true", async () => {
    const data = { category: "security" };
    const result = await evaluateCondition('.category == "security"', data);
    expect(result).toBe(true);
  });

  it("simple equality non-matching — not equal returns false", async () => {
    const data = { category: "logging" };
    const result = await evaluateCondition('.category == "security"', data);
    expect(result).toBe(false);
  });

  it("comparison — greater than matching returns true", async () => {
    const data = { priority: 10 };
    const result = await evaluateCondition('.priority > 5', data);
    expect(result).toBe(true);
  });

  it("comparison — greater than non-matching returns false", async () => {
    const data = { priority: 3 };
    const result = await evaluateCondition('.priority > 5', data);
    expect(result).toBe(false);
  });

  it("exists check — field present returns true", async () => {
    const data = { api_key: "secret123" };
    const result = await evaluateCondition('.api_key', data);
    expect(result).toBe(true);
  });

  it("exists check — field absent returns false", async () => {
    const data = { other: "value" };
    const result = await evaluateCondition('.api_key', data);
    expect(result).toBe(false);
  });

  it("null value returns false", async () => {
    const data = { value: null };
    const result = await evaluateCondition('.value', data);
    expect(result).toBe(false);
  });

  it("empty string returns false", async () => {
    const data = { value: "" };
    const result = await evaluateCondition('.value', data);
    expect(result).toBe(false);
  });

  it("false value returns false", async () => {
    const data = { enabled: false };
    const result = await evaluateCondition('.enabled', data);
    expect(result).toBe(false);
  });

  it("true value returns true", async () => {
    const data = { enabled: true };
    const result = await evaluateCondition('.enabled', data);
    expect(result).toBe(true);
  });

  it("invalid expression — graceful degradation returns true with warning", async () => {
    const data = { value: "test" };
    const result = await evaluateCondition('invalid jq syntax [[[', data);
    // Graceful degradation: invalid jq should return true (execute anyway)
    expect(result).toBe(true);
  });

  it("empty data object — handles gracefully", async () => {
    const data = {};
    const result = await evaluateCondition('.missing_field', data);
    expect(result).toBe(false);
  });

  it("complex nested path", async () => {
    const data = { user: { role: "admin" } };
    const result = await evaluateCondition('.user.role == "admin"', data);
    expect(result).toBe(true);
  });

  it("array length check", async () => {
    const data = { items: [1, 2, 3] };
    const result = await evaluateCondition('.items | length > 2', data);
    expect(result).toBe(true);
  });
});
