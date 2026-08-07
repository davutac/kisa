#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const APP_PACKAGE_PATH = path.join(
  import.meta.dirname,
  "..",
  "apps",
  "desktop",
  "package.json"
);
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const USAGE =
  "Usage: pnpm release [major|minor|patch|x.y.z] [--dry-run] [--no-push] [--skip-check]";

const writeLine = (message = "") => {
  process.stdout.write(`${message}\n`);
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const run = (command, args, options = {}) => {
  if (options.dryRun === true) {
    writeLine(`$ ${[command, ...args].join(" ")}`);
    return "";
  }

  return execFileSync(command, args, {
    encoding: "utf-8",
    stdio: options.inherit === true ? "inherit" : "pipe",
  });
};

const readAppPackage = () =>
  JSON.parse(readFileSync(APP_PACKAGE_PATH, "utf-8"));

const parseVersion = (version) => {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    fail(`Expected a semantic version like 1.2.3, got "${version}".`);
  }

  return version.split(".").map((part) => Math.trunc(Number(part)));
};

const compareVersions = (left, right) => {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (const [index, leftPart] of leftParts.entries()) {
    const difference = leftPart - rightParts[index];

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};

const bumpVersion = (currentVersion, bump) => {
  if (VERSION_PATTERN.test(bump)) {
    if (compareVersions(bump, currentVersion) <= 0) {
      fail(`Release version ${bump} must be greater than ${currentVersion}.`);
    }

    return bump;
  }

  if (!BUMP_TYPES.has(bump)) {
    fail(USAGE);
  }

  const [major, minor, patch] = parseVersion(currentVersion);

  if (bump === "major") {
    return `${major + 1}.0.0`;
  }

  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
};

const assertCleanWorkingTree = () => {
  const status = run("git", ["status", "--porcelain"]);

  if (status.trim() !== "") {
    fail("Working tree must be clean before creating a release.");
  }
};

const assertTagAvailable = (tagName) => {
  try {
    run("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tagName}`]);
    fail(`Tag ${tagName} already exists locally.`);
  } catch (error) {
    if (error.status !== 1) {
      throw error;
    }
  }

  try {
    run("git", [
      "ls-remote",
      "--exit-code",
      "--tags",
      "origin",
      `refs/tags/${tagName}`,
    ]);
    fail(`Tag ${tagName} already exists on origin.`);
  } catch (error) {
    if (error.status !== 2) {
      throw error;
    }
  }
};

const writeAppPackageVersion = (nextVersion) => {
  const appPackage = readAppPackage();
  appPackage.version = nextVersion;
  writeFileSync(APP_PACKAGE_PATH, `${JSON.stringify(appPackage, null, 2)}\n`);
};

const promptForRelease = async () => {
  if (input.isTTY !== true) {
    fail(USAGE);
  }

  const readline = createInterface({ input, output });

  try {
    const answer = await readline.question(
      "New version or bump (major/minor/patch): "
    );
    return answer.trim();
  } finally {
    readline.close();
  }
};

const args = process.argv.slice(2);
const bump = args.find((arg) => !arg.startsWith("--"));
const isDryRun = args.includes("--dry-run");
const shouldPush = !args.includes("--no-push");
const shouldCheck = !args.includes("--skip-check");

const currentVersion = readAppPackage().version;
writeLine(`Current version: ${currentVersion}`);

const release = bump ?? (await promptForRelease());

if (release === "") {
  fail(USAGE);
}

if (!isDryRun) {
  assertCleanWorkingTree();
}

const nextVersion = bumpVersion(currentVersion, release);
const tagName = `v${nextVersion}`;

assertTagAvailable(tagName);

writeLine(`Releasing ${tagName}`);

if (isDryRun) {
  writeLine(
    `Would update ${APP_PACKAGE_PATH} from ${currentVersion} to ${nextVersion}.`
  );
} else {
  writeAppPackageVersion(nextVersion);
}

if (shouldCheck) {
  run("pnpm", ["run", "check"], { dryRun: isDryRun, inherit: true });
}

run("git", ["add", APP_PACKAGE_PATH], { dryRun: isDryRun });
run("git", ["commit", "-m", `Release ${tagName}`], {
  dryRun: isDryRun,
  inherit: true,
});
run("git", ["tag", tagName], { dryRun: isDryRun });

if (shouldPush) {
  run("git", ["push"], { dryRun: isDryRun, inherit: true });
  run("git", ["push", "origin", tagName], { dryRun: isDryRun, inherit: true });
}

writeLine(`${tagName} is ready.`);
