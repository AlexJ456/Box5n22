import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sw = readFileSync(join(root, 'service-worker.js'), 'utf8');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test('every module under src/ is in the service worker precache list', () => {
  const shell = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
  const modules = walk(join(root, 'src')).map((f) => relative(root, f));
  for (const file of modules) assert.ok(shell.includes(file), `${file} missing from SHELL`);
  for (const file of ['index.html', 'styles.css', 'manifest.json']) assert.ok(shell.includes(file));
});

test('the service worker carries a semantic version', () => {
  assert.match(sw, /const VERSION = 'v\d+\.\d+\.\d+';/);
});
