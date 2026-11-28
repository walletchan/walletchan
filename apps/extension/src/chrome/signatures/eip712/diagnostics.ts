/** Bounded caller-owned context; never include message values or wallet state. */
export function formatEip712ValidationError(
  reason: unknown,
  method: string,
  payload: unknown,
  origin?: string,
): string {
  const text = (value: unknown): string | undefined =>
    typeof value === "string"
      // eslint-disable-next-line no-control-regex -- Intentionally strip controls from untrusted diagnostic text.
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160)
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : undefined;
  const context: Record<string, unknown> = {
    method: text(method),
    origin: text(origin),
    payloadFormat: typeof payload,
  };
  try {
    // Do not parse oversized input again just to describe its rejection.
    const data = typeof payload === "string"
      ? payload.length <= 128 * 1024 ? JSON.parse(payload) : undefined
      : payload;
    if (data && typeof data === "object") {
      context.primaryType = text(data.primaryType);
      context.domain = {
        name: text(data.domain?.name),
        version: text(data.domain?.version),
        chainId: text(data.domain?.chainId),
        verifyingContract: text(data.domain?.verifyingContract),
      };
      if (data.types && typeof data.types === "object") {
        context.types = Object.keys(data.types).slice(0, 8).map((name) => ({
          name: text(name),
          fields: Array.isArray(data.types[name])
            ? data.types[name].slice(0, 8).map((field: any) => ({
                name: text(field?.name), type: text(field?.type),
              }))
            : "invalid field definitions",
        }));
      }
    }
  } catch {
    // Malformed JSON still gets the method, origin and original validation reason.
  }
  return `Data must conform to EIP-712 schema: ${text(reason) || "Invalid typed data"}. Request: ${JSON.stringify(context)}`.slice(0, 4096);
}
