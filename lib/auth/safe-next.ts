/**
 * Returns a safe app-relative redirect target. Only allows paths that start with
 * a single "/" and are not protocol-relative ("//") or backslash-smuggled ("/\").
 */
export function safeNext(raw: string | null, fallback = "/deals"): string {
  const next = raw ?? fallback;
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) {
    return next;
  }
  return fallback;
}
