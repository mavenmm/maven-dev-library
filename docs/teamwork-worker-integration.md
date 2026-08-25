# Teamwork worker — integration guide

How Maven apps talk to Teamwork, and how to extend that surface. **Read this before adding
ANY new Teamwork functionality to any Maven app** — the answer is never "call Teamwork's API
from the app," even when that looks quicker.

## The three repos

| Repo | Role |
|---|---|
| [mavenmm/maven-teamwork-worker](https://github.com/mavenmm/maven-teamwork-worker) | Cloudflare Worker — the ONE holder of a Teamwork service credential. Verbs, per-app policy, deploy. Private. |
| [mavenmm/maven-dev-library](https://github.com/mavenmm/maven-dev-library) | This repo. The typed client (`@mavenmm/dev-library/core` → `teamwork-worker-client.ts`) apps use to call the worker. Public — never put secrets or infra addresses in it. |
| [mavenmm/copydeck-writing](https://github.com/mavenmm/copydeck-writing) | First consumer (appId `copydeck`): link tasks (`src/lib/teamwork-tasks.ts`) + milestone footer dates (`src/lib/teamwork-milestones.ts`) via `src/lib/teamwork-worker.ts`. The reference integration. |

## How it works

```
app server ──▶ maven-teamwork-worker (CF) ──▶ mavenmm.teamwork.com
 (typed client:      verifies the caller's Maven SSO JWT,
  Bearer = user's    runs the verb with the USER'S OWN Teamwork
  refresh JWT +      token (from the JWT payload), falls back to
  x-maven-app-id)    the bot token only where policy allows
```

- **Apps store ZERO Teamwork credentials.** The only app-side config is `TEAMWORK_WORKER_URL`
  (a plain env var, not a secret — the worker 401s anything without a valid Maven JWT).
- **Actions carry the real user's identity** wherever their permissions allow ("created by
  Dave", not "created by a service account"). The response's `tokenUsed: "user" | "service"`
  says which identity acted.
- **The service credential lives in exactly one place** (the worker's `TEAMWORK_BOT_TOKEN`
  secret), so rotating it is one `wrangler secret put`, not a hunt across app `.env` files.
- The Maven Dashboard's GraphQL API accepts the same Bearer-refresh-JWT contract
  (maven-dashboard PR #136) — one dialect for every Maven server→server hop.

## The rules (load-bearing)

1. **Verbs are Teamwork's vocabulary, never an app's.** `tasks.create`, `milestones.list` —
   not `/copydeck/deck-link-task`. A new app should normally need ZERO worker changes: it
   composes existing verbs. App workflow logic (e.g. copydeck's resolve-tasklist → create →
   reorder sequence, and its "only ever once per deck" gate) stays in the app.
2. **Never a raw proxy.** Every route has typed params and numeric-id path validation. A
   "forward this request to Teamwork" endpoint would make the worker's URL equivalent to
   the token itself.
3. **Policy is the governance seam.** `src/policy.ts` in the worker maps each `appId` to its
   allowed verbs AND — separately — which verbs may fall back to the bot token when the
   user's own token is rejected (401/403). Keep fallbacks as tight as the app justifies; a
   verb without fallback surfaces the 403 to the app (sometimes that IS the design — e.g.
   copydeck's milestone reads soft-fail to a `<<TBD>>` placeholder).

## Adding a new verb (checklist — changes in maven-teamwork-worker)

1. Add the verb id to the `Verb` union in `src/policy.ts` and grant it to the app(s) that
   need it (+ `serviceFallback` only if justified).
2. Implement it in `src/verbs/` — call Teamwork through `twRequest(env, caller, verb, path,
   init)` ONLY (it owns token selection, logging, the 8s timeout). Throw `VerbError` with
   the real HTTP status.
3. Route it in `src/index.ts` — validate every path id with the numeric regex, validate the
   body shape, never interpolate unvalidated strings into the Teamwork path.
4. `npm run typecheck` → commit → `npx wrangler deploy` → smoke it (`npx wrangler tail
   maven-teamwork-worker` shows `[teamwork] <app> <verb> user=<who> token=user|service`).

## Extending the client (changes in maven-dev-library)

1. Add the method + types to `src/core/teamwork-worker-client.ts`, mirroring the worker
   route exactly. Document Teamwork gotchas on the method's JSDoc — that's where consumers
   see them.
2. `npm run typecheck && npm run build && npm test` — **dist/ is COMMITTED** (consumers
   install prebuilt; no prepare script), so build BEFORE committing.
3. Bump `package.json` version, commit, tag `vX.Y.Z`, push (repo is public — nothing
   internal in code or comments).
4. Bump the consumer's pin: `"@mavenmm/dev-library": "github:mavenmm/maven-dev-library#vX.Y.Z"`.
   ⚠️ **If the consumer repo has a supply-chain cooldown (`min-release-age` in any npmrc), use
   the tarball form instead**: `https://codeload.github.com/mavenmm/maven-dev-library/tar.gz/vX.Y.Z`.
   npm (11.10+) converts min-release-age into an internal `--before` during git-dep preparation
   and then trips over its own exclusivity check — every `github:#tag` install fails with
   "--min-release-age cannot be provided when using --before". The tarball pins the same tag
   but skips git-dep preparation entirely. (Hit live on dev-job-tracker's Netlify build,
   2026-08-24.)

## Registering a new app

1. One entry in the worker's `src/policy.ts` (appId → verbs + serviceFallback). Deploy.
2. In the app: set `TEAMWORK_WORKER_URL`, depend on `@mavenmm/dev-library`, and build the
   client with `createTeamworkWorkerClient({ workerUrl, appId, getJwt })` where `getJwt`
   returns the raw `maven_refresh_token` cookie value (copydeck: `getSessionJwt()` in
   `src/lib/auth.ts` — returns null with no session, so calls fail soft).
3. No session (e.g. copydeck's `SKIP_AUTH` dev mode) → calls throw 401 without hitting the
   network — design the app's soft-fail/skip paths around that.

## Teamwork API gotchas already encoded in the worker (don't re-learn these)

- Tasklist reads MUST use `showCompleted=true` (a completed list is still THE list for a
  job; without it resolvers create "(#2)" near-duplicate lists — prod-verified).
- Never set a due date on task create (Teamwork bug defaults it to a random 2021 date).
- Auth scheme is `Bearer <token>`; Basic (`key:x` base64) 401s on every endpoint.
- Complete-never-delete for link tasks (completing is reversible; deleting isn't).
- 8s per-call timeout — verbs run inline in user-facing writes upstream.

## History / rationale

Built 2026-08-24 to end personal-token sprawl: one credential holder, per-user identity,
one-command rotation. The worker's `TEAMWORK_BOT_TOKEN` should be a dedicated bot user's
token, never a person's. The maven-dashboard server holds the only other Teamwork service
credential (its own sync machinery); everything else forwards user sessions.
