// Permissive email-format gate. Authoritative validation is done by SES;
// this is just to reject obvious typos before we incur token issuance,
// SES throughput cost, or DDB writes downstream.
//
// Trims surrounding whitespace because the call sites consistently
// normalize on the way in (.trim().toLowerCase()) — folding the trim into
// the gate keeps "user typed a leading space" from sneaking through if
// any caller forgets.
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
