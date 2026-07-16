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

**1. Add the dependency + the one-time `preinstall` script** to your app's `package.json`
(the `preinstall` is what lets an install clone the private dep with a token — add it once):
```jsonc
"dependencies": {
  "@mavenmm/dev-library": "github:mavenmm/maven-dev-library#v0.5.1"  // pin a tag (or a commit SHA)
},
"scripts": {
  // Rewrites the git@github.com clone → https+token when GH_READ_TOKEN is set (CI); no-ops locally.
  "preinstall": "if [ -n \"$GH_READ_TOKEN\" ]; then for b in \"git+ssh://git@github.com/\" \"ssh://git@github.com/\" \"git@github.com:\" \"https://github.com/\"; do git config --global url.\"https://$GH_READ_TOKEN@github.com/\".insteadOf \"$b\"; done; fi"
}
```

**2. Provide clone access:**
- **Local dev:** either have SSH access to the `mavenmm` org (your GitHub SSH key added — most devs
  already do), **or** `export GH_READ_TOKEN=<fine-grained PAT>` before `npm install` (the preinstall
  then rewrites to HTTPS + token).
- **CI (Netlify):** set `GH_READ_TOKEN` (a fine-grained PAT with read access to this repo) in the
  site's **builds** scope — the `preinstall` does the rest. Netlify's `GIT_CONFIG_*` env vars do
  **not** apply during the dependency-install stage, so the `preinstall` is required (not optional).

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

On install, npm runs `prepare` and builds `dist/` automatically — no committed artifacts, no
registry token. Full CI walkthrough: [`docs/feedback-integration.md`](docs/feedback-integration.md).

**Updating:** bump the `#tag` (or SHA) and reinstall — no semver range resolution with git deps.

## Release a new version

```bash
npm test && npm run build
# bump "version" in package.json, commit
git tag vX.Y.Z && git push --tags
```

## Develop

```bash
npm install        # also runs prepare -> build
npm test           # vitest (core + jsdom UI portability)
npm run typecheck
npm run build
```

## Structure

```
src/core/   -> @mavenmm/dev-library/core   (framework-neutral backend logic)
src/ui/     -> @mavenmm/dev-library/ui      (React components + styles.css)
test/       -> vitest specs
docs/       -> specs + implementation plans
```

## Docs
- **Add the feedback widget to an app:** [`docs/feedback-integration.md`](docs/feedback-integration.md) — step-by-step; maven-home + paab are integrated, Dashboard + Status next. Captures the paab learnings (peer deps, shadow-DOM isolation, CI preinstall, auth fallback, env gotchas).
- Design spec: [`docs/specs/`](docs/specs)
- Implementation plans: [`docs/plans/`](docs/plans)
