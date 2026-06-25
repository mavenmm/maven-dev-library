# Feedback Phase 1 — maven-home Text Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working in-app feedback button in **maven-home** that files a real Teamwork task, powered by two new private `@mavenmm` packages (`feedback-core` + `feedback-ui`) — the first components of `maven-dev-library`.

**Architecture:** `feedback-core` is framework-neutral TS: parameterized Teamwork client + HTML composers + a `createTextFeedback` orchestrator (config + secrets + input + submitter → filed task). `feedback-ui` is a React widget (launcher + draggable panel + plain textarea) that `fetch`es a host-supplied endpoint and ships its own scoped CSS (no Tailwind in the host). maven-home adds one Netlify Function that exchanges the user's JWT for their Teamwork token and calls `core.createTextFeedback`. **Text path only** — no video, no Vimeo, no poller.

**Tech Stack:** TypeScript, npm workspaces, tsup (dual ESM/CJS + d.ts), vitest, React 19, Vite, Netlify Functions, Teamwork REST API.

## Global Constraints

- **Behavioral source of truth = copydeck** (`/tmp/claude/copydeck-writing/app`). Mirror its text-path exactly; do not invent new UX or task shape.
- **Task shape (copydeck-verified):** title = `(Mon DD) [TypePrefix] <subject>` in **America/Toronto** time; the rich body goes in the **FIRST COMMENT**, never the task description (the v1 description came through empty).
- **Feedback types (verbatim):** `bug` → "Bug"; `feature` → "Feature request"; `working_well` → "What's working well"; `other` → "Other". Type is a **title prefix only**.
- **Secrets are server-side only** — the Teamwork token never reaches the browser. The widget only ever holds the user's Maven JWT (already in the app).
- **Distribution = private GitHub Packages**, `@mavenmm` scope, `publishConfig.registry = https://npm.pkg.github.com`.
- **Scoped CSS:** every UI class is prefixed `mvfb-`; ship a precompiled stylesheet with **no global/reset rules**; **no runtime-built class strings**. Must not depend on the host's Tailwind (host runs Tailwind v4).
- **React peer range** `>=18 <20`; **build and test against React 19** (maven-home is 19.1.0).
- **No follower-strip in maven-home:** the task is authored by the submitter's own token (author == submitter), so `soleFollowerId` is left UNSET and the orchestrator skips follower cleanup. (copydeck sets it in Phase 2; keep the capability.)
- **Node fetch** is global (Node 18+ / Netlify runtime) — no `node-fetch` dependency.

---

## File Structure

**New repo `maven-dev-library`** (at `~/Documents/Github/maven-dev/maven-dev-library`, already git-init'd, holds the spec):
```
package.json                       # workspaces root
.npmrc                             # @mavenmm -> github packages
tsconfig.base.json
packages/feedback-core/
  package.json                     # @mavenmm/feedback-core
  tsup.config.ts
  src/index.ts                     # public exports
  src/types.ts                     # FeedbackType, FeedbackConfig, Submitter, inputs, results
  src/compose.ts                   # escapeHtml, easternDatePrefix, buildTitle, buildContextHtml
  src/teamwork.ts                  # parameterized Teamwork client
  src/create-text-feedback.ts      # orchestrator
  test/compose.test.ts
  test/teamwork.test.ts
  test/create-text-feedback.test.ts
packages/feedback-ui/
  package.json                     # @mavenmm/feedback-ui
  tsup.config.ts
  src/index.ts
  src/feedback-context.tsx         # FeedbackProvider + useFeedback
  src/feedback-launcher.tsx        # FeedbackLauncher button
  src/feedback-widget.tsx          # text-only draggable panel
  src/feedback-config.ts           # UiFeedbackConfig type + context
  src/styles.css                   # scoped mvfb-* CSS (no resets)
```

**maven-home** (`~/Documents/Github/maven-internals/maven-home`):
```
functions/feedback.ts              # NEW — JWT exchange -> core.createTextFeedback
src/components/FeedbackMount.tsx    # NEW — wires provider+launcher+widget+config
src/App.tsx                         # MODIFY — wrap with FeedbackProvider
src/components/Layout.tsx           # MODIFY — mount launcher in nav + widget
.npmrc                             # NEW/MODIFY — @mavenmm registry
```

---

### Task 1: Scaffold the maven-dev-library monorepo

**Files:**
- Create: `package.json`, `.npmrc`, `tsconfig.base.json` (repo root)
- Create: `packages/feedback-core/package.json`, `packages/feedback-core/tsconfig.json`, `packages/feedback-core/tsup.config.ts`, `packages/feedback-core/src/index.ts`
- Create: `packages/feedback-core/test/smoke.test.ts`

**Interfaces:**
- Produces: a workspace where `npm run build -w @mavenmm/feedback-core` and `npm test` run.

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "maven-dev-library",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write root `.npmrc`** (private scope → GitHub Packages)

```
@mavenmm:registry=https://npm.pkg.github.com
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2021", "DOM"],
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx"
  }
}
```

- [ ] **Step 4: Write `packages/feedback-core/package.json`**

```json
{
  "name": "@mavenmm/feedback-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" }
  },
  "files": ["dist"],
  "publishConfig": { "registry": "https://npm.pkg.github.com" },
  "scripts": { "build": "tsup" }
}
```

- [ ] **Step 5: Write `packages/feedback-core/tsconfig.json` and `tsup.config.ts`**

`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
```

- [ ] **Step 6: Write a placeholder export + smoke test**

`src/index.ts`:
```ts
export const FEEDBACK_CORE_VERSION = "0.1.0";
```

`test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { FEEDBACK_CORE_VERSION } from "../src/index";
describe("smoke", () => {
  it("exports a version", () => { expect(FEEDBACK_CORE_VERSION).toBe("0.1.0"); });
});
```

- [ ] **Step 7: Install + verify test and build**

Run: `cd ~/Documents/Github/maven-dev/maven-dev-library && npm install && npm test`
Expected: 1 passed.
Run: `npm run build -w @mavenmm/feedback-core`
Expected: `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` created.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold maven-dev-library workspaces + feedback-core skeleton"
```

---

### Task 2: feedback-core — types + HTML composers (TDD)

**Files:**
- Create: `packages/feedback-core/src/types.ts`
- Create: `packages/feedback-core/src/compose.ts`
- Test: `packages/feedback-core/test/compose.test.ts`

**Interfaces:**
- Produces:
  - `type FeedbackType = "bug" | "feature" | "working_well" | "other"`
  - `FEEDBACK_TYPES: { value: FeedbackType; label: string; titlePrefix: string }[]`
  - `titlePrefixFor(type: FeedbackType): string`
  - `interface TeamworkConfig { baseUrl: string; tasklistId: string; assigneeId: string; workflowId: string; stageId: string; soleFollowerId?: string }`
  - `interface FeedbackConfig { appName: string; teamwork: TeamworkConfig }`
  - `interface Submitter { name?: string; email?: string; userId?: string }`
  - `interface CreateTextFeedbackInput { type: FeedbackType; subject: string; bodyHtml?: string; pageUrl: string; pageTitle?: string; userAgent?: string; viewport?: string }`
  - `type CreateFeedbackResult = { ok: true; taskId: string; url: string } | { ok: false; error: string }`
  - `escapeHtml(s: string): string`
  - `easternDatePrefix(now?: Date): string`
  - `buildTitle(type: FeedbackType, subject: string, now?: Date): string`
  - `buildContextHtml(submitter: Submitter, ctx: { appName: string; pageUrl: string; pageTitle?: string; userAgent?: string; viewport?: string }): string`

- [ ] **Step 1: Write the failing test**

`test/compose.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { escapeHtml, easternDatePrefix, buildTitle, buildContextHtml, titlePrefixFor } from "../src/compose";

describe("escapeHtml", () => {
  it("escapes the dangerous five", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("easternDatePrefix", () => {
  it("formats Mon DD in America/Toronto", () => {
    // 2026-06-25T12:00:00Z -> Jun 25 in Toronto
    expect(easternDatePrefix(new Date("2026-06-25T12:00:00Z"))).toBe("Jun 25");
  });
});

describe("buildTitle", () => {
  it("prefixes date + type label", () => {
    const t = buildTitle("bug", "Login button missing", new Date("2026-06-25T12:00:00Z"));
    expect(t).toBe("(Jun 25) [Bug] Login button missing");
  });
});

describe("titlePrefixFor", () => {
  it("maps working_well", () => { expect(titlePrefixFor("working_well")).toBe("What's working well"); });
});

describe("buildContextHtml", () => {
  it("includes submitter, app, page link, escapes values", () => {
    const html = buildContextHtml(
      { name: "A <b>", email: "a@x.com" },
      { appName: "maven-home", pageUrl: "https://h/x?q=1&y=2", pageTitle: "Home", userAgent: "UA", viewport: "800x600" },
    );
    expect(html).toContain("<strong>Submitted by:</strong> A &lt;b&gt; (a@x.com)");
    expect(html).toContain("<strong>App:</strong> maven-home");
    expect(html).toContain('href="https://h/x?q=1&amp;y=2"');
    expect(html).toContain("<strong>Browser:</strong> UA · 800x600");
  });
  it("falls back to userId when no name", () => {
    const html = buildContextHtml({ userId: "42" }, { appName: "maven-home", pageUrl: "https://h" });
    expect(html).toContain("user #42");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- compose`
Expected: FAIL — cannot find module `../src/compose`.

- [ ] **Step 3: Write `src/types.ts`**

```ts
export type FeedbackType = "bug" | "feature" | "working_well" | "other";

export interface FeedbackTypeOption { value: FeedbackType; label: string; titlePrefix: string; }

export const FEEDBACK_TYPES: FeedbackTypeOption[] = [
  { value: "bug", label: "Bug", titlePrefix: "Bug" },
  { value: "feature", label: "Feature request", titlePrefix: "Feature request" },
  { value: "working_well", label: "What's working well", titlePrefix: "What's working well" },
  { value: "other", label: "Other", titlePrefix: "Other" },
];

export interface TeamworkConfig {
  baseUrl: string;
  tasklistId: string;
  assigneeId: string;
  workflowId: string;
  stageId: string;
  soleFollowerId?: string;
}

export interface FeedbackConfig { appName: string; teamwork: TeamworkConfig; }

export interface Submitter { name?: string; email?: string; userId?: string; }

export interface CreateTextFeedbackInput {
  type: FeedbackType;
  subject: string;
  bodyHtml?: string;
  pageUrl: string;
  pageTitle?: string;
  userAgent?: string;
  viewport?: string;
}

export type CreateFeedbackResult =
  | { ok: true; taskId: string; url: string }
  | { ok: false; error: string };
```

- [ ] **Step 4: Write `src/compose.ts`**

```ts
import { FEEDBACK_TYPES, type FeedbackType, type Submitter } from "./types";

export function titlePrefixFor(type: FeedbackType): string {
  return FEEDBACK_TYPES.find((t) => t.value === type)?.titlePrefix ?? "Other";
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function easternDatePrefix(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
  }).format(now);
}

export function buildTitle(type: FeedbackType, subject: string, now: Date = new Date()): string {
  return `(${easternDatePrefix(now)}) [${titlePrefixFor(type)}] ${subject}`;
}

export function buildContextHtml(
  submitter: Submitter,
  ctx: { appName: string; pageUrl: string; pageTitle?: string; userAgent?: string; viewport?: string },
): string {
  const who = submitter.name
    ? escapeHtml(submitter.name)
    : submitter.userId
      ? `user #${escapeHtml(submitter.userId)}`
      : "Unknown user";
  const email = submitter.email ? ` (${escapeHtml(submitter.email)})` : "";
  const pageLabel = ctx.pageTitle?.trim() || ctx.pageUrl;
  const lines: string[] = [`<strong>Submitted by:</strong> ${who}${email}`, `<strong>App:</strong> ${escapeHtml(ctx.appName)}`];
  if (ctx.pageUrl) lines.push(`<strong>Page:</strong> <a href="${escapeHtml(ctx.pageUrl)}">${escapeHtml(pageLabel)}</a>`);
  const browser = [ctx.userAgent, ctx.viewport].filter(Boolean).map((b) => escapeHtml(b!));
  if (browser.length) lines.push(`<strong>Browser:</strong> ${browser.join(" · ")}`);
  return `<hr/><p>${lines.join("<br/>")}</p>`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- compose`
Expected: PASS (all compose tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): types + HTML composers (title, context, escape)"
```

---

### Task 3: feedback-core — parameterized Teamwork client (TDD)

**Files:**
- Create: `packages/feedback-core/src/teamwork.ts`
- Test: `packages/feedback-core/test/teamwork.test.ts`

**Interfaces:**
- Consumes: `TeamworkConfig` from `./types`.
- Produces:
  - `teamworkTaskUrl(cfg: TeamworkConfig, taskId: string): string`
  - `createFeedbackTaskInTeamwork(cfg: TeamworkConfig, token: string, title: string): Promise<string>`
  - `addHtmlComment(cfg: TeamworkConfig, token: string, taskId: string, html: string): Promise<void>`
  - `moveTaskToStage(cfg: TeamworkConfig, token: string, taskId: string): Promise<boolean>`
  - `setSoleFollower(cfg: TeamworkConfig, token: string, taskId: string, followerId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test** (mock global `fetch`)

`test/teamwork.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFeedbackTaskInTeamwork, addHtmlComment, moveTaskToStage, teamworkTaskUrl } from "../src/teamwork";
import type { TeamworkConfig } from "../src/types";

const cfg: TeamworkConfig = {
  baseUrl: "https://mavenmm.teamwork.com",
  tasklistId: "2976106", assigneeId: "100", workflowId: "66400", stageId: "388923",
};

function mockFetch(impl: (url: string, init: any) => { ok: boolean; status?: number; body?: string }) {
  return vi.fn(async (url: string, init: any) => {
    const r = impl(url, init);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), text: async () => r.body ?? "" } as any;
  });
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("teamworkTaskUrl", () => {
  it("builds the human url", () => { expect(teamworkTaskUrl(cfg, "999")).toBe("https://mavenmm.teamwork.com/app/tasks/999"); });
});

describe("createFeedbackTaskInTeamwork", () => {
  it("POSTs to the tasklist with assignee + bearer, returns id", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://mavenmm.teamwork.com/tasklists/2976106/tasks.json");
      expect(init.headers.Authorization).toBe("Bearer T");
      const b = JSON.parse(init.body);
      expect(b["todo-item"]["responsible-party-id"]).toBe("100");
      expect(b["todo-item"].content).toBe("My title");
      return { ok: true, body: JSON.stringify({ id: 555 }) };
    });
    vi.stubGlobal("fetch", f);
    expect(await createFeedbackTaskInTeamwork(cfg, "T", "My title")).toBe("555");
  });
  it("throws on non-OK", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ ok: false, status: 403, body: "nope" })));
    await expect(createFeedbackTaskInTeamwork(cfg, "T", "x")).rejects.toThrow(/403/);
  });
});

describe("addHtmlComment", () => {
  it("POSTs an HTML comment", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://mavenmm.teamwork.com/tasks/555/comments.json");
      const b = JSON.parse(init.body);
      expect(b.comment["content-type"]).toBe("HTML");
      expect(b.comment.body).toBe("<p>hi</p>");
      return { ok: true };
    });
    vi.stubGlobal("fetch", f);
    await expect(addHtmlComment(cfg, "T", "555", "<p>hi</p>")).resolves.toBeUndefined();
  });
});

describe("moveTaskToStage", () => {
  it("returns true on OK and false (no throw) on failure", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ ok: true })));
    expect(await moveTaskToStage(cfg, "T", "555")).toBe(true);
    vi.stubGlobal("fetch", mockFetch(() => ({ ok: false, status: 500, body: "x" })));
    expect(await moveTaskToStage(cfg, "T", "555")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- teamwork`
Expected: FAIL — cannot find module `../src/teamwork`.

- [ ] **Step 3: Write `src/teamwork.ts`**

```ts
import type { TeamworkConfig } from "./types";

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export function teamworkTaskUrl(cfg: TeamworkConfig, taskId: string): string {
  return `${cfg.baseUrl}/app/tasks/${taskId}`;
}

export async function createFeedbackTaskInTeamwork(cfg: TeamworkConfig, token: string, title: string): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/tasklists/${cfg.tasklistId}/tasks.json`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ "todo-item": { content: title, "responsible-party-id": cfg.assigneeId, notify: false } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Teamwork task create failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  let taskId = "";
  try { const j = JSON.parse(text) as { id?: string | number; taskId?: string | number }; taskId = String(j.id ?? j.taskId ?? ""); } catch { /* handled below */ }
  if (!taskId) throw new Error(`Teamwork task create returned no id — ${text.slice(0, 300)}`);
  return taskId;
}

export async function addHtmlComment(cfg: TeamworkConfig, token: string, taskId: string, html: string): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/tasks/${taskId}/comments.json`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ comment: { body: html, "content-type": "HTML", notify: false } }),
  });
  if (!res.ok) throw new Error(`Teamwork comment failed: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
}

export async function moveTaskToStage(cfg: TeamworkConfig, token: string, taskId: string): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/workflows/${cfg.workflowId}/stages/${cfg.stageId}/tasks.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ taskIds: [Number(taskId)] }),
    });
    return res.ok;
  } catch { return false; }
}

export async function setSoleFollower(cfg: TeamworkConfig, token: string, taskId: string, followerId: string): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/tasks/${taskId}.json`, {
      method: "PATCH",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ task: { changeFollowers: { userIds: [Number(followerId)] }, commentFollowers: { userIds: [Number(followerId)] } } }),
    });
    return res.ok;
  } catch { return false; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- teamwork`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): parameterized Teamwork client (create/comment/stage/follower)"
```

---

### Task 4: feedback-core — createTextFeedback orchestrator + public exports (TDD)

**Files:**
- Create: `packages/feedback-core/src/create-text-feedback.ts`
- Modify: `packages/feedback-core/src/index.ts`
- Test: `packages/feedback-core/test/create-text-feedback.test.ts`

**Interfaces:**
- Consumes: composers (Task 2), Teamwork client (Task 3).
- Produces:
  - `createTextFeedback(cfg: FeedbackConfig, secrets: { teamworkToken: string }, input: CreateTextFeedbackInput, submitter: Submitter): Promise<CreateFeedbackResult>`
  - `index.ts` re-exports everything from `./types`, `./compose`, `./teamwork`, `./create-text-feedback`.

- [ ] **Step 1: Write the failing test**

`test/create-text-feedback.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createTextFeedback } from "../src/create-text-feedback";
import type { FeedbackConfig } from "../src/types";

const cfg: FeedbackConfig = {
  appName: "maven-home",
  teamwork: { baseUrl: "https://mavenmm.teamwork.com", tasklistId: "2976106", assigneeId: "100", workflowId: "66400", stageId: "388923" },
};

afterEach(() => vi.restoreAllMocks());

function sequenceFetch(calls: { ok: boolean; body?: string }[]) {
  const seen: string[] = [];
  const fn = vi.fn(async (url: string) => {
    seen.push(url);
    const r = calls.shift()!;
    return { ok: r.ok, status: r.ok ? 200 : 500, text: async () => r.body ?? "" } as any;
  });
  return { fn, seen };
}

describe("createTextFeedback", () => {
  it("rejects an empty subject without calling the network", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await createTextFeedback(cfg, { teamworkToken: "T" }, { type: "bug", subject: "   ", pageUrl: "https://h" }, {});
    expect(res).toEqual({ ok: false, error: expect.stringContaining("subject") });
    expect(f).not.toHaveBeenCalled();
  });

  it("creates task, posts comment, moves stage; skips follower when soleFollowerId unset", async () => {
    const { fn, seen } = sequenceFetch([
      { ok: true, body: JSON.stringify({ id: 777 }) }, // create
      { ok: true },                                    // comment
      { ok: true },                                    // stage
    ]);
    vi.stubGlobal("fetch", fn);
    const res = await createTextFeedback(
      cfg, { teamworkToken: "T" },
      { type: "bug", subject: "Broken link", bodyHtml: "<p>details</p>", pageUrl: "https://h/x" },
      { name: "Rondie" },
    );
    expect(res).toEqual({ ok: true, taskId: "777", url: "https://mavenmm.teamwork.com/app/tasks/777" });
    expect(seen).toHaveLength(3); // no follower PATCH
    expect(seen[0]).toContain("/tasklists/2976106/tasks.json");
    expect(seen[1]).toContain("/tasks/777/comments.json");
  });

  it("runs follower cleanup when soleFollowerId is set", async () => {
    const { fn, seen } = sequenceFetch([
      { ok: true, body: JSON.stringify({ id: 1 }) }, { ok: true }, { ok: true }, { ok: true },
    ]);
    vi.stubGlobal("fetch", fn);
    const cfg2: FeedbackConfig = { ...cfg, teamwork: { ...cfg.teamwork, soleFollowerId: "100" } };
    const res = await createTextFeedback(cfg2, { teamworkToken: "T" }, { type: "other", subject: "x", pageUrl: "https://h" }, {});
    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(4);
    expect(seen[3]).toContain("/projects/api/v3/tasks/1.json");
  });

  it("returns ok:false when task creation throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }) as any));
    const res = await createTextFeedback(cfg, { teamworkToken: "T" }, { type: "bug", subject: "x", pageUrl: "https://h" }, {});
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- create-text-feedback`
Expected: FAIL — cannot find module `../src/create-text-feedback`.

- [ ] **Step 3: Write `src/create-text-feedback.ts`**

```ts
import type { CreateFeedbackResult, CreateTextFeedbackInput, FeedbackConfig, Submitter } from "./types";
import { buildContextHtml, buildTitle } from "./compose";
import { addHtmlComment, createFeedbackTaskInTeamwork, moveTaskToStage, setSoleFollower, teamworkTaskUrl } from "./teamwork";

export async function createTextFeedback(
  cfg: FeedbackConfig,
  secrets: { teamworkToken: string },
  input: CreateTextFeedbackInput,
  submitter: Submitter,
): Promise<CreateFeedbackResult> {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { ok: false, error: "Please add a one-line subject." };

  const tw = cfg.teamwork;
  const token = secrets.teamworkToken;
  const title = buildTitle(input.type, subject);
  const body = (input.bodyHtml ?? "").trim() || "<p><em>(No description provided.)</em></p>";
  const commentHtml = body + buildContextHtml(submitter, {
    appName: cfg.appName, pageUrl: input.pageUrl, pageTitle: input.pageTitle, userAgent: input.userAgent, viewport: input.viewport,
  });

  try {
    const taskId = await createFeedbackTaskInTeamwork(tw, token, title);
    await addHtmlComment(tw, token, taskId, commentHtml);
    await moveTaskToStage(tw, token, taskId); // best-effort
    if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId); // best-effort, copydeck-only
    return { ok: true, taskId, url: teamworkTaskUrl(tw, taskId) };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Something went wrong filing your feedback." };
  }
}
```

- [ ] **Step 4: Replace `src/index.ts` with the real public surface**

```ts
export * from "./types";
export * from "./compose";
export * from "./teamwork";
export * from "./create-text-feedback";
```

- [ ] **Step 5: Run all core tests + build**

Run: `npm test`
Expected: all PASS (compose, teamwork, create-text-feedback; remove `test/smoke.test.ts`).
Run: `npm run build -w @mavenmm/feedback-core`
Expected: dist regenerated, no type errors.

- [ ] **Step 6: Commit**

```bash
git rm packages/feedback-core/test/smoke.test.ts
git add -A && git commit -m "feat(core): createTextFeedback orchestrator + public exports"
```

---

### Task 5: feedback-ui — context, launcher, config (compile-gated)

**Files:**
- Create: `packages/feedback-ui/package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `packages/feedback-ui/src/feedback-config.ts`, `src/feedback-context.tsx`, `src/feedback-launcher.tsx`, `src/index.ts`

**Interfaces:**
- Consumes: nothing from core at runtime (it `fetch`es the host endpoint); imports types only.
- Produces:
  - `interface UiFeedbackConfig { endpoint: string; getAccessToken: () => string | null | Promise<string | null>; zIndex?: number }`
  - `FeedbackProvider({ config, children }): JSX.Element`
  - `useFeedback(): { isOpen; open(); close(); config: UiFeedbackConfig }`
  - `FeedbackLauncher(props?: { className?: string }): JSX.Element`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@mavenmm/feedback-ui",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./styles.css": "./dist/styles.css"
  },
  "files": ["dist"],
  "publishConfig": { "registry": "https://npm.pkg.github.com" },
  "peerDependencies": { "react": ">=18 <20", "react-dom": ">=18 <20" },
  "devDependencies": { "react": "^19.1.0", "react-dom": "^19.1.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0" },
  "scripts": { "build": "tsup && cp src/styles.css dist/styles.css" }
}
```

- [ ] **Step 2: Write `tsconfig.json` + `tsup.config.ts`**

`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["react", "react-dom"],
});
```

- [ ] **Step 3: Write `src/feedback-config.ts`**

```ts
import { createContext, useContext } from "react";

export interface UiFeedbackConfig {
  /** URL of the host endpoint that files the task (e.g. "/api/feedback"). */
  endpoint: string;
  /** Returns the Maven JWT to send as a Bearer token (sync or async). */
  getAccessToken: () => string | null | Promise<string | null>;
  /** z-index for the floating portal; default 2147483000 (above MUI/Chakra). */
  zIndex?: number;
}

interface FeedbackState { isOpen: boolean; open: () => void; close: () => void; config: UiFeedbackConfig; }

export const FeedbackCtx = createContext<FeedbackState | null>(null);

export function useFeedback(): FeedbackState {
  const ctx = useContext(FeedbackCtx);
  if (!ctx) throw new Error("useFeedback must be used within a FeedbackProvider");
  return ctx;
}
```

- [ ] **Step 4: Write `src/feedback-context.tsx`**

```tsx
import { useCallback, useState, type ReactNode } from "react";
import { FeedbackCtx, type UiFeedbackConfig } from "./feedback-config";

export function FeedbackProvider({ config, children }: { config: UiFeedbackConfig; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return <FeedbackCtx.Provider value={{ isOpen, open, close, config }}>{children}</FeedbackCtx.Provider>;
}
```

- [ ] **Step 5: Write `src/feedback-launcher.tsx`**

```tsx
import { useFeedback } from "./feedback-config";

export function FeedbackLauncher({ className }: { className?: string }) {
  const { open } = useFeedback();
  return (
    <button type="button" onClick={open} className={className ?? "mvfb-launcher"}>
      <svg viewBox="0 0 20 20" fill="none" className="mvfb-launcher-icon" aria-hidden="true">
        <path d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      Feedback
    </button>
  );
}
```

- [ ] **Step 6: Write `src/index.ts`** (widget added in Task 6)

```ts
export { FeedbackProvider } from "./feedback-context";
export { FeedbackLauncher } from "./feedback-launcher";
export { useFeedback, type UiFeedbackConfig } from "./feedback-config";
```

- [ ] **Step 7: Install React devDeps + typecheck**

Run: `cd ~/Documents/Github/maven-dev/maven-dev-library && npm install`
Run: `npx tsc -p packages/feedback-ui/tsconfig.json --noEmit`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(ui): FeedbackProvider, launcher, config context"
```

---

### Task 6: feedback-ui — text widget + scoped CSS (compile-gated)

**Files:**
- Create: `packages/feedback-ui/src/feedback-widget.tsx`
- Create: `packages/feedback-ui/src/styles.css`
- Modify: `packages/feedback-ui/src/index.ts`

**Interfaces:**
- Consumes: `useFeedback`, `UiFeedbackConfig` (Task 5); type/result shapes mirror `@mavenmm/feedback-core` (`FeedbackType`, `CreateFeedbackResult`) but are declared locally to avoid a runtime dep on core.
- Produces: `FeedbackWidget(): JSX.Element | null`. POSTs `{ type, subject, bodyHtml, pageUrl, pageTitle, userAgent, viewport }` to `config.endpoint` with `Authorization: Bearer <token>`; expects `{ ok: true, taskId, url } | { ok: false, error }`.

- [ ] **Step 1: Write `src/styles.css`** (scoped, no resets)

```css
.mvfb-launcher { display:inline-flex; align-items:center; gap:6px; border:0; background:transparent; cursor:pointer; font:inherit; font-size:14px; padding:6px 10px; border-radius:6px; color:inherit; }
.mvfb-launcher:hover { background:rgba(0,0,0,0.06); }
.mvfb-launcher-icon { width:16px; height:16px; }
.mvfb-panel { position:fixed; display:flex; flex-direction:column; width:420px; max-width:calc(100vw - 32px); background:#fff; color:#0f172a; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 10px 40px rgba(0,0,0,0.25); font-family:system-ui,-apple-system,sans-serif; }
.mvfb-bar { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#e2e8f0; border-bottom:1px solid #cbd5e1; border-radius:8px 8px 0 0; cursor:move; user-select:none; }
.mvfb-bar-title { font-size:14px; font-weight:600; }
.mvfb-x { border:0; background:transparent; font-size:18px; line-height:1; color:#64748b; cursor:pointer; }
.mvfb-body { display:flex; flex-direction:column; gap:12px; padding:12px; }
.mvfb-types { display:flex; flex-wrap:wrap; gap:6px; }
.mvfb-type { border:0; border-radius:6px; padding:4px 10px; font-size:12px; font-weight:500; cursor:pointer; background:#f1f5f9; color:#475569; }
.mvfb-type[data-active="true"] { background:#1e293b; color:#fff; }
.mvfb-input, .mvfb-textarea { width:100%; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:4px; padding:6px 8px; font:inherit; font-size:14px; color:#0f172a; }
.mvfb-textarea { min-height:120px; resize:vertical; }
.mvfb-actions { display:flex; justify-content:flex-end; gap:8px; }
.mvfb-cancel { border:0; background:transparent; color:#64748b; font:inherit; font-size:14px; padding:8px 12px; cursor:pointer; }
.mvfb-send { border:0; border-radius:6px; background:#2563eb; color:#fff; font:inherit; font-size:14px; font-weight:500; padding:8px 16px; cursor:pointer; }
.mvfb-send:disabled { background:#cbd5e1; cursor:not-allowed; }
.mvfb-ok { border:1px solid #a7f3d0; background:#ecfdf5; color:#065f46; border-radius:6px; padding:12px; font-size:14px; }
.mvfb-ok a { color:#047857; }
.mvfb-err { border:1px solid #fecaca; background:#fef2f2; color:#b91c1c; border-radius:6px; padding:8px 12px; font-size:12px; }
```

- [ ] **Step 2: Write `src/feedback-widget.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFeedback } from "./feedback-config";

type FeedbackType = "bug" | "feature" | "working_well" | "other";
const TYPES: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature request" },
  { value: "working_well", label: "What's working well" },
  { value: "other", label: "Other" },
];
type Result = { ok: true; taskId: string; url: string } | { ok: false; error: string };

export function FeedbackWidget() {
  const { isOpen, close, config } = useFeedback();
  const [mounted, setMounted] = useState(false);
  const [type, setType] = useState<FeedbackType>("bug");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (isOpen && !pos) setPos({ left: Math.max(16, window.innerWidth - 444), top: Math.max(16, Math.round(window.innerHeight * 0.12)) });
  }, [isOpen, pos]);

  const onMove = useCallback((e: MouseEvent) => {
    if (!drag.current) return;
    setPos({ left: Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - 60), top: Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - 60) });
  }, []);
  const onUp = useCallback(() => { drag.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }, [onMove]);
  const onDown = useCallback((e: React.MouseEvent) => {
    if (!pos) return;
    drag.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [pos, onMove, onUp]);
  useEffect(() => () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }, [onMove, onUp]);

  function reset() { setSubject(""); setBody(""); setResult(null); }
  function handleClose() { reset(); close(); }

  async function send() {
    if (!subject.trim() || submitting) return;
    setSubmitting(true); setResult(null);
    try {
      const token = await config.getAccessToken();
      const res = await fetch(config.endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          type, subject: subject.trim(), bodyHtml: body.trim() ? `<p>${body.trim().replace(/\n/g, "<br/>")}</p>` : "",
          pageUrl: window.location.href, pageTitle: document.title, userAgent: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}`,
        }),
      });
      const json = (await res.json()) as Result;
      setResult(res.ok ? json : { ok: false, error: (json as any)?.error ?? `HTTP ${res.status}` });
      if (res.ok && (json as any).ok) { setSubject(""); setBody(""); }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally { setSubmitting(false); }
  }

  if (!mounted || !isOpen || !pos) return null;
  const z = config.zIndex ?? 2147483000;

  return createPortal(
    <div className="mvfb-panel" role="dialog" aria-label="Send feedback" style={{ top: pos.top, left: pos.left, zIndex: z }}>
      <div className="mvfb-bar" onMouseDown={onDown}>
        <span className="mvfb-bar-title">Send feedback</span>
        <button type="button" className="mvfb-x" aria-label="Close" onClick={handleClose}>×</button>
      </div>
      <div className="mvfb-body">
        {result?.ok ? (
          <div className="mvfb-ok">
            <p>Thanks — your feedback was filed.</p>
            <a href={result.url} target="_blank" rel="noreferrer">View the Teamwork task →</a>
            <div className="mvfb-actions"><button type="button" className="mvfb-send" onClick={() => setResult(null)}>Send another</button><button type="button" className="mvfb-cancel" onClick={handleClose}>Done</button></div>
          </div>
        ) : (
          <>
            <div className="mvfb-types">
              {TYPES.map((t) => (
                <button key={t.value} type="button" className="mvfb-type" data-active={type === t.value} onClick={() => setType(t.value)}>{t.label}</button>
              ))}
            </div>
            <input className="mvfb-input" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="One-line summary" />
            <textarea className="mvfb-textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened? What did you expect?" />
            {result && !result.ok && <p className="mvfb-err">{result.error}</p>}
            <div className="mvfb-actions">
              <button type="button" className="mvfb-cancel" onClick={handleClose}>Cancel</button>
              <button type="button" className="mvfb-send" disabled={submitting || !subject.trim()} onClick={send}>{submitting ? "Sending…" : "Send feedback"}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: Add the widget to `src/index.ts`**

```ts
export { FeedbackProvider } from "./feedback-context";
export { FeedbackLauncher } from "./feedback-launcher";
export { FeedbackWidget } from "./feedback-widget";
export { useFeedback, type UiFeedbackConfig } from "./feedback-config";
```

- [ ] **Step 4: Typecheck + build both packages**

Run: `npx tsc -p packages/feedback-ui/tsconfig.json --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: both packages build; `packages/feedback-ui/dist/styles.css` exists.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): text-only feedback widget + scoped CSS"
```

---

### Task 7: Publish both packages to private GitHub Packages

**Files:**
- Modify: root `package.json` (bump note only if needed)
- Use: existing root `.npmrc`

**Interfaces:**
- Produces: installable `@mavenmm/feedback-core@0.1.0` and `@mavenmm/feedback-ui@0.1.0` on GitHub Packages.

- [ ] **Step 1: Create the GitHub repo + push**

```bash
cd ~/Documents/Github/maven-dev/maven-dev-library
gh repo create mavenmm/maven-dev-library --private --source=. --remote=origin --push
```
Expected: repo created, `main` pushed.

- [ ] **Step 2: Authenticate npm to GitHub Packages** (one-time, local)

Confirm `~/.npmrc` (NOT the repo file) has a line:
```
//npm.pkg.github.com/:_authToken=<GH PAT with write:packages,read:packages>
```
Verify: `npm whoami --registry=https://npm.pkg.github.com`
Expected: prints your GitHub username.

- [ ] **Step 3: Build, then publish both packages**

```bash
npm run build
npm publish -w @mavenmm/feedback-core
npm publish -w @mavenmm/feedback-ui
```
Expected: both show `+ @mavenmm/feedback-*@0.1.0`.

- [ ] **Step 4: Commit any metadata changes**

```bash
git add -A && git commit -m "chore: publish feedback-core + feedback-ui 0.1.0 to GitHub Packages" --allow-empty
```

---

### Task 8: maven-home — feedback Netlify Function (JWT → Teamwork token → core)

**Files:**
- Create: `~/Documents/Github/maven-internals/maven-home/functions/feedback.ts`
- Create/Modify: `~/Documents/Github/maven-internals/maven-home/.npmrc`
- Modify: `~/Documents/Github/maven-internals/maven-home/package.json` (add dep)

**Interfaces:**
- Consumes: `@mavenmm/feedback-core` `createTextFeedback`; the auth-service exchange pattern from `functions/get-teamwork-token.ts`.
- Produces: `POST /api/feedback` → `{ ok: true, taskId, url } | { ok: false, error }`.

- [ ] **Step 1: Add the registry + install the package**

`~/Documents/Github/maven-internals/maven-home/.npmrc` (add line; keep existing contents):
```
@mavenmm:registry=https://npm.pkg.github.com
```
Run:
```bash
cd ~/Documents/Github/maven-internals/maven-home
npm install @mavenmm/feedback-core@0.1.0
```
Expected: added to `dependencies`.

- [ ] **Step 2: Write `functions/feedback.ts`**

```ts
import type { Handler, HandlerEvent } from "@netlify/functions";
import { createTextFeedback, type CreateTextFeedbackInput, type FeedbackConfig, type Submitter } from "@mavenmm/feedback-core";

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "https://auth.mavenmm.com";
const DOMAIN_KEY = process.env.VITE_DOMAIN_KEY || "dev_localhost_shared";
const TW_BASE = "https://mavenmm.teamwork.com";

function cfg(): FeedbackConfig {
  return {
    appName: "Maven Home",
    teamwork: {
      baseUrl: TW_BASE,
      tasklistId: process.env.FEEDBACK_TASKLIST_ID!,   // shared "Team feedback" tasklist
      assigneeId: process.env.FEEDBACK_ASSIGNEE_ID!,   // Rondie's Teamwork user id
      workflowId: process.env.FEEDBACK_WORKFLOW_ID!,
      stageId: process.env.FEEDBACK_STAGE_ID!,         // "To Do (ASAP)"
      // soleFollowerId intentionally unset: task is authored by the submitter's own token.
    },
  };
}

/** Exchange the Maven JWT for the user's Teamwork token + userId. */
async function exchange(event: HandlerEvent): Promise<{ token: string; userId: string } | null> {
  const authHeader = event.headers.authorization;
  if (!authHeader) return null;
  const res = await fetch(`${AUTH_SERVICE_URL}/auth/token`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      "X-Domain-Key": DOMAIN_KEY,
      "Content-Type": "application/json",
      Origin: "https://home.mavenmm.com",
      ...(event.headers.cookie ? { Cookie: event.headers.cookie } : {}),
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { accessToken?: string; userId?: string };
  if (!data.accessToken) return null;
  return { token: data.accessToken, userId: String(data.userId ?? "") };
}

/** Best-effort: resolve the submitter's display name from Teamwork. */
async function resolveName(token: string, userId: string): Promise<Submitter> {
  if (!userId) return {};
  try {
    const res = await fetch(`${TW_BASE}/people/${userId}.json`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { userId };
    const j = (await res.json()) as { person?: { "first-name"?: string; "last-name"?: string; "email-address"?: string } };
    const p = j.person ?? {};
    const name = [p["first-name"], p["last-name"]].filter(Boolean).join(" ");
    return { userId, name: name || undefined, email: p["email-address"] || undefined };
  } catch { return { userId }; }
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
  const auth = await exchange(event);
  if (!auth) return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Not authenticated" }) };

  let input: CreateTextFeedbackInput;
  try { input = JSON.parse(event.body ?? "{}") as CreateTextFeedbackInput; }
  catch { return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Bad request body" }) }; }

  const submitter = await resolveName(auth.token, auth.userId);
  const result = await createTextFeedback(cfg(), { teamworkToken: auth.token }, input, submitter);
  return { statusCode: result.ok ? 200 : 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
};

export { handler };
```

- [ ] **Step 3: Typecheck maven-home**

Run: `cd ~/Documents/Github/maven-internals/maven-home && npx tsc -b --noEmit`
Expected: no errors (the function and the imported types resolve).

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/Github/maven-internals/maven-home
git add functions/feedback.ts .npmrc package.json package-lock.json
git commit -m "feat: feedback Netlify function (JWT exchange -> @mavenmm/feedback-core)"
```

---

### Task 9: maven-home — mount the widget + end-to-end verification

**Files:**
- Create: `~/Documents/Github/maven-internals/maven-home/src/components/FeedbackMount.tsx`
- Modify: `~/Documents/Github/maven-internals/maven-home/src/App.tsx`
- Modify: `~/Documents/Github/maven-internals/maven-home/src/components/Layout.tsx`
- Add dep: `@mavenmm/feedback-ui`

**Interfaces:**
- Consumes: `FeedbackProvider`, `FeedbackLauncher`, `FeedbackWidget`, `UiFeedbackConfig` from `@mavenmm/feedback-ui`; `useAuthContext().getAccessToken` from `@mavenmm/teamwork-auth`.

- [ ] **Step 1: Install the UI package + its CSS**

```bash
cd ~/Documents/Github/maven-internals/maven-home
npm install @mavenmm/feedback-ui@0.1.0
```

- [ ] **Step 2: Import the widget CSS once** (in `src/index.css`, append)

```css
@import "@mavenmm/feedback-ui/styles.css";
```

- [ ] **Step 3: Write `src/components/FeedbackMount.tsx`** (binds auth → config; renders launcher+widget)

```tsx
import { useAuthContext } from "@mavenmm/teamwork-auth";
import { FeedbackProvider, FeedbackLauncher, FeedbackWidget, type UiFeedbackConfig } from "@mavenmm/feedback-ui";
import type { ReactNode } from "react";

export function FeedbackRoot({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuthContext();
  const config: UiFeedbackConfig = { endpoint: "/api/feedback", getAccessToken: () => getAccessToken() };
  return (
    <FeedbackProvider config={config}>
      {children}
      <FeedbackWidget />
    </FeedbackProvider>
  );
}

export { FeedbackLauncher };
```

- [ ] **Step 4: Wrap the app** — in `src/App.tsx`, wrap the routed tree with `FeedbackRoot` INSIDE `AuthProvider` (so `useAuthContext` is available):

```tsx
// add import:
import { FeedbackRoot } from "./components/FeedbackMount";

// inside <AuthProvider authConfig={authConfig}> wrap <Routes>…</Routes>:
<AuthProvider authConfig={authConfig}>
  <FeedbackRoot>
    <Routes>
      <Route element={<Layout />}>
        {routes.map((route) => (
          <Route key={route.path} path={route.path} element={<route.component />} />
        ))}
      </Route>
    </Routes>
  </FeedbackRoot>
</AuthProvider>
```

- [ ] **Step 5: Mount the launcher in the nav** — in `src/components/Layout.tsx`, add the import and place `<FeedbackLauncher />` in the right-cluster `<div className="flex items-center gap-4">` before the Logout button:

```tsx
// add import:
import { FeedbackLauncher } from "@mavenmm/feedback-ui";

// inside the right cluster:
<div className="flex items-center gap-4">
  {isRealUserDev && <AdminUserOverride />}
  <FeedbackLauncher />
  <button className="text-sm px-4 py-1.5 rounded bg-white ..." onClick={logout}>Logout</button>
</div>
```

- [ ] **Step 6: Build maven-home**

Run: `cd ~/Documents/Github/maven-internals/maven-home && npm run build`
Expected: `tsc -b` clean, `vite build` succeeds.

- [ ] **Step 7: Set the function env vars** (Netlify dashboard + local `.env` for `netlify dev`)

Set: `FEEDBACK_TASKLIST_ID=2976106`, `FEEDBACK_WORKFLOW_ID=66400`, `FEEDBACK_STAGE_ID=388923`, `FEEDBACK_ASSIGNEE_ID=<Rondie's Teamwork user id>`.
(To find Rondie's id: `tw` CLI or `GET /people.json` filtered by name. Do NOT guess.)

- [ ] **Step 8: Run locally and file a REAL task (acceptance test)**

Run: `cd ~/Documents/Github/maven-internals/maven-home && npm run dev`
Then in the browser: log in, click **Feedback**, pick **Bug**, subject `Phase-1 smoke test`, body `hello from maven-home`, **Send feedback**.
Expected:
- The widget shows "Thanks — your feedback was filed" with a working Teamwork link.
- Open the task: title is `(Mon DD) [Bug] Phase-1 smoke test`, the **body is in the first comment** (not the description), the comment's context block shows **App: Maven Home** + the submitter + the page URL, the task is assigned to Rondie, and (best-effort) sits in the "To Do (ASAP)" stage.

- [ ] **Step 9: Commit**

```bash
cd ~/Documents/Github/maven-internals/maven-home
git add -A
git commit -m "feat: mount @mavenmm/feedback-ui widget in maven-home"
```

---

## Self-Review

**Spec coverage (Phase 1 scope only):**
- Two private packages on GitHub Packages → Tasks 1,5,7. ✔
- `feedback-core` text path mirrors copydeck (title, body-in-comment, types) → Tasks 2–4, verified against `/tmp/claude/copydeck-writing/app`. ✔
- Scoped CSS, no host Tailwind, configurable z-index, React 19 → Tasks 5,6. ✔
- Config object v1 (`FeedbackConfig`/`Secrets`) locked → Task 2 (consumed Task 8). ✔
- maven-home wiring on existing `get-teamwork-token` exchange rails, no follower hack, no bot account → Tasks 8,9. ✔
- Real-task acceptance (Dave's "second app actually works") → Task 9 Step 8. ✔
- **Out of Phase 1 (correctly absent):** video/recorder/Vimeo, the poller + `app_id`, central screenshot bucket, copydeck parity refactor, bot account, PAAB routing, paab auth spike, bugs B1–B4 (B1 lands with screenshots sub-phase; B3/B4 are poller/Phase 2).

**Placeholder scan:** no TBD/TODO; every code step has complete code. The only human-supplied value is Rondie's Teamwork user id (Task 9 Step 7), explicitly flagged "do not guess."

**Type consistency:** `FeedbackConfig`/`TeamworkConfig`/`Submitter`/`CreateTextFeedbackInput`/`CreateFeedbackResult` defined in Task 2, consumed unchanged in Tasks 4 and 8. `createTextFeedback(cfg, secrets, input, submitter)` signature identical in Task 4 (def) and Task 8 (call). UI POST body matches `CreateTextFeedbackInput` fields (Task 6 ↔ Task 8). `UiFeedbackConfig` defined Task 5, consumed Tasks 6 and 9.

**Known follow-ups (next plans, not this one):** screenshots-in-text sub-phase (+ central bucket, fix B1); Phase 2 video via reused copydeck poller (+ `app_id`); Phase 3 fan-out + bot account.
