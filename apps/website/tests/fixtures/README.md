# Safe proxy verification fixtures

These frozen runtime bytecodes let the website proxy tests run independently
of the extension's experimental Bunker feature.

- `safe4337Module.json`: released Safe4337Module v0.3.0 runtime at
  `0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226`, originally recorded in the
  Safe Bunker contract integration fixtures. Its keccak256 hash must match
  `SAFE_4337_MODULE_CODE_HASH` in `packages/shared/src/safe4337.ts`.
- `safeProxy.json`: canonical SafeProxy runtime from the Safe 1.4.1 factory
  fixture; the singleton is stored in slot zero and verified separately.

Tests use these public bytecodes with injected authority reads, without
broadcasting transactions or requiring a browser, funded account, or RPC.
