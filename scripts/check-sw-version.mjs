#!/usr/bin/env node
/**
 * Fails when app files changed against a base ref but the service worker's
 * VERSION did not. Assets are cache-first; only a new worker drops the old
 * cache, so a release without a bump leaves installed copies on the old build.
 *
 *   node scripts/check-sw-version.mjs [base-ref]     default: origin/main
 */
import { execSync } from 'node:child_process';

const base = process.argv[2] || 'origin/main';
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const changed = sh(`git diff --name-only ${base}...HEAD`).split('\n').filter(Boolean);
const app = changed.filter((f) =>
  f === 'index.html' || f === 'styles.css' || f === 'manifest.json' || f.startsWith('src/') || f.startsWith('icons/')
);

if (app.length === 0) {
  console.log('No app files changed; no version bump needed.');
  process.exit(0);
}

const versionOf = (text) => (text.match(/const VERSION = '([^']+)'/) || [])[1];
const before = versionOf(sh(`git show ${base}:service-worker.js`));
const after = versionOf(sh('git show HEAD:service-worker.js'));

if (!after) {
  console.error('service-worker.js has no VERSION constant.');
  process.exit(1);
}
if (before === after) {
  console.error(`App files changed (${app.length}) but service-worker.js VERSION is still ${after}. Bump it.`);
  process.exit(1);
}
console.log(`VERSION ${before} -> ${after} with ${app.length} app file(s) changed.`);
