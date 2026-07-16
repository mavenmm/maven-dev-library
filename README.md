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

```jsonc
// package.json — pin a tag (or a commit SHA)
"@mavenmm/dev-library": "github:mavenmm/maven-dev-library#v0.5.0"
```

```ts
import { FeedbackProvider, FeedbackLauncher, FeedbackWidget } from "@mavenmm/dev-library/ui";
import "@mavenmm/dev-library/ui/styles.css";
import { createTextFeedback /* … */ } from "@mavenmm/dev-library/core";
```

- **Peer deps** (when using the widget's rich-text / video): `@tiptap/react`, `@tiptap/pm`,
  `@tiptap/starter-kit`, `@tiptap/extension-image`, `@tiptap/extension-placeholder` — all `^3`.
  A missing peer (esp. `extension-placeholder`) crashes the modal on open.
- **TypeScript:** `exports` + `typesVersions` cover both `bundler` and classic `node` resolution —
  do **not** add a consumer `paths` shim for this package (it breaks `vite-tsconfig-paths` at runtime).
- **CI (Netlify):** cloning the private dep needs a `preinstall` git-rewrite + a `GH_READ_TOKEN`
  build var — `GIT_CONFIG_*` env vars alone don't apply during the dependency-install stage.

On install, npm runs `prepare` and builds `dist/` automatically — no committed artifacts, no
registry token. See [`docs/feedback-integration.md`](docs/feedback-integration.md) for the full CI setup.

**Updating:** bump the `#tag` (or SHA) in the consuming app's `package.json` and reinstall.
There is no semver range resolution with git deps — you pin and bump explicitly.

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
