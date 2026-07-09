# Feedback CF Worker + D1 (maven-home proof) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a standalone Cloudflare Worker + D1 that hosts the full feedback backend (text, video-target, video-submit, and the async transcript-summary drain) by wrapping `@mavenmm/dev-library/core`, and wire maven-home to it as the first consuming app.

**Architecture:** A new standalone Worker repo (`maven-feedback-worker`) exposes three POST routes + a cron `scheduled()` drain, all calling `dev-library/core`. D1 holds the one-table pending-video queue (mirror of copydeck's `FeedbackVideo`). maven-home keeps thin Netlify functions that authenticate the user, resolve the submitter, and proxy to the Worker with a shared secret; screenshots stay on maven-home's existing S3 function untouched.

**Tech Stack:** TypeScript, Cloudflare Workers (wrangler 4), D1 (SQLite), `@cloudflare/vitest-pool-workers` for tests, `@mavenmm/dev-library/core` (git dep), plain `fetch` handler + pathname router (no web framework).

**Design spec:** [`../specs/2026-07-09-feedback-cf-worker-backend-design.md`](../specs/2026-07-09-feedback-cf-worker-backend-design.md)

**Revision 2 (2026-07-09):** incorporated an adversarial review. Changes: current test toolchain (findings 1–2); official D1 migration harness (finding 3); **atomic claim-based drain** for cron-overlap safety (finding 4); insert-failure no longer 500s a filed task (finding 5); **maven-home keeps its real assignee 381243/Rondie** (finding 6); unknown-`app_id` rows fail fast instead of poisoning the batch (finding 7); plus give-up string parity, observability logging, real maven-home typecheck, and ordering/typing nits (8–16).

## Global Constraints

- **Runtime:** Workers only — no `node:*`, no `Buffer`, no AWS SDK, no Prisma. `core` is already pure `fetch` (verified) so **no `nodejs_compat` flag**.
- **dev-library pin:** depend on `@mavenmm/dev-library` by git tag/SHA (currently `#v0.2.1`); import only from `@mavenmm/dev-library/core`.
- **Auth (proof):** Worker trusts inbound header `x-maven-feedback-secret` === `env.WORKER_SHARED_SECRET`. It does NOT validate Maven JWTs (maven-home's proxy does).
- **Teamwork token (proof):** reuse copydeck's shared `TEAMWORK_ACCESS_TOKEN`. Because the token is a shared person's (Chris), `soleFollowerId` MUST be set (else the token owner is spammed as a follower of every task). Swap to a bot account before app #3 (spec D6), then drop `soleFollowerId`.
- **maven-home routing (preserve prod — do NOT regress):** tasklist `2976106`, **assignee `381243` (Rondie)**, workflow `66400`, stage `388923`. (Current prod files as the user's own token with no follower reset; moving to the shared token means `soleFollowerId` becomes necessary — set it to `381243`.)
- **Drain semantics (match copydeck `poller.js`):** batch `BATCH=5` oldest-first; `MAX_ATTEMPTS=40`; on transcript-not-ready bump `attempts`, and at the budget post the give-up fallback comment + mark `failed`; on success mark `summarized`. **Overlap-safe:** claim rows atomically (`pending`→`processing`) before work so concurrent cron runs can't double-process.
- **D1 mirror of `FeedbackVideo`:** `id, app_id (NEW), teamwork_task_id, vimeo_id, vimeo_uri, status, attempts, last_error, created_at, updated_at`, index on `status`. `status ∈ pending | processing | summarized | failed`.
- **Secrets:** `TEAMWORK_ACCESS_TOKEN`, `VIMEO_ACCESS_TOKEN`, `ANTHROPIC_API_KEY` (from `maven-dev-library/.env.copdeck-droplet`), `WORKER_SHARED_SECRET` (generated). Never in `wrangler.toml`.
- **Accepted parity deviations (documented, not bugs):** core's summary prompt is generic (correct for maven-home); core omits `stripCodeFences`; core treats any non-empty transcript as ready (poller required ≥5 chars); comment header is "AI summary" vs poller's "AI summary of the recording". None affect the maven-home proof; revisit if the copydeck parity gate (Phase 2) needs exact strings.
- **Verified core signatures** (consume, do not redefine):
  - `createTextFeedback(cfg, secrets, input: CreateTextFeedbackInput, submitter: Submitter): Promise<CreateFeedbackResult>`
  - `createVideoTarget(cfg, secrets, sizeBytes: number, subject: string): Promise<VideoUploadTarget>`
  - `submitVideoFeedback(cfg, secrets, input: SubmitVideoInput, submitter): Promise<{ result: CreateFeedbackResult; pending?: PendingVideo }>`
  - `summarizePendingVideo(cfg, secrets, pending: PendingVideo): Promise<SummaryOutcome>` — already posts the summary comment AND clears followers on success; the drain must NOT re-post/re-clear on success.
  - `addHtmlComment(tw: TeamworkConfig, token, taskId, html): Promise<void>`, `setSoleFollower(tw, token, taskId, followerId): Promise<boolean>`
  - `CreateFeedbackResult = {ok:true,taskId,url} | {ok:false,error}`; `SummaryOutcome = {status:"summarized"} | {status:"retry"} | {status:"failed",error}`; `PendingVideo = {taskId, videoId, videoUri?}`

---

## File Structure

**New repo `maven-feedback-worker/`:**
- `wrangler.toml` — worker name, D1 binding `DB`, cron trigger, `[observability]`.
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.dev.vars` (gitignored).
- `migrations/0001_feedback_video.sql` — D1 schema.
- `src/env.ts` — `Env` binding types.
- `src/config.ts` — `appConfig(appId, env)` → `{ cfg, secrets } | null` (typed map, maven-home entry).
- `src/auth.ts` — `checkSharedSecret(request, env)`.
- `src/store.ts` — D1 store: `insertPending`, `listPending` (read-only), `claimBatch`, `markSummarized`, `markFailed`, `releasePending`.
- `src/drain.ts` — `runSummaryPass(env, deps?)` (the claim-based loop) + give-up comment.
- `src/index.ts` — `fetch()` router (3 routes + health) and `scheduled()` → drain.
- `test/apply-migrations.ts` (setup), `test/reset.ts` (helper), `test/env.d.ts`, `test/*.spec.ts`.

**maven-home (modify):**
- `functions/lib/feedback-shared.ts` — add `callWorker(path, body)` (keep `exchange`/`resolveSubmitter`/`feedbackConfig`).
- `functions/feedback.ts`, `functions/feedback-video.ts`, `functions/feedback-video-target.ts` — proxy to the Worker; drop the `console.log` pending hop.
- `functions/feedback-image.ts`, `feedback-image-serve.ts` — **untouched** (S3 stays).

---

### Task 1: Scaffold the Worker repo

**Files:** Create `maven-feedback-worker/{package.json,tsconfig.json,wrangler.toml,vitest.config.ts,.gitignore}`, `src/env.ts`, `src/index.ts`, `test/env.d.ts`, `test/apply-migrations.ts`, `test/health.spec.ts`, `migrations/0001_feedback_video.sql`.

**Interfaces:** Produces `Env`; a `fetch` handler answering `GET /` with `200 "ok"`; a working test harness with migrations applied.

- [ ] **Step 1: Create the repo + `package.json`**

```bash
mkdir -p ~/Documents/Github/maven-internals/maven-feedback-worker/{src,test,migrations}
cd ~/Documents/Github/maven-internals/maven-feedback-worker && git init
```

```json
{
  "name": "maven-feedback-worker",
  "private": true,
  "type": "module",
  "scripts": { "dev": "wrangler dev", "deploy": "wrangler deploy", "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@mavenmm/dev-library": "github:mavenmm/maven-dev-library#v0.2.1" },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.77.0"
  }
}
```
> Toolchain note: `@cloudflare/vitest-pool-workers` must be current-gen (0.8+) with a matching `vitest@3` — an older pool bundles an older `workerd` that rejects a modern `compatibility_date`. If `npm test` reports an unsupported compatibility date, lower the date in `wrangler.toml` to one the installed pool supports.

- [ ] **Step 2: `tsconfig.json`, `.gitignore`, `wrangler.toml`, `test/env.d.ts`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ES2022", "moduleResolution": "Bundler",
    "lib": ["ES2022"], "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true, "noEmit": true, "skipLibCheck": true, "esModuleInterop": true
  },
  "include": ["src", "test"]
}
```

`.gitignore`:
```
node_modules
.dev.vars
.wrangler
dist
```

`wrangler.toml`:
```toml
name = "maven-feedback-worker"
main = "src/index.ts"
compatibility_date = "2024-11-01"  # supported by the pinned pool-workers' workerd; bump only if a newer feature is needed AND tests still pass

[[d1_databases]]
binding = "DB"
database_name = "maven-feedback"
database_id = "PLACEHOLDER_SET_IN_TASK_8"
migrations_dir = "migrations"

[triggers]
crons = ["*/2 * * * *"]  # every 2 min; MAX_ATTEMPTS=40 → ~80min budget. Overlap-safe via claim, but 2m reduces overlap vs 1m.

[observability]
enabled = true
```

`test/env.d.ts` (types the test bindings — kills `env as any` and the migration binding type):
```ts
import type { Env } from "../src/env";
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env { TEST_MIGRATIONS: D1Migration[]; }
}
```

- [ ] **Step 3: `src/env.ts`**

```ts
export interface Env {
  DB: D1Database;
  TEAMWORK_ACCESS_TOKEN: string;
  VIMEO_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  WORKER_SHARED_SECRET: string;
}
```

- [ ] **Step 4: `migrations/0001_feedback_video.sql`**

```sql
CREATE TABLE feedback_video (
  id               TEXT PRIMARY KEY,
  app_id           TEXT NOT NULL,
  teamwork_task_id TEXT NOT NULL,
  vimeo_id         TEXT NOT NULL,
  vimeo_uri        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX feedback_video_status_idx ON feedback_video(status);
```
> Millisecond `created_at` so oldest-first ordering is stable for same-second inserts.

- [ ] **Step 5: Test harness — `vitest.config.ts` + `test/apply-migrations.ts`**

`vitest.config.ts` (official D1 migration harness — no `?raw`, no hand-rolled `exec`):
```ts
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
        },
      },
    },
  };
});
```

`test/apply-migrations.ts`:
```ts
import { applyD1Migrations, env } from "cloudflare:test";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 6: `src/index.ts` (health only for now) + `test/health.spec.ts`**

`src/index.ts`:
```ts
import type { Env } from "./env";
export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("ok");
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

`test/health.spec.ts`:
```ts
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("health", () => {
  it("GET / returns ok", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://x/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
```

- [ ] **Step 7: Install, typecheck, test (real gate — verify before committing)**

```bash
npm install
npm run typecheck
npm test
```
Expected: typecheck clean; health test PASS. If the compat date is rejected, lower it (Step 2 note) and re-run.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold maven-feedback-worker (health + D1 migration test harness)"
```

---

### Task 2: Schema test

**Files:** Create `test/reset.ts`, `test/schema.spec.ts`.

**Interfaces:** Produces `resetDb()` (clears the table between tests); confirms the migration applied with correct defaults.

- [ ] **Step 1: `test/reset.ts`**

```ts
import { env } from "cloudflare:test";
export async function resetDb(): Promise<void> {
  await env.DB.exec("DELETE FROM feedback_video");
}
```

- [ ] **Step 2: Write `test/schema.spec.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, it, expect } from "vitest";
import { resetDb } from "./reset";

describe("schema", () => {
  beforeEach(resetDb);
  it("inserts with pending/0 defaults", async () => {
    await env.DB.prepare(
      "INSERT INTO feedback_video (id, app_id, teamwork_task_id, vimeo_id) VALUES (?,?,?,?)",
    ).bind("t1", "maven-home", "999", "123").run();
    const row = await env.DB.prepare(
      "SELECT status, attempts FROM feedback_video WHERE id=?",
    ).bind("t1").first<{ status: string; attempts: number }>();
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
  });
});
```

- [ ] **Step 3: Run → PASS**

```bash
npm test -- schema
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: D1 schema defaults + reset helper"
```

---

### Task 3: Store (claim-based, overlap-safe)

**Files:** Create `src/store.ts`, `test/store.spec.ts`.

**Interfaces:** Produces
- `insertPending(db, {id, appId, taskId, vimeoId, vimeoUri}): Promise<void>`
- `listPending(db, limit): Promise<PendingRow[]>` — read-only (status='pending'), for assertions
- `claimBatch(db, limit): Promise<PendingRow[]>` — atomically flips `pending`→`processing` (also reclaims `processing` stale >10min), increments `attempts`, returns claimed rows (post-increment `attempts`)
- `markSummarized(db, id)`, `markFailed(db, id, lastError)`, `releasePending(db, id, lastError?)`
- `PendingRow = {id, app_id, teamwork_task_id, vimeo_id, vimeo_uri, attempts}`

- [ ] **Step 1: Write failing tests** — `test/store.spec.ts`

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, it, expect } from "vitest";
import { resetDb } from "./reset";
import { insertPending, listPending, claimBatch, markSummarized, markFailed, releasePending } from "../src/store";

const seed = (id: string) => insertPending(env.DB, { id, appId: "maven-home", taskId: id, vimeoId: "v" + id, vimeoUri: "/videos/" + id });

describe("store", () => {
  beforeEach(resetDb);

  it("listPending returns pending oldest-first", async () => {
    await seed("a"); await seed("b");
    expect((await listPending(env.DB, 5)).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("claimBatch flips to processing + increments; a second claim returns nothing (overlap-safe)", async () => {
    await seed("a"); await seed("b");
    const first = await claimBatch(env.DB, 5);
    expect(first.map((r) => r.id)).toEqual(["a", "b"]);
    expect(first[0].attempts).toBe(1);
    expect(await claimBatch(env.DB, 5)).toHaveLength(0); // now 'processing'
    expect(await listPending(env.DB, 5)).toHaveLength(0);
  });

  it("releasePending returns a claimed row to pending; markSummarized/markFailed remove it", async () => {
    await seed("a"); await seed("b"); await seed("c");
    await claimBatch(env.DB, 5);
    await releasePending(env.DB, "a", "not ready");
    await markSummarized(env.DB, "b");
    await markFailed(env.DB, "c", "gave up");
    expect((await listPending(env.DB, 5)).map((r) => r.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run → FAIL**

```bash
npm test -- store
```

- [ ] **Step 3: Implement `src/store.ts`**

```ts
export interface PendingRow {
  id: string; app_id: string; teamwork_task_id: string;
  vimeo_id: string; vimeo_uri: string; attempts: number;
}

const COLS = "id, app_id, teamwork_task_id, vimeo_id, vimeo_uri, attempts";

export async function insertPending(
  db: D1Database,
  row: { id: string; appId: string; taskId: string; vimeoId: string; vimeoUri: string },
): Promise<void> {
  await db.prepare(
    `INSERT INTO feedback_video (id, app_id, teamwork_task_id, vimeo_id, vimeo_uri) VALUES (?, ?, ?, ?, ?)`,
  ).bind(row.id, row.appId, row.taskId, row.vimeoId, row.vimeoUri).run();
}

export async function listPending(db: D1Database, limit: number): Promise<PendingRow[]> {
  const { results } = await db.prepare(
    `SELECT ${COLS} FROM feedback_video WHERE status = 'pending' ORDER BY created_at ASC, rowid ASC LIMIT ?`,
  ).bind(limit).all<PendingRow>();
  return results ?? [];
}

/** Atomically claim a batch: pending (or stale-processing) → processing, attempts+1. Returns claimed rows. */
export async function claimBatch(db: D1Database, limit: number): Promise<PendingRow[]> {
  const { results } = await db.prepare(
    `UPDATE feedback_video
        SET status = 'processing', attempts = attempts + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id IN (
        SELECT id FROM feedback_video
         WHERE status = 'pending'
            OR (status = 'processing' AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes'))
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?
      )
      RETURNING ${COLS}`,
  ).bind(limit).all<PendingRow>();
  return results ?? [];
}

export async function markSummarized(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE feedback_video SET status='summarized', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(id).run();
}

export async function markFailed(db: D1Database, id: string, lastError: string): Promise<void> {
  await db.prepare(`UPDATE feedback_video SET status='failed', last_error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(lastError.slice(0, 300), id).run();
}

export async function releasePending(db: D1Database, id: string, lastError?: string): Promise<void> {
  await db.prepare(`UPDATE feedback_video SET status='pending', last_error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(lastError ? lastError.slice(0, 300) : null, id).run();
}
```

- [ ] **Step 4: Run → PASS**

```bash
npm test -- store
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: claim-based D1 pending store (overlap-safe)"
```

---

### Task 4: Shared-secret auth + app config

**Files:** Create `src/auth.ts`, `src/config.ts`, `test/auth.spec.ts`.

**Interfaces:** `checkSharedSecret(request, env): boolean`; `appConfig(appId, env): { cfg: FeedbackConfig; secrets: Secrets } | null`.

- [ ] **Step 1: Write failing tests** — `test/auth.spec.ts`

```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { checkSharedSecret } from "../src/auth";
import { appConfig } from "../src/config";

const req = (v?: string) => new Request("https://x/feedback/text", { method: "POST", headers: v ? { "x-maven-feedback-secret": v } : {} });

describe("auth", () => {
  it("accepts configured secret, rejects wrong/missing", () => {
    const e = { ...env, WORKER_SHARED_SECRET: "s3cr3t" };
    expect(checkSharedSecret(req("s3cr3t"), e)).toBe(true);
    expect(checkSharedSecret(req("nope"), e)).toBe(false);
    expect(checkSharedSecret(req(undefined), e)).toBe(false);
  });
});

describe("config", () => {
  it("resolves maven-home (assignee 381243), null for unknown app", () => {
    const e = { ...env, TEAMWORK_ACCESS_TOKEN: "t", VIMEO_ACCESS_TOKEN: "v", ANTHROPIC_API_KEY: "a" };
    const ok = appConfig("maven-home", e);
    expect(ok?.cfg.appName).toBe("Maven Home");
    expect(ok?.cfg.teamwork.assigneeId).toBe("381243");
    expect(ok?.cfg.teamwork.soleFollowerId).toBe("381243");
    expect(ok?.secrets.teamworkToken).toBe("t");
    expect(appConfig("mystery-app", e)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

```bash
npm test -- auth
```

- [ ] **Step 3: `src/auth.ts`**

```ts
import type { Env } from "./env";
// NOTE: plain === on a 32-byte random secret is acceptable here; crypto.subtle.timingSafeEqual is a future hardening.
export function checkSharedSecret(request: Request, env: Env): boolean {
  const got = request.headers.get("x-maven-feedback-secret");
  return !!got && !!env.WORKER_SHARED_SECRET && got === env.WORKER_SHARED_SECRET;
}
```

- [ ] **Step 4: `src/config.ts`** (mirrors maven-home's real prod config — NOT copydeck's Dave assignee)

```ts
import type { FeedbackConfig, Secrets } from "@mavenmm/dev-library/core";
import type { Env } from "./env";

// Per-app config (typed map for the proof; promote to a D1 table before fan-out).
const APPS: Record<string, FeedbackConfig> = {
  "maven-home": {
    appName: "Maven Home",
    teamwork: {
      baseUrl: "https://mavenmm.teamwork.com",
      tasklistId: "2976106",   // Team feedback
      assigneeId: "381243",    // Rondie Li — matches maven-home prod (do NOT change to Dave)
      workflowId: "66400",
      stageId: "388923",       // To Do (ASAP)
      soleFollowerId: "381243",// required while reusing the shared token; drop once the bot account lands
    },
    vimeo: { folderId: "" },   // numeric Vimeo folder id set in Task 8 Step 3 (B2 fix)
    summary: { model: "claude-sonnet-4-6", maxTokens: 700 },
  },
};

export function appConfig(appId: string, env: Env): { cfg: FeedbackConfig; secrets: Secrets } | null {
  const cfg = APPS[appId];
  if (!cfg) return null;
  return {
    cfg,
    secrets: { teamworkToken: env.TEAMWORK_ACCESS_TOKEN, vimeoToken: env.VIMEO_ACCESS_TOKEN, anthropicKey: env.ANTHROPIC_API_KEY },
  };
}
```

- [ ] **Step 5: Run → PASS**

```bash
npm test -- auth
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: shared-secret auth + per-app config (maven-home → Rondie)"
```

---

### Task 5: Routes (text / video-target / video) + scheduled wiring

**Files:** Modify `src/index.ts`; create a stub `src/drain.ts` (real logic in Task 6); create `test/routes.spec.ts`.

**Interfaces:** Consumes `checkSharedSecret`, `appConfig`, `insertPending`, core `createTextFeedback`/`createVideoTarget`/`submitVideoFeedback`, and `runSummaryPass`. Request contract (POST, JSON): `{ appId, submitter, input }`, header `x-maven-feedback-secret`.

- [ ] **Step 1: Write failing tests** — `test/routes.spec.ts`

```ts
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { resetDb } from "./reset";
import { listPending } from "../src/store";
import worker from "../src/index";

const E = () => ({ ...env, WORKER_SHARED_SECRET: "s", TEAMWORK_ACCESS_TOKEN: "t", VIMEO_ACCESS_TOKEN: "v", ANTHROPIC_API_KEY: "a" });
const post = (path: string, body: unknown, secret = "s") =>
  new Request(`https://x${path}`, { method: "POST", headers: { "x-maven-feedback-secret": secret, "content-type": "application/json" }, body: JSON.stringify(body) });
const run = async (req: Request) => { const ctx = createExecutionContext(); const res = await worker.fetch(req, E(), ctx); await waitOnExecutionContext(ctx); return res; };

describe("routes", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it("401 on wrong secret", async () => {
    expect((await run(post("/feedback/text", {}, "wrong"))).status).toBe(401);
  });

  it("400 on unknown app", async () => {
    expect((await run(post("/feedback/text", { appId: "ghost", input: {} }))).status).toBe(400);
  });

  it("text path creates a task via core", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("/tasklists/") ? new Response(JSON.stringify({ id: 555 }), { status: 200 }) : new Response("{}", { status: 200 }));
    const res = await run(post("/feedback/text", { appId: "maven-home", submitter: { name: "Rondie" }, input: { type: "bug", subject: "x", pageUrl: "https://home", bodyHtml: "<p>hi</p>" } }));
    const json = await res.json<any>();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.taskId).toBe("555");
  });

  it("video path persists exactly one pending D1 row", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("/tasklists/") ? new Response(JSON.stringify({ id: 777 }), { status: 200 }) : new Response("{}", { status: 200 }));
    const res = await run(post("/feedback/video", { appId: "maven-home", submitter: { name: "Rondie" }, input: { type: "bug", subject: "vid", videoId: "vv", videoUri: "/videos/vv", pageUrl: "https://home" } }));
    expect((await res.json<any>()).ok).toBe(true);
    const rows = await listPending(E().DB, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].teamwork_task_id).toBe("777");
    expect(rows[0].vimeo_id).toBe("vv");
  });
});
```

- [ ] **Step 2: Create the stub `src/drain.ts`**

```ts
import type { Env } from "./env";
export async function runSummaryPass(_env: Env): Promise<{ summarized: number; failed: number; retried: number }> {
  return { summarized: 0, failed: 0, retried: 0 }; // implemented in Task 6
}
```

- [ ] **Step 3: Run → FAIL**

```bash
npm test -- routes
```

- [ ] **Step 4: Implement `src/index.ts`**

```ts
import type { Env } from "./env";
import { checkSharedSecret } from "./auth";
import { appConfig } from "./config";
import { insertPending } from "./store";
import { runSummaryPass } from "./drain";
import {
  createTextFeedback, createVideoTarget, submitVideoFeedback,
  type CreateTextFeedbackInput, type SubmitVideoInput, type Submitter,
} from "@mavenmm/dev-library/core";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

interface Body { appId?: string; submitter?: Submitter; input?: unknown }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("ok");
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    if (!checkSharedSecret(request, env)) return json({ ok: false, error: "unauthorized" }, 401);

    let body: Body;
    try { body = await request.json<Body>(); } catch { return json({ ok: false, error: "bad body" }, 400); }
    const resolved = appConfig(body.appId ?? "", env);
    if (!resolved) return json({ ok: false, error: "unknown app" }, 400);
    const { cfg, secrets } = resolved;
    const submitter = body.submitter ?? {};

    try {
      if (url.pathname === "/feedback/text") {
        const r = await createTextFeedback(cfg, secrets, body.input as CreateTextFeedbackInput, submitter);
        return json(r, r.ok ? 200 : 500);
      }
      if (url.pathname === "/feedback/video-target") {
        const { sizeBytes, subject } = (body.input ?? {}) as { sizeBytes?: number; subject?: string };
        return json(await createVideoTarget(cfg, secrets, Number(sizeBytes), subject ?? ""));
      }
      if (url.pathname === "/feedback/video") {
        const out = await submitVideoFeedback(cfg, secrets, body.input as SubmitVideoInput, submitter);
        // Persist AFTER the task is filed. A persistence failure must NOT fail the (successful) submit —
        // otherwise the widget shows an error and the user resubmits → duplicate task + duplicate video.
        if (out.pending) {
          try {
            await insertPending(env.DB, { id: crypto.randomUUID(), appId: body.appId!, taskId: out.pending.taskId, vimeoId: out.pending.videoId, vimeoUri: out.pending.videoUri ?? "" });
          } catch (e) {
            console.error("[feedback] pending persist FAILED (task filed, summary will be skipped):", out.pending, e);
          }
        }
        return json(out.result, out.result.ok ? 200 : 500);
      }
    } catch (err) {
      return json({ ok: false, error: (err as Error).message }, 500);
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const r = await runSummaryPass(env);
    if (r.summarized || r.failed || r.retried) console.log("[drain]", JSON.stringify(r));
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Run → PASS**

```bash
npm test -- routes
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: text/video routes wrapping core; insert-failure never 500s a filed task"
```

---

### Task 6: The drain loop (claim-based `scheduled`)

**Files:** Modify `src/drain.ts`; create `test/drain.spec.ts`.

**Interfaces:** `runSummaryPass(env, deps?): Promise<{summarized, failed, retried}>` where `deps = { summarizeOne?: typeof summarizePendingVideo; postGiveUp?: (cfg, secrets, taskId) => Promise<void> }`. Constants `BATCH=5`, `MAX_ATTEMPTS=40`.

- [ ] **Step 1: Write failing tests** — `test/drain.spec.ts` (inject fakes; no network)

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb } from "./reset";
import { insertPending, listPending } from "../src/store";
import { runSummaryPass, MAX_ATTEMPTS } from "../src/drain";

const E = () => ({ ...env, TEAMWORK_ACCESS_TOKEN: "t", VIMEO_ACCESS_TOKEN: "v", ANTHROPIC_API_KEY: "a" });
const seed = (id: string, appId = "maven-home") => insertPending(env.DB, { id, appId, taskId: id, vimeoId: "v" + id, vimeoUri: "" });

describe("drain", () => {
  beforeEach(resetDb);

  it("summarized → row leaves pending", async () => {
    await seed("a");
    const out = await runSummaryPass(E(), { summarizeOne: async () => ({ status: "summarized" }) });
    expect(out.summarized).toBe(1);
    expect(await listPending(env.DB, 5)).toHaveLength(0);
  });

  it("retry below budget → released to pending, attempts=1", async () => {
    await seed("a");
    const out = await runSummaryPass(E(), { summarizeOne: async () => ({ status: "retry" }) });
    expect(out.retried).toBe(1);
    const rows = await listPending(env.DB, 5);
    expect(rows[0].attempts).toBe(1);
  });

  it("retry AT budget → give-up comment + marked failed", async () => {
    await seed("a");
    await env.DB.prepare("UPDATE feedback_video SET attempts=? WHERE id='a'").bind(MAX_ATTEMPTS - 1).run();
    const giveUp = vi.fn(async () => {});
    const out = await runSummaryPass(E(), { summarizeOne: async () => ({ status: "retry" }), postGiveUp: giveUp });
    expect(giveUp).toHaveBeenCalledOnce();
    expect(out.failed).toBe(1);
    expect(await listPending(env.DB, 5)).toHaveLength(0);
  });

  it("unknown app_id → fails fast (no poison pill), summarizeOne not called", async () => {
    await seed("z", "ghost");
    const summarizeOne = vi.fn(async () => ({ status: "summarized" as const }));
    const out = await runSummaryPass(E(), { summarizeOne });
    expect(summarizeOne).not.toHaveBeenCalled();
    expect(out.failed).toBe(1);
    expect(await listPending(env.DB, 5)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → FAIL**

```bash
npm test -- drain
```

- [ ] **Step 3: Implement `src/drain.ts`**

```ts
import type { Env } from "./env";
import { appConfig } from "./config";
import { claimBatch, markSummarized, markFailed, releasePending } from "./store";
import {
  summarizePendingVideo, addHtmlComment, setSoleFollower,
  type FeedbackConfig, type Secrets,
} from "@mavenmm/dev-library/core";

export const BATCH = 5;
export const MAX_ATTEMPTS = 40;

// Matches poller.js:160 (give-up copy).
const GIVE_UP_HTML =
  "<p>🤖 <em>The auto-transcript wasn't available in time, so no AI summary was generated. Please watch the recording above.</em></p>";

export interface DrainDeps {
  summarizeOne?: typeof summarizePendingVideo;
  postGiveUp?: (cfg: FeedbackConfig, secrets: Secrets, taskId: string) => Promise<void>;
}

async function defaultGiveUp(cfg: FeedbackConfig, secrets: Secrets, taskId: string): Promise<void> {
  // Mirror poller.js: the fallback comment is best-effort; the follower reset must still run.
  try { await addHtmlComment(cfg.teamwork, secrets.teamworkToken, taskId, GIVE_UP_HTML); } catch { /* poller: .catch(() => {}) */ }
  if (cfg.teamwork.soleFollowerId) await setSoleFollower(cfg.teamwork, secrets.teamworkToken, taskId, cfg.teamwork.soleFollowerId);
}

export async function runSummaryPass(env: Env, deps: DrainDeps = {}): Promise<{ summarized: number; failed: number; retried: number }> {
  const summarizeOne = deps.summarizeOne ?? summarizePendingVideo;
  const postGiveUp = deps.postGiveUp ?? defaultGiveUp;
  const rows = await claimBatch(env.DB, BATCH); // atomic: pending→processing, attempts already incremented
  let summarized = 0, failed = 0, retried = 0;

  for (const row of rows) {
    const attempts = row.attempts; // post-increment value from the claim
    const resolved = appConfig(row.app_id, env);
    if (!resolved) { // deploy bug: config-only error won't self-heal → fail fast, free the batch slot
      await markFailed(env.DB, row.id, `unknown app_id: ${row.app_id}`); failed++; continue;
    }
    const { cfg, secrets } = resolved;
    try {
      const outcome = await summarizeOne(cfg, secrets, { taskId: row.teamwork_task_id, videoId: row.vimeo_id, videoUri: row.vimeo_uri });
      if (outcome.status === "summarized") {
        await markSummarized(env.DB, row.id); summarized++;
      } else if (outcome.status === "retry") {
        if (attempts >= MAX_ATTEMPTS) { await postGiveUp(cfg, secrets, row.teamwork_task_id); await markFailed(env.DB, row.id, "transcript not ready within attempt budget"); failed++; }
        else { await releasePending(env.DB, row.id); retried++; }
      } else {
        if (attempts >= MAX_ATTEMPTS) { await markFailed(env.DB, row.id, outcome.error); failed++; }
        else { await releasePending(env.DB, row.id, outcome.error); retried++; }
      }
    } catch (err) {
      const msg = (err as Error).message ?? "drain error";
      if (attempts >= MAX_ATTEMPTS) { await markFailed(env.DB, row.id, msg); failed++; }
      else { await releasePending(env.DB, row.id, msg); retried++; }
    }
  }
  return { summarized, failed, retried };
}
```

- [ ] **Step 4: Run → PASS**

```bash
npm test -- drain
```

- [ ] **Step 5: Full suite + typecheck**

```bash
npm run typecheck && npm test
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: claim-based cron drain (poller parity: batch, MAX_ATTEMPTS, give-up, fail-fast unknown app)"
```

---

### Task 7: maven-home → Worker proxy wiring

**Files:** Modify `functions/lib/feedback-shared.ts`, `functions/feedback.ts`, `functions/feedback-video.ts`, `functions/feedback-video-target.ts`. Untouched: `functions/feedback-image.ts`, `feedback-image-serve.ts`.

**Interfaces:** maven-home functions authenticate the user (`exchange`), resolve the submitter (`resolveSubmitter`), and POST `{ appId:"maven-home", submitter, input }` to the Worker with the shared secret.

- [ ] **Step 1: Add `callWorker` to `feedback-shared.ts`** (keep existing exports)

```ts
const WORKER_URL = process.env.FEEDBACK_WORKER_URL || "";
const WORKER_SECRET = process.env.WORKER_SHARED_SECRET || "";

export async function callWorker(path: string, payload: unknown): Promise<{ status: number; body: string }> {
  if (!WORKER_URL || !WORKER_SECRET) return { status: 500, body: JSON.stringify({ ok: false, error: "Feedback worker not configured." }) };
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-maven-feedback-secret": WORKER_SECRET },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.text() };
}
```

- [ ] **Step 2: Rewrite `functions/feedback.ts`**

```ts
import type { Handler, HandlerEvent } from "@netlify/functions";
import { exchange, resolveSubmitter, callWorker } from "./lib/feedback-shared";

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
  const auth = await exchange(event);
  if (!auth) return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Not authenticated" }) };
  const submitter = await resolveSubmitter(auth.token, auth.userId);
  let input: unknown; try { input = JSON.parse(event.body ?? "{}"); } catch { return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Bad request body" }) }; }
  const { status, body } = await callWorker("/feedback/text", { appId: "maven-home", submitter, input });
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body };
};
export { handler };
```

- [ ] **Step 3: Rewrite `functions/feedback-video-target.ts`**

```ts
import type { Handler, HandlerEvent } from "@netlify/functions";
import { exchange, callWorker } from "./lib/feedback-shared";

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  const auth = await exchange(event);
  if (!auth) return { statusCode: 401, body: JSON.stringify({ error: "Not authenticated" }) };
  let input: unknown; try { input = JSON.parse(event.body ?? "{}"); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad request body" }) }; }
  const { status, body } = await callWorker("/feedback/video-target", { appId: "maven-home", input });
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body };
};
export { handler };
```

- [ ] **Step 4: Rewrite `functions/feedback-video.ts`** (drops the old `console.log` pending hop)

```ts
import type { Handler, HandlerEvent } from "@netlify/functions";
import { exchange, resolveSubmitter, callWorker } from "./lib/feedback-shared";

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
  const auth = await exchange(event);
  if (!auth) return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Not authenticated" }) };
  const submitter = await resolveSubmitter(auth.token, auth.userId);
  let input: unknown; try { input = JSON.parse(event.body ?? "{}"); } catch { return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Bad request body" }) }; }
  const { status, body } = await callWorker("/feedback/video", { appId: "maven-home", submitter, input });
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body };
};
export { handler };
```

- [ ] **Step 5: Typecheck the changed functions** (maven-home's `tsconfig.json` does NOT include `functions/`, so `tsc -b` is vacuous — check them directly)

```bash
cd ~/Documents/Github/maven-internals/maven-home
npx tsc --noEmit --esModuleInterop --skipLibCheck --module esnext --moduleResolution bundler --target es2022 \
  functions/feedback.ts functions/feedback-video.ts functions/feedback-video-target.ts functions/lib/feedback-shared.ts
```
Expected: no errors. Remove any now-unused `@mavenmm/dev-library/core` imports the compiler flags. (Alternatively run `npx netlify build` to compile the functions via esbuild.)

- [ ] **Step 6: Commit (maven-home repo)**

```bash
git add functions/feedback.ts functions/feedback-video.ts functions/feedback-video-target.ts functions/lib/feedback-shared.ts
git commit -m "feat: proxy feedback endpoints to maven-feedback-worker; close pending hop"
```

---

### Task 8: Provision, deploy, configure, verify end-to-end

**Files:** Modify `wrangler.toml` (real `database_id`), `src/config.ts` (Vimeo `folderId`). Env: Worker secrets; maven-home `FEEDBACK_WORKER_URL` + `WORKER_SHARED_SECRET`.

- [ ] **Step 1: Create prod D1 + paste its id into `wrangler.toml`**

```bash
cd ~/Documents/Github/maven-internals/maven-feedback-worker
npx wrangler d1 create maven-feedback
# copy the printed database_id into wrangler.toml (replace PLACEHOLDER_SET_IN_TASK_8)
```

- [ ] **Step 2: Apply the migration to remote D1**

```bash
npx wrangler d1 migrations apply maven-feedback --remote
npx wrangler d1 execute maven-feedback --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```
Expected: lists `feedback_video`.

- [ ] **Step 3: Set the numeric Vimeo folder id in `src/config.ts`**

```bash
curl -s -H "Authorization: Bearer <VIMEO_ACCESS_TOKEN>" -H "Accept: application/vnd.vimeo.*+json;version=3.4" \
  "https://api.vimeo.com/me/projects?per_page=100" | python3 -c "import sys,json; [print(p['name'], p['uri']) for p in json.load(sys.stdin)['data']]"
```
Set `vimeo.folderId` in `APPS["maven-home"]` to the numeric id from the "Feedback/Instruction (To Delete)" project uri. Commit.

- [ ] **Step 4: Put secrets** (three reused from `maven-dev-library/.env.copdeck-droplet`; do NOT echo values)

```bash
npx wrangler secret put TEAMWORK_ACCESS_TOKEN
npx wrangler secret put VIMEO_ACCESS_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put WORKER_SHARED_SECRET   # paste `openssl rand -hex 32`; keep it for maven-home too
```

- [ ] **Step 5: Deploy**

```bash
npx wrangler deploy
```
Expected: prints the workers.dev URL + confirms the cron trigger.

- [ ] **Step 6: Configure maven-home env** (Netlify + local `.env`): `FEEDBACK_WORKER_URL=https://maven-feedback-worker.<subdomain>.workers.dev`, `WORKER_SHARED_SECRET=<same value as Step 4>`.

- [ ] **Step 7: E2E — text feedback files a real task, assigned to the RIGHT person**

Run maven-home (`npm run dev`), submit text feedback. Verify: a Teamwork task in tasklist 2976106, **assigned to Rondie (381243)** (NOT Dave), body in the **first comment**, on "To Do (ASAP)", and the token owner (Chris) is NOT left as a follower. Record the URL.

- [ ] **Step 8: E2E — video feedback + AI summary via cron**

Record a short screen capture and submit. Verify: (a) task created immediately with Vimeo link + "summary pending"; (b) one D1 row (`npx wrangler d1 execute maven-feedback --remote --command "SELECT id,status,attempts FROM feedback_video;"`); (c) within a couple of cron cycles the "🤖 AI summary" second comment appears and the row flips to `summarized`. Watch logs: `npx wrangler tail` (shows the `[drain]` counts).

- [ ] **Step 9: Push the Worker repo**

```bash
cd ~/Documents/Github/maven-internals/maven-feedback-worker
gh repo create mavenmm/maven-feedback-worker --private --source . --push
```

- [ ] **Step 10: Record the proof** — note the two Teamwork task URLs (text + video-with-summary) as parity evidence.

---

## Self-Review

**Spec coverage:** droplet poller → CF cron drain (Tasks 5–6) ✓; Postgres → D1 (Tasks 1–3) ✓; text/video/summary wrap core (5–6) ✓; thin auth-proxy (7) ✓; S3 untouched ✓; reused shared token + `soleFollowerId` (4) ✓; `app_id` routing (3,6) ✓; B2 numeric folderId (8 Step 3) ✓; B3 structured drain logging (5 Step scheduled + 6) ✓.

**Review findings resolved:** toolchain/type packages (Task 1); official D1 migration harness (Task 1 Step 5 / Task 2); **overlap-safe atomic claim** (Task 3 `claimBatch` + Task 6); **insert-failure never 500s a filed task** (Task 5 Step 4); **maven-home assignee stays Rondie 381243** (Task 4 + E2E Step 7 asserts it); **unknown-`app_id` fails fast** (Task 6); give-up string matches poller (Task 6); millisecond `created_at` + `rowid` tiebreak (Tasks 1,3); real function typecheck (Task 7 Step 5); observability logging (Task 5 + wrangler.toml).

**Placeholder scan:** `database_id="PLACEHOLDER_SET_IN_TASK_8"` and `vimeo.folderId:""` are resolved by explicit Task 8 steps, not silent TODOs. All drain branches fully coded.

**Type consistency:** `PendingRow`, `PendingVideo`, `SummaryOutcome`, `CreateFeedbackResult` consistent across store/routes/drain; `runSummaryPass(env, deps?)` matches its `scheduled()` caller; claim returns post-increment `attempts` and downstream `mark*` do not re-increment.

**Open follow-ups (post-proof; tracked in the design doc, NOT this plan):** R2 screenshot centralization + B1 prefix constant; Teamwork bot account (D6) before app #3 (then drop `soleFollowerId`); promote config map → D1 table; Slack digest of `failed` rows; optional exact-string parity (transcript ≥5 chars, "of the recording" header) if the copydeck parity gate requires it.
