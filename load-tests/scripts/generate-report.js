#!/usr/bin/env node
'use strict';

// `artillery report` (the CLI's own JSON -> HTML step) was deprecated in
// Artillery 2.x in favor of paid Artillery Cloud, so this replaces it: reads
// the JSON artillery run -o produces and renders a static, dependency-free
// HTML report — pass/fail status, latency timeline, per-metric percentiles,
// error breakdown — filed alongside the JSON so every run leaves a report
// the way a Playwright run leaves playwright-report/index.html.

const fs = require('node:fs');
const path = require('node:path');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(n, digits = 1) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function sumErrorCounters(counters) {
  return Object.entries(counters || {})
    .filter(([k]) => k.startsWith('errors.'))
    .reduce((acc, [, v]) => acc + v, 0);
}

function buildSparklinePath(values, width, height, padding = 4) {
  if (values.length === 0) return { path: '', points: [] };
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => ({
    x: padding + i * step,
    y: height - padding - ((v - min) / range) * (height - padding * 2),
    v,
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  return { path, points, max, min };
}

function generateHtml(result, meta) {
  const agg = result.aggregate || {};
  const counters = agg.counters || {};
  const summaries = agg.summaries || {};
  const intermediate = result.intermediate || [];

  const created = counters['vusers.created'] ?? 0;
  const completed = counters['vusers.completed'] ?? 0;
  const failed = counters['vusers.failed'] ?? 0;
  const failRate = created > 0 ? (failed / created) * 100 : 0;
  const passed = failed === 0 && created > 0;
  const durationMs = (agg.lastMetricAt || 0) - (agg.firstMetricAt || 0);
  const durationS = durationMs / 1000;

  const errorEntries = Object.entries(counters)
    .filter(([k]) => k.startsWith('errors.'))
    .sort((a, b) => b[1] - a[1]);

  const otherCounters = Object.entries(counters)
    .filter(([k]) => !k.startsWith('errors.') && !k.startsWith('vusers.'))
    .sort((a, b) => b[1] - a[1]);

  const summaryRows = Object.entries(summaries).sort((a, b) => b[1].count - a[1].count);

  // pick a headline latency metric for the timeline chart
  const headlineKey = Object.keys(summaries).find((k) => /response_time|duration|step\./.test(k))
    ?? Object.keys(summaries)[0];

  const firstPeriod = intermediate.length ? Number(intermediate[0].period) : 0;
  const timeline = intermediate.map((snap) => {
    const t = (Number(snap.period) - firstPeriod) / 1000;
    const s = (snap.summaries || {})[headlineKey];
    const errs = sumErrorCounters(snap.counters);
    const vc = snap.counters?.['vusers.created'] ?? 0;
    return { t, p95: s?.p95 ?? null, median: s?.median ?? null, errs, vc };
  });

  const chartW = 760;
  const chartH = 200;
  const p95Line = buildSparklinePath(timeline.map((p) => p.p95 ?? 0), chartW, chartH);
  const medianLine = buildSparklinePath(timeline.map((p) => p.median ?? 0), chartW, chartH);
  const maxErrBar = Math.max(...timeline.map((p) => p.errs), 1);
  const barW = timeline.length ? (chartW - 8) / timeline.length : 0;

  const p95Path = p95Line.path;
  const medianPath = medianLine.path;

  const errorBars = timeline.map((p, i) => {
    if (!p.errs) return '';
    const h = (p.errs / maxErrBar) * (chartH - 8);
    const x = 4 + i * barW;
    return `<rect class="err-bar" x="${x.toFixed(2)}" y="${(chartH - h).toFixed(2)}" width="${Math.max(barW - 1, 1).toFixed(2)}" height="${h.toFixed(2)}"><title>${fmt(p.t, 0)}s: ${p.errs} error(s)</title></rect>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.name)} — Load Test Report</title>
<style>
  :root {
    --bg: #f7f8fa;
    --surface: #ffffff;
    --border: #e2e5ea;
    --text: #1a1d23;
    --text-muted: #5b6270;
    --accent: #3457d5;
    --accent-soft: #e8ecfc;
    --good: #1a8a4a;
    --good-soft: #e5f6ec;
    --bad: #c22b3f;
    --bad-soft: #fbe8ea;
    --mono: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a;
      --surface: #1c1f26;
      --border: #2b2f38;
      --text: #e8eaee;
      --text-muted: #9aa1ad;
      --accent: #7f97ff;
      --accent-soft: #232a4a;
      --good: #4fce8b;
      --good-soft: #16302233;
      --bad: #f0798a;
      --bad-soft: #3a1c22;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 32px 24px 64px;
  }
  main { max-width: 920px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .meta { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 24px; }
  .status-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 12px; border-radius: 999px; font-weight: 600; font-size: 0.8rem;
    letter-spacing: 0.02em; text-transform: uppercase;
  }
  .status-badge.pass { background: var(--good-soft); color: var(--good); }
  .status-badge.fail { background: var(--bad-soft); color: var(--bad); }
  .cards {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px; margin: 20px 0 28px;
  }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 16px;
  }
  .card .label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
  .card .value { font-size: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .card .value.bad { color: var(--bad); }
  section { margin-bottom: 32px; }
  h2 { font-size: 1rem; margin: 0 0 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  th, td { text-align: right; padding: 8px 12px; font-variant-numeric: tabular-nums; font-size: 0.88rem; border-bottom: 1px solid var(--border); }
  th:first-child, td:first-child { text-align: left; font-variant-numeric: normal; }
  th { color: var(--text-muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.02em; }
  tr:last-child td { border-bottom: none; }
  .chart-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; overflow-x: auto; }
  .legend { display: flex; gap: 16px; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .err-bar { fill: var(--bad); opacity: 0.55; }
  .empty { color: var(--text-muted); font-size: 0.9rem; padding: 12px 0; }
  footer { color: var(--text-muted); font-size: 0.78rem; margin-top: 40px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(meta.name)}</h1>
  <div class="meta">
    ${escapeHtml(meta.timestamp)} · target <code>${escapeHtml(meta.target || 'n/a')}</code>
    &nbsp;·&nbsp;
    <span class="status-badge ${passed ? 'pass' : 'fail'}">${passed ? 'Passed' : 'Failed'}</span>
  </div>

  <div class="cards">
    <div class="card"><div class="label">VUsers created</div><div class="value">${fmt(created, 0)}</div></div>
    <div class="card"><div class="label">Completed</div><div class="value">${fmt(completed, 0)}</div></div>
    <div class="card"><div class="label">Failed</div><div class="value ${failed ? 'bad' : ''}">${fmt(failed, 0)}</div></div>
    <div class="card"><div class="label">Fail rate</div><div class="value ${failRate > 0 ? 'bad' : ''}">${fmt(failRate, 1)}%</div></div>
    <div class="card"><div class="label">Duration</div><div class="value">${fmt(durationS, 0)}s</div></div>
  </div>

  <section>
    <h2>Latency &amp; errors over time${headlineKey ? ` — ${escapeHtml(headlineKey)}` : ''}</h2>
    ${timeline.length ? `
    <div class="chart-wrap">
      <div class="legend">
        <span><span class="swatch" style="background:var(--accent)"></span>p95</span>
        <span><span class="swatch" style="background:var(--text-muted)"></span>median</span>
        <span><span class="swatch" style="background:var(--bad);opacity:.55"></span>errors / period</span>
      </div>
      <svg viewBox="0 0 ${chartW} ${chartH}" width="100%" height="${chartH}" preserveAspectRatio="none">
        ${errorBars}
        <path d="${medianPath}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" />
        <path d="${p95Path}" fill="none" stroke="var(--accent)" stroke-width="2" />
      </svg>
    </div>` : `<div class="empty">No time-series data was recorded for this run.</div>`}
  </section>

  <section>
    <h2>Response time / duration metrics</h2>
    ${summaryRows.length ? `
    <table>
      <thead><tr><th>Metric</th><th>Count</th><th>Min</th><th>Median</th><th>Mean</th><th>p95</th><th>p99</th><th>Max</th></tr></thead>
      <tbody>
        ${summaryRows.map(([k, s]) => `<tr>
          <td><code>${escapeHtml(k)}</code></td>
          <td>${fmt(s.count, 0)}</td>
          <td>${fmt(s.min)}</td>
          <td>${fmt(s.median)}</td>
          <td>${fmt(s.mean)}</td>
          <td>${fmt(s.p95)}</td>
          <td>${fmt(s.p99)}</td>
          <td>${fmt(s.max)}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : `<div class="empty">No latency metrics were recorded — every request may have failed before completing.</div>`}
  </section>

  <section>
    <h2>Errors</h2>
    ${errorEntries.length ? `
    <table>
      <thead><tr><th>Error</th><th>Count</th></tr></thead>
      <tbody>
        ${errorEntries.map(([k, v]) => `<tr><td>${escapeHtml(k.replace(/^errors\\./, ''))}</td><td>${fmt(v, 0)}</td></tr>`).join('')}
      </tbody>
    </table>` : `<div class="empty">No errors reported.</div>`}
  </section>

  <section>
    <h2>Other counters</h2>
    ${otherCounters.length ? `
    <table>
      <thead><tr><th>Counter</th><th>Value</th></tr></thead>
      <tbody>
        ${otherCounters.map(([k, v]) => `<tr><td><code>${escapeHtml(k)}</code></td><td>${fmt(v, 0)}</td></tr>`).join('')}
      </tbody>
    </table>` : `<div class="empty">—</div>`}
  </section>

  <footer>Generated by scripts/generate-report.js from ${escapeHtml(meta.jsonFile)}</footer>
</main>
</body>
</html>
`;
}

function main() {
  const [, , jsonPath, outPath] = process.argv;
  if (!jsonPath) {
    console.error('Usage: node scripts/generate-report.js <result.json> [output.html]');
    process.exit(1);
  }
  const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const html = generateHtml(result, {
    name: path.basename(path.dirname(path.dirname(jsonPath))) || 'Load Test',
    timestamp: new Date().toLocaleString(),
    target: undefined,
    jsonFile: path.basename(jsonPath),
  });
  const dest = outPath || jsonPath.replace(/\.json$/, '.html');
  fs.writeFileSync(dest, html);
  console.log(`Report written to ${dest}`);
}

if (require.main === module) {
  main();
}

module.exports = { generateHtml };
