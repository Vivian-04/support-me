# Empty States — Design Spec

Status: **Design / Handoff-ready** · Owner: UI/UX · Consumers: `frontend/` (Next.js)

Tracks issue: **#47** — *UI/UX: Design consistent empty states across the app*

Related: `docs/design/donation-subscription-failure-states.md` (error states — distinct
from empty states), `docs/design/donation-widget.md`, `frontend/components/Skeleton.tsx`
(loading states), `frontend/components/TipChart.tsx`.

---

## 1. Problem & Goal

Empty states in the app are inconsistent. The best one lives on Discover
(`frontend/app/discover/page.tsx`), which shows a bordered card, an icon, a bold
title, and a supporting line. Most others are a bare muted sentence with no icon,
no title, and no action:

| Today | Where |
| --- | --- |
| Icon + title + body (the pattern to standardise on) | `frontend/app/discover/page.tsx` |
| Bare `<p className="text-muted font-medium">No activity yet…` | `frontend/app/dashboard/page.tsx` |
| Bare `<p className="text-muted font-medium">No users yet.</p>` | `frontend/app/activity/page.tsx` |
| Body only, inside a card, no icon or title | `frontend/app/app/subscriptions/page.tsx` |
| Bare `<p className="text-muted font-medium">No active goals yet.</p>` | `frontend/app/settings/page.tsx` |
| Bare `<p className="text-muted font-medium …">No tips in this window yet.</p>` | `frontend/components/TipChart.tsx` |
| Bare `—` inside a statistic | `frontend/app/dashboard/page.tsx`, `frontend/app/activity/page.tsx` |

A first-time visitor therefore meets a different treatment on every screen, and
most screens tell them nothing to do next. This spec:

1. defines **one empty-state pattern** (anatomy, variants, copy rules, a11y);
2. gives **every** list/data surface in the app its own spec — the actual title,
   body, and action for that surface, not a generic placeholder;
3. draws a hard line between **empty**, **loading**, **error**, and **zero**, which
   are four different states that today are sometimes conflated.

## 2. Design Decisions (short version)

1. **Empty is a designed screen, not a fallback string.** Every empty state names
   what is absent (title), why or when it fills (body), and — where the viewer can
   act — offers the action that creates the data (CTA).
2. **Empty ≠ zero ≠ error ≠ loading.** A statistic that is genuinely `0` is not an
   empty state and must not render `—` (see §5). Empty states never use error
   styling (`bg-brand-pink` / `text-red-600` are reserved for failures, per
   `donation-subscription-failure-states.md`), and an empty state is never shown
   while data is still loading — that is `Skeleton`'s job.
3. **Two sizes, one pattern.** `page` (fills a page region, `p-12`, 40px icon) and
   `compact` (embedded inside an existing card or chart panel, `p-8`, 32px icon).
4. **Three variants.** `first-run` (nothing exists yet), `no-results` (a query or
   filter matched nothing), `absence` (a record does not exist — e.g. an unknown
   profile). The variant changes the copy contract, not the visual structure.
5. **One shared component.** The pattern is specified here so it can be implemented
   once as `frontend/components/EmptyState.tsx` and adopted surface by surface
   (§7). This document is the handoff; it does not itself change components.

## 3. The Pattern

### 3.1 Anatomy

```
┌─────────────────────── card-brutal bg-card ────────────────────────┐
│                                                                    │
│                            [  Icon  ]        ← decorative, 40px    │
│                                                                    │
│                     No creators found for “sam”                    │  ← title
│              Try a different name or username.                     │  ← body
│                                                                    │
│                        [ Clear search ]                            │  ← optional CTA
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Canonical markup (this is the exact treatment already shipping on Discover —
standardise on it, do not invent a new one):

```tsx
<div className="card-brutal bg-card p-12 text-center">
  <HugeiconsIcon
    icon={FileEmptyIcon}
    size={40}
    strokeWidth={1.5}
    className="mx-auto mb-4 text-ink/30"
    aria-hidden="true"
  />
  <p className="text-lg font-extrabold text-ink mb-1">{title}</p>
  <p className="text-muted font-medium">{body}</p>
  {cta && (
    <Link href={cta.href} className="btn-brutal mt-4 inline-flex">
      {cta.label}
    </Link>
  )}
</div>
```

### 3.2 Tokens

| Element | page | compact |
| --- | --- | --- |
| Container | `card-brutal bg-card p-12 text-center` | `text-center py-8 px-4` (already inside a card) |
| Icon | `size={40} strokeWidth={1.5}`, `mx-auto mb-4 text-ink/30` | `size={32}`, `mx-auto mb-3 text-ink/30` |
| Title | `text-lg font-extrabold text-ink mb-1` | `text-base font-extrabold text-ink mb-1` |
| Body | `text-muted font-medium` | `text-sm text-muted font-medium` |
| CTA | `btn-brutal mt-4 inline-flex` | `btn-brutal btn-brutal-white mt-3 text-xs px-3 py-1.5` |

Icons come from `@hugeicons/core-free-icons` (already the app's icon set).
`text-ink/30` is for the **decorative icon only** — the title and body carry the
meaning and must meet normal text contrast.

### 3.3 Copy rules

- **Title** — states the absence in the user's words, in sentence case, 2–6 words.
  "No subscriptions yet", not "Empty result set". Never end with a colon.
- **Body** — one short sentence saying *why it is empty* and *when it will fill*,
  or what the user can do. Never "No data available."
- **No-results body must echo the query** and suggest the fix — never blame the
  user and never say "none". Discover already does this correctly.
- **CTA** — present whenever the viewer can create or reach the data (go to
  Discover, start a subscription, add a goal, clear the search). Omit it when the
  emptiness is not actionable by this viewer (e.g. a supporter with no activity).
- **Never** put a raw error, status code, or `—` in an empty state.
- Copy is sentence case and matches the surrounding voice: direct, no exclamation
  marks (the one existing exception, "Check back soon!", is replaced in §4).

### 3.4 Accessibility

- Wrap the empty state in `role="status"` when it is rendered *in place of* results
  that arrived asynchronously, so a screen reader announces it on arrival.
- For search/filter surfaces, the results container stays `aria-live="polite"` —
  the empty state is the announced outcome, and the query is part of the message
  (that is why the title echoes it).
- The icon is decorative: `aria-hidden="true"`. Never carry meaning only in the
  icon.
- The CTA is a real link/button with an accessible name (not an icon-only control).
- Do not move focus into the empty state. It is content, not an alert.
- Loading must render `Skeleton` (as Discover and Subscriptions already do), never
  an empty state; a flash of "No subscriptions yet" before data arrives is a bug.

## 4. Per-Surface Specs

Every list/data surface in the app that can be empty. Copy is final and
handoff-ready; implement as written.

### S1 — Discover: no creators match the search

- **Surface:** creators grid, `frontend/app/discover/page.tsx` (empty branch).
- **Variant:** `no-results` · **Size:** page.
- **Icon:** `Search01Icon`.
- **Title:** “No creators found for “{query}””
- **Body:** “Try a shorter search, or check the spelling.”
- **CTA:** `Clear search` → resets `debouncedQuery` and shows all creators.

### S2 — Discover: no creators exist yet

- **Surface:** same grid, when the query is empty and the platform has no creators.
- **Variant:** `first-run` · **Size:** page.
- **Icon:** `FileEmptyIcon`.
- **Title:** “No creators yet”
- **Body:** “Creators appear here as soon as the first profile is set up.”
- **CTA:** none (not actionable by a visitor). Replaces today's “Check back soon!”.

### S3 — Discover: active tab/filter matches nothing

- **Surface:** same grid, when a tab (e.g. trending / newest — `FireIcon`,
  `Clock01Icon`) filters the list to nothing but creators do exist.
- **Variant:** `no-results` · **Size:** page.
- **Icon:** the tab's own icon (`FireIcon` for trending, `Clock01Icon` for newest).
- **Title:** “Nothing {trending|new} right now”
- **Body:** “No creator matches this view yet — see all creators instead.”
- **CTA:** `See all creators` → activates the all-creators tab.

### S4 — Discover: no search matches for a typed handle

- **Surface:** same grid, when the query looks like a handle (starts with `@` or
  contains no spaces) and no creator matches it.
- **Variant:** `no-results` · **Size:** page.
- **Icon:** `UserSearch01Icon`.
- **Title:** “No profile for {query}”
- **Body:** “Check the username — handles are case-insensitive but must match
  exactly.”
- **CTA:** `Clear search`.

### S5 — Dashboard: no recent activity

- **Surface:** Recent Activity panel, `frontend/app/dashboard/page.tsx`
  (`activity.length === 0`).
- **Variant:** `first-run` · **Size:** compact (inside the existing `card-brutal p-6`).
- **Icon:** `Clock01Icon`.
- **Title:** “No tips yet”
- **Body:** “Tips you receive and cash-outs you make will appear here.”
- **CTA:** `Share your profile` → opens the existing `ShareModal`
  (`frontend/components/ShareModal.tsx`) — this is the action that creates the data,
  and it replaces today's bare “No activity yet. Share your profile link to get
  started!” sentence.

### S6 — Dashboard: earnings chart window is empty

- **Surface:** `frontend/components/TipChart.tsx` (currently “No tips in this window
  yet.”).
- **Variant:** `first-run` (no tips at all) / `no-results` (none *in the selected
  window*) · **Size:** compact.
- **Icon:** `ChartLineData01Icon` for the `no-results` case; omit the icon when the
  whole account has no tips and S5 is already visible on the same screen (avoid
  repeating two empty states in one viewport).
- **Title:** “No tips in this window”
- **Body:** “Pick a longer range to see earlier tips.” (For an account with no tips
  at all: “Your earnings will chart here after your first tip.”)
- **CTA:** `Show all time` (range selector) where the range control exists.

### S7 — Activity: no users

- **Surface:** users table, `frontend/app/activity/page.tsx`
  (`data.users.length === 0`).
- **Variant:** `first-run` · **Size:** page (replaces the bare “No users yet.”).
- **Icon:** `UserGroupIcon`.
- **Title:** “No activity yet”
- **Body:** “Platform users and their donation counts appear here once the first
  tip is sent.”
- **CTA:** none (admin/observability surface; not actionable here).

### S8 — Subscriptions: supporter has no recurring donations

- **Surface:** subscriptions list, `frontend/app/app/subscriptions/page.tsx`
  (`subscriptions.length === 0`).
- **Variant:** `first-run` · **Size:** page (upgrade today's icon-less, title-less card).
- **Icon:** `RepeatIcon`.
- **Title:** “No recurring donations yet”
- **Body:** “Start one from a creator's profile and it will show up here with its
  next charge date.”
- **CTA:** `Find a creator` → `/discover`.

### S9 — Settings: no active goals

- **Surface:** goals list, `frontend/app/settings/page.tsx` (“No active goals yet.”).
- **Variant:** `first-run` · **Size:** compact (the “Add a goal” card sits directly
  below, so the empty state must not compete with it).
- **Icon:** none — the adjacent “Add a goal” card is the affordance; an icon here
  would duplicate it.
- **Title:** “No active goals”
- **Body:** “Add a goal to show supporters what you're working towards.”
- **CTA:** none — relies on the adjacent form (and the pattern allows an
  icon-less, CTA-less compact empty state).

### S10 — Creator profile: no profile exists

- **Surface:** `frontend/app/[username]/CreatorProfileClient.tsx`
  (“No profile exists for @username.”).
- **Variant:** `absence` · **Size:** page.
- **Icon:** `UserSearch01Icon`.
- **Title:** “No profile for @{username}”
- **Body:** “This handle hasn't been claimed. Check the spelling, or explore
  creators who are already here.”
- **CTA:** `Discover creators` → `/discover`.
- **Note:** this is an *absence*, not an error — it keeps the neutral card styling
  and must not become the `error.tsx` treatment. The HTTP 404 that produces it is
  already handled by the caller.

### S11 — Activity: empty cell within a populated table

- **Surface:** `frontend/app/activity/page.tsx`, the per-row empty cell (`—`).
- **Variant:** `zero` (see §5) · **Size:** inline.
- **Treatment:** keep the em dash, styled `text-muted`, with a `title`/`aria-label`
  giving the reason (e.g. “No profile set”). This is a missing *field*, not an
  empty *surface* — it must not grow into a card.

### S12 — Dashboard: withdrawn / volume statistics at zero

- **Surface:** the Withdrawn card (`withdrawnTotal === 0` → bare `—`) and the XLM /
  USDC volume cards, `frontend/app/dashboard/page.tsx`.
- **Variant:** `zero` (see §5).
- **Treatment:** show the real zero — `0 XLM`, `0 USDC`, `0 XLM/USDC` — styled as
  the other values (`text-2xl sm:text-3xl font-extrabold text-ink tabular-nums`).
  A lifetime total of zero is information; `—` hides it. Only the per-row missing
  *field* case (S11) keeps the dash.

## 5. Empty vs Zero

These must not be conflated:

| State | Meaning | Treatment |
| --- | --- | --- |
| **Empty** | There is no collection to show | The pattern in §3, with copy from §4 |
| **Zero** | A measurable value is genuinely 0 | Render the value: `0 XLM`, `0 tips`. Never `—` for a total |
| **Missing field** | A single cell has no value; the row exists | `—` in `text-muted` with an accessible reason (S11) |
| **Loading** | Data not yet fetched | `Skeleton` (`frontend/components/Skeleton.tsx`) — never an empty state |
| **Error** | The fetch failed | The failure treatment in `donation-subscription-failure-states.md`, never the empty state |

## 6. Motion & Behaviour

- No animation on the empty state itself; it appears with the rest of the content.
  (Reveal/entrance motion is out of scope here.)
- Search-driven empty states (S1, S3, S4) update as the user types, debounced with
  the existing discover debounce, and are announced via `aria-live="polite"`.
- Clearing a search or switching a tab restores the list without a full reload;
  the empty state unmounts with the results container.
- A CTA navigates (or opens the existing modal); it never fires a request that
  could fail into an error state without the failure treatment.

## 7. Handoff

1. **New component** — `frontend/components/EmptyState.tsx`, props:
   `{ icon?: IconType; title: string; body?: string; cta?: { label: string; href?: string; onClick?: () => void }; size?: 'page' | 'compact'; className?: string }`.
   It renders §3.1 and the §3.4 accessibility rules. This is the only place the
   pattern is expressed.
2. **Adopt per surface** — S1–S4, S5, S7, S8, S10 replace their current markup with
   `<EmptyState …/>`; S6, S9 use the `compact` size; S11 and S12 are zero/missing
   rules applied in place with no new component.
3. **Tests** — each adopted surface gains a unit assertion on the title/CTA copy,
   and Discover's existing empty-state tests (`frontend/app/__tests__`,
   `frontend/e2e/creator-profile.spec.ts`) are extended to the new copy where they
   assert on it.
4. **Out of scope** — illustrations/artwork (the icon treatment is the pattern for
   now), entrance animation, any change to when data is fetched, and the failure
   copy owned by `donation-subscription-failure-states.md`.
