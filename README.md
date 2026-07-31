# @mavenmm/dev-library

Maven's **private** shared dev-component library and **single source of truth** for
reusable UI + backend logic. It is **never published to a registry** — Maven apps
consume it directly via **git dependency**.

## Subpaths

| Import | What it is |
|--------|-----------|
| `@mavenmm/dev-library/core` | Framework-neutral backend / shared logic (no React, no DOM). |
| `@mavenmm/dev-library/ui` | React frontend components. The feedback widget renders in a **shadow root**, so host CSS (Tailwind preflight, global `input`/`button` rules) can't leak in. |
| `@mavenmm/dev-library/ui/styles.css` | Launcher styles for the host tree (the modal injects its own stylesheet into the shadow root). Import once. |

## Consume in a Maven app (git dependency)

> ⚠️ **This is a PRIVATE repo — set up clone access FIRST, or `npm install` fails with:**
> ```
> npm error command git … ls-remote ssh://git@github.com/mavenmm/maven-dev-library.git
> npm error git@github.com: Permission denied (publickey).
> ```

**1. Add the dependency** to your app's `package.json`:
```jsonc
"dependencies": {
  "@mavenmm/dev-library": "github:mavenmm/maven-dev-library#v0.5.3"  // pin a tag (or a commit SHA)
}
```

**2. Provide clone access:**
- **Local dev:** clone over your own GitHub **SSH key** (most devs in the `mavenmm` org already have
  one added) — the `github:` shorthand just works, nothing else to set up.
- **CI (Netlify):** SSH is a dead end (the build bot has no SSH key for dependency repos), so
  authenticate with a token over HTTPS. Set **two** env vars in the site's **builds** scope:

  | Env var | Value |
  |---|---|
  | `GIT_CONFIG_PARAMETERS` | `'url.https://github.com/.insteadOf=ssh://git@github.com/' 'url.https://github.com/.insteadOf=git+ssh://git@github.com/' 'url.https://github.com/.insteadOf=git@github.com:' 'credential.https://github.com.helper=!f() { echo username=x-access-token; echo "password=${GH_READ_TOKEN}"; }; f'` |
  | `GH_READ_TOKEN` | fine-grained PAT, **read** access to this repo |

  git reads `GIT_CONFIG_PARAMETERS` on every call from process start, rewrites the `ssh://` clone to
  `https://github.com/`, and a credential helper supplies the token **at clone time** — so no token
  lands in config or the lockfile. The three `insteadOf` rules cover every URL form the package
  managers use: npm clones `ssh://git@github.com/...`, npm's lockfile records `git+ssh://...`, and
  **pnpm clones the scp-style `git@github.com:...`** — drop the third rule and pnpm-based consumers
  (e.g. maven-dashboard) fail with `Host key verification failed`. A `preinstall` script does
  **not** work (it runs too late for npm's clone; warm build cache hides this — verify with a
  **clear-cache** deploy).

**3. Import:**
```ts
import { FeedbackProvider, FeedbackLauncher, FeedbackWidget } from "@mavenmm/dev-library/ui";
import "@mavenmm/dev-library/ui/styles.css";
import { createTextFeedback /* … */ } from "@mavenmm/dev-library/core";
```

- **Peer deps** (widget rich-text / video): `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`,
  `@tiptap/extension-image`, `@tiptap/extension-placeholder` — all `^3`. A missing peer (esp.
  `extension-placeholder`) crashes the modal on open.
- **TypeScript:** `exports` + `typesVersions` cover `bundler` and classic `node` — do **not** add a
  consumer `paths` shim for this package (it breaks `vite-tsconfig-paths` at runtime).

`dist/` is **committed to the repo** (since v0.5.3), so installs are prebuilt — no build step runs
in the consumer's install, no registry token needed. (Before v0.5.3 a `prepare` script built on
every install; it was removed because the tsup/rollup build breaks on some consumer machines —
rollup's native binary + yarn 1 git deps, npm/cli#4828 — and slowed every CI/local install.)
Full CI walkthrough: [`docs/feedback-integration.md`](docs/feedback-integration.md).

**Updating:** bump the `#tag` (or SHA) and reinstall — no semver range resolution with git deps.

## Release a new version

> ⚠️ **`dist/` is committed — you MUST `npm run build` and commit the result before tagging.**
> A tag ships whatever `dist/` it contains: tag without rebuilding and consumers silently get the
> previous build with the new version number.

```bash
npm test && npm run typecheck
npm run build
# bump "version" in package.json
git add -A && git commit   # the dist/ diff belongs in the release commit
git tag vX.Y.Z && git push origin main vX.Y.Z
```

Sanity check: `git show vX.Y.Z --stat | grep dist/` — a release that touched `src/` must also
touch `dist/`.

## Develop

```bash
npm install        # deps only — does NOT build dist/
npm run build      # rebuild dist/ after changing src/ (tsup clean:true)
npm test           # vitest (core + jsdom UI portability)
npm run typecheck
```

## Structure

```
src/core/   -> @mavenmm/dev-library/core   (framework-neutral backend logic)
src/ui/     -> @mavenmm/dev-library/ui      (React components + styles.css)
test/       -> vitest specs
docs/       -> specs + implementation plans
```

## Docs
- **Add the feedback widget to an app:** [`docs/feedback-integration.md`](docs/feedback-integration.md) — step-by-step; maven-home, paab, and status-update are integrated (Dashboard next). Captures the paab learnings (peer deps, shadow-DOM isolation, CI install via `GIT_CONFIG_PARAMETERS`, auth fallback, env gotchas).
- Design spec: [`docs/specs/`](docs/specs)
- Implementation plans: [`docs/plans/`](docs/plans)
