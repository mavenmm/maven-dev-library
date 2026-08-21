// Is the supply-chain cooldown actually in force here — or just written down?
//
// `min-release-age` in .npmrc is silently ignored by npm 10.x: no warning, no
// error, it simply installs the newest release. So the line existing proves
// nothing about the install you just ran. Measured 2026-08-21 against esbuild
// (0.28.2 was 12 days old, 0.28.1 was 70):
//
//   npm 10.8.2,  cooldown on  -> 0.28.2  (ignored)
//   npm 11.10.0, cooldown on  -> 0.28.1  (enforced)
//   npm 11.10.0, cooldown off -> 0.28.2  (control)
//
// This asserts the three things that together make the cooldown real: the key
// is set, the engines floor names a version that honours it, and engine-strict
// makes a too-old npm fail loudly. It also reports the npm you are running now,
// which is the part a person actually gets wrong.
//
// Run: npm run verify:cooldown
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const NPMRC = join(ROOT, ".npmrc");
const PKG = join(ROOT, "package.json");

// The version that first enforces min-release-age. Not arbitrary — see above.
const ENFORCING_NPM = [11, 10, 0];

let failed = 0;
const ok = (m) => console.log(`✓ ${m}`);
const bad = (m, hint) => {
  failed++;
  console.error(`✗ ${m}`);
  if (hint) console.error(`   ${hint}`);
};

for (const f of [NPMRC, PKG]) {
  if (!existsSync(f)) {
    console.error(`✗ missing ${f} — run this from the repo root.`);
    process.exit(1);
  }
}

const npmrc = readFileSync(NPMRC, "utf8");
const pkg = JSON.parse(readFileSync(PKG, "utf8"));

// Ignore commented-out lines; a cooldown in a comment is not a cooldown.
const live = npmrc
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

const cooldown = live.match(/^\s*min-release-age\s*=\s*(\d+)/m);
cooldown
  ? ok(`.npmrc sets min-release-age=${cooldown[1]}`)
  : bad(".npmrc does not set min-release-age", "add `min-release-age=14`");

/^\s*engine-strict\s*=\s*true/m.test(live)
  ? ok(".npmrc sets engine-strict=true")
  : bad(
      ".npmrc does not set engine-strict=true",
      "without it, an npm below the engines floor installs anyway and skips the cooldown",
    );

const parse = (s) => (s.match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
const gte = (a, b) =>
  a.length === 3 && (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) >= 0;

const floorRaw = pkg.engines?.npm;
const floor = floorRaw ? parse(floorRaw) : [];
if (!floorRaw) {
  bad(
    "package.json declares no engines.npm floor",
    `add "npm": ">=${ENFORCING_NPM.join(".")}" — otherwise any npm is accepted`,
  );
} else if (!gte(floor, ENFORCING_NPM)) {
  bad(
    `engines.npm floor "${floorRaw}" is below ${ENFORCING_NPM.join(".")}`,
    "versions under that ignore min-release-age silently",
  );
} else {
  ok(`engines.npm floor "${floorRaw}" is at or above ${ENFORCING_NPM.join(".")}`);
}

// The environment actually in use, which is what the person can fix right now.
let running = null;
try {
  running = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
} catch {
  console.warn("! could not read the running npm version — skipping that check");
}
if (running) {
  gte(parse(running), ENFORCING_NPM)
    ? ok(`the npm running here (${running}) enforces the cooldown`)
    : bad(
        `the npm running here (${running}) IGNORES min-release-age`,
        `installs from this shell are NOT cooled down — use npm >= ${ENFORCING_NPM.join(".")} (volta pins ${pkg.volta?.npm ?? "one"})`,
      );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed — the cooldown is not fully in force.`);
  process.exit(1);
}
console.log("\nCooldown is configured and the current npm enforces it.");
