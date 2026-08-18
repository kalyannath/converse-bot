#!/usr/bin/env node
'use strict';

// Wraps `artillery run` so every invocation produces a self-contained HTML
// report, filed under reports/<test-name>/<timestamp>/, the way Playwright
// writes a fresh report per run instead of only printing to the terminal.
// Artillery 2.x's own `artillery report` (JSON -> HTML) command is
// deprecated in favor of paid Artillery Cloud, so generate-report.js (in
// this folder) renders the HTML from the `-o` JSON output instead.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const [, , scriptPath, ...rawRest] = process.argv;

if (!scriptPath) {
  console.error('Usage: node scripts/run-with-report.js <test-file> [artillery run args...]');
  process.exit(1);
}

const noOpen = rawRest.includes('--no-open');
const rest = rawRest.filter((arg) => arg !== '--no-open');

const name = path.basename(scriptPath).replace(/\.(ya?ml|ts|js)$/i, '');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(__dirname, '..', 'reports', name, timestamp);
fs.mkdirSync(runDir, { recursive: true });

const jsonPath = path.join(runDir, 'result.json');
const htmlPath = path.join(runDir, 'report.html');

const run = spawnSync('npx', ['artillery', 'run', '--output', jsonPath, scriptPath, ...rest], {
  stdio: 'inherit',
  shell: true,
});

if (!fs.existsSync(jsonPath)) {
  console.error('\nArtillery did not produce a JSON report (test likely failed to start) — skipping HTML report.');
  process.exit(run.status ?? 1);
}

const report = spawnSync('node', [path.join(__dirname, 'generate-report.js'), jsonPath, htmlPath], {
  stdio: 'inherit',
  shell: true,
});

const latestPath = path.join(__dirname, '..', 'reports', name, 'latest.html');
fs.copyFileSync(htmlPath, latestPath);

console.log(`\nReport:  ${htmlPath}`);
console.log(`Latest:  ${latestPath}`);

if (!process.env.CI && !noOpen) {
  const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawnSync(opener, [htmlPath], { shell: true, stdio: 'ignore' });
}

process.exit(run.status ?? report.status ?? 0);
