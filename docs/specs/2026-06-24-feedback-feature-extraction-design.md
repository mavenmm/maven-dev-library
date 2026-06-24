# maven-dev-library — Feedback Component: Extraction & Multi-App Rollout

**Status:** Design — approved direction (2 adversarial review rounds + stakeholder sign-off: Dave, Adam)
**Revision:** 2 (2026-06-24) — corrects factual errors from review round 2; re-sequences to a text-first Phase 1
**Owner:** Rondie
**Source task:** Teamwork 40757043 — "Please add feedback feature to all Maven apps" (Dave Makerewich)
**Source feature:** `mavenmm/copydeck-writing` — the working implementation and **behavioral source of truth**

> This is the **program-level** spec. Implementation proceeds as **separate per-phase plans**.
> **Plan A = Phase 1 (maven-home text-feedback slice)** is the only plan written now.

---

## 1. Context & Goal

Dave built an in-app **feedback feature** in the CopyDeck web app: a user clicks a
button, a modal opens; they either write text + paste screenshots, or record a
screenshare. Video uploads to Vimeo, an AI summarizes the auto-transcript, and a
Teamwork task is auto-created (assigned per-app, on "To Do (ASAP)") carrying the
video link, a deep link to the page, and the AI summary as a follow-up comment.

He wants the same feature in every Maven app. Rather than copy-paste it, we are
standing up **`maven-dev-library`** — a private, shadcn-style shelf of reusable
Maven dev components. **Feedback is component #1.**

### Two goals, held together
- **Tactical (Dave, ~Jun 26):** a real, working feedback button in a 2nd app.
- **Strategic (Rondie):** a durable `maven-dev-library` for future components.

Sequencing honors both: ship a **text-feedback** vertical slice to maven-home
first (fast, no async infra), then harden into the full library + video, then fan out.

---

## 2. Non-goals
- Not rebuilding the feedback UX — copydeck defines it; we mirror it.
- Not migrating any app to Next.js (all targets are Vite).
- **Reference Anchor Library** integration is out of scope — Dave does it himself.
- **maven-portal** is NOT a target (not in Dave's list; pure SPA, no backend).

---

## 3. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Distribution = **private GitHub Packages** (`@mavenmm` scope). Git-dependency as fallback. | Code is private (it carries business-logic-adjacent design). One-time `.npmrc` + read token per app/CI (Netlify = one env var). **Correction:** `@mavenmm/teamwork-auth` is on *public npm*, so there is NO existing private rail to "reuse" — this is net-new but small. |
| D2 | **Two packages:** `@mavenmm/feedback-core` (pure logic) + `@mavenmm/feedback-ui` (React widget). | Shared brain vs. shared skin. |
| D3 | UI ships with its **own precompiled, scoped CSS**: Tailwind reset (`preflight`) OFF, every class prefixed + wrapped in a scoping selector, **no runtime-built class strings**. Zero Tailwind required in the host. | Hosts vary: maven-home/paab = Tailwind **v4**; maven-dashboard ui = Tailwind **v3** + Chakra/Emotion; status-update = MUI/Emotion (no Tailwind). Self-contained CSS is **independent of the host's Tailwind version** — sidesteps the v3/v4 split entirely. |
| D4 | Each app provides its own **backend wiring** (HTTP endpoints + config + secrets) calling `feedback-core`. | Targets span Vite+Netlify and Vite+Netlify+GraphQL/Prisma API. Core stays framework-neutral. |
| D5 | **Text-first vertical slice:** Phase 1 ships *text* feedback to maven-home (synchronous, no Vimeo, no poller). Video + AI-summary follow in Phase 2. | Both judges asked for this; it's the only thing realistically shippable by ~Jun 26. |
| D6 | A **Teamwork bot/service account** replaces Chris's personal token **before fan-out (Phase 3)** — NOT before app #1. | The follower-stripping hack exists only because of a personal token. Bot fixes attribution/rate-limit/offboarding and deletes ~40 lines. Dave's rule: **mandatory the moment we go from one extra app to two.** |
| D7 | The video transcript→summary backend is **centralized** by **reusing copydeck's existing PM2 poller + Postgres store**: other apps write `pending` rows (with `app_id`) into it; the existing poller drains all. (A Cloudflare Worker on a Cron Trigger is the future alternative if we outgrow it.) | Vimeo has **no transcript-ready webhook** (confirmed) → must poll. Reusing the working poller avoids standing up a new service. Accept the coupling: if copydeck's poller is down, summaries pause everywhere. |
| D8 | Feedback **screenshots hosted centrally** (one library-owned bucket + stable custom domain + lifecycle cleanup). | Permanent image URLs are baked into Teamwork comments forever; per-app hosting 404s if any app domain changes, and risks exposing client content. |

---

## 4. Architecture

### 4.1 Repo layout (`maven-dev-library`, npm workspaces)
```
maven-dev-library/
├── packages/
│   ├── feedback-core/        # @mavenmm/feedback-core  — pure TS, no framework/DOM
│   └── feedback-ui/          # @mavenmm/feedback-ui    — React widget + scoped CSS
├── examples/
│   ├── netlify/              # reference wiring (maven-home / status / paab)
│   └── graphql-prisma-api/   # reference wiring for the dashboard-style API
├── docs/
│   ├── specs/                # this document
│   └── integration.md        # per-stack integration guide (endpoint contracts, CSP, auth)
└── README.md
```
The Phase-2 async backend is **copydeck's existing poller** (D7), not a new service here.
Future components land as additional `packages/*`.

### 4.2 `@mavenmm/feedback-core` — the brain
Pure TS. No `"use server"`, no Next, no Prisma, no DOM. Functions take
**(config, secrets, input, submitter)** → data.
- `createTextFeedback(cfg, secrets, input, submitter)` → `{ taskId, url }`  ← **Phase 1**
- `createVideoTarget(cfg, secrets, { sizeBytes, subject })` → Vimeo tus target  ← Phase 2
- `submitVideoFeedback(cfg, secrets, input, submitter)` → `{ taskId, url, pending }`  ← Phase 2
- `runSummaryPass(cfg, secrets, store, opts)` — drain pending → transcript → Claude → 2nd comment  ← Phase 2
- Parameterized Teamwork + Vimeo clients + HTML composers, all exported.

App supplies:
- **`submitter`** — resolved server-side from the app's auth. In the Netlify apps
  the pattern is: read the Maven JWT → exchange at `auth.mavenmm.com` → get a
  `userId` → resolve name/email (Teamwork people lookup). Core must accept a
  submitter that may be **`{ userId }` only**; the HTML composer tolerates a
  missing email (it already does).
- **`PendingStore`** interface (`add`/`listPending`/`markSummarized`/`markFailed`/
  `bumpAttempt`) — in the centralized model (D7) copydeck's poller owns the one impl.

Encoded-in-core invariants (mirror copydeck exactly; must NOT regress):
- Rich body goes in the **first comment, not the task description**.
- Follower cleanup runs **after** the comment. Removed entirely once the bot lands (D6).
- Video path is **two-phase**: task created immediately with "🤖 summary pending".
- `summary.model` is **config**, not a constant.

### 4.3 `@mavenmm/feedback-ui` — the skin
React: `<FeedbackProvider>`, `<FeedbackLauncher>`, `<FeedbackWidget>`,
`useScreenRecorder()` (Phase 2). Talks to the app via plain `fetch` to
app-supplied endpoint URLs (no server actions → runs in Vite).
- **Self-contained scoped CSS** per D3.
- **Configurable high z-index** for the body portal (avoid MUI/Chakra modal collisions).
- **Rich-text + screenshots are opt-in.** Default = plain textarea. Phase 1 ships
  the textarea; screenshots are a near-term sub-phase (not lumped into video).
- **TipTap/ProseMirror dedupe:** when rich-text is enabled, declare `@tiptap/*`
  and `prosemirror-*` as **peer deps**, or ship the composer as an **adapter** to
  the host's existing editor. (dashboard + status already run TipTap → two
  ProseMirror copies in one bundle break.) The app-local `ResizableImage` node
  must be re-homed into the package/adapter, not assumed.
- **React 18 + 19 peer range; built and tested against React 19** first (maven-home is 19).
- **CSP/Permissions-Policy:** the recorder needs `display-capture` + `microphone`
  and `connect-src` open to `api.vimeo.com` + the tus host. `integration.md` ships
  a paste-able Netlify header block.

### 4.4 Config & secrets (lock **v1** before maven-home wiring)
```ts
FeedbackConfig = {
  teamwork: { baseUrl, tasklistId, assigneeId, workflowId, stageId, soleFollowerId? },
  routes?: { [key]: { label, tasklistId, assigneeId, stageId } }, // PAAB — full destination
  vimeo?: { folderId },        // folder ID, not name-match (bug B2)
  summary?: { model, maxTokens },
  ui?: { richText?: boolean, zIndex?: number }
}
Secrets = { teamworkToken, vimeoToken?, anthropicKey? }   // server-side env only, never client
```
Secrets are shared Maven-level; per-app only the routing config differs.

### 4.5 Per-stack backend wiring (`docs/integration.md` — incl. exact HTTP endpoint contracts)
Each app writes thin endpoints calling `core.*`. The UI↔backend HTTP request/
response shapes are specified in `integration.md` (not just core's signatures).
- **maven-home / status-update / paab (Netlify):** endpoints as Functions. Text
  path is fully synchronous. Video `pending` descriptor is written to copydeck's
  shared store (D7).
- **maven-dashboard:** a Vite UI on **Netlify** + a separate **Apollo GraphQL +
  Prisma** API (which already runs a Prisma cron). Feedback endpoints added as
  **REST routes on that existing API**, not a greenfield Express app.
- **copydeck (Phase 2):** endpoints stay route handlers/server actions; its poller
  becomes the shared central poller (D7).

**Interim summary contract (until the shared poller accepts other apps):** the task
**files immediately**; the summary is best-effort and **never blocks submit**; the
video link + "summary pending" note are always on the task.

### 4.6 Centralized async-summary backend (Phase 2 = reuse copydeck's poller)
copydeck's PM2 poller + Postgres `FeedbackVideo` table become the shared drain.
**Net-new:** add an **`app_id`** column (+ a teamwork-config reference) to the
pending row, written at submit, so each summary routes back to the right app's
Teamwork config. No Vimeo-metadata routing (no webhook exists; routing is purely
the DB row). Add **structured logging + a daily digest of `failed` rows to Slack**
(console-only is invisible across apps).

### 4.7 Centralized screenshot hosting (lands with text-screenshots sub-phase / Phase 2)
One library-owned, feedback-only bucket (R2/S3) behind a **stable custom domain**,
with a lifecycle expiry rule. `feedback-core` exposes `publicUrlFor(key, baseUrl)`;
the permanent URL never depends on an app's deploy domain. Fix bug B1 (prefix) here.

---

## 5. PAAB routing (Phase 3 special case)
PAAB needs an **interactive pre-submit question** in the widget: "general → assign
**Rondie**, or Agentic research assistant → assign **Dave**." This is UI flow +
config, not config alone: the widget shows the prompt only when `routes` is
configured; each route carries the **full destination** (tasklist + assignee +
stage). Net-new logic (copydeck always assigns Dave) — build and test, don't
assume extracted. Gated behind the paab auth spike (§6).

---

## 6. Prerequisites

**Phase 1 prerequisites (small):**
1. **Clone `copydeck-writing`** into the workspace (the extraction source + parity oracle).
2. **Lock `FeedbackConfig`/`Secrets` v1** (§4.4) before wiring maven-home.
3. **Set up private GitHub Packages** publish (library CI) + install auth in maven-home (one Netlify env var). Git-dep fallback if needed.

**Phase 3 prerequisites (only matter at fan-out — do NOT block Phase 1):**
4. **Teamwork bot/service account** + token (D6). Mandatory before the 2nd extra app.
5. **paab auth spike:** paab/frontend has **no `@mavenmm/teamwork-auth`** (it uses
   Supabase + client-side jwt-decode) → no server-side `submitter` path. Time-boxed
   research; fallback = "Unknown user" + page deep-link, or paab drops from the wave.
6. **Vimeo quota check:** one shared account for 5 apps' recordings; plan the
   "(To Delete)" folder cleanup.

---

## 7. Phased rollout

**Phase 1 — Text slice (target ~Jun 26):**  *(this is Plan A)*
- Create `maven-dev-library` repo + workspaces; private GH Packages publish.
- `@mavenmm/feedback-core`: extract + parameterize the **text path**
  (`createTextFeedback`) from copydeck; lock config v1; fix bugs B1/B3.
- `@mavenmm/feedback-ui`: launcher + modal + **plain textarea** (no recorder yet),
  scoped CSS, configurable z-index; built/tested on React 19.
- Wire **maven-home** (Rondie): install both packages, add Netlify Function(s) on
  the existing `get-teamwork-token` rails, supply config. Files a real Teamwork task.
- **copydeck untouched.**
- Outcome: a working feedback button in a 2nd app; library exists; zero duplicated logic.

**Phase 2 — Harden (video + summary):**
- Add screen-recorder + tus upload to `feedback-ui` (rich-text/screenshots sub-phase too).
- Reuse copydeck's poller as the shared drain; add `app_id` (§4.6); add logging/Slack digest.
- Stand up the central screenshot bucket (§4.7).
- Refactor **copydeck** to consume the packages — **gated on the parity test (§8)**.

**Phase 3 — Fan out:**
- Bot account (D6) first. Then maven-dashboard (REST routes on its GraphQL/Prisma
  API), status-update (Netlify), paab (routing question §5 + auth spike §6.5).

---

## 8. CopyDeck parity gate (Dave's non-negotiable)
The Phase-2 copydeck refactor must produce **identical behavior**, proven by an
**actual filed Teamwork task** (not a green build):
- Same task in the right tasklist; **body in the first comment**, not the description.
- **Two-phase video** works (task immediate; summary backfilled).
- **Follower end-state** correct — and the test asserts the **end-state parametrized
  for the bot account** (i.e. "token-owner is not a follower"), NOT a hardcoded user id.
Do it on a branch, parity-check, merge. No fix-forward on main. No regression for a day.

---

## 9. Concrete bugs to fix during extraction (all confirmed in the real code)
- **B1 — S3 prefix:** upload route's header comment says `feedback/` but it writes
  `images/feedback/`; the serve guard allows only `images/feedback/`. Lock the
  prefix in ONE place in core.
- **B2 — Vimeo folder lookup:** `per_page=100` with no pagination → silently fails
  past 100 folders. Pass folder **ID** via config instead of name-matching.
- **B3 — Silent give-up:** poller's fallback comment is `.catch(() => {})` → invisible
  failure. Add structured logging.
- **B4 — CJS/ESM duplication:** `vimeo.ts` logic is duplicated in `poller.js`. Core's
  dual build removes it.

---

## 10. Risks & open questions
- **R1 — Vimeo polling (not webhook):** no transcript-ready webhook exists; Phase 2
  is the reused PM2 poller. Budget for the poll loop + the bounded-retry behavior.
- **R2 — CSP / Permissions-Policy:** Netlify apps may block `display-capture`/
  `microphone`/`connect-src` → recorder silently fails. Ship a paste-able header block.
- **R3 — TipTap/ProseMirror dedupe:** peer-dep or adapter (see §4.3) — real blocker
  for dashboard/status when rich-text is on.
- **R4 — Library ownership + config API:** owner = Rondie for the build; **pin
  `FeedbackConfig` v1 from day one** (consumed by maven-home in Phase 1).
- **R5 — Version skew / GH Packages auth in CI:** each consuming app's build env
  needs the read token for the private scope; document the upgrade convention before Phase 3.
- **R6 — Poller coupling (D7):** all apps' summaries depend on copydeck's poller
  being up; acceptable interim, revisit if it becomes a SPOF.

---

## 11. Target apps
| Dave's app | Repo | Frontend | Backend | React | Tailwind | teamwork-auth? | Assignee | Phase |
|---|---|---|---|---|---|---|---|---|
| Maven Home | maven-home | Vite | Netlify Functions (`get-teamwork-token` rails) | 19 | v4 | ✓ | Rondie | **1** |
| Maven Copy Deck | copydeck-writing | Next.js | RSC + PM2 poller + Prisma/Postgres | — | (Tailwind) | its own auth | Dave | 2 (parity refactor) |
| Maven Dashboard | maven-dashboard | Vite (Chakra+Emotion) on Netlify | separate Apollo GraphQL + Prisma API (+ existing cron) | — | v3 | ✓ | Adam | 3 |
| Maven Status App | status-update | Vite (MUI+Emotion) | Netlify Functions | 18 | none | ✓ | Adam | 3 |
| Maven PAAB app | paab-app/frontend | Vite | Netlify Functions | 19 | v4 | ✗ (Supabase; spike) | general→Rondie / agentic→Dave | 3 |
| Reference Anchor Library | — | — | — | — | — | — | Dave (self) | out of scope |
