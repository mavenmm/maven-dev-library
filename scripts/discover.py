#!/usr/bin/env python3
"""Find each consumer's checkout on THIS machine, by git remote.

consumers.json used to carry a `workspaceRoot` plus a hardcoded `path` per app.
That was one person's directory tree committed to a shared repo: it resolved to
nothing for everyone else, and — worse — it failed silently, so consumers.sh
printed a table of blanks that read like "nothing installed anywhere" rather
than "I looked in the wrong place".

So nothing about anyone's disk is stored any more. The registry keeps only what
is true in every clone (repo URL, pkgDir, defaultBranch, deploy), and we locate
the working copy by scanning for git checkouts whose origin remote matches the
repo URL. That also removes the need to record that a directory is named
differently from its repo — status-app/status-update, copydeck-cms/
copydeck-writing and home/maven-home are all matched by remote.

Scan root: $MAVEN_WORKSPACE if set, otherwise inferred from where this library
is checked out — its parent and grandparent are tried, and whichever finds more
registry repos wins. That makes the common layouts work with no configuration:
ours (tools/maven-dev-library beside dev/*) and a flat one (all repos siblings).
Repos live one or two levels below the root, so the walk stops at depth 3 and
never descends into a checkout it has already matched.

Used as a library (resolve()) by consumers.sh and rollout.sh, or standalone:

    ./scripts/discover.py consumers.json          # table
    ./scripts/discover.py consumers.json --json   # {id: {status, path, ...}}
"""
import json
import os
import subprocess
import sys

MAX_DEPTH = 3

# Scanning is cheap (~0.4s) but not free, and picking a root probes several
# candidates before resolve() scans the winner. Memoize both.
_scan_cache = {}
_root_cache = []


def candidate_roots():
    """Where might the sibling checkouts be?

    Derived from where THIS library is checked out rather than hardcoded, so a
    teammate who keeps repos in ~/code or ~/Documents/Github needs no setup. We
    sit at <workspace>/tools/maven-dev-library here, but a flat layout puts us
    at <workspace>/maven-dev-library — so try both our parent and grandparent,
    then the historical default."""
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    seen, roots = set(), []
    for r in (os.path.dirname(repo), os.path.dirname(os.path.dirname(repo)),
              os.path.expanduser("~/mavenmm")):
        if r and r not in seen and os.path.isdir(r):
            seen.add(r)
            roots.append(r)
    return roots


def scan_root(registry=None):
    """The chosen root. An explicit MAVEN_WORKSPACE always wins — probing is a
    convenience, never something that overrides what you asked for.

    Candidates are ranked by how many REGISTRY repos each finds, not by how many
    git checkouts it contains: a broader root almost always holds more repos,
    and we want the narrowest one that still finds the consumers. Ties keep the
    earlier (narrower) candidate."""
    env = os.environ.get("MAVEN_WORKSPACE")
    if env:
        return os.path.expanduser(env)
    if _root_cache:
        return _root_cache[0]
    wanted = {normalize(a["repo"]) for a in
              (registry["apps"] + [registry["worker"]])} if registry else None
    best, best_n = None, -1
    for root in candidate_roots():
        found = find_checkouts(root)
        n = len(set(found) & wanted) if wanted is not None else len(found)
        if n > best_n:
            best, best_n = root, n
    _root_cache.append(best or os.path.expanduser("~/mavenmm"))
    return _root_cache[0]


def normalize(url):
    """git@github.com:mavenmm/paab.git and https://github.com/mavenmm/paab
    are the same repo. Reduce both to github.com/mavenmm/paab."""
    if not url:
        return None
    u = url.strip().rstrip("/")
    for prefix in ("git+ssh://", "ssh://", "git+https://", "https://", "http://", "git://"):
        if u.startswith(prefix):
            u = u[len(prefix):]
            break
    if u.startswith("git@"):
        u = u[len("git@"):]
    u = u.replace(":", "/", 1) if "@" not in u and u.count(":") == 1 else u
    if u.endswith(".git"):
        u = u[:-len(".git")]
    # Drop any user@ left over from an scp-style remote.
    if "@" in u.split("/")[0]:
        u = u.split("@", 1)[1]
    return u.lower()


def origin_of(repo_dir):
    try:
        r = subprocess.run(
            ["git", "-C", repo_dir, "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5,
        )
    except Exception:
        return None
    return normalize(r.stdout) if r.returncode == 0 else None


def find_checkouts(root):
    """Map normalized remote -> [paths]. A repo can legitimately be cloned
    twice; keep both so the caller can report the ambiguity instead of
    picking one at random and bumping the wrong copy."""
    found = {}
    root = os.path.abspath(root)
    if root in _scan_cache:
        return _scan_cache[root]
    if not os.path.isdir(root):
        return found
    _scan_cache[root] = found
    # Symlinked directories ARE followed: people routinely symlink a project
    # tree in from another volume, and skipping those made a perfectly good
    # workspace look empty. Loops are the price, so track resolved paths.
    seen = set()
    stack = [(root, 0)]
    while stack:
        d, depth = stack.pop()
        real = os.path.realpath(d)
        if real in seen:
            continue
        seen.add(real)
        if os.path.isdir(os.path.join(d, ".git")):
            remote = origin_of(d)
            if remote:
                found.setdefault(remote, []).append(d)
            continue  # a checkout's subdirectories are its own business
        if depth >= MAX_DEPTH:
            continue
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        for e in entries:
            if e.is_dir() and not e.name.startswith(".") and e.name != "node_modules":
                stack.append((e.path, depth + 1))
    return found


def resolve(registry):
    """Return {id: {status, path, pkgPath, candidates, app}} for every entry.

    status is "ok", "missing" (not cloned here) or "ambiguous" (cloned twice).
    Callers must handle all three — a missing checkout is a normal state on a
    machine that simply does not work on that app, not an error."""
    root = scan_root(registry)
    checkouts = find_checkouts(root)
    out = {}
    for app in registry["apps"] + [registry["worker"]]:
        key = normalize(app["repo"])
        paths = sorted(checkouts.get(key, []))
        if len(paths) == 1:
            path = paths[0]
            out[app["id"]] = {
                "status": "ok",
                "path": path,
                "pkgPath": os.path.join(path, app.get("pkgDir", ".")),
                "candidates": paths,
                "app": app,
            }
        else:
            out[app["id"]] = {
                "status": "ambiguous" if paths else "missing",
                "path": None,
                "pkgPath": None,
                "candidates": paths,
                "app": app,
            }
    return out


def hint(resolved):
    """Finding NOTHING almost always means a misconfigured scan root, not six
    apps nobody has cloned. Say so — the original bug this whole module
    replaced was a wrong root failing quietly."""
    if resolved and not any(r["status"] == "ok" for r in resolved.values()):
        return (f"None of the {len(resolved)} repos were found under {scan_root()}.\n"
                f"If your checkouts live elsewhere, point MAVEN_WORKSPACE at the\n"
                f"directory that contains them, e.g.\n"
                f"    MAVEN_WORKSPACE=~/code ./scripts/consumers.sh")
    return None


def emit_shell(registry, want):
    """Print `eval`-able shell for rollout.sh: SCAN_ROOT plus an APPS array of
    id|path|pkgDir|defaultBranch|deploy|packageManager records. Lives here
    rather than in a heredoc inside rollout.sh because bash mis-parses nested
    quotes and parens in a heredoc within $( )."""
    import shlex
    apps = [a for a in registry["apps"] if not want or a["id"] in want]
    if want and len(apps) != len(want):
        missing = sorted(set(want) - {a["id"] for a in apps})
        print(f'echo "unknown app(s): {" ".join(missing)}" >&2; exit 1')
        return 0
    resolved = resolve(registry)
    specs = []
    for a in apps:
        loc = resolved[a["id"]]
        if loc["status"] == "ambiguous":
            clones = " ".join(loc["candidates"])
            print(f'echo "{a["id"]}: cloned more than once ({clones}) — '
                  f'point MAVEN_WORKSPACE at the tree you mean" >&2; exit 1')
            return 0
        specs.append("|".join([a["id"], loc["path"] or "", a.get("pkgDir", "."),
                               a["defaultBranch"], a["deploy"],
                               a.get("packageManager", "npm")]))
    print("SCAN_ROOT=" + shlex.quote(scan_root()))
    print("APPS=(" + " ".join(shlex.quote(s) for s in specs) + ")")
    return 0


def main():
    args = [a for a in sys.argv[1:]]
    as_json = "--json" in args
    as_shell = "--shell" in args
    positional = [a for a in args if not a.startswith("-")]
    reg_path = positional[0] if positional else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "consumers.json")
    registry = json.load(open(reg_path))

    if as_shell:
        # rollout.sh passes "${TARGETS[@]:-}", which is a single empty arg when
        # no app was named — that means "all apps", not an app called "".
        return emit_shell(registry, [t for t in positional[1:] if t])

    resolved = resolve(registry)

    if as_json:
        print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "app"}
                          for k, v in resolved.items()}, indent=2))
        return 0

    print(f"scan root: {scan_root()}  (override with MAVEN_WORKSPACE)\n")
    for app_id, r in resolved.items():
        if r["status"] == "ok":
            print(f"  {app_id:<16} {r['path']}")
        elif r["status"] == "missing":
            print(f"  {app_id:<16} NOT CLONED under {scan_root()}")
        else:
            print(f"  {app_id:<16} AMBIGUOUS — {len(r['candidates'])} clones: "
                  f"{', '.join(r['candidates'])}")
    print()
    print(hint(resolved) or "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
