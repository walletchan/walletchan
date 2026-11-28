# Dependency patches

## viem 2.45.1

`viem@2.45.1.patch` backports the dependency-name parsing fix from upstream
[commit 71636a3](https://github.com/wevm/viem/commit/71636a342b859fa9f15296d2f15377430db4629e):
remove only array suffixes rather than truncating names at non-word characters.
It also requires own schema properties during dependency lookup. TypeScript,
ESM and CommonJS implementations are patched together through pnpm.

This preserves exact namespaced type names and their nested dependencies when
hashing, signing and recovering signatures. No dapp-specific validation or
schema rewriting is used. Do not upgrade this pinned dependency without running
`tests/signatures/eip712SigningCompatibility.test.ts` and the signing regressions:
an upgrade must preserve both digest correctness and accepted deployed names.
The patch can be removed only when the replacement version passes those cases.

The existing `@trezor__connect-common@10.0.1.patch` is documented in
`_docs/TREZOR.md` and `_docs/SECURITY.md`.
