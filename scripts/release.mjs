#!/usr/bin/env node
// Bumps the app version everywhere it is declared, commits and tags the release.
//
//   npm run release                   # next patch version, e.g. 1.1.0 → 1.1.1
//   npm run release -- minor          # or major: 1.1.0 → 1.2.0 / 2.0.0
//   npm run release -- 0.2.0          # an exact version
//   npm run release -- 0.2.0 --no-git # only rewrite the version files
//   npm run release -- --check v0.2.0 # fail unless every file says 0.2.0 (used by CI)
//
// Each run commits "Release vX.Y.Z" and tags vX.Y.Z (unless --no-git).
//
// Pushing the tag (`git push --follow-tags`) starts .github/workflows/release.yml.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// Edits are targeted replacements so the files keep their Prettier formatting.
const topLevelJsonVersion = /^ {2}"version": "([^"]+)"/m;

const files = {
  "package.json": {
    read: (text) => JSON.parse(text).version,
    write: (text, v) =>
      text.replace(topLevelJsonVersion, `  "version": "${v}"`),
  },
  "package-lock.json": {
    read: (text) => JSON.parse(text).packages[""].version,
    // Both the top-level entry and packages[""] carry the app's version.
    write: (text, v) =>
      text.replace(
        /("name": "snipit",\n\s*"version": )"[^"]+"/g,
        (_, prefix) => `${prefix}"${v}"`,
      ),
  },
  "src-tauri/tauri.conf.json": {
    read: (text) => JSON.parse(text).version,
    write: (text, v) =>
      text.replace(topLevelJsonVersion, `  "version": "${v}"`),
  },
  "src-tauri/Cargo.toml": {
    // The first `version =` line belongs to [package]; dependency versions come later.
    read: (text) => text.match(/^version = "(.+)"$/m)?.[1],
    write: (text, v) => text.replace(/^version = ".+"$/m, `version = "${v}"`),
  },
  "src-tauri/Cargo.lock": {
    read: (text) => text.match(/name = "snipit"\nversion = "(.+)"/)?.[1],
    write: (text, v) =>
      text.replace(
        /(name = "snipit"\nversion = )".+"/,
        (_, prefix) => `${prefix}"${v}"`,
      ),
  },
};

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** The next `kind` (patch, minor or major) version after `current`, as semver does it. */
function bump(current, kind) {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) fail(`current version "${current}" is not semver`);
  let [major, minor, patch] = match.slice(1, 4).map(Number);
  const pre = Boolean(match[4]);
  // A pre-release (1.2.0-beta.1) bumps to the release it was leading up to (1.2.0).
  if (kind === "major") {
    if (!(pre && minor === 0 && patch === 0)) major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    if (!(pre && patch === 0)) minor += 1;
    patch = 0;
  } else if (!pre) {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const BUMPS = ["patch", "minor", "major"];

const args = process.argv.slice(2);
const check = args.includes("--check");
const noGit = args.includes("--no-git");
const input =
  args.find((arg) => !arg.startsWith("--")) ?? (check ? undefined : "patch");
const version = BUMPS.includes(input)
  ? bump(
      files["package.json"].read(readFileSync("package.json", "utf8")),
      input,
    )
  : input?.replace(/^v/, "");

if (!version || !SEMVER.test(version)) {
  fail(
    `expected patch, minor, major or a version like 1.2.3 or 1.2.3-beta.1, got "${input ?? ""}"`,
  );
}

if (check) {
  const mismatched = Object.entries(files)
    .map(([path, { read }]) => [path, read(readFileSync(path, "utf8"))])
    .filter(([, found]) => found !== version);
  for (const [path, found] of mismatched) {
    console.error(`  ${path}: ${found}`);
  }
  if (mismatched.length > 0) {
    fail(`tag v${version} does not match the version in the files above`);
  }
  console.log(`All version files are at ${version}.`);
  process.exit(0);
}

if (!noGit) {
  if (git("status", "--porcelain")) {
    fail("working tree has uncommitted changes; commit or stash them first");
  }
  if (git("tag", "--list", `v${version}`)) {
    fail(`tag v${version} already exists`);
  }
}

for (const [path, { write }] of Object.entries(files)) {
  writeFileSync(path, write(readFileSync(path, "utf8"), version));
}
console.log(`Bumped version to ${version}.`);
// The workflow reads the resolved version from here when it was given patch/minor/major.
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`, {
    flag: "a",
  });
}

if (!noGit) {
  git("add", ...Object.keys(files));
  git("commit", "--message", `Release v${version}`);
  git("tag", "--annotate", `v${version}`, "--message", `Snipit v${version}`);
  console.log(
    `Committed and tagged v${version}. Push it to publish the release:\n\n  git push --follow-tags\n`,
  );
}
