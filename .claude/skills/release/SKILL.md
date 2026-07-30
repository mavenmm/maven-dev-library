---
name: release
description: Release a new version of @mavenmm/dev-library. Use when the user says "release", "tag a version", "publish a new version", "cut vX.Y.Z", or after merging changes that consumers need. CRITICAL - dist/ is committed to git; the build MUST run before tagging or consumers silently get the previous build.
---

# Release @mavenmm/dev-library

This package is consumed as a **git dependency** pinned to a tag. `dist/` is **committed** —
consumers install prebuilt artifacts and never run a build. A tag ships whatever `dist/` it
contains, so a release that skips the build ships the PREVIOUS build under the new version
number, with no error anywhere. The build step is not optional.

## Steps (in order, from the repo root)

1. **Verify clean state on main:**
```bash
git checkout main && git pull origin main && git status --porcelain
```

2. **Test, typecheck, build:**
```bash
npm ci && npm test && npm run typecheck && npm run build
```
`tsup` has `clean: true`, so stale hashed chunks are removed automatically.

3. **Bump the version** in `package.json` (the `version` field). Patch for fixes, minor for new
   components/props. Consumers pin exact tags, so semver is informational — but keep it honest.

4. **Commit — the `dist/` diff must be in the release commit:**
```bash
git add -A
git commit -m "Release vX.Y.Z — <one-line summary>"
```

5. **Sanity-check the build wasn't skipped** — if this release touched `src/`, the commit must
   also touch `dist/`:
```bash
git show HEAD --stat | grep -E "dist/|src/"
```
If `src/` files appear but no `dist/` files do, STOP — run `npm run build`, amend the commit.

6. **Push and tag:**
```bash
git push origin main
git tag vX.Y.Z && git push origin vX.Y.Z
```

7. **Bump consumers** (maven-home, paab, maven-dashboard, status-update): update the pin in each
   app's `package.json` (`github:mavenmm/maven-dev-library#vX.Y.Z`), reinstall so the lockfile
   re-resolves, commit. Warn the user: bumping the `#tag` doesn't always re-resolve lockfiles —
   verify the lockfile diff shows the new commit SHA.

## Never do

- **Never re-add a `prepare`/`postinstall` build script.** Build-on-install (≤ v0.5.2) broke git
  installs where rollup's platform-native binary fails (maven-dashboard prod droplet, yarn 1
  git-dep prepare env, npm/cli#4828) and slowed every Netlify/local install. `dist/` being
  committed is the deliberate fix.
- Never tag from a dirty tree or an unpushed commit.
- Never edit files in `dist/` by hand — it is build output; change `src/` and rebuild.
