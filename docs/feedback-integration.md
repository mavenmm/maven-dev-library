# Feedback widget — integration guide

How to add the in-app feedback widget to a Maven app. **maven-home is the reference
implementation** — when in doubt, copy from it (`mavenmm/home`).

## How it works

```
React widget  ──▶  app's Netlify functions  ──▶  maven-feedback-worker (CF)  ──▶  Teamwork task
(@mavenmm/         (thin proxies: auth +          (owns per-app config,            + R2 screenshots
 dev-library/ui)    forward to Worker)             files task, drains video)        + Vimeo + AI summary
```

The app side is almost entirely **copy-paste** — the only per-app code change is the `appId`
string. Per-app *behaviour* (which Teamwork project/tasklist, assignee, etc.) lives in the
**Worker's** `src/config.ts`, not in the app.

Prerequisites: the app is already auth-gated with `@mavenmm/teamwork-auth` (an `<AuthProvider>`
at the root) and hosted on Netlify with functions enabled. Both Dashboard and Status meet this.

---

## Part A — App side (copy from maven-home)

### 1. Dependencies (`package.json`)
```jsonc
"dependencies": {
  "@mavenmm/dev-library": "github:mavenmm/maven-dev-library#v0.3.0",  // pin a tag or, better, a commit SHA
  "@mavenmm/teamwork-auth": "^3.0.3"
}
```

### 2. Let Netlify install the private dep
`@mavenmm/dev-library` is a private git dep with **no registry token** — Netlify clones it over
git, which fails (`Permission denied (publickey)`) unless you rewrite the URL to HTTPS + a token.
**The robust way** (set these as Netlify environment variables — timing-independent, works for
every git call):

| Env var | Value |
|---|---|
| `GIT_CONFIG_COUNT` | `2` |
| `GIT_CONFIG_KEY_0` | `url.https://<GH_TOKEN>@github.com/.insteadOf` |
| `GIT_CONFIG_VALUE_0` | `ssh://git@github.com/` |
| `GIT_CONFIG_KEY_1` | `url.https://<GH_TOKEN>@github.com/.insteadOf` |
| `GIT_CONFIG_VALUE_1` | `git@github.com:` |

`<GH_TOKEN>` = a fine-grained GitHub PAT with read access to `mavenmm/maven-dev-library`
(ask Adam — it's the same token maven-home uses). **PATs expire** — rotate before it lapses or
CD breaks. (maven-home also carries a `preinstall` script doing the same rewrite; it's redundant
once `GIT_CONFIG_*` is set — prefer the env vars.)

### 3. Mount the widget
Copy `src/components/FeedbackMount.tsx` from maven-home verbatim. Then:

- Wrap the app in `<FeedbackRoot>` (inside the existing `<AuthProvider>`) — see `src/App.tsx`:
  ```tsx
  import { FeedbackRoot } from "./components/FeedbackMount";
  // ...
  <AuthProvider authConfig={authConfig}>
    <FeedbackRoot>
      {/* app */}
    </FeedbackRoot>
  </AuthProvider>
  ```
- Drop the launcher button into the layout (`src/components/Layout.tsx`):
  ```tsx
  import { FeedbackLauncher } from "@mavenmm/dev-library/ui";
  // ...
  <FeedbackLauncher variant="inverted" />   // "default" | "inverted"
  ```
- `FeedbackMount.tsx` imports `@mavenmm/dev-library/ui/styles.css` — that's the only style import needed.

### 4. The proxy functions
Copy these from maven-home's `functions/` and **change `appId`** in each (that's the only edit):

| File | Purpose |
|---|---|
| `functions/feedback.ts` | text feedback → `/feedback/text` |
| `functions/feedback-image.ts` | screenshot bytes → `/feedback/image` (returns public R2 URL) |
| `functions/feedback-video-target.ts` | mint Vimeo upload target → `/feedback/video-target` |
| `functions/feedback-video.ts` | submit recorded video → `/feedback/video` |
| `functions/lib/feedback-shared.ts` | `exchange()` + `resolveSubmitter()` + `callWorker()` helpers |

> In `feedback-shared.ts` you only need `exchange`, `resolveSubmitter`, `callWorker`. The old
> `feedbackConfig()` helper is **dead** — the Worker owns per-app config now — delete it.

### 5. `/api/*` → functions redirect (`netlify.toml`)
```toml
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

### 6. Netlify environment variables

| Env var | What |
|---|---|
| `FEEDBACK_WORKER_URL` | `https://maven-feedback-worker.chang-424.workers.dev` |
| `WORKER_SHARED_SECRET` | shared secret (same value the Worker holds) |
| `AUTH_SERVICE_URL` | `https://auth.mavenmm.com` |
| `VITE_DOMAIN_KEY` | the app's domain key for `@mavenmm/teamwork-auth` |
| `GIT_CONFIG_*` | see step 2 |
| `VITE_FEEDBACK_RICHTEXT` | `true` to enable the rich-text editor + screenshots (optional) |
| `VITE_FEEDBACK_VIDEO` | `true` to enable screen recording (optional) |

Text-only works with the flags off; screenshots/video light up only when the flags are `true`.

---

## Part B — Worker side (register the app)

In `mavenmm/maven-feedback-worker`:

### 1. Create the destination tasklist
Feedback tasks land in whatever **tasklist** you point at, and a tasklist belongs to a Teamwork
**project** — that's what puts feedback under the right app. Create a "Team feedback" tasklist in
the app's project and grab its id:
```bash
tw tasklist create --project-id <PROJECT_ID> --name "Team feedback"
tw tasklist list --project-id <PROJECT_ID>     # find the new id
```

### 2. Add a config entry to `src/config.ts` (`APPS` map)
```ts
"maven-dashboard": {                       // <- this is the appId your proxies send
  appName: "Maven Dashboard",
  teamwork: {
    baseUrl: "https://mavenmm.teamwork.com",
    tasklistId: "<the 'Team feedback' tasklist id from step 1>",
    assigneeId: "<Teamwork user id to assign>",
    workflowId: "66400",                   // shared Maven dev workflow (reuse for internal apps)
    stageId: "388923",                     // "To Do (ASAP)" — see `tw stages` for others
    soleFollowerId: "<Teamwork user id>",  // needed while using the shared token
  },
  vimeo: { folderId: "" },                 // numeric Vimeo folder id, or "" for account root
  summary: { model: "claude-sonnet-4-6", maxTokens: 700 },
},
```

### 3. Deploy
```bash
npx wrangler deploy
```

Secrets (`TEAMWORK_ACCESS_TOKEN`, `VIMEO_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `WORKER_SHARED_SECRET`)
are currently **shared across all apps** — no new secret per app. See "Known limitations" below.

---

## The two next apps

| App | Teamwork project | Suggested `appId` |
|---|---|---|
| **Dashboard** (`dashboard.mavenmm.com`) | `496857` — "Dashboard (dashboard.mavenmm.com)" | `maven-dashboard` |
| **Status** | `661818` — "(Adam) Maven Status Update App" | `status-update` |

For each: create the "Team feedback" tasklist in that project (Part B step 1), add the config
entry (step 2), deploy the Worker, then do Part A in the app repo with the matching `appId`.

---

## Per-app checklist

- [ ] Worker: "Team feedback" tasklist created in the app's Teamwork project
- [ ] Worker: `APPS` entry added in `src/config.ts` (tasklistId, assignee, etc.)
- [ ] Worker: `npx wrangler deploy`
- [ ] App: deps added (`dev-library` pinned + `teamwork-auth`)
- [ ] App: `GIT_CONFIG_*` env vars set on Netlify
- [ ] App: `FeedbackMount.tsx` copied; `<FeedbackRoot>` + `<FeedbackLauncher>` mounted
- [ ] App: 4 proxy functions + `feedback-shared.ts` copied; **`appId` changed** in all 4
- [ ] App: `/api/*` redirect + env vars set
- [ ] Test: submit text feedback → task appears in the right project/tasklist

## Gotchas

- **`appId` must match** between the app's functions and the Worker's `config.ts`, or the Worker
  returns `400 unknown app`.
- **Wrong tasklist = wrong project.** The task lands wherever the tasklist lives — double-check
  the tasklist is in the app's project, not another app's.
- **Private-dep build failure** (`git ls-remote ... Permission denied (publickey)`) = `GIT_CONFIG_*`
  missing or token expired.

## Known limitations (fan-out hardening — track before scaling wide)

- **One shared `WORKER_SHARED_SECRET`** guards all apps and `appId` is client-asserted — a leak in
  one app affects all. Move to per-app secrets before client-facing apps.
- **Config is a hardcoded map**, not per-app secrets — promote `APPS` to a D1 table.
- **dev-library genericity leaks**: `America/Toronto` timezone and "View the Teamwork task" copy are
  hardcoded — make them config-driven before an app in another timezone / non-Teamwork backend.
