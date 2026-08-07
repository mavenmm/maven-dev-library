#!/usr/bin/env bash
# Roll a new @mavenmm/dev-library version out to consumer apps.
#
#   ./scripts/rollout.sh v0.7.0                  # dry run, ALL apps
#   ./scripts/rollout.sh v0.7.0 paab             # dry run, one app
#   ./scripts/rollout.sh v0.7.0 paab --apply     # branch, bump, verify, push, open PR
#
# What it deliberately does NOT do: merge, or deploy to production. It stops at an
# open PR, because every app deploys on merge (Netlify or GitHub Actions) and a
# script that fans six production deploys out of one command is a bad trade for
# the two minutes it saves. Merging stays a human decision, per app.
#
# What it DOES do is the error-prone mechanical part:
#   - refuses to touch a dirty or wrong-branch checkout
#   - forces npm to actually re-resolve the tag, then VERIFIES it took.
#     `npm install` after a bumped #tag silently keeps the old version; that is
#     how a known-broken build shipped to production once already.
#   - proves the new code is really in node_modules, not just in package.json
set -euo pipefail

VERSION="${1:-}"
[ -n "$VERSION" ] || { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
shift || true

APPLY=false
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    -*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *) TARGETS+=("$arg") ;;
  esac
done

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REG="$HERE/consumers.json"
DEP="github:mavenmm/maven-dev-library#${VERSION}"
BRANCH="chore/dev-library-${VERSION}"

git -C "$HERE" rev-parse "$VERSION" >/dev/null 2>&1 || {
  echo "tag $VERSION does not exist in the library — tag and push it first." >&2; exit 1; }

# Marker proving the built artifact really carries this release's code. Without a
# content check, "version says 0.7.0" can still be an old dist/ (the library ships
# a COMMITTED dist/, so a tag can carry a stale build).
MARKER="${MARKER:-mvui-fb-mic-bar}"

eval "$(python3 - "$REG" "${TARGETS[@]:-}" <<'PY'
import json, os, shlex, sys
reg = json.load(open(sys.argv[1]))
want = [t for t in sys.argv[2:] if t]
root = os.path.expanduser(reg["workspaceRoot"])
apps = [a for a in reg["apps"] if not want or a["id"] in want]
if want and len(apps) != len(want):
    missing = set(want) - {a["id"] for a in apps}
    print(f'echo "unknown app(s): {" ".join(sorted(missing))}" >&2; exit 1')
    sys.exit(0)
print("ROOT=" + shlex.quote(root))
print("APPS=(" + " ".join(shlex.quote("|".join([a["id"], a["path"], a.get("pkgDir", "."), a["defaultBranch"], a["deploy"]])) for a in apps) + ")")
PY
)"

echo "rolling out $VERSION  (marker: $MARKER)"
$APPLY || echo "DRY RUN — nothing will be changed. Add --apply to act."
echo

FAILED=()
for spec in "${APPS[@]}"; do
  IFS='|' read -r id path pkgdir defbranch deploy <<< "$spec"
  repo="$ROOT/$path"
  pkg="$repo/$pkgdir"
  echo "── $id  ($path, deploys via $deploy)"

  [ -d "$repo/.git" ] || { echo "   SKIP: not a git repo"; FAILED+=("$id:no-repo"); continue; }

  dirty="$(git -C "$repo" status --porcelain | wc -l | tr -d ' ')"
  cur="$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
  echo "   branch=$cur (expected $defbranch), uncommitted=$dirty"

  if [ "$dirty" != "0" ]; then
    echo "   SKIP: working tree is dirty — commit or stash first, this script will not stash for you"
    FAILED+=("$id:dirty"); continue
  fi
  if [ "$cur" != "$defbranch" ]; then
    echo "   SKIP: on '$cur', not '$defbranch'. Switch deliberately — a rollout branched off"
    echo "         someone's half-finished feature is worse than no rollout."
    FAILED+=("$id:wrong-branch"); continue
  fi

  if ! $APPLY; then
    echo "   would: branch $BRANCH, install $DEP in $pkgdir/, verify, push, open PR"
    continue
  fi

  git -C "$repo" fetch -q origin
  git -C "$repo" pull -q --ff-only
  git -C "$repo" checkout -q -B "$BRANCH"

  # --save forces re-resolution. Plain `npm install` honours the stale lockfile
  # entry and leaves the OLD version on disk while package.json claims the new one.
  ( cd "$pkg" && npm install "$DEP" --save >/dev/null 2>&1 ) || {
    echo "   FAIL: npm install failed (npm >= 11.16.0 is required with min-release-age)"
    git -C "$repo" checkout -q "$defbranch"; FAILED+=("$id:install"); continue; }

  got="$(node -p "require('$pkg/node_modules/@mavenmm/dev-library/package.json').version" 2>/dev/null || echo '?')"
  want="${VERSION#v}"
  if [ "$got" != "$want" ]; then
    echo "   FAIL: node_modules has $got, expected $want — the lockfile did not re-resolve"
    git -C "$repo" checkout -q "$defbranch"; FAILED+=("$id:not-resolved"); continue
  fi

  if ! grep -q "$MARKER" "$pkg/node_modules/@mavenmm/dev-library/dist/ui.js" 2>/dev/null; then
    echo "   FAIL: dist/ui.js lacks '$MARKER' — the tag shipped a stale build"
    git -C "$repo" checkout -q "$defbranch"; FAILED+=("$id:stale-dist"); continue
  fi
  echo "   verified: $got on disk, marker present in dist/ui.js"

  git -C "$repo" add -A
  git -C "$repo" commit -q -m "Bump @mavenmm/dev-library to $VERSION

Verified on disk (not just in package.json): node_modules reports $got and
dist/ui.js contains '$MARKER'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
  git -C "$repo" push -q -u origin "$BRANCH"
  ( cd "$repo" && gh pr create --title "Bump @mavenmm/dev-library to $VERSION" \
      --body "Automated by the library's scripts/rollout.sh.

Installed version verified on disk as **$got**, and \`dist/ui.js\` confirmed to contain \`$MARKER\` — package.json alone is not proof, because a bumped \`#tag\` does not reliably re-resolve the lockfile.

**Before merging:** confirm \`VITE_FEEDBACK_VIDEO=true\` exists in this site's *build* environment. It is inlined at build time, so an unset flag ships the widget text-only with no sign anything is wrong.

Deploys via **$deploy** on merge." >/dev/null 2>&1 ) \
    && echo "   PR opened" || echo "   pushed $BRANCH (no PR — open it manually)"
done

echo
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "needs attention: ${FAILED[*]}"
else
  echo "all targeted apps processed cleanly."
fi
$APPLY && cat <<'NEXT'

Not done yet — this stops at open PRs on purpose:
  1. Confirm VITE_FEEDBACK_VIDEO=true in each site's BUILD env (build-time inlined).
  2. Merge each PR; Netlify / GitHub Actions deploys from there.
  3. For Netlify, prefer a clear-cache deploy — a warm cache hides private-dep
     install failures until some unrelated build finally goes cold.
  4. Verify in the SERVED bundle, not the UI.
NEXT
exit 0
