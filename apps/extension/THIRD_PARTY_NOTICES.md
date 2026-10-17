# WalletChan Browser Extension — Third-Party Notices

This file records third-party software whose license materially affects the
distributed WalletChan browser extension. Other dependencies retain their own
copyright notices and license terms as provided in their source packages.

## snarkjs and its GPL dependency family

- Component: `snarkjs`
- Version: `0.7.5`
- Copyright: Copyright 2018 0KIMS Association
- Author listed by the package: Jordi Baylina
- Project: <https://github.com/iden3/snarkjs>
- Exact source: <https://github.com/iden3/snarkjs/tree/v0.7.5>
- License: GNU General Public License version 3 (`GPL-3.0`)

WalletChan uses the unmodified npm release of `snarkjs@0.7.5` for local
Groth16 proof generation and verification in its packaged privacy prover.
WalletChan's build bundles that library into the extension; no `snarkjs`
source patch is maintained by WalletChan.

The following GPL-3.0 packages are included through that exact dependency:

| Package | Version | Exact package source |
| --- | --- | --- |
| `@iden3/bigarray` | `0.0.2` | <https://www.npmjs.com/package/@iden3/bigarray/v/0.0.2> |
| `@iden3/binfileutils` | `0.0.12` | <https://www.npmjs.com/package/@iden3/binfileutils/v/0.0.12> |
| `fastfile` | `0.0.20` | <https://www.npmjs.com/package/fastfile/v/0.0.20> |
| `ffjavascript` | `0.3.0`, `0.3.1` | <https://www.npmjs.com/package/ffjavascript/v/0.3.0>, <https://www.npmjs.com/package/ffjavascript/v/0.3.1> |
| `r1csfile` | `0.0.48` | <https://www.npmjs.com/package/r1csfile/v/0.0.48> |
| `wasmbuilder` | `0.0.16` | <https://www.npmjs.com/package/wasmbuilder/v/0.0.16> |
| `wasmcurves` | `0.2.2` | <https://www.npmjs.com/package/wasmcurves/v/0.2.2> |

These packages identify Jordi Baylina or 0kims as their author. Their upstream
source packages retain the detailed copyright notices for each work.

The complete GNU GPL version 3 text is included in [COPYING](./COPYING) and as
`LICENSE.txt` in every packaged extension build.

## Trezor Connect

- Component: `@trezor/connect-web@10.0.1` and MIT-licensed Trezor thin-client dependencies
- Copyright: Trezor Company s.r.o.
- Exact source: <https://github.com/trezor/trezor-suite/tree/2ee7bd0636889196bab33e6069e2736393a58f3c/packages/connect-web>
- License: MIT
- Local modification: `patches/@trezor__connect-common@10.0.1.patch` binds the Suite approval channel to its current top-level tab and verifies outbound tab URLs.

WalletChan bundles the thin client only in its Chromium background worker.
Trezor Suite is a separate upstream application with its own license and
privacy terms. Firefox contains no Trezor signing transport. The unused
`@trezor/crypto-utils` re-export is excluded by a build guard; its missing
referenced license is not treated as permission to distribute its code.

MIT License

Copyright (c) Trezor Company s.r.o.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
