// Shared helpers for integration tests. Keep these dependency-light so any
// test file can import them without pulling the harness in.

/**
 * Extract the `token` query parameter from a magic-link URL. Throws a clear
 * error (rather than returning `null` or relying on a `!` non-null assertion)
 * when the URL is missing the parameter — this catches handler-shape
 * regressions where the email payload no longer carries the expected token
 * field, instead of failing later as a confusing TypeError.
 */
export function tokenFromMagicLink(url: string): string {
  const t = new URL(url).searchParams.get('token');
  if (!t) throw new Error(`Expected 'token' query param in URL: ${url}`);
  return t;
}
