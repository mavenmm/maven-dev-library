# Feedback widget — integration guide

How to add the in-app feedback widget to a Maven app. Two apps are integrated:
**maven-home** (`@mavenmm/teamwork-auth` cookie/JWT exchange) and **paab** (`mavenmm/paab`,
cookie `validate()` + Bearer fallback). Copy the one whose **auth model** matches your app.

## How it works

```
React widget  ──▶  app's Netlify functions  ──▶  maven-feedback-worker (CF)  ──▶  Teamwork task
(@mavenmm/         (thin proxies: auth +          (owns per-app config,            + R2 screenshots
 dev-library/ui)    forward user's TW token)       files task, drains video)        + Vimeo + AI summary
```

- The app side is mostly copy-paste — the only per-app code change is the `appId` string and the
  auth mechanism.
- Per-app *behaviour* (Teamwork project/tasklist, assignee, topic→assignee routing) lives in the
  **Worker's** `src/config.ts`, not in the app.
- The widget renders in a **shadow root** (v0.4.0+), so it's immune to the host app's CSS (Tailwind
  preflight, global `input`/`button` rules). Only `font-family`/`color` inherit from the host.

Prerequisites: the app is auth-gated (has a way to get the current user's Teamwork token) and
hosted on Netlify with functions enabled.

---

## Part A — App side

### 1. Dependencies (`package.json`)
```jsonc
"dependencies": {
  "@mavenmm/dev-library": "github:mavenmm/maven-dev-library#v0.5.0"  // pin a tag (or a commit SHA)
}
```

**Peer dependencies (required when you enable rich text / video).** The widget's composer is
lazy-loaded and imports TipTap directly; if a peer is missing, the modal **crashes on open**.
Install all of these at `^3` (matching versions):
```
@tiptap/react  @tiptap/pm  @tiptap/starter-kit  @tiptap/extension-image  @tiptap/extension-placeholder
```
> paab already had most of these but was missing `@tiptap/extension-placeholder` → the modal
> crashed the moment it opened. Don't skip it.

### 2. TypeScript resolution (only if your tsconfig uses classic `moduleResolution: "node"`)
The library ships `typesVersions` (v0.3.1+) so classic-`node` consumers (e.g. paab) resolve the
`/ui` and `/core` subpath **types** without any consumer-side config. **Do NOT add a tsconfig
`paths` entry** pointing `@mavenmm/dev-library/*` at the package's `.d.ts` — if the app runs
`vite-tsconfig-paths`, that mapping is applied at **runtime** too and loads the declaration file as
the module, crashing with `Export 'FEEDBACK_TYPES' is not defined in module`. (Apps on
`moduleResolution: "bundler"` need nothing.)

### 3. Install access for the private dep — the `preinstall` script (do this FIRST)
`@mavenmm/dev-library` is a **private** git dep. `npm install` clones it over SSH and fails with
`git ls-remote ssh://git@github.com/… Permission denied (publickey)` unless you set up access.
Add the `preinstall` script below to your app's `package.json` **before your first install**, then:

- **Local dev:** either have SSH access to the `mavenmm` org (most devs do) — then it just works —
  **or** `export GH_READ_TOKEN=<PAT>` before `npm install` (the preinstall rewrites to HTTPS+token).
- **CI (Netlify):** set `GH_READ_TOKEN` in the site's **builds** scope; the preinstall does the rest.
  Netlify's `GIT_CONFIG_*` env vars do **not** apply during the dependency-install stage.

The `preinstall` script (runs at the start of `npm ci`, before the clone; guarded so it no-ops
locally when `GH_READ_TOKEN` is unset):
```jsonc
"scripts": {
  "preinstall": "if [ -n \"$GH_READ_TOKEN\" ]; then for b in \"git+ssh://git@github.com/\" \"ssh://git@github.com/\" \"git@github.com:\" \"https://github.com/\"; do git config --global url.\"https://$GH_READ_TOKEN@github.com/\".insteadOf \"$b\"; done; fi"
}
```
Set **`GH_READ_TOKEN`** (a fine-grained PAT with read access to `mavenmm/maven-dev-library`) in the
Netlify site's env, **builds scope**. PATs expire — rotate before they lapse or CD breaks.

### 4. Mount the widget
Copy `FeedbackMount.tsx` from a reference app (paab: `src/components/FeedbackMount.tsx`). It wires the
transport, sources the submitter from your auth context, and mounts the provider + widget. Then:

- Wrap the app in `<FeedbackRoot>` **inside** your auth provider (so it can read the current user):
  ```tsx
  <FeedbackRoot>{/* app */}</FeedbackRoot>
  ```
- Drop the launcher where you want it — convention is **top-right, next to the user avatar**
  (`variant="inverted"` for dark headers):
  ```tsx
  import { FeedbackLauncher } from "@mavenmm/dev-library/ui";
  <FeedbackLauncher variant="inverted" />
  ```
- Keep the `@mavenmm/dev-library/ui/styles.css` import (the launcher itself is inline in the host;
  the modal styles are injected into its shadow root by the widget).

**Optional — topic step.** Pass `topics` in the UI config to open on a "what's this about?" step; the
chosen label is attached to the task as an `Area:` line (and can route the assignee — see Part B):
```tsx
const config: UiFeedbackConfig = {
  transport, enableRichText: RICHTEXT, enableVideo: VIDEO,
  topics: [
    { value: "app-general", label: "App (general)" },
    { value: "agentic",     label: "Agentic workflow" },
  ],
};
```

### 5. The proxy functions (auth + forward)
Copy the 4 proxies + the worker client + your auth helper. **The only per-app edit is `appId`.**
Each proxy: authenticate the caller, then `callWorker(path, { appId, submitter, userToken, input })`.

| File | Purpose |
|---|---|
| `feedback` | text → `/feedback/text` |
| `feedback-image` | screenshot bytes → `/feedback/image` (returns public R2 URL) |
| `feedback-video-target` | mint Vimeo upload target → `/feedback/video-target` |
| `feedback-video` | submit recorded video → `/feedback/video` |
| `lib/feedbackWorker` | `callWorker()` (adds the shared secret; wraps fetch in try/catch) |

**Forward the user's own Teamwork token** as `userToken` so the task is filed by the submitter, not
the shared bot. Where that token comes from depends on the app's auth:

- **maven-home** — `@mavenmm/teamwork-auth`: `exchange()` the Maven JWT for the Teamwork token.
- **paab** — cookie `validate()` returns the user's `access_token` in `options.headers.Authorization`.
  paab also adds a **Bearer fallback**: the `refresh_token` cookie `validate()` needs lapses while the
  app stays "logged in" via localStorage, so feedback would 401 until a re-login. The proxy accepts
  the app's short-lived localStorage JWT via `Authorization: Bearer <jwt>` (verified with
  `REACT_APP_JWT_KEY`, same payload as the cookie) — see `functions/lib/feedbackAuth.mts`. The widget
  transport sends that header alongside `credentials: "include"`.

### 6. `/api/*` → functions redirect (`netlify.toml`)
```toml
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

### 7. Netlify environment variables
The consuming **Netlify site must hold its COMPLETE env** — don't rely on a local `.env` file. paab
had been deploying with a local `.env.netlify.prod`, so its site was missing ~10 vars and CI
couldn't build. Feedback-specific keys to add:

| Env var | What | Scope |
|---|---|---|
| `FEEDBACK_WORKER_URL` | `https://maven-feedback-worker.chang-424.workers.dev` | functions |
| `WORKER_SHARED_SECRET` | shared secret (same value the Worker holds) | functions |
| `GH_READ_TOKEN` | PAT for the private-dep install (see step 3) | builds |
| `VITE_FEEDBACK_RICHTEXT` / `VITE_FEEDBACK_VIDEO` | `true` to enable rich text+screenshots / video | builds |

> ⚠️ **`netlify env:set --site X` gotcha:** run `netlify env:*` **from a directory linked to the
> target site** (`netlify link --id <site>` first). Running it with `--site X` from a directory
> linked to a *different* site silently targets the linked site — you'll think you set vars on X but
> they went elsewhere. (This cost ~an hour on paab: vars "set on paab-maven" from the maven-home dir
> actually landed on maven-home.)

---

## Part B — Worker side (register the app)

In `mavenmm/maven-feedback-worker`:

### 1. Create the destination tasklist
The task lands in whatever **tasklist** you point at; a tasklist belongs to a Teamwork **project** —
that's what files feedback under the right app.
```bash
tw tasklist create --project-id <PROJECT_ID> --name "Team feedback"
tw tasklist list --project-id <PROJECT_ID>     # grab the new id
```

### 2. Add a config entry to `src/config.ts` (`APPS` map)
```ts
"maven-dashboard": {                       // <- the appId your proxies send
  appName: "Maven Dashboard",
  teamwork: {
    baseUrl: "https://mavenmm.teamwork.com",
    tasklistId: "<'Team feedback' tasklist id from step 1>",
    assigneeId: "<default Teamwork user id>",
    workflowId: "66400",                   // shared Maven dev workflow (moveTaskToStage is best-effort)
    stageId: "388923",                     // "To Do (ASAP)"; see `tw stages`
    soleFollowerId: "<Teamwork user id>",  // needed while on the shared token
  },
  vimeo: { folderId: "" },                 // numeric Vimeo folder id, or "" for account root
  summary: { model: "claude-sonnet-4-6", maxTokens: 700 },
  // OPTIONAL: route a topic value to a different assignee (same tasklist).
  topicAssignees: { agentic: "118870" },   // e.g. paab: "Agentic workflow" → Dave
},
```

### 3. Deploy
```bash
npx wrangler deploy    # commit config.ts too, so git matches the deployed worker
```
Secrets (`TEAMWORK_ACCESS_TOKEN`, `VIMEO_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `WORKER_SHARED_SECRET`)
are **shared across all apps** today — no new secret per app. See "Known limitations".

---

## Integrated apps

| App | Teamwork project | `appId` | Auth model |
|---|---|---|---|
| **maven-home** | Home page (768246) | `maven-home` | `@mavenmm/teamwork-auth` exchange |
| **paab** | (OPP-009) PAAB APP (664715) | `paab-app` | cookie `validate()` + Bearer fallback; `agentic` → Dave |
| Dashboard (next) | `496857` | `maven-dashboard` | TBD |
| Status (next) | `661818` | `status-update` | TBD |

---

## Per-app checklist
- [ ] Worker: "Team feedback" tasklist created in the app's Teamwork project
- [ ] Worker: `APPS` entry in `src/config.ts` (+ `topicAssignees` if routing); deploy + commit
- [ ] App: `@mavenmm/dev-library` pinned + **TipTap peers** (if richtext/video)
- [ ] App: `preinstall` script added; `GH_READ_TOKEN` in the site's **builds** scope
- [ ] App: `FeedbackMount.tsx` + 4 proxies + auth helper copied; **`appId` changed**; user token forwarded
- [ ] App: `<FeedbackRoot>` + `<FeedbackLauncher>` mounted; `/api/*` redirect; env vars set on the SITE
- [ ] Test: submit while logged in (no forced re-login) → task appears in the right tasklist, as the submitter

## Gotchas (learned on paab)
- **Modal crashes on open** → missing `@tiptap/extension-placeholder` (or another TipTap peer).
- **`Export 'FEEDBACK_TYPES' is not defined`** at runtime → a tsconfig `paths` shim for the library is
  being applied at runtime by `vite-tsconfig-paths`, loading the `.d.ts`. Remove it; rely on `typesVersions`.
- **CI build fails `Permission denied (publickey)`** → missing `preinstall` script or `GH_READ_TOKEN`
  (in **builds** scope). `GIT_CONFIG_*` env vars alone do **not** work (they don't apply during install).
- **"Unauthorized" until re-login** → the app's session cookie lapsed; add the Bearer fallback (step 5).
- **Vars didn't take effect** → `netlify env:set --site` run from the wrong linked dir (see step 7 warning).
- **`appId` mismatch** between proxies and `config.ts` → Worker returns `400 unknown app`.
- **Wrong tasklist = wrong project.** Confirm the tasklist is in *this* app's project.

## Known limitations (fan-out hardening — before scaling wide)
- One shared `WORKER_SHARED_SECRET` guards all apps and `appId` is client-asserted — a leak in one
  app affects all. Move to per-app secrets before client-facing apps.
- Config is a hardcoded `APPS` map — promote to a D1 table.
- The async video AI-summary comment still posts under the stored (Chris's) token — swap to a bot
  account. `soleFollowerId` exists only for the shared-token workaround.
- dev-library genericity: `America/Toronto` timezone is hardcoded (`compose.ts`) — make it config-driven
  before an app in another timezone.
