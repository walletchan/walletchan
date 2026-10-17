/**
 * Creates an opaque identifier for one Trezor SDK attempt.
 *
 * Durable request and proposal IDs are deliberately not reused here: retrying
 * must not be able to correlate with or accept a stale SDK result.
 */
export function createTrezorOperationId(): string {
  return crypto.randomUUID();
}
