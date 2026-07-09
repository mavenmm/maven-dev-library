# Feedback Backend on Cloudflare — Worker + D1 (centralized service)

**Status:** Design — awaiting Rondie review
**Date:** 2026-07-09
**Owner:** Rondie
**Parent spec:** [`2026-06-24-feedback-feature-extraction-design.md`](./2026-06-24-feedback-feature-extraction-design.md) (program-level)
**Source task:** Teamwork 40757043 — "Add feedback feature to all Maven apps" (Dave)
**Behavioral source of truth:** `mavenmm/copydeck-writing` (droplet + Postgres + PM2 poller)

> This design **revises** two decisions of the parent spec (D4, D7) and realizes the
> Cloudflare alternative the parent spec pre-blessed in D7. It does not change the
> UX, the library-first strategy, the parity gate (§8 of parent), or the phased rollout.

---

## 1. What changes vs. the parent spec

The parent spec chose **per-app backend wiring** (D4: each app writes thin endpoints
calling `@mavenmm/dev-library/core`) and a **single shared async poller = copydeck's
DO droplet + Postgres** (D7), with "a Cloudflare Worker on a Cron Trigger" named as
the future replacement.

This design promotes that future to the present:

| Parent decision | Revised to |
|---|---|
| **D4** — each app wires its own backend endpoints calling core | **One central Cloudflare Worker** exposes the feedback HTTP API; apps call it. Each app keeps only a **thin Netlify auth-proxy** (project-specific glue). |
| **D7** — reuse copydeck's PM2 poller + Postgres as the shared drain | **CF Worker (Cron Trigger) + D1** is the drain. Copydeck's droplet poller is retired when copydeck is refactored (last). |

Rationale (Rondie): pure, shareable, scheduled serverless is more reliable and
manageable on Cloudflare than on per-app Netlify Functions; Maven already runs most
cron jobs on CF Workers. Netlify Functions stay for project-specific glue (auth).

**Unchanged:** the feedback UX, `@mavenmm/dev-library/{core,ui}` as the shared brain +
skin, the copydeck parity gate, and the rollout order.

---

## 2. Key insight — the logic is already extracted

`@mavenmm/dev-library/core` (v0.2.1) already exports the entire backend brain,
framework-neutral (no DOM, no Node-only assumptions):

- `createTextFeedback(cfg, secrets, input, submitter)` → `CreateFeedbackResult`
- `createVideoTarget(cfg, secrets, sizeBytes, subject)` → `VideoUploadTarget`
- `submitVideoFeedback(cfg, secrets, input, submitter)` → `{ result, pending? }`
- summary path (`summary.ts`) → `SummaryOutcome` (`summarized | retry | failed`)
- parameterized Teamwork + Vimeo clients + HTML composers
- config/secrets/submitter model in `types.ts` (`FeedbackConfig`, `Secrets`,
  `Submitter`, `PendingVideo`, `SummaryOutcome`)

**The Worker reimplements none of the per-request logic.** It is a thin host that:
1. maps HTTP routes → `core.*` calls,
2. provides a **D1-backed store** for `PendingVideo` rows,
3. runs a **cron handler** that drains pending rows through core's per-video summary,
4. authenticates callers.

maven-home is already 90% wired for this: `functions/feedback*.ts` call these exact
core functions today. The migration is redirecting them at the Worker + closing the
one open hop (`feedback-video.ts` currently only `console.log`s the pending descriptor).

### 2.1 Materials/parity audit (2026-07-09) — verified against local copydeck

Line-by-line comparison of `copydeck-writing/app` against `dev-library/core`:

- **Ported & faithful:** text path (`create-text-feedback.ts` == copydeck `createFeedbackTask`),
  video target + submit (`create-video-feedback.ts`), transcript fetch + clean
  (`vimeo.ts:fetchTranscript`/`vttToText`), summarize-one-video (`summary.ts` +
  `summarizePendingVideo`). Config/submitter are injected instead of hardcoded/`getCurrentUser`.
- **Workers-runtime clean — `nodejs_compat` NOT needed** (resolves R2): core has zero
  `node:*`, `Buffer`, `process.env`-at-import, AWS SDK, Prisma, or `@anthropic-ai/sdk`.
  It already calls Anthropic via REST `fetch`. The Node/Netlify deps all live in
  copydeck host code (`s3.ts`, `poller.js`, `feedback-actions.ts`) that we are NOT
  porting as-is.
- **Net-new in the Worker** (core stops at "one video"; `poller.js` is the port oracle):
  1. the **drain loop** — `BATCH=5` oldest-first, `MAX_ATTEMPTS=40`, re-entrancy guard,
     per-row try/catch; `setInterval`(45 s) → **CF Cron Trigger**;
  2. the **D1 pending store** — write row on submit (core returns a descriptor, does
     not persist), query batch, bump `attempts`, set `status`/`last_error`;
  3. the **give-up branch** — the "🤖 auto-transcript wasn't available in time" fallback
     comment exists only in `poller.js`, not core; reproduce it (+ follower clear + mark
     `failed`);
  4. thin auth proxy + config/secrets plumbing (§4–5).
- **Deviations to accept (not bugs):** core's summary prompt is generic (correct for
  maven-home; copydeck's is pharma-specific); core omits `stripCodeFences` (trivial
  robustness add); Vimeo folder move needs the **numeric `folderId`** in config (B2 fix).
- **Not applicable to this build:** copydeck's `s3.ts` (screenshots stay on maven-home's
  Netlify→S3 function) → Worker needs no R2/AWS SDK.

---

## 3. Architecture

### 3.1 Components

```
 App frontend (maven-home, Vite)
    │  user clicks Feedback → dev-library/ui widget
    │  POST /api/feedback* (same-origin)
    ▼
 maven-home Netlify Function  ── thin AUTH PROXY (project glue) ──┐
    │  • teamwork-auth exchange → resolve Submitter               │
    │  • attach shared secret                                     │
    │  • image upload STAYS here → S3 (unchanged)                 │
    ▼                                                             │
 ┌─────────────────────────── CF Worker (generic backend) ───────┘
 │  routes:  POST /feedback/text
 │           POST /feedback/video-target
 │           POST /feedback/video        (writes pending row → D1)
 │  cron:    */N  drain D1 pending → core.summary → 2nd TW comment
 │  imports: @mavenmm/dev-library/core   (all logic)
 │  binds:   D1 (feedback_video queue + app config)
 │  secrets: TEAMWORK_ACCESS_TOKEN, VIMEO_ACCESS_TOKEN,
 │           ANTHROPIC_API_KEY, WORKER_SHARED_SECRET
 └──────────────────────────────────────────────────────────────
        │                              │
        ▼                              ▼
   Teamwork API                   Vimeo API (tus + transcripts)
```

### 3.2 The Worker

Small CF Worker (plain fetch handler or Hono; TS; `nodejs_compat` if core needs it).
Endpoints mirror the current maven-home function contracts so the UI is unchanged:

- `POST /feedback/text` → `core.createTextFeedback` → `{ ok, taskId, url }`
- `POST /feedback/video-target` → `core.createVideoTarget` → `VideoUploadTarget`
- `POST /feedback/video` → `core.submitVideoFeedback`; on `pending`, **insert a D1
  row** (this closes the gap that is only a `console.log` today) → `{ ok, taskId, url }`
- **`scheduled` (cron)** → list `pending` rows, run each through the core summary
  path; `summarized` → post 2nd Teamwork comment + mark done; `retry` → bump attempt;
  `failed`/attempts exhausted → mark failed + log. (Poll interval ≈ copydeck's 45 s
  behavior expressed as a cron cadence; `MAX_ATTEMPTS` ≈ 40 preserved.)

Per-app `FeedbackConfig` (Teamwork IDs, Vimeo folder, summary model) is resolved by
`app_id` — stored in a D1 config table (or a typed map in the Worker for the proof).
Secrets are shared Maven-level (see §5).

### 3.3 D1 schema

Mirror copydeck's `FeedbackVideo` table + the parent spec's `app_id` addition (§4.6):

```sql
CREATE TABLE feedback_video (
  id               TEXT PRIMARY KEY,           -- uuid
  app_id           TEXT NOT NULL,              -- NEW: routes summary back to the right app config
  teamwork_task_id TEXT NOT NULL,
  vimeo_id         TEXT NOT NULL,
  vimeo_uri        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | summarized | failed
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX feedback_video_status_idx ON feedback_video(status);
```

D1 is a strong fit: the store is a tiny, low-write queue (humans recording
screenshares), and the Worker is its **sole owner**. Non-CF callers never touch D1
directly — they POST to the Worker, which owns the write. That is the correct generic
boundary, not a limitation.

### 3.4 Text & screenshot handling

- **Text feedback**: fully synchronous through the Worker; no D1 row (copydeck never
  persisted text feedback — it lives only as the Teamwork task + first comment).
- **Screenshots — S3 now, R2 next (decided 2026-07-09):**
  - **Proof (this build):** unchanged — stay on maven-home's existing Netlify → S3
    function (`functions/feedback-image.ts`, `feedback-image-serve.ts`). The Worker does
    not touch storage. Keeps the proof focused on Worker + D1.
  - **Centralization sub-phase (right after the proof, before fan-out = parent §4.7/D8):**
    move screenshot hosting onto the **Worker with R2** — native binding (no AWS SDK on
    the Workers runtime, no access keys), **zero egress** (screenshots are served from
    Teamwork comments indefinitely), a **stable custom domain** (permanent URLs that don't
    depend on any app's deploy domain), and a lifecycle expiry rule. The upload endpoint
    moves onto the Worker; maven-home's widget uploads to the Worker instead of its
    Netlify function. **Prereq:** the CF token currently lacks `r2` scope (has `workers` +
    `d1`) — add it before this sub-phase.

---

## 4. Auth & attribution

### 4.1 Caller authentication — thin per-app auth-proxy (recommended)

The Worker is public. It must (a) reject non-Maven callers and (b) know *who* is
submitting (for the "Submitted by …" line in the task). Maven apps authenticate very
differently (teamwork-auth JWT vs Supabase vs MUI), so **each app keeps a thin Netlify
Function that does its own auth**, resolves the `Submitter`, and calls the Worker with:

- a shared secret header (`WORKER_SHARED_SECRET`) — proves the call came from a
  trusted Maven proxy, and
- the resolved `Submitter` (`{ name?, email?, userId? }`) in the body.

The Worker validates only the shared secret. This keeps app-specific auth as
project-specific Netlify glue (consistent with the CF-vs-Netlify split) and means the
Worker needs **no** `JWT_REFRESH_KEY` / SSO knowledge.

*Alternative considered (not chosen for the proof):* the Worker validates the Maven
JWT itself (verify `JWT_REFRESH_KEY` or call `auth.mavenmm.com`) and apps call it
directly frontend→Worker. Purer "apps thin to fetch," but forces cross-origin token
handling + CORS + per-auth-scheme logic into the Worker. Revisit at fan-out if the
per-app proxy proves redundant.

### 4.2 Task attribution — reuse copydeck's token for the proof

Copydeck already files **every** task with one shared server-side token
(`TEAMWORK_ACCESS_TOKEN`, owner Chris `119775`); the submitter's identity comes from
auth and is written into the comment, not the task creator. The Worker does the same.

- **Phase 1 (maven-home proof):** reuse copydeck's existing token. Keep the
  `soleFollowerId` follower-reset (already a `TeamworkConfig` field) since the token is
  a real person's.
- **Before app #3 (2nd extra app):** stand up the Teamwork **bot/service account**
  (parent D6 — mandatory at this threshold), swap the token, drop `soleFollowerId`.
  A bot following its own tasks is fine.

Risk deferred: if Chris rotates/loses that token, feedback breaks for every app at
once. Acceptable while it is only maven-home; not acceptable at 3+ apps → hence the
bot before fan-out.

---

## 5. Secrets & config

**Worker secrets** (`wrangler secret put`; prod) / `.dev.vars` (local):

| Secret | Source | Purpose |
|---|---|---|
| `TEAMWORK_ACCESS_TOKEN` | copydeck droplet `.env` (reused) | file tasks + comments |
| `VIMEO_ACCESS_TOKEN` | copydeck droplet `.env` (reused) | mint tus targets, fetch transcripts |
| `ANTHROPIC_API_KEY` | copydeck droplet `.env` (reused) | summary pass |
| `WORKER_SHARED_SECRET` | **generated new** | authenticate the maven-home proxy → Worker |

**Not needed by the Worker:** AWS S3 creds (screenshots stay on maven-home/Netlify),
`DATABASE_URL` (D1 replaces Postgres), `JWT_REFRESH_KEY` (proxy does auth).

**Non-secret config** (`wrangler.toml [vars]` and/or D1 config table), per `app_id`:
Teamwork `tasklistId` / `assigneeId` / `workflowId` / `stageId` / `soleFollowerId`,
Vimeo `folderId`, summary `model` / `maxTokens`, `appName`. maven-home Phase-1 values
mirror copydeck's (tasklist `2976106`, assignee Dave `118870`, workflow `66400`, stage
`388923`) unless we intentionally route maven-home elsewhere.

**maven-home Netlify env:** `WORKER_SHARED_SECRET` (same value) + the Worker's base URL.

---

## 6. Data flows

**Text:** UI → maven-home proxy (auth → Submitter) → `POST /feedback/text` →
`core.createTextFeedback` → task + first comment + move stage (+ follower reset) →
`{ ok, taskId, url }`. Synchronous.

**Video (two-phase, unchanged behavior):**
1. UI asks for a target → proxy → `POST /feedback/video-target` →
   `core.createVideoTarget` → `{ videoId, videoUri, uploadLink }`.
2. Browser uploads to Vimeo directly (tus; Vimeo token never client-side).
3. UI submits → proxy → `POST /feedback/video` → `core.submitVideoFeedback` (task
   created immediately with "🤖 summary pending") → **insert D1 pending row**.

**Summary drain (cron):** `scheduled` → select `status='pending'` (bounded batch) →
core summary path (fetch transcript → Claude → HTML): `summarized` → post 2nd comment,
mark done; `retry` → bump `attempts`; exhausted/`failed` → mark failed + structured log.

---

## 7. Rollout

1. **Phase 1 — maven-home proof (this build):** stand up the Worker + D1; wire
   maven-home's functions to call it (thin auth-proxy); reuse copydeck's token/secrets;
   file a real Teamwork task end-to-end incl. a real video summary via cron. Copydeck
   untouched.
2. **Bot account** (parent D6) before app #3; swap token, drop follower reset.
3. **Fan out** to the next two apps (thin auth-proxy each; per-`app_id` config).
4. **Copydeck last:** refactor to call the Worker; retire its droplet poller +
   Postgres; **gated by the parent spec's parity test (§8)** — a real filed task,
   body-in-first-comment, two-phase video, correct follower end-state.

---

## 8. Bugs to fix during the port (from parent §9)

- **B1** — screenshot S3 prefix inconsistency: lock the prefix in one place (core).
  **Deferred to the R2 centralization sub-phase** — screenshots are untouched in the
  maven-home proof, so there's no prefix code in this build to fix.
- **B2** — Vimeo folder lookup by name w/ `per_page=100` no pagination → pass folder
  **ID** via `VimeoConfig.folderId` (already in the type).
- **B3** — poller's silent `.catch(() => {})` → structured logging + a daily Slack
  digest of `failed` rows (parent §4.6).
- **B4** — CJS/ESM duplication of `vimeo.ts` in the old `poller.js` → gone; the Worker
  imports core once.

---

## 9. Risks & open questions

- **R1 — Vimeo transcript is poll-only** (no webhook): cron cadence + bounded retry
  (`MAX_ATTEMPTS`). Budget the loop.
- **R2 — `nodejs_compat`: RESOLVED (see §2.1).** Core is pure `fetch`, no Node-only
  APIs; runs on the Workers runtime with no compat flag. (tus lives in the browser/UI,
  not the Worker; only Vimeo *target minting* is server-side.)
- **R3 — CORS:** with the auth-proxy model the Worker is same-infra-to-same-infra;
  no browser CORS. If we ever go frontend→Worker direct (§4.1 alt), CORS returns.
- **R4 — Cron granularity:** CF cron min is 1 minute (vs copydeck's 45 s). Fine for
  human-paced video feedback; note the slightly longer worst-case summary latency.
- **R5 — Shared-secret rotation:** `WORKER_SHARED_SECRET` lives in two places (Worker
  + each app's Netlify env); document rotation before fan-out.
- **OQ1 — Config store:** per-app `FeedbackConfig` as a D1 table vs a typed map in the
  Worker. Map is fine for the proof (1 app); table before fan-out. Decide in the plan.
- **OQ2 — Worker repo:** new standalone repo (like `assistant-feedback`) vs a
  `worker/` package inside `maven-dev-library`. Leaning standalone repo for clean
  deploy/secrets isolation. Decide in the plan.
