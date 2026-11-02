/** A device-side failure carrying the Lattice response code. */
export class LatticeProtocolError extends Error {
  readonly responseCode: number | null;

  constructor(message: string, responseCode: number | null = null) {
    super(message);
    this.name = "LatticeProtocolError";
    this.responseCode = responseCode;
  }

  static fromResponseCode(code: number): LatticeProtocolError {
    return new LatticeProtocolError(`Lattice response code 0x${code.toString(16)}`, code);
  }
}

/** A relay/HTTP failure before a Lattice frame could be parsed. */
export class LatticeTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LatticeTransportError";
  }
}
