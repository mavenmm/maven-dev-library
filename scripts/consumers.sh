#!/usr/bin/env bash
# Who is on which version of @mavenmm/dev-library?
#
# Reads consumers.json — the registry, not a copy of it. Read-only: touches no
# git state, installs nothing. Checkouts are located by git remote (see
# scripts/discover.py); set MAVEN_WORKSPACE if you clone outside ~/mavenmm.
#
#   ./scripts/consumers.sh              # table of pinned vs installed vs latest
#   ./scripts/consumers.sh --json       # same data, machine-readable
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REG="$HERE/consumers.json"
[ -f "$REG" ] || { echo "missing $REG" >&2; exit 1; }

LATEST="$(git -C "$HERE" tag --list 'v*' --sort=-v:refname | head -1)"

python3 - "$REG" "$LATEST" "${1:-}" "$HERE/scripts" <<'PY'
import json, os, subprocess, sys

reg_path, latest, mode, script_dir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sys.path.insert(0, script_dir)
import discover

reg = json.load(open(reg_path))
resolved = discover.resolve(reg)
entries = reg["apps"] + [reg["worker"]]

def pinned(pkg):
    try:
        d = json.load(open(pkg))
    except Exception:
        return None
    for section in ("dependencies", "devDependencies"):
        v = d.get(section, {}).get("@mavenmm/dev-library")
        if v:
            return v.split("#")[-1] if "#" in v else v
    return None

def installed(pkg_dir):
    p = os.path.join(pkg_dir, "node_modules/@mavenmm/dev-library/package.json")
    try:
        return "v" + json.load(open(p))["version"]
    except Exception:
        return None

def branch(repo_dir):
    try:
        return subprocess.run(["git", "-C", repo_dir, "rev-parse", "--abbrev-ref", "HEAD"],
                              capture_output=True, text=True, timeout=5).stdout.strip() or None
    except Exception:
        return None

rows = []
for a in entries:
    loc = resolved[a["id"]]
    # No checkout here (or two of them) is a normal state, not an error — report
    # it as such rather than printing blanks that read like "nothing installed".
    if loc["status"] != "ok":
        rows.append({
            "id": a["id"], "repo": a["repo"], "deploy": a["deploy"],
            "pinned": None, "installed": None, "checkedOutBranch": None,
            "expectedBranch": a["defaultBranch"], "latest": latest,
            "locate": loc["status"], "candidates": loc["candidates"],
        })
        continue
    pkg_dir = loc["pkgPath"]
    rows.append({
        "id": a["id"], "repo": a["repo"], "deploy": a["deploy"],
        "pinned": pinned(os.path.join(pkg_dir, "package.json")),
        # Pinned and installed disagreeing is the failure that shipped the broken
        # build twice: `npm install` after a tag bump does NOT always re-resolve.
        "installed": installed(pkg_dir),
        "checkedOutBranch": branch(loc["path"]),
        "expectedBranch": a["defaultBranch"],
        "latest": latest,
        "locate": "ok", "candidates": loc["candidates"],
    })

if mode == "--json":
    print(json.dumps({"latest": latest, "consumers": rows}, indent=2))
    sys.exit(0)

print(f"@mavenmm/dev-library — latest tag: {latest}")
print(f"checkouts located under {discover.scan_root()} (MAVEN_WORKSPACE to change)\n")
print(f"{'app':<16} {'pinned':<9} {'installed':<10} {'branch':<22} {'deploy':<15} status")
print("-" * 96)
stale = drift = unlocated = 0
for r in rows:
    if r["locate"] != "ok":
        unlocated += 1
        note = ("not cloned here" if r["locate"] == "missing"
                else f"AMBIGUOUS — {len(r['candidates'])} clones: {', '.join(r['candidates'])}")
        print(f"{r['id']:<16} {'—':<9} {'—':<10} {'—':<22} {r['deploy']:<15} {note}")
        continue
    flags = []
    if r["pinned"] != latest:
        flags.append("STALE"); stale += 1
    if r["installed"] and r["pinned"] and r["installed"] != r["pinned"]:
        flags.append("LOCKFILE-DRIFT"); drift += 1
    if r["checkedOutBranch"] and r["checkedOutBranch"] != r["expectedBranch"]:
        flags.append(f"on {r['checkedOutBranch']}, expected {r['expectedBranch']}")
    print(f"{r['id']:<16} {str(r['pinned']):<9} {str(r['installed']):<10} "
          f"{str(r['checkedOutBranch']):<22} {r['deploy']:<15} {' | '.join(flags) or 'up to date'}")

summary = f"\n{stale} stale, {drift} with pinned/installed drift"
print(summary + (f", {unlocated} not located on this machine." if unlocated else "."))
misconfigured = discover.hint(resolved)
if misconfigured:
    print("\n" + misconfigured)
if drift:
    print("LOCKFILE-DRIFT means package.json and node_modules disagree — a plain\n"
          "`npm install` after a tag bump silently keeps the old version. Re-run\n"
          "scripts/rollout.sh, which forces re-resolution and verifies it took.")
PY
