# maven-dev-library

A private, shadcn-style shelf of reusable Maven dev components — shareable UI and
the backend logic that powers it. Components are added over time; the first will
be the in-app **feedback** widget.

## Packages

| Package | What it holds |
|---------|---------------|
| [`@mavenmm/core`](packages/core) | Framework-neutral backend / shared logic (no React, no DOM). Build: `tsup` (ESM+CJS+d.ts). |
| [`@mavenmm/ui`](packages/ui) | React frontend components + self-contained scoped CSS. Build: `tsup`. |

Each future feature contributes a module to one or both packages.

## Develop

```bash
npm install
npm test          # vitest (core logic)
npm run build     # build all packages
npm run typecheck # tsc project references
```

## Distribution

Private **GitHub Packages** under the `@mavenmm` scope (see `.npmrc`).
Consuming apps add `@mavenmm:registry=https://npm.pkg.github.com` + a read token.

## Docs

- Design spec: [`docs/specs/`](docs/specs)
- Implementation plans: [`docs/plans/`](docs/plans)
