import TrezorConnect from "@trezor/connect-web";
import { createTrezorConnectAdapter } from "./connectAdapter";

/** Only the background's serialized client can reach the public Suite SDK. */
export const trezorConnectAdapter = createTrezorConnectAdapter(TrezorConnect);
