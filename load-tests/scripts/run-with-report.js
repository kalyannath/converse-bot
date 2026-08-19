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
const yaml = require('js-yaml');

const [, , scriptPath, ...rawRest] = process.argv;

if (!scriptPath) {
  console.error('Usage: node scripts/run-with-report.js <test-file> [artillery run args...]');
  process.exit(1);
}

// --- Pre-run cost estimate -----------------------------------------------
// The report shows what a run DID cost, which is the wrong time to find out
// that a ramp was misconfigured. This works the same sum out from the config
// before anything is sent, so an accidental 200/sec ceiling run against the
// live model is visible while it can still be cancelled.
//
// Only applies to configs wired to the real-AI processor; the mock-mode
// tests (ceiling-with-ai-mock.yml, soak-trail.yml) never call the model.
const AVG_OUTPUT_TOKENS_EST = 90; // typical for the short voice-assistant replies this app produces
const SYSTEM_PROMPT_TOKENS_EST = 45;

function estimateRunCost(scriptFile) {
  if (!/\.ya?ml$/i.test(scriptFile) || !fs.existsSync(scriptFile)) return null;
  let doc;
  try {
    doc = yaml.safeLoad(fs.readFileSync(scriptFile, 'utf8'));
  } catch {
    return null;
  }
  const processor = doc?.config?.processor ?? '';
  if (!/realistic-processor/.test(processor)) return null;

  const phases = doc?.config?.phases;
  if (!Array.isArray(phases)) return null;

  const totalVus = phases.reduce((sum, p) => {
    if (p.pause !== undefined) return sum;
    const dur = Number(p.duration) || 0;
    const r0 = Number(p.arrivalRate ?? p.rampTo ?? 0);
    const r1 = Number(p.rampTo ?? p.arrivalRate ?? r0);
    return sum + ((r0 + r1) / 2) * dur;
  }, 0);
  if (!totalVus) return null;

  // Average the real prompt pool rather than guessing at it.
  let avgPromptTokens = 30;
  try {
    const { PROMPTS } = require('./realistic-processor.js');
    if (Array.isArray(PROMPTS) && PROMPTS.length) {
      avgPromptTokens = PROMPTS.reduce((s, p) => s + Math.ceil(p.text.length / 4), 0) / PROMPTS.length;
    }
  } catch {
    /* fall back to the default estimate */
  }

  const inputTokens = totalVus * (avgPromptTokens + SYSTEM_PROMPT_TOKENS_EST);
  const outputTokens = totalVus * AVG_OUTPUT_TOKENS_EST;
  const perMInput = Number(process.env.LOAD_TEST_COST_PER_1M_INPUT ?? 0.15);
  const perMOutput = Number(process.env.LOAD_TEST_COST_PER_1M_OUTPUT ?? 0.6);
  const usd = (inputTokens / 1e6) * perMInput + (outputTokens / 1e6) * perMOutput;
  return { totalVus, usd };
}

const estimate = estimateRunCost(scriptPath);
if (estimate) {
  const cap = Number(process.env.LOAD_TEST_COST_CAP_USD ?? 0);
  console.log(
    `\n[cost] ${Math.round(estimate.totalVus)} real model calls planned — estimated ~$${estimate.usd.toFixed(2)}` +
      ` (assumes ~${AVG_OUTPUT_TOKENS_EST} output tokens/reply; $0 if the server is in LOAD_TEST=true mock mode).` +
      (cap > 0
        ? `\n[cost] Hard cap active: $${cap.toFixed(2)} per worker (LOAD_TEST_COST_CAP_USD).`
        : '\n[cost] No hard cap set — export LOAD_TEST_COST_CAP_USD=<usd> to add one.') +
      '\n',
  );
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

const report = spawnSync('node', [path.join(__dirname, 'generate-report.js'), jsonPath, htmlPath, scriptPath], {
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
