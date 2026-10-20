# Safe Bunker self-funded execution

Safe Bunkers require Safe4337Module v0.3.0 as their sole enabled module and
fallback handler. The module remains enabled when an EOA pays for execution.
EntryPoint v0.7, Safe singleton/factory, MultiSendCallOnly, module and setup
library addresses/runtime hashes are pinned in safeBunker/deployments.json.
Unknown modules, guards, handlers or infrastructure fail closed.

## Payer and fee selection

Without an explicit saved preference, execution defaults to the Bunker itself.
PayerFields prepends only the current chain-bound Bunker to the eligible existing
PK/seed/Ledger/Trezor executors and identifies it with a This Bunker pill. Changing
the selection clears an unsaved checkbox. The default checkbox is offered when
the selected payer differs from the effective default, for either payer type.
Remembering a selection commits alongside durable release metadata before
broadcast; an unchecked selection applies only to that operation.

Self-payment mounts the existing FeePaymentSelector and drawer. Native currency
is preferred when the spend and maximum gas cost are covered, including an
existing EntryPoint deposit. Otherwise the shared automaticFeeToken picks the
first supported positive ERC-20 balance. Only that token is quoted. Insufficient
balance leaves it selected, disables confirmation and allows manual selection;
there is no automatic search through additional Pimlico quotes. Manual choice
wins for the request. ERC-20 quotes share bounded approvals (resetting a nonzero insufficient allowance
to zero before replacement for USDT compatibility), provider validation,
expiry and refresh limits. EOA execution retains its native gas controls.

## Execution and authority

feePayment.ts adapts shared ERC-20 preparation with a Safe-specific call encoder
and stub signature; EIP-7702 authorizations/delegates never enter this path.
The Safe is the UserOperation sender, using EntryPoint nonce key zero. Its
executeUserOp targets canonical MultiSendCallOnly by delegatecall. Every inner
call is CALL-only: optional exact bounded fee approval, original user calls,
then exactly one swapOwner. Owner rotation and user effects are atomic.
Native execution has no paymaster. ERC-20 execution uses the existing Pimlico
proxy, approved chain/token catalog and maximum token-cost ceiling.

feeExecution.ts captures live master authority, account/provenance, both nonce
models, current/successor owner and configuration; rebuilds calldata; signs the
SafeOp EIP-712 domain for the pinned module; and encrypts the owner signature
before any signed RPC. The shared SafeOp projection lives in
packages/shared/src/safe4337.ts and is used by the proxy verifier too.
The wire signature prepends validAfter=0 and the reviewed validUntil timestamp.

Unsigned native estimation may use an exact sender-balance override to estimate
fees when native funds are absent. This does not authorize spending. Exact signed
estimation has no override, checks prefund and execution, and may not replace any
reviewed gas/paymaster fields. Authority/expiry/route gates run again immediately
before the exact deterministic UserOperation hash is saved and released.
Ambiguous release remains pending by that hash; no fresh envelope is generated.
Recovery rotation remains the escape path for unresolved exposed signatures.

## Settlement and history

A UserOperation hash is not a transaction hash. It removes a submitted operation
from approval navigation and publishes pending Activity, but injected/WC requests
wait for a verified transaction receipt before receiving a transaction hash.
ERC-5792 may receive its ordinary pending bundle acknowledgment earlier.

feeSettlement.ts checks the bundler hint against an independently fetched chain
receipt, matching EntryPoint hash/sender/nonce/paymaster. Owner events are scoped
to that operation's event segment. Reconciliation checks canonical confirmations
and owner changes. Successful module execution does not increment Safe.nonce;
EOA execution still does. Failed UserOperations may consume gas and EntryPoint
nonce while leaving owner and Safe nonce unchanged. Existing revert guidance
and fresh-successor rules apply. Gas attribution uses the operation's actual gas
cost rather than the enclosing bundler transaction. ERC-20 fee enrichment uses
the verified paymaster.

## Deployment profile

Deployment profile v3 installs the pinned Safe4337Module using SafeModuleSetup
and sets that module as the fallback handler. Hardened owner derivation remains
v2. Discovery, import, activation, execution and settlement all require this
module configuration. Module-free deployment profiles and their upgrade flow
are unsupported.

The encrypted journal accepts optional review.feePayment and
operation.userOperationHash fields. No new storage key or eager ciphertext
rewrite is required. There is no module-activation marker or upgrade operation.

## Proxy and validation

The website proxy retains EOA signature verification and adds canonical-length,
short-lived Safe signatures verified against a live single-owner Safe with the
pinned module and fallback handler. RPC destinations are trusted chain defaults,
not request inputs. Balance overrides are estimation-only and bound to sender;
submission never accepts overrides. Deploy the proxy change with this feature.
Self-payment availability is bounded by the verified infrastructure, proxy chain
catalog and Pimlico availability. Fees are paid on the Bunker's own chain.

Tests cover real Safe/module/EntryPoint bytecode on disposable Sepolia and Base
Sepolia nodes, native gas charged to Safe, unchanged Safe nonce, owner rotation,
master-only access, exact EIP-712 hashes including paymaster fields, strict
module configuration and shared bounded ERC-20 encoding. Provider responses are fixtures;
these are not live Pimlico sponsorship/billing acceptance. Hardware payer QA still
requires real Ledger/Trezor devices. Browser fee-picker fixtures validate the
shared drawer, one-token selection and both themes without broadcasting.

Native-balance discovery is independent of gas estimates. When no native balance
remains after the requested native spend and the EntryPoint deposit is zero,
the shared selector may select the first funded supported token even if native
estimation fails. Unknown balances or a positive deposit still require an
estimate; manual selection remains authoritative. Native preparation errors
are cleared when the payer/token changes and provider failures use fixed,
redacted fee-payment diagnostics.

Signed Bunker fee-check failures retain their signature, reviewed operation and
reserved owner in the encrypted journal, with a redacted diagnostic. The UI
provides Check status and Back to wallet rather than refreshing an expired
signed review. Reconciliation may invalidate an unexecuted signed SafeOp only
after a confirmed canonical block is past its signed nonzero validUntil, with
the expected owner, Safe nonce and EntryPoint nonce still unchanged. Submitted hashes settle by verified receipts or confirmed expiry plus unchanged
authority/nonces. No signature evidence is deleted.
The expiry block becomes the existing plan.verifiedBlock anchor; subsequent
reviews/signatures fail closed if that canonical proof is reorganized.

Bunker gas preparation preserves ERC-7677 paymaster postOp limits and the
paymaster verification-gas floor. Account/verification/pre-verification budgets
include proportional headroom. A realistic public dummy ECDSA signature avoids
underpricing compressed L1 signature bytes on L2s. Native operations omit
paymaster-only zero fields. ERC-20 reviews validate the completed paymaster
envelope while still unsigned; a gas increase triggers fresh sponsorship
before review, with bounded retries for the selected token only. Bounded
approval and maximum token cost are recomputed from the final envelope. The
signed preflight retains gas caps and reports the exact field and numeric
required/reviewed limits without exposing signatures or calldata. No gas field
is mutated after owner signing.


Bunker self-payment submission makes exactly one send attempt after durably
saving its hash/signature. Only an acknowledgement matching that deterministic
hash becomes pending; transport failures, explicit rejections and hash mismatches
remain ambiguous. `feeSubmission.ts` preserves bounded HTTP/RPC/AA-code diagnostics
without reflecting provider text, URLs, error.data or signed bytes. Failed sends
are surfaced to confirmation and Activity; ambiguous history uses the existing
broadcastUncertain/error fields and “Verifying broadcast” label. No automatic
replacement or re-signing occurs.

Reconciliation can resolve submitted, pending and ambiguous expired SafeOps after
a confirmed canonical block is strictly past validUntil, with the expected current
owner and both Safe/EntryPoint nonces unchanged at that block. A consumed nonce
blocks expiry even when the bundler reports no receipt. The canonical expiry
anchor, original hash/signature and exposed-successor reservations are retained.
Expired rows become dropped, and dapp/batch results report invalidation rather
than user rejection. EntryPoint event lookup over at most 10,000 blocks from the
saved signing block provides a chain-verified receipt fallback when the bundler
receipt service is unavailable. Older stuck rows repair through the same startup/
alarm reconciliation. No storage schema or key changes are required.


Completion UI retains the active confirmation while its promise is in flight,
even if a background refresh removes it from approvals. The parent deduplicates
completion from refresh, progress and response: acknowledged submission opens
Public Activity in sidepanel/fullscreen, or uses the existing TransactionSentScreen
and 1-second close in popup mode. Ambiguous releases open Activity with their
diagnostic and never show a success checkmark. Late request preloads are invalidated
before navigating away so they cannot reopen the completed approval.

Deployment prerequisite: the extension's production Pimlico proxy must ship the
77-byte Safe signature branch in policy.ts, safePolicy.ts, and shared/safe4337.ts
alongside this feature. An older proxy accepts 65-byte EOA signatures only and
returns HTTP 401 for Safe sends. Rebuilding/reloading only the extension cannot
upgrade that hosted verifier. Proxy-policy tests validate the canonical authority
and short-lived owner signature; the backend change requires its own release.

### Quote failure diagnostics

Bunker fee-option/quote routes preserve only the existing fixed policy and step
diagnostics instead of replacing every exception with an unlock instruction.
Pimlico's recognized paymaster token-collection simulation failure retains the
shared message explaining that the transaction leaves too little selected token
for the network fee, with reduce-amount/change-token guidance. This mapping is
based on the known failure signature, not an assumption that every swap revert
means insufficient funds. Unknown provider messages, URLs, calldata and error
data remain hidden behind a fixed quote fallback. Failed quoting never signs or
submits an operation.
