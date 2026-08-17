#!/usr/bin/env python3
"""Point a consumer's manifests at a new @mavenmm/dev-library tag, so that the
`npm install` which follows really re-resolves it.

    ./scripts/bump_manifest.py <pkgDir> "github:mavenmm/maven-dev-library#vX.Y.Z"

Two deliberate choices:

* package.json is edited as TEXT, one entry, so a version bump doesn't reformat
  somebody's whole manifest into a diff nobody can review.
* the lockfile's `node_modules/@mavenmm/dev-library` entry is DELETED, not just
  updated. Deleting is what forces the re-resolve. Rewriting the spec while
  leaving an entry that still satisfies it is exactly how a bumped #tag ends up
  installing the old commit — the failure that shipped a known-broken build.
  JSON round-tripping the lockfile costs no diff noise because the install
  regenerates it anyway.

This replaced `npm install <spec> --save`, which stopped working under npm 12
with allow-git=root: npm invalidates the root edge precisely BECAUSE the
committish changed, and allow-git=root only exempts deps on a valid root edge,
so the bump is refused as "non-root".
"""
import json
import os
import re
import sys

NAME = "@mavenmm/dev-library"


def main():
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    pkg_dir, dep = sys.argv[1], sys.argv[2]

    manifest = os.path.join(pkg_dir, "package.json")
    try:
        src = open(manifest).read()
    except OSError as e:
        print(f"cannot read {manifest}: {e}", file=sys.stderr)
        return 1

    pattern = r'("%s"\s*:\s*)"[^"]*"' % re.escape(NAME)
    new, count = re.subn(pattern, lambda m: m.group(1) + json.dumps(dep), src)
    if count != 1:
        print(f"expected exactly one {NAME} entry in {manifest}, found {count}",
              file=sys.stderr)
        return 1
    open(manifest, "w").write(new)

    lockfile = os.path.join(pkg_dir, "package-lock.json")
    if os.path.exists(lockfile):
        lock = json.load(open(lockfile))
        root = lock.get("packages", {}).get("", {})
        for section in ("dependencies", "devDependencies"):
            if NAME in root.get(section, {}):
                root[section][NAME] = dep
        lock.get("packages", {}).pop("node_modules/" + NAME, None)
        lock.get("dependencies", {}).pop(NAME, None)  # lockfileVersion 1/2 mirror
        open(lockfile, "w").write(json.dumps(lock, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
