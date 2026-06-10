export type AuthResult = { ok: true } | { ok: false; error: string };

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Returns an error message, or null if the email is well-formed. */
export function validateEmail(email: string): string | null {
  if (!email || !EMAIL_RE.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

/** Returns an error message, or null if the password meets the length policy. */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function passwordsMatch(password: string, confirm: string): boolean {
  return password === confirm;
}
