import { TrezorError, TrezorErrorCode } from "./errors";

/** Ephemeral Suite identity. Never returned to the renderer or persisted. */
export interface ConnectDeviceBinding {
  path: string;
  instance?: number;
  state: {
    sessionId?: string;
    staticSessionId?: string;
    deriveCardano?: boolean;
  };
}

export function captureDeviceBinding(
  value: unknown,
  expected?: ConnectDeviceBinding,
): ConnectDeviceBinding {
  const fail = (): never => {
    throw new TrezorError(
      TrezorErrorCode.DEVICE_DISCONNECTED,
      "The selected Trezor or wallet changed. Reconnect and try again.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const row = value as Record<string, unknown>;
  if (
    typeof row.path !== "string" ||
    !row.path ||
    row.path.length > 1024 ||
    (row.instance !== undefined &&
      (!Number.isSafeInteger(row.instance) || (row.instance as number) < 0)) ||
    !row.state ||
    typeof row.state !== "object" ||
    Array.isArray(row.state)
  )
    return fail();
  const state = row.state as Record<string, unknown>;
  const boundedId = (id: unknown): id is string =>
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 256 &&
    !/[\p{Cc}]/u.test(id);
  if (
    (!boundedId(state.staticSessionId) && !boundedId(state.sessionId)) ||
    (state.staticSessionId !== undefined &&
      !boundedId(state.staticSessionId)) ||
    (state.sessionId !== undefined && !boundedId(state.sessionId)) ||
    (state.deriveCardano !== undefined &&
      typeof state.deriveCardano !== "boolean")
  )
    return fail();
  const binding: ConnectDeviceBinding = {
    path: row.path,
    ...(row.instance === undefined ? {} : { instance: row.instance as number }),
    state: {
      ...(state.sessionId === undefined
        ? {}
        : { sessionId: state.sessionId as string }),
      ...(state.staticSessionId === undefined
        ? {}
        : { staticSessionId: state.staticSessionId as string }),
      ...(state.deriveCardano === undefined
        ? {}
        : { deriveCardano: state.deriveCardano as boolean }),
    },
  };
  if (
    expected &&
    (binding.path !== expected.path ||
      binding.instance !== expected.instance ||
      (expected.state.staticSessionId !== undefined
        ? binding.state.staticSessionId !== expected.state.staticSessionId
        : binding.state.sessionId !== expected.state.sessionId))
  )
    return fail();
  return binding;
}
