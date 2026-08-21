# @mavenmm/dev-library

Maven's **private** shared component library (SSOT for reusable UI + backend logic). **Never
published to a registry** — apps consume it as a pinned **git dependency** (`github:mavenmm/maven-dev-library#vX.Y.Z`).

- `src/core` → `@mavenmm/dev-library/core` — framework-neutral (no React, no DOM). Used by the CF
  `maven-feedback-worker`.
- `src/ui` → `@mavenmm/dev-library/ui` — React components. First component: the **feedback widget**.
- Consumed by **maven-home** and **paab**. To add it to an app, follow
  [`docs/feedback-integration.md`](docs/feedback-integration.md) — it carries the hard-won integration
  learnings; read it before changing the widget or advising a consumer.

## Architecture you must not break

- **Shadow DOM (v0.4.0+):** `FeedbackWidget` portals its modal/pill into a shadow root and injects
  the stylesheet there, so host CSS (Tailwind preflight, global element rules) can't leak in. The CSS
  is imported as a **string** via the tsup `.css` → `text` loader (`tsup.config.ts`) and injected as a
  `<style>`. Keep both: the string import (for the shadow root) *and* the copied `dist/styles.css`
  (for the launcher, which stays in the host light DOM). Inherited props (font/color) intentionally
  still flow from the host.
- **`typesVersions` (v0.3.1+)** in `package.json` mirrors `exports` so consumers on classic
  `moduleResolution: "node"` resolve `/ui` and `/core` types. If you add a subpath, update BOTH
  `exports` and `typesVersions`.
- **Peers are external:** React + all `@tiptap/*` are in `tsup.config` `external` and declared as
  optional peers. Consumers install them; the composer is lazy-loaded and imports TipTap directly.
- **Error handling (v0.6.0+) — the library reports NOTHING.** No Sentry client, no telemetry, no
  `console.*`. Observability is the host app's call (Rondie, 2026-08-06); our job is to hand back
  errors a host can act on without parsing a message string. Three rules:
  1. **Throw `FeedbackError`** (`src/core/errors.ts`) with `step`, `httpStatus`, `responseBody`,
     `cause`, and `retryable`. Never `throw new Error("...")` from core.
  2. **`retryable` is load-bearing.** 400/401/403/404/410/422 ⇒ permanent; everything else transient.
     A poller uses this to stop instead of re-sending a doomed request until its budget runs out —
     that distinction is exactly what a `string | null` return could not express, and its absence hid
     an expired Vimeo token for six days.
  3. **Best-effort steps warn, never throw.** `moveTaskToStage` / `setSoleFollower` /
     `moveVideoToFolder` still return `boolean`, but take an optional `WarningSink` so the reason
     survives. They surface as `warnings[]` on a successful result — never shown to the user.

  **The asymmetry to preserve:** once a Teamwork task exists, the result stays `ok: true` even if
  later steps fail. Reporting `ok: false` after creation makes users resubmit and duplicates the
  task — one copy being a title with no body, since the failing step *was* the body.

- **Mic verification (v0.7.0+) is a METER, not a gate.** The failure being designed against is
  someone who muted without noticing and narrates a whole recording for nothing. Four bars in the
  recording pill move with their voice, so a muted mic reads as four flat bars while they can still
  fix it. Rules: never block Send, never open a modal, never judge at a fixed timeout. Instant
  signals (`enumerateDevices`, `NotAllowedError`, `track.muted`) warn in words *before* recording;
  the RMS meter covers the case none of them can see — a live track delivering silence (hardware
  mute switch, gain at zero). `hasAudio:false` on submit means the backend files the task with a
  "no audio" note and does NOT queue it for transcription, because Vimeo can never caption silence.

- **The video summary comment (v0.8.0+) has three sections, in this order:** AI summary, still
  frames, raw transcript (Teamwork 41044223). Summary first because it's what a human reads;
  frames next because these reports are mostly visual; transcript last as the long tail, so the
  submitter's actual wording is preserved in Teamwork rather than only inside Vimeo. Tune via
  `FeedbackConfig.videoComment` — defaults are on for every app, deliberately, so nobody has to
  edit six per-app entries.
  - **Frames come from Vimeo, not from us.** `POST /videos/{id}/pictures` with `{time, active:false}`
    at 20%/70% of duration. Two non-obvious facts, both verified 2026-08-11: those CDN URLs are
    fetchable with **no auth** even though the videos are private (that's what makes an `<img>` in
    Teamwork work at all), and an inactive picture returns an **empty `link`** — the usable URLs
    live in `sizes[]`. `active:false` matters: `true` would silently overwrite the video's poster.
  - **The transcript is untrusted text.** Two layers neutralise markup: `vttToText` strips
    tag-shaped spans (its job is VTT cue markup), then `transcriptToHtml` escapes what survives —
    which is what catches an unclosed `<script` the first layer's regex can't match.

## Commands
```bash
npm install        # deps only — does NOT build (no prepare script; see Release)
npm test           # vitest — core specs + jsdom UI tests (query the widget THROUGH the shadow root)
npm run typecheck  # tsc --noEmit
npm run build      # tsup && cp src/ui/styles.css dist/styles.css — writes the COMMITTED dist/
```

## Release — `dist/` is committed; YOU MUST BUILD BEFORE TAGGING

`dist/` is checked into git and consumers install it **prebuilt**. There is deliberately **no
`prepare` script**: when this was built-on-install (≤ v0.5.2), every git install ran tsup inside
the consumer's package manager, which broke on machines where rollup's platform-native binary
doesn't install (the maven-dashboard prod droplet — yarn 1's git-dep prepare env hits
npm/cli#4828) and slowed every Netlify/local install. Do not re-add `prepare`.

The corollary: **a tag ships whatever `dist/` was committed at that tag.** If you change `src/`
and tag without rebuilding, consumers get the OLD build with the new version number — this fails
silently. The release checklist, in order:

```bash
npm test && npm run typecheck
npm run build            # tsup has clean:true, so stale chunks are removed
# bump "version" in package.json
git add -A               # dist/ diff MUST be part of the release commit
# PR the change to main (or commit directly), then tag the merged commit:
git tag vX.Y.Z origin/main && git push origin vX.Y.Z
```

Sanity check before pushing the tag: `git show vX.Y.Z --stat | grep dist/` — if the release
changed `src/` but no `dist/` files appear, the build step was skipped. Consumers pin the tag and
bump explicitly (no semver ranges with git deps).

## Consumers & rollout

`consumers.json` is the **single source of truth** for who installs this library — id, repo
URL, which subdirectory holds the `package.json`, default branch (some are `master`, some
`main`), which package manager installs it, and how each one deploys. Adding an app? Add it
there, not to a script.

It holds **no local paths**, deliberately. It used to carry a `workspaceRoot` plus a `path` per
app — one person's directory tree committed to a shared repo, which resolved to nothing for
everyone else and failed *silently*, so `consumers.sh` printed a table of blanks that read like
"nothing is installed anywhere". `scripts/discover.py` now finds each checkout by matching its
git origin against the repo URL. Only facts true in every clone belong in the registry. A side
benefit: three checkouts are named differently from their repos (`status-app`, `copydeck-cms`,
`home`) and nobody has to record it.

The scan root is inferred from where this library itself is checked out — its parent and
grandparent are tried and the one finding more registry repos wins — so both our layout
(`tools/maven-dev-library` beside `dev/*`) and a flat one work with no setup. `MAVEN_WORKSPACE`
overrides it. If a run finds nothing at all it says so and names the root, because a wrong root
failing quietly is the exact bug this replaced.

```bash
./scripts/consumers.sh            # who's on what: pinned vs installed vs latest tag
./scripts/discover.py             # where each checkout was found (or NOT CLONED / AMBIGUOUS)
./scripts/rollout.sh v0.7.0       # dry run over every app
./scripts/rollout.sh v0.7.0 paab --apply   # branch, bump, verify, push, open a PR
MAVEN_WORKSPACE=~/code ./scripts/consumers.sh   # if you clone somewhere else
```

`rollout.sh` **stops at an open PR by design.** Every app deploys on merge, so a script that
fans six production deploys out of one command is a bad trade for the two minutes it saves.
What it does automate is the part that has actually gone wrong: it refuses a dirty or
wrong-branch checkout, forces npm to re-resolve the tag, and then **verifies the new code is
really on disk** — both the version *and* a content marker in `dist/ui.js`, because this
package ships a committed `dist/` and a tag can carry a stale build.

It bumps with **npm only**, and skips any app whose `packageManager` says otherwise — dashboard
is a pnpm workspace that refuses npm outright via `preinstall: only-allow pnpm`, so bump that
one by hand. An app not cloned on this machine is skipped with a reason; an app cloned *twice*
is a hard error rather than a coin flip about which copy gets bumped.

Two failures worth knowing, both of which have bitten production:
- **`npm install` after bumping a `#tag` does not reliably re-resolve.** package.json says the
  new version while `node_modules` keeps the old one. `consumers.sh` flags this as
  LOCKFILE-DRIFT; `rollout.sh` fails loudly rather than committing it. The bump itself goes
  through `scripts/bump_manifest.py`, which rewrites both manifests and **deletes** the
  lockfile's package entry — deleting is what forces the re-resolve. That replaced
  `npm install <spec> --save`, which under npm 12 with `allow-git=root` (status-update) is
  refused outright: npm invalidates the root edge *because* the committish changed, and
  `allow-git=root` only exempts deps sitting on a valid root edge.
- **`VITE_FEEDBACK_RICHTEXT` / `VITE_FEEDBACK_VIDEO` are build-time.** Unset in a site's build
  env means the widget ships text-only with no error anywhere. Scripts can't read Netlify env,
  so this stays a manual pre-merge check.

## Gotchas
- **Consumer CI install is via `GIT_CONFIG_PARAMETERS`, NOT a `preinstall` script.** This is a private
  git dep; npm clones it over SSH, and Netlify's build bot has no SSH key → cold builds fail with
  `Permission denied (publickey)`. A `preinstall` git-rewrite runs too late for npm's clone;
  `GIT_CONFIG_PARAMETERS` (ssh→https rewrite + credential helper reading `GH_READ_TOKEN`) applies from
  process start. **Warm build cache hides the failure** — verify with a clear-cache deploy. Bumping the
  `#tag` doesn't always re-resolve `package-lock.json` (prod can silently serve the old version). Full
  detail + the exact env-var value: `docs/feedback-integration.md` step 3.
- UI tests are **shadow-aware** — modal content is in `[data-mvui-feedback-root]`'s shadow root, not
  the light DOM. Use `within(host.shadowRoot)`, not `screen`.
- Never tell a consumer to add a tsconfig `paths` entry for this package — `vite-tsconfig-paths`
  applies it at runtime and loads the `.d.ts` as the module (crash). `typesVersions` already handles it.
- Version constants (`CORE_VERSION`/`UI_VERSION`) are hand-maintained — keep in sync with `package.json`
  or drop them (open cleanup).
