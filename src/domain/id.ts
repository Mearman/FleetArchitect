/**
 * Identifier generation. Uses the platform CSPRNG (`crypto.randomUUID`),
 * available in modern browsers and Node 19+.
 */
export function createId(prefix?: string): string {
  const uuid = crypto.randomUUID();
  return prefix === undefined ? uuid : `${prefix}_${uuid}`;
}

/** Current time as an ISO-8601 string, for entity timestamps. */
export function nowIso(): string {
  return new Date().toISOString();
}
