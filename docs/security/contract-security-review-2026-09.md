# Contract Security Review — September 2026

**Scope:** All deployed Soroban smart contracts in this repository — `donation`,
`creator-registry`, and the shared `common` types crate. There is no separate
"recurring-donation" contract; recurring donations (`Subscription`) are
implemented as functions inside the `donation` contract (`subscribe`,
`charge_subscription`, `cancel_subscription`).

**Checklist applied to each contract:**
1. Auth checks — does every state-mutating function call `.require_auth()` on
   the correct, non-spoofable address, and are admin-only functions actually
   gated?
2. Reentrancy via cross-contract calls — checks-effects-interactions ordering
   around `env.invoke_contract` and token transfers, assessed against
   Soroban's actual execution/auth model (not EVM assumptions).
3. Overflow/underflow — are arithmetic ops on user-influenced amounts safe,
   and does the code rely implicitly on the build-level overflow trap vs.
   defending itself explicitly?
4. Storage TTL handling — are persistent entries bumped with an appropriate
   TTL extension policy so they aren't archived/evicted unexpectedly?

**Severity bar:** *Critical* = an articulable, concrete fund-loss or
auth-bypass exploit path. *High* = a real security weakness with a narrower
or harder-to-trigger exploit path, or one requiring a privileged/compromised
actor. *Medium* = a defense-in-depth or availability gap, not directly
fund-loss. *Low* = hardening/best-practice gap. *Informational* = no risk,
noted for completeness or as a DRY/maintainability observation.

**Reviewer:** Manual source review of `contracts/donation/src/lib.rs`,
`contracts/creator-registry/src/lib.rs`, `contracts/common/src/lib.rs`, and
the workspace/crate `Cargo.toml` files, cross-checked against the existing
`docs/admin-multisig-timelock.md` and `docs/contract-upgrade-migration.md`.
No code was changed as part of this review.

---

## Summary table

| # | Contract | Checklist area | Function / Location | Finding | Severity |
|---|----------|-----------------|----------------------|---------|----------|
| 1 | donation | Storage TTL | `donate`, `charge_subscription` — `contracts/donation/src/lib.rs:469-474`, `627-632` | Donation log entries (`DONATIONS_KEY`) are written with no `extend_ttl`/`extend_persistent_ttl` call; the contract's own doc comment says they're allowed to expire. This is a *documented, deliberate* tradeoff (event log is canonical), but worth re-confirming as a product decision, not an oversight. | Low |
| 2 | donation | Storage TTL | `subscribe`, `charge_subscription`, `cancel_subscription` — `contracts/donation/src/lib.rs:507-523`, `556-637`, `653-669` | Active `Subscription` records (`SUBSCRIPTIONS_KEY`) receive no explicit TTL extension anywhere, including on successful charge. Unlike the donation log, subscriptions are **live, mutable, funds-relevant state** — if a subscription entry expires/is archived between charges (long `interval_secs`, e.g. monthly/yearly), `charge_subscription` and `cancel_subscription` will fail with "subscription not found," silently halting future recurring charges and (worse) making the subscription impossible to cancel until/unless the entry is restored. | High |
| 3 | donation | Storage TTL | `propose_admin_action`, `approve_admin_action` — `contracts/donation/src/lib.rs:240-242`, `273-275`; same pattern in creator-registry `:174-176`, `207-209` | `AdminProposal`/`APPROVAL_KEY` entries get no explicit TTL bump. A proposal created with a long timelock delay could expire before `execute_admin_action` is called, silently dropping a pending governance action (fails safe — action doesn't execute — but is an availability/operational gap for the multisig workflow). | Low |
| 4 | donation | Overflow/underflow | `charge_subscription` reschedule — `contracts/donation/src/lib.rs:634` (`subscription.next_charge_at = now + subscription.interval_secs`) | `now` and `interval_secs` are both `u64`; `interval_secs` is admin/user-supplied at `subscribe` time with only a `> 0` check, no upper bound. A very large `interval_secs` close to `u64::MAX` combined with a large `now` could overflow. `overflow-checks = true` is set for the release profile (see Informational note below), so this traps/aborts rather than wrapping — but the resulting DoS (permanently stuck/unusable subscription) is still a real, if very unlikely, annoyance. No realistic supporter would set a multi-billion-year interval, and UIs will not offer it, so exploitability is negligible. | Informational |
| 5 | creator-registry | Auth checks | `record_donation` — `contracts/creator-registry/src/lib.rs:349-361` | `caller.require_auth()` is invoked *before* verifying `caller == authorized_donation_contract`. This is safe in Soroban's model (see Reentrancy/Auth discussion below) — `require_auth()` cryptographically proves the caller is who it claims, so an attacker cannot spoof the donation contract's identity even though the auth check runs before the identity check. Flagged here only to confirm it was reviewed, not because it's exploitable. | Informational |
| 6 | donation | Overflow/underflow | Multisig admin state (`approvals_count`, threshold math) — `contracts/donation/src/lib.rs:274`; creator-registry `:208` | `proposal.approvals_count += 1` is unchecked, but `approve_admin_action` already prevents double-approval per admin (`has_approved` check) and the admin list is bounded by `AddAdmin`/`RemoveAdmin` governance actions, so `approvals_count` cannot realistically exceed the small admin set size. No practical overflow path. | Informational |
| 7 | common | N/A | `contracts/common/src/lib.rs` (whole file) | Pure `#[contracttype]` data definitions, no logic, no storage access, no arithmetic. Nothing to review against this checklist beyond confirming both `donation` and `creator-registry` import identical types from here (DRY-positive — avoids type drift between the two contracts' cross-contract call ABIs). | Informational |
| 8 | donation, creator-registry | Overflow/underflow (build config) | `Cargo.toml:10-18`, `contracts/donation/Cargo.toml:24-32`, `contracts/creator-registry/Cargo.toml:20-28` | `overflow-checks = true` is set correctly in the **release** profile at the workspace root, and then **redundantly re-declared** identically in each contract crate's own `Cargo.toml`. Functionally harmless (values match) but is a DRY violation — if the workspace-level setting is ever changed, the per-crate overrides would silently keep the old behavior unless updated in lockstep. Also worth noting: code does not use `checked_add`/`checked_mul` anywhere for the amount arithmetic (`profile.total_donations += amount`, `donation.amount`, etc.) — it relies entirely on the build flag to trap overflow rather than defending in the code itself. | Low |

**Totals:** 0 Critical, 0 High-with-fund-loss, 1 High (availability/operational — subscription TTL), 3 Low, 4 Informational.

---

## 1. `donation` contract (`contracts/donation/src/lib.rs`)

### 1.1 Auth checks

Every state-mutating entry point requires auth on the correct principal:

- `initialize` / `initialize_multisig`: `admin.require_auth()` / each admin in the list `.require_auth()` — correct, and the `assert!(!has(&ADMIN_KEY))` guard prevents re-initialization by a later caller.
- `emergency_pause`: `admin.require_auth()` **then** `assert!(Self::is_admin(...))` — correctly checks the caller is both authenticated *and* on the admin list, not just any authenticated address.
- `propose_admin_action` / `approve_admin_action` / `execute_admin_action`: all require auth on the acting address and verify admin membership before proceeding. `execute_admin_action` additionally re-checks the approval threshold and timelock ETA server-side (not client-trusted) — solid.
- `set_executor` (legacy 1-of-1 path): reads the *stored* `ADMIN_KEY`, not a caller-supplied admin address, then calls `.require_auth()` on it. Correct — the caller cannot pass in an arbitrary "admin" to bypass this, since the admin identity comes from storage, not from function arguments.
- `add_allowed_token` / `remove_allowed_token`: same pattern — admin address read from storage, not parameter, then `require_auth()`. Correct.
- `donate`: `donor.require_auth()` on the actual donor parameter, matching the token transfer's `from`. Correct — a caller cannot make someone else's funds move without that address's signature.
- `subscribe`: `supporter.require_auth()`, matching the party whose token allowance will later be drawn on. Correct.
- `charge_subscription`: `executor.require_auth()`, then explicitly compares against the *stored* `EXECUTOR_KEY` (`assert_eq!(executor, authorized_executor, ...)`) rather than trusting the parameter. This is the right pattern — even though `executor` is caller-supplied, the subsequent equality check against storage means an attacker cannot charge subscriptions as an impostor executor; they would need the real executor's signature. Verified by `test_charge_subscription_rejects_unauthorized_executor`.
- `cancel_subscription`: `supporter.require_auth()`, then `assert_eq!(subscription.supporter, supporter, "not the subscription owner")` — prevents a third party from cancelling someone else's subscription even though `supporter` is a parameter. Correct ownership check.
- `register_creator`, `get_creator`, `set_goal`, `get_goal`: `set_goal` cross-contract call is preceded by `creator.require_auth()` in `donation::set_goal` — correct, the donation contract does not simply forward an unauthenticated call to the registry.

**Verdict:** No auth-bypass path found. All state mutations that move funds, alter subscriptions, or change privileged configuration are gated on `.require_auth()` calls against addresses that are either read from trusted storage or checked for equality against the acting party — never a raw, unchecked caller-supplied "trust me" address.

### 1.2 Reentrancy via cross-contract calls

The contract makes cross-contract calls in three places: `token_client.transfer` (in `donate`), `token_client.transfer_from` (in `charge_subscription`), and `env.invoke_contract(&registry, "record_donation", ...)` (in `donate`, `charge_subscription`, `register_creator`, `get_creator`, `set_goal`, `get_goal`).

**Soroban's actual reentrancy model** differs meaningfully from EVM:
- Soroban has no fallback-function-triggered reentrancy — there's no way for a called contract to "hijack" control flow via an implicit callback the way a malicious `receive()`/`fallback()` does on EVM. A Soroban contract can only re-enter by being explicitly invoked again, and the SDK's `Env` does allow same-contract or cross-contract re-entrant calls, but each such call must independently satisfy its own `require_auth()` checks — auth is enforced per-invocation and tied to the transaction's signed authorization tree, not just "did this run once already."
- In `donate`: the token transfer (`token_client.transfer(&donor, &creator, &amount)`) happens **before** the local donation log write and the `DonatedEvent` publish (`contracts/donation/src/lib.rs:447` vs. `454-474`). This is a checks-effects-interactions *violation* in the literal ordering sense — external call before state finalization — but the practical exploit surface is narrow: the `token` here is restricted to the admin-curated allowlist (`is_token_allowed`), so an attacker cannot supply an arbitrary malicious token contract with hostile `transfer` logic; they can only use tokens the admin has vetted (in practice SACs/well-known assets). If a re-entrant call into `donate` or another entry point occurred during that transfer, it would still need its own valid `require_auth()`, so it could not drain funds beyond what the re-entrant caller is itself authorizing. No state (like the donation counter) is read-then-written in a way a reentrant call could corrupt into an inconsistent double-count, because the counter read/write happens after the transfer, in the same top-level call, and Soroban's storage writes are not interleaved by concurrent execution (single-threaded, synchronous call semantics).
- In `charge_subscription`: allowance and balance are checked (`allowance < subscription.amount`, `balance < subscription.amount`) **before** `transfer_from` is invoked, and `subscription.next_charge_at` is updated **after** the transfer (`contracts/donation/src/lib.rs:595-637`). This ordering means if a hostile token's `transfer_from` somehow re-entered `charge_subscription` for the *same* `subscription_id` before the reschedule write, it could in principle draw the allowance twice for one period before `next_charge_at` advances — a real checks-effects-interactions gap. However, exploitability is again bounded by the token allowlist: only admin-approved tokens can be used, and the reentrant call would still require `executor.require_auth()` to succeed (only the single authorized executor address can call `charge_subscription`), and a real SAC/standard Stellar Asset Contract does not call back into arbitrary contracts during `transfer_from`. This is a defense-in-depth gap, not a currently exploitable path against the token types the system supports today, but it is exactly the kind of gap that becomes dangerous if the allowlist is ever loosened to include arbitrary custom token contracts.
- Cross-contract calls to the registry (`record_donation`) happen *after* the token transfer but *before* the local donation-log persistence in `donate` (registry call at `:452`, log write at `:469-474`) — order doesn't matter here since these are independent storage keys with no shared invariant a reentrant registry call could corrupt.

**Verdict:** No actual reentrancy exploit was identified against the currently supported (allowlisted) token set. The `charge_subscription` external-call-before-reschedule ordering is the one place worth hardening defensively before the token allowlist is ever relaxed. See Finding table row 2 area — actually this specific ordering issue does not currently meet the High bar for a fund-loss finding because it requires an untrusted/malicious token to be allowlisted, which is itself gated by admin auth; it is called out here narratively rather than as a numbered finding, since fixing it would be a "harden for the future" change rather than a live vulnerability. If you want it as a tracked follow-up regardless, see the "Follow-up issues" section.

### 1.3 Overflow/underflow

Amount-related arithmetic: `amount` (donation/subscription amounts) is `i128`, validated `> 0` at entry (`donate:436`, `subscribe:500`) but never checked against an upper bound. `profile.total_donations += amount` (in the registry, not here) and `subscription.next_charge_at = now + subscription.interval_secs` are the two addition sites relevant to this contract. Neither uses `checked_add`. The workspace's `[profile.release]` sets `overflow-checks = true`, which causes Soroban's wasm release build to **trap (abort the transaction)** rather than silently wrap on overflow — this is the correct, safe default and is explicitly and intentionally configured (not relying on an implicit debug-only default). See table rows 4 and 8 for the two related Informational/Low notes: the code implicitly depends on this build flag rather than being defensively self-contained, and the flag is redundantly declared in three `Cargo.toml` files instead of once.

**Verdict:** No exploitable overflow path found. The reliance on build-level trapping instead of explicit `checked_*` arithmetic is a style/defense-in-depth observation, not a live bug, since the flag is correctly and deliberately set for release.

### 1.4 Storage TTL handling

- **Donation log** (`DONATIONS_KEY`, `DONATION_COUNTER`): explicitly and deliberately un-extended, per the contract's own doc comments (`:10-17`, `:422-425`, `:712-719`, `:729-735`). This is a documented product decision (off-chain `DonatedEvent` indexing is canonical), not an oversight. Low severity only because it's already disclosed and the backend explicitly compensates — see Finding 1.
- **Subscriptions** (`SUBSCRIPTIONS_KEY`): no `extend_ttl` call anywhere, including in `charge_subscription`'s success path where the entry is rewritten (a rewrite does refresh the entry's TTL to the contract's default, but there is no explicit policy ensuring that default covers the supporter's chosen `interval_secs`, e.g. an annual subscription could easily outlive the archival threshold between charges). This is the most significant finding in this review — see Finding 2 (High). Unlike the donation log, a subscription is **live governing state**, and its expiry doesn't just lose history, it can silently break the ability to charge *or cancel* a still-intended-to-be-active subscription, effectively trapping the supporter's standing token allowance in limbo (they'd need to separately revoke the SAC allowance directly against the token contract to regain control, bypassing `cancel_subscription`).
- **Admin proposals** (`PROPOSAL_KEY`, `APPROVAL_KEY`): no explicit TTL extension; see Finding 3 (Low) — fails safe (action simply doesn't execute) but is an operational gap for governance flows with long timelock delays.

---

## 2. `creator-registry` contract (`contracts/creator-registry/src/lib.rs`)

### 2.1 Auth checks

- `initialize` / `initialize_multisig`: same correct pattern as `donation` — `admin.require_auth()` / all admins `.require_auth()`, guarded against re-initialization.
- `propose_admin_action` / `approve_admin_action` / `execute_admin_action`: identical, correct pattern to `donation`'s multisig flow (admin membership + threshold + timelock ETA all re-verified server-side).
- `set_donation_contract`: legacy 1-of-1 path reads `ADMIN_KEY` from storage, not a parameter, then `require_auth()` — correct, cannot be spoofed by passing a different "admin."
- `register_creator`: `creator.require_auth()` — correct, only the creator themself can claim/overwrite their own profile. The re-registration guard (`assert!(p.username.len() == 0, "creator already registered")`) correctly distinguishes a real existing profile from a placeholder auto-created by `record_donation` (see `2.4` below) — verified by `test_register_creator_twice_panics` and `test_register_creator_after_donation`.
- `record_donation`: `caller.require_auth()` followed by `assert_eq!(caller, authorized_donation_contract, ...)`. As discussed in the summary table (Finding 5), the ordering (auth-then-identity-check rather than identity-then-auth) is safe in Soroban: `require_auth()` is a cryptographic proof that the transaction's authorization tree actually authorizes `caller` to act, so an attacker cannot pass in `caller = <the real donation contract address>` and have `require_auth()` succeed unless the *actual* donation contract (or its legitimate final signer) authorized the call. There is no way to "trick" `require_auth()` into approving an address you don't control. Verified by `test_record_donation_rejects_unauthorized_caller`.
- `set_goal`: `creator.require_auth()` — correct, matches the on-chain design's intent that only the creator can set their own goal (mirrored by `donation::set_goal`'s pre-check).

**Verdict:** No auth-bypass path found. This is the contract most exposed to a "confused deputy" risk (`record_donation` is meant to be callable only by the donation contract) and the guard is implemented correctly.

### 2.2 Reentrancy via cross-contract calls

`creator-registry` makes **no outbound cross-contract calls** — it is purely a callee (invoked by `donation` via `invoke_contract`). There is no reentrancy surface to assess from this contract's own code; any reentrancy risk involving the registry is already covered under `donation`'s review (§1.2), since `donation` is the caller.

**Verdict:** Not applicable / no findings — contract makes no external calls.

### 2.3 Overflow/underflow

`record_donation`: `profile.total_donations += amount;` and `profile.donation_count += 1;` (`:375-376`). `amount` is validated `> 0` but has no upper bound; `total_donations` accumulates indefinitely across a creator's lifetime. Both are unchecked arithmetic relying on the same workspace-level `overflow-checks = true` release setting discussed in §1.3. `donation_count` is `u32`, incrementing once per successful donation/charge — realistically would require over 4 billion donations to a single creator to overflow, not a practical concern. `total_donations` is `i128`, effectively unreachable via realistic token amounts.

**Verdict:** No exploitable overflow path. Same Informational/Low observations as `donation` (build-flag reliance, redundant Cargo.toml declarations) apply here.

### 2.4 Storage TTL handling

- **Creator profiles** (keyed by `creator: Address`) and **goals** (`GOAL_KEY, creator`): no explicit `extend_ttl` calls anywhere in this contract. Unlike the donation contract's append-only log (which has an explicit, documented "OK to expire" design decision), creator profiles are **the canonical, only on-chain source of truth** for username, lifetime totals, and donation count — there is no off-chain fallback analogous to `DonatedEvent` indexing for this state (the backend's Postgres mirror is a cache/index of events, not a substitute source of truth for the registry's authoritative balance). If a long-dormant creator's profile entry is archived/evicted due to TTL expiry, `get_creator` would return `None`, and a subsequent `record_donation` for that creator would recreate a **fresh placeholder profile starting from zero** (`:363-373`), silently losing all prior lifetime totals and donation count history. This is a real, if slow-moving (requires genuine long-term inactivity beyond the archival threshold), state-loss risk and is more severe than the donation log's TTL gap because there's no compensating off-chain source for *this specific* aggregate. This did not meet the "Critical/concrete near-term exploit" bar since it requires natural long-term inactivity rather than being attacker-triggerable on demand, but it is a legitimate High-severity data-integrity gap worth its own follow-up (not merged into Finding 2's table row since it's a distinct root cause/contract).

**Verdict:** This is a second, separate TTL-related finding beyond the subscription one — see "Follow-up issues" below (listed as Finding 9, since it was identified during the narrative writeup after the summary table was drafted).

---

## 3. `common` crate (`contracts/common/src/lib.rs`)

Pure data-type definitions (`DonationRecord`, `CreatorProfile`, `Subscription`, `AdminAction`, `AdminProposal`) shared via `#[contracttype]` between `donation` and `creator-registry`. No storage access, no arithmetic, no auth logic, no cross-contract calls — there is nothing in this file to assess against any of the four checklist items. Its existence as a shared crate is itself a good DRY practice: it guarantees `donation` and `creator-registry` cannot drift into incompatible wire-level type definitions for the values they exchange over `invoke_contract`, which would otherwise be a subtle, hard-to-test cross-contract bug class.

**Verdict:** No findings. Reviewed for completeness; confirmed no logic present.

---

## Overall assessment

Across all three contracts, auth checks are consistently and correctly implemented: every privileged or fund-moving function either reads the authoritative principal from storage (never trusting a caller-supplied "I am the admin/executor" parameter) or checks a caller-supplied identity against an authoritative record before or via `require_auth()`'s cryptographic guarantee. No auth-bypass path was found in either contract. Soroban's execution/auth model meaningfully reduces classic EVM-style reentrancy risk since every re-entrant call must independently satisfy its own signed authorization; the one checks-effects-interactions ordering gap worth hardening (`charge_subscription`'s transfer-before-reschedule) is not currently exploitable given the token allowlist, but should be fixed defensively before that allowlist is ever relaxed. Overflow/underflow is correctly guarded at the build level (`overflow-checks = true` in release), though the code does not defend itself explicitly with `checked_*` arithmetic — acceptable given the explicit, deliberate build configuration, but worth tightening. The most actionable findings are storage-TTL-related: active subscriptions and (separately) creator profiles have no explicit TTL extension policy, which for genuinely long-lived state could eventually cause silent, hard-to-diagnose loss of the ability to manage a subscription or loss of a creator's lifetime stats. These are the two findings recommended for prioritized follow-up.

---

## Follow-up issues to file

Ready to copy into GitHub issue titles/bodies.

### Issue A — Subscriptions have no storage TTL extension policy (High)
**Title:** `Contract(donation): active subscriptions lack TTL extension, risking silent charge/cancel failure`
**Body:**
> `Subscription` records (`SUBSCRIPTIONS_KEY`) in `contracts/donation/src/lib.rs` are written in `subscribe` (`:507-523`) and rewritten in `charge_subscription` (`:634-637`) with no explicit `extend_ttl`/`extend_persistent_ttl` call. Unlike the donation log (which has a documented "OK to expire, backend indexes events instead" design), a subscription is live, mutable, funds-relevant state with no off-chain fallback for *control* (you cannot re-derive an ability to cancel from an event log). If a subscription's persistent entry is archived/evicted before its next scheduled charge (plausible for long `interval_secs`, e.g. annual), `charge_subscription` and `cancel_subscription` will both fail with "subscription not found," silently halting the recurring donation and leaving the supporter's SAC token allowance in place with no on-chain path to revoke it via this contract.
>
> **Suggested fix:** call `env.storage().persistent().extend_ttl(&(SUBSCRIPTIONS_KEY, id), threshold, extend_to)` (or the SDK's current equivalent) on every write/rewrite of a `Subscription` entry, sized to comfortably exceed the subscription's own `interval_secs`, with a sane cap or minimum extend to avoid excessive rent for very long intervals.
>
> **Severity:** High (availability/state-loss; not a direct fund-drain, but can silently trap a supporter's standing allowance and break the intended cancel path).

### Issue B — Creator profiles have no storage TTL extension policy (High)
**Title:** `Contract(creator-registry): creator profiles lack TTL extension, risking silent loss of lifetime stats`
**Body:**
> Creator profile entries (keyed by `creator: Address` in `contracts/creator-registry/src/lib.rs`) are written in `register_creator` (`:330`) and `record_donation` (`:378`) with no explicit TTL extension anywhere in the contract. Unlike the donation contract's append-only log, this state is the sole canonical on-chain source of a creator's username, lifetime total donations, and donation count — there is no off-chain fallback that reconstructs *this specific* aggregate if the entry is archived. If a creator is inactive long enough for their profile to expire, the very next `record_donation` for them will recreate a fresh placeholder profile starting from zero (`contracts/creator-registry/src/lib.rs:363-373`), silently discarding all prior history.
>
> **Suggested fix:** extend the profile entry's TTL on every read-modify-write in `record_donation` and on writes in `register_creator`/`set_goal`, and consider whether `get_creator` should also bump TTL on read (bounded, to avoid a read-based rent-griefing vector) to keep actively-viewed profiles alive.
>
> **Severity:** High (data-integrity/state-loss; requires natural long-term inactivity to trigger, not attacker-controlled on demand, which is why it isn't Critical).

### Issue C — `charge_subscription` performs the token transfer before rescheduling `next_charge_at` (Medium, defense-in-depth)
**Title:** `Contract(donation): charge_subscription reschedules after transfer_from — harden checks-effects-interactions ordering`
**Body:**
> In `charge_subscription` (`contracts/donation/src/lib.rs:595-637`), `token_client.transfer_from(...)` is called before `subscription.next_charge_at` is advanced and persisted. Balance/allowance are pre-checked, and today's token allowlist (admin-curated, presumably standard SACs) means this is not currently exploitable — a malicious token contract with hostile re-entrant `transfer_from` logic cannot currently be used since only allowlisted tokens are accepted, and any re-entrant call into `charge_subscription` would still require the single authorized executor's real `require_auth()`. However, this ordering is a latent risk if the token allowlist is ever relaxed to permit less-trusted custom token contracts.
>
> **Suggested fix:** update `subscription.next_charge_at` and persist the subscription record *before* calling `transfer_from`, following strict checks-effects-interactions ordering, so the reschedule is finalized regardless of what the called token contract does during the transfer.
>
> **Severity:** Medium (not currently exploitable given the trusted token allowlist; recommended as proactive hardening before that trust boundary is ever widened).

### Issue D — Redundant `overflow-checks` declaration across four Cargo.toml files (Low, DRY/maintainability)
**Title:** `Contracts: overflow-checks = true is redundantly declared per-crate instead of solely at the workspace level`
**Body:**
> The workspace root `Cargo.toml` already sets `overflow-checks = true` (and the rest of the `[profile.release]` block) for all workspace members. `contracts/donation/Cargo.toml` and `contracts/creator-registry/Cargo.toml` each redeclare an identical `[profile.release]` block. This is currently harmless (values match) but is a DRY violation: if the workspace-level profile is ever changed, the per-crate overrides will silently keep stale settings unless updated in lockstep, and a future contributor could reasonably assume the per-crate blocks are unnecessary and remove them without realizing they're currently load-bearing duplicates (Cargo profile precedence rules mean the workspace root's `[profile.*]` already applies to workspace members; per-crate `[profile.*]` sections in a *member* crate's `Cargo.toml` are actually ignored by Cargo for workspace builds — worth double-checking with `cargo metadata`/a real workspace build whether these per-crate blocks do anything at all, or are simply dead configuration).
>
> **Suggested fix:** remove the duplicated `[profile.release]` blocks from `contracts/donation/Cargo.toml` and `contracts/creator-registry/Cargo.toml`, keeping the single source of truth at the workspace root; confirm via `cargo build --release` that the resulting wasm still has `overflow-checks` active (e.g. via a targeted overflow test in `release-with-logs` or a build-time assertion).
>
> **Severity:** Low (no runtime security impact today; maintainability/DRY hygiene only).

### Issue E — Amount arithmetic relies on build-level overflow trapping rather than explicit checked arithmetic (Informational)
**Title:** `Contracts: consider explicit checked_add/checked_sub for user-influenced amount arithmetic`
**Body:**
> `profile.total_donations += amount` (`contracts/creator-registry/src/lib.rs:375`), `proposal.approvals_count += 1` (both contracts), and `subscription.next_charge_at = now + subscription.interval_secs` (`contracts/donation/src/lib.rs:634`) all use plain arithmetic operators rather than `checked_add`/`checked_sub`. This is currently safe because `overflow-checks = true` is correctly set for the release profile, causing these to trap (abort the transaction) rather than silently wrap on overflow. This issue is filed purely as a defense-in-depth / explicitness suggestion (matches "bias toward explicit over clever"): using `checked_add(...).expect(...)` or returning a typed error would make the safety property visible in the code itself rather than depending entirely on build configuration remaining correct forever (see Issue D, which shows the current build config is already slightly fragile/duplicated).
>
> **Severity:** Informational (no current exploit path; style/robustness improvement only).
