import { describe, it, expect } from "vitest";
import {
  validateEmail,
  validatePassword,
  passwordsMatch,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/validation";

describe("validateEmail", () => {
  it("returns null for a valid address", () => {
    expect(validateEmail("a@b.com")).toBeNull();
  });
  it("returns an error for a missing @", () => {
    expect(validateEmail("nope")).toBe("Enter a valid email address.");
  });
  it("returns an error for an empty string", () => {
    expect(validateEmail("")).toBe("Enter a valid email address.");
  });
});

describe("validatePassword", () => {
  it("returns null when length >= minimum", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });
  it("returns an error when too short", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  });
});

describe("passwordsMatch", () => {
  it("is true when equal", () => {
    expect(passwordsMatch("abc", "abc")).toBe(true);
  });
  it("is false when different", () => {
    expect(passwordsMatch("abc", "abd")).toBe(false);
  });
});
