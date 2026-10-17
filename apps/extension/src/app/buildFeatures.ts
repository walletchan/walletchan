declare const __WALLETCHAN_TREZOR_ENABLED__: boolean;

/** Build-time release boundary; tests/default development remain enabled. */
export const TREZOR_BUILD_ENABLED =
  typeof __WALLETCHAN_TREZOR_ENABLED__ === "undefined" ||
  __WALLETCHAN_TREZOR_ENABLED__;
