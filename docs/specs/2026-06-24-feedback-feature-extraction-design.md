# maven-dev-library — Feedback Component: Extraction & Multi-App Rollout

**Status:** Design (approved direction, pending spec review)
**Date:** 2026-06-24
**Owner:** Rondie
**Source task:** Teamwork 40757043 — "Please add feedback feature to all Maven apps" (Dave Makerewich)
**Source feature:** `mavenmm/copydeck-writing` (the working implementation)

---

## 1. Context & Goal

Dave built an in-app **feedback feature** in the CopyDeck web app: a user clicks a
button, a modal opens, they record a screenshare (or write text + paste
screenshots); the video uploads to Vimeo, an AI summarizes the auto-transcript,
and a Teamwork task is auto-created (assigned per-app, on the "To Do (ASAP)"
board column) carrying the video link, a deep link to the exact page, and the AI
summary as a follow-up comment.

He wants the same feature in every Maven app. Rather than copy-paste it into each
codebase, we are standing up **`maven-dev-library`** — a shared, shadcn-style
"shelf" of reusable Maven dev components. **Feedback is component #1.** The
library is a real, ongoing goal; this spec covers both the library foundation and
the feedback rollout, sequenced so the feature ships fast without the library
becoming a multi-week prerequisite.

### Two goals, explicitly held together
- **Tactical (Dave, due ~Jun 26):** feedback live in more apps, soon.
- **Strategic (Rondie):** a durable `maven-dev-library` where future components slot in.

The sequencing below honors both: stand up the library + feedback packages and
prove them in ONE new app first (maven-home), then harden the shared
infrastructure and fan out.

---

## 2. Non-goals
- Not rebuilding the feedback UX — it is defined by the working CopyDeck version.
- Not migrating any app to Next.js (all targets are Vite).
- The **Reference Anchor Library** integration is out of scope — Dave does that himself.
- **maven-portal** is NOT a target (not in Dave's list; pure SPA, no backend).

---

## 3. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Distribution = **npm packages** published to **GitHub Packages** (`@mavenmm` scope). Git-dependency as fallback. | Reuses the exact rails `@mavenmm/teamwork-auth` already rides in 3 apps. Bugfixes propagate via version bump. **No code duplicated across apps** — only thin backend wiring is app-local. |
| D2 | **Two packages:** `@mavenmm/feedback-core` (pure logic) + `@mavenmm/feedback-ui` (React widget). | Clean split: shared brain vs. shared skin. |
| D3 | UI ships as a package with its **own precompiled, scoped CSS**. No Tailwind required in the consuming app; no per-app restyle; no copy-in. | Targets use MUI/Chakra/Emotion, not Tailwind. A self-contained feedback overlay (Sentry/Intercom-style identity) is acceptable and simpler than theming into 4 design systems. |
| D4 | Each app provides its own **backend wiring** (HTTP endpoints + config + secrets) calling `feedback-core`. | Apps span Vite+Netlify, Vite+Express. Core stays framework-neutral; the HTTP wrapper is app-local and small. |
| D5 | **Vertical slice first:** prove feedback end-to-end in maven-home before building the heavy shared infra. | Both persona judges (requester Dave, implementer Adam) asked for this. Avoids backloading the deliverable. |
| D6 | A **Teamwork bot/service account** replaces Chris's personal token before fan-out. | The whole follower-stripping hack exists only because of a personal token. Bot author fixes attribution, rate-limit sharing, and the offboarding bomb; deletes ~40 lines. |
| D7 | The async transcript→summary backend is **centralized** (one shared webhook-receiver + one queue), not replicated per app. | Netlify Scheduled Functions can't hold a 30-min retry loop; Blobs isn't a queue; per-app Neon DBs = heavy ops. |
| D8 | Feedback **screenshots are hosted centrally** (one library-owned bucket + stable custom domain + lifecycle cleanup). | Permanent image URLs are baked into Teamwork comments forever; per-app hosting 404s if any app domain changes, and risks exposing client content. |

---

## 4. Architecture

### 4.1 Repo layout (`maven-dev-library`, monorepo via npm workspaces)
```
maven-dev-library/
├── packages/
│   ├── feedback-core/        # @mavenmm/feedback-core  — pure TS, no framework/DOM
│   └── feedback-ui/          # @mavenmm/feedback-ui    — React widget + scoped CSS
├── services/
│   └── summary-receiver/     # (Phase 2) shared webhook receiver + queue
├── examples/
│   ├── express/              # reference backend wiring (dashboard)
│   └── netlify/              # reference backend wiring (home/status/paab)
├── docs/
│   ├── specs/                # this document
│   └── integration.md        # per-stack integration guide
└── README.md
```
Future components land as additional `packages/*`.

### 4.2 `@mavenmm/feedback-core` — the brain
Pure TS. No `"use server"`, no Next, no Prisma, no DOM. Every function takes
**(config, secrets, input, submitter)** and returns data.

Surface (illustrative):
- `createTextFeedback(cfg, secrets, input, submitter)` → `{ taskId, url }`
- `createVideoTarget(cfg, secrets, { sizeBytes, subject })` → Vimeo tus target
- `submitVideoFeedback(cfg, secrets, input, submitter)` → `{ taskId, url, pending }`
  (`pending` = the descriptor the app/queue persists for later summary)
- `runSummaryPass(cfg, secrets, store, opts)` → drains pending videos: fetch
  transcript → Claude summary → post 2nd comment → mark done/failed
- Parameterized Teamwork + Vimeo clients + HTML composers, all exported.

The app supplies two things core deliberately does not own:
- **`submitter`** — resolved from the app's own auth, server-side (never trusted
  from the client). See §6 spike for paab.
- **`PendingStore`** interface (`add` / `listPending` / `markSummarized` /
  `markFailed` / `bumpAttempt`) — app plugs in its storage. In the centralized
  model (D7) the shared receiver owns the one real implementation.

Encoded-in-core invariants (hard-won from CopyDeck; must NOT regress):
- Rich body goes in the **first comment, not the task description** (v1
  description came through empty).
- Follower cleanup runs **after** the comment (commenting re-subscribes the
  token owner). With the bot account (D6) this logic is removed entirely.
- Video path is **two-phase**: task created immediately with "summary pending",
  summary backfilled async.
- `summary.model` is **config**, not a constant.

### 4.3 `@mavenmm/feedback-ui` — the skin
React components: `<FeedbackProvider>`, `<FeedbackLauncher>`, `<FeedbackWidget>`,
`useScreenRecorder()`. Talks to the app via plain `fetch` to app-supplied
endpoint URLs (no server actions → runs in Vite). Characteristics:
- **Self-contained scoped CSS** (precompiled from Tailwind → plain CSS, scoped/
  prefixed so it can't collide). Consuming app needs zero Tailwind.
- **Configurable high z-index** for the `document.body` portal (avoid MUI/Chakra
  modal collisions).
- **Rich-text + screenshots are opt-in.** Default = plain textarea, so an app can
  ship text feedback without standing up TipTap or screenshot storage. The
  TipTap composer (and its image node) is gated behind a flag/adapter, never
  forced.
- React 18 + 19 declared as a peer range; tested on 18.

### 4.4 Config & secrets
```ts
FeedbackConfig = {
  teamwork: { baseUrl, tasklistId, assigneeId, workflowId, stageId, soleFollowerId? },
  routes?: { [key]: { label, tasklistId, assigneeId, stageId } }, // PAAB branch — full destination
  vimeo?: { folderId },        // folder ID, not name-match (see bug B2)
  summary?: { model, maxTokens },
  ui?: { richText?: boolean, zIndex?: number }
}
Secrets = { teamworkToken, vimeoToken?, anthropicKey? }   // server-side env only, never client
```
- CopyDeck's hardcoded tasklist/assignee/workflow/stage become per-app config.
- Secrets are shared Maven-level (one Vimeo account/folder, one Anthropic key,
  one Teamwork **bot** token). Per-app, only the routing config differs.

### 4.5 Per-stack backend wiring (the `docs/integration.md`)
Each app writes a few thin endpoints calling `core.*`:
- **Express (maven-dashboard):** endpoints as routes; summary handled centrally
  (D7). No in-process poller needed once the receiver exists.
- **Netlify (maven-home / status-update / paab):** endpoints as Functions;
  summary handled centrally (D7).
- **Next (copydeck, Phase 2):** endpoints stay route handlers/server actions;
  the existing PM2 poller is retired in favor of the central receiver (or kept
  as the one reference `PendingStore` if we phase that).

### 4.6 Centralized async-summary backend (Phase 2)
One shared **summary-receiver** service (Cloudflare Worker or a single Netlify/
Node service):
- Receives Vimeo "transcript ready" webhooks (preferred) **or** runs a single
  scheduled drain over one queue store.
- Owns the one `PendingStore` (one DB, e.g. Neon), keyed by `appId` so each
  summary routes to the correct Teamwork config.
- Calls `core.runSummaryPass`. Emits **structured logs + a daily digest of
  `failed` rows to Slack** (the current console.warn-only model is invisible
  across many apps).

### 4.7 Centralized screenshot hosting (Phase 2)
One library-owned, feedback-only bucket (R2 or S3) behind a **stable custom
domain**, with an S3/R2 **lifecycle rule** to expire old objects. `feedback-core`
exposes `publicUrlFor(key, baseUrl)`; the permanent URL never depends on an app's
deploy domain. Same idea for the Vimeo "(To Delete)" folder — add real cleanup.

---

## 5. PAAB routing (special case)
PAAB requires an **interactive pre-submit question** in the widget: "Is this about
the PAAB app in general, or the Agentic research assistant?" The answer selects a
route:
- **general → assign Rondie**
- **agentic → assign Dave**

This is **UI flow + config**, not config alone. The widget must support a
pre-submit routing prompt (only shown when `routes` is configured); each route
carries the **full destination** (tasklist + assignee + stage), since branches may
differ beyond just assignee. Net-new logic (CopyDeck always assigns Dave) — build
and test, don't assume it's extracted.

---

## 6. Prerequisites (Phase 0)
1. **Teamwork bot/service account** + its own token (D6). Removes the follower hack.
2. **Confirm GitHub Packages auth** mechanism used by `@mavenmm/teamwork-auth`
   and reuse it for publishing/installing the new packages.
3. **paab-app auth spike:** paab/frontend has **no `@mavenmm/teamwork-auth`** — it
   needs another trusted server-side way to resolve `submitter`, or feedback there
   degrades to "Unknown user." Resolve before paab rollout.
4. **Vimeo quota check:** one shared account receiving 5 apps' recordings — confirm
   upload + storage limits; plan the "(To Delete)" cleanup.

---

## 7. Phased rollout

**Phase 0 — Prerequisites:** items in §6.

**Phase 1 — Vertical slice (target ~Jun 26):**
- Create `maven-dev-library` repo + workspaces.
- Build `@mavenmm/feedback-core` (extract + parameterize CopyDeck logic; fix bugs §8).
- Build `@mavenmm/feedback-ui` (scoped CSS, text-path first; rich-text opt-in).
- Wire **maven-home** (Rondie, no branch logic = simplest): install both packages,
  write ~4 endpoints + config + summary trigger (interim: simplest viable path).
- **copydeck untouched** — used only as the behavior-parity reference.
- Outcome: a working feedback button in a second app, library exists, zero
  duplicated logic.

**Phase 2 — Harden:**
- Stand up the centralized summary-receiver (D7) + centralized screenshot host (D8).
- Publish packages to GitHub Packages; point maven-home at published versions.
- Refactor **copydeck** to consume the packages — **gated on the parity test (§9)**.

**Phase 3 — Fan out:**
- maven-dashboard (Adam) — Express wiring.
- status-update (Adam) — Netlify wiring.
- paab (branch) — Netlify wiring + the pre-submit routing question (§5), after the
  auth spike (§6.3).

---

## 8. CopyDeck parity gate (Dave's non-negotiable)
Refactoring copydeck (Phase 2) must produce **identical behavior**, proven by an
**actual filed Teamwork task** (not a green build):
- Same task in the right tasklist; **body in the first comment**, not the description.
- Follower set ends as **assignee-only** (Dave).
- **Two-phase video** path works (task immediate; summary backfilled).
Do it on a branch, parity-check, then merge. No fix-forward on main. copydeck must
not regress for even a day.

---

## 9. Concrete bugs to fix during extraction (else copied ×N)
- **B1 — S3 prefix mismatch:** `feedback-upload/route.ts` header comment says
  top-level `feedback/` but `s3.ts` writes `images/feedback/`; the serve guard
  allows only `images/feedback/`. Lock the prefix in ONE place in core.
- **B2 — Vimeo folder lookup:** `moveVideoToFeedbackFolder` uses `per_page=100`
  with no pagination → silently fails past 100 folders. Pass folder **ID** via
  config instead of name-matching.
- **B3 — Silent give-up:** the poller's fallback comment is `.catch(() => {})` —
  if it fails, the failure is invisible. Add structured logging.
- **B4 — CJS/ESM duplication:** `vimeo.ts` logic is duplicated in `poller.js`
  because the poller is CJS and can't import the TS. Core's dual build removes
  the duplication.

---

## 10. Risks & open questions
- **R1 — Vimeo webhook coverage:** one shared account, webhooks routed to many
  apps. Validate Vimeo supports the needed webhook + that the receiver can route
  by video metadata/appId. (Webhook is preferred; scheduled drain is the fallback.)
- **R2 — CSP / Permissions-Policy:** Netlify apps may restrict `display-capture`/
  `microphone`/`connect-src` → recorder silently fails. Add a per-app preflight to
  `integration.md` (must allow the recorder + `api.vimeo.com` + tus host).
- **R3 — Bundle weight:** `tus-js-client` (+ optional TipTap) added to Vite apps.
  Keep rich-text opt-in to avoid forcing TipTap where unwanted.
- **R4 — Library ownership:** name an owner for `maven-dev-library`; pin a stable
  config-object API v1 from day one (don't ship hardcoded-constants-turned-exports).
- **R5 — Version skew:** GitHub Packages doesn't force upgrades; document an
  upgrade convention so 5 apps don't drift on `feedback-core`.

---

## 11. Target apps
| Dave's app | Repo | Stack | Backend | teamwork-auth? | Assignee | Phase |
|---|---|---|---|---|---|---|
| Maven Home | maven-home | Vite | Netlify Functions | ✓ | Rondie | 1 |
| Maven Copy Deck | copydeck-writing | Next.js | RSC/PM2/Prisma | ✓ (its own auth) | Dave | 2 (parity refactor) |
| Maven Dashboard | maven-dashboard | Vite | Express | ✓ | Adam | 3 |
| Maven Status App | status-update | Vite | Netlify Functions | ✓ | Adam | 3 |
| Maven PAAB app | paab-app/frontend | Vite | Netlify Functions | ✗ (spike) | general→Rondie / agentic→Dave | 3 |
| Reference Anchor Library | — | — | — | — | Dave (self) | out of scope |
