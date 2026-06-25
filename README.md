# @mavenmm/dev-library

Maven's **private** shared dev-component library and **single source of truth** for
reusable UI + backend logic. It is **never published to a registry** — Maven apps
consume it directly via **git dependency**.

## Subpaths

| Import | What it is |
|--------|-----------|
| `@mavenmm/dev-library/core` | Framework-neutral backend / shared logic (no React, no DOM). |
| `@mavenmm/dev-library/ui` | React frontend components + scoped CSS. First component: the feedback widget. |
| `@mavenmm/dev-library/ui/styles.css` | The widget's self-contained stylesheet (import once). |

## Consume in a Maven app (git dependency)

```bash
# pin a tag (recommended) or a commit SHA
npm i "git+ssh://git@github.com/mavenmm/maven-dev-library.git#v0.1.0"
```

```ts
import { FeedbackProvider, FeedbackLauncher, FeedbackWidget } from "@mavenmm/dev-library/ui";
import "@mavenmm/dev-library/ui/styles.css";

import { /* createTextFeedback, ... (Phase 2) */ } from "@mavenmm/dev-library/core";
```

On install, npm runs the package's `prepare` script and builds `dist/` automatically
— there are no committed build artifacts and no registry token to configure.
Private-repo access (an SSH deploy key or a GitHub token) is required in CI to clone it.

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
src/core/   -> @mavenmm/dev-library/core   (backend logic; Phase 2)
src/ui/     -> @mavenmm/dev-library/ui      (React components + styles.css)
test/       -> vitest specs
docs/       -> specs + implementation plans
```

## Docs
- Design spec: [`docs/specs/`](docs/specs)
- Implementation plans: [`docs/plans/`](docs/plans)
