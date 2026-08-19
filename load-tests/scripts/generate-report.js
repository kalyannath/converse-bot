#!/usr/bin/env node
'use strict';

// `artillery report` (the CLI's own JSON -> HTML step) was deprecated in
// Artillery 2.x in favor of paid Artillery Cloud, so this replaces it: reads
// the JSON artillery run -o produces and renders a static, dependency-free
// HTML report — pass/fail status, latency timeline, per-metric percentiles,
// error breakdown — filed alongside the JSON so every run leaves a report
// the way a Playwright run leaves playwright-report/index.html.
//
// The report has two tabs: "Overview" (plain language, for whoever's
// reading the headline numbers — a lead, a PM) and "Engineering details"
// (the full percentile tables, error breakdown, and raw counters). Both are
// derived from the same result.json — there's no separate audience-specific
// data source, just a different lens on it.

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

function friendlyDuration(ms) {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return 'n/a';
  if (ms < 1000) return `${fmt(ms, 0)} ms`;
  return `${fmt(ms / 1000, 1)}s`;
}

function sumErrorCounters(counters) {
  return Object.entries(counters || {})
    .filter(([k]) => k.startsWith('errors.'))
    .reduce((acc, [, v]) => acc + v, 0);
}

// Rounds up to a "nice" axis ceiling (1/2/5 x a power of ten) so gridline
// labels read as 40/80/120 rather than 37/74/111.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  const norm = v / magnitude;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * magnitude;
}

// Renders one or more time-series lines (all sharing a left y-axis scaled to
// their combined max) plus an optional error bar layer (scaled to ITS OWN
// max instead — error counts/rates and e.g. latency live on completely
// different scales, so sharing one axis would flatten one of them to
// nothing). x-axis ticks use each point's own `t` (seconds into the run).
function renderTimeSeriesChart({ width = 760, height = 200, points, lines, bars, yFormat = (v) => fmt(v, 0) }) {
  const marginLeft = 44;
  const marginRight = 8;
  const marginTop = 10;
  const marginBottom = 22;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const n = points.length;
  if (n === 0) return '';

  const xStep = n > 1 ? plotW / (n - 1) : 0;
  const xAt = (i) => marginLeft + i * xStep;

  const yMax = niceMax(Math.max(...lines.flatMap((l) => l.values), 0));
  const yAt = (v) => marginTop + plotH - (v / yMax) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const val = f * yMax;
    const y = yAt(val);
    return `<line x1="${marginLeft}" y1="${y.toFixed(2)}" x2="${(width - marginRight).toFixed(2)}" y2="${y.toFixed(2)}" stroke="var(--border)" stroke-width="1" />`
      + `<text x="${(marginLeft - 6).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end" font-size="9" fill="var(--text-muted)">${escapeHtml(yFormat(val))}</text>`;
  }).join('');

  const tickCount = Math.min(n, 6);
  const tickIndices = [...new Set(Array.from({ length: tickCount }, (_, k) =>
    Math.round((k * (n - 1)) / Math.max(tickCount - 1, 1))))];
  const xLabels = tickIndices.map((i) =>
    `<text x="${xAt(i).toFixed(2)}" y="${(height - 4).toFixed(2)}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${escapeHtml(fmt(points[i].t, 0))}s</text>`
  ).join('');

  let barsMarkup = '';
  if (bars) {
    const barMax = Math.max(...bars.values, 1);
    const barW = plotW / n;
    barsMarkup = bars.values.map((v, i) => {
      if (!v) return '';
      const h = (v / barMax) * plotH;
      const x = marginLeft + i * barW;
      const y = marginTop + plotH - h;
      const title = bars.title ? `<title>${escapeHtml(bars.title(i))}</title>` : '';
      return `<rect class="err-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barW - 1, 1).toFixed(2)}" height="${h.toFixed(2)}">${title}</rect>`;
    }).join('');
  }

  const linesMarkup = lines.map((l) => {
    const path = l.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`).join(' ');
    return `<path d="${path}" fill="none" stroke="${l.color}" stroke-width="${l.widthPx ?? 2}" />`;
  }).join('');

  const axisLine = `<line x1="${marginLeft}" y1="${(marginTop + plotH).toFixed(2)}" x2="${(width - marginRight).toFixed(2)}" y2="${(marginTop + plotH).toFixed(2)}" stroke="var(--border)" stroke-width="1" />`;

  return `${gridLines}${axisLine}${barsMarkup}${linesMarkup}${xLabels}`;
}

// Artillery's per-window `intermediate` snapshots report connections/sec
// (arrival rate), not concurrent users directly. This converts one to the
// other with Little's Law (L = λW): concurrent users in flight ≈ arrival
// rate × average time each one spends in the system, using THAT WINDOW's
// own session-length mean (not the global aggregate, which gets dragged up
// by any later slow/broken windows and would overstate concurrency
// everywhere else).
function computeWindows(result) {
  const intermediate = result.intermediate || [];
  const globalSessionMeanMs = (result.aggregate?.summaries || {})['vusers.session_length']?.mean;
  const firstPeriod = intermediate.length ? Number(intermediate[0].period) : 0;

  return intermediate.map((snap, i) => {
    const period = Number(snap.period);
    const prevPeriod = i > 0 ? Number(intermediate[i - 1].period) : null;
    const durationSec = prevPeriod !== null ? (period - prevPeriod) / 1000 : 10;
    const created = snap.counters?.['vusers.created'] ?? 0;
    const completed = snap.counters?.['vusers.completed'] ?? 0;
    const failed = snap.counters?.['vusers.failed'] ?? 0;
    const sessionMeanMs = snap.summaries?.['vusers.session_length']?.mean ?? globalSessionMeanMs ?? null;
    const arrivalRate = durationSec > 0 ? created / durationSec : 0;
    const concurrency = sessionMeanMs != null ? arrivalRate * (sessionMeanMs / 1000) : null;
    // `created` counts arrivals to THIS window; `completed`/`failed` count
    // resolutions that landed in THIS window, which can easily be a
    // different set of VUs once sessions start taking longer than one
    // window to finish (a VU that arrived 3 windows ago can time out now).
    // failed/created then stops meaning anything once that happens (it can
    // exceed 100%). failed/(completed+failed) stays a real 0-100% because
    // both sides are counted on the same clock: "of the VUs that finished
    // in this window, what fraction of them failed".
    const resolved = completed + failed;
    const errorRatePct = resolved > 0 ? (failed / resolved) * 100 : 0;
    return {
      t: (period - firstPeriod) / 1000,
      created,
      completed,
      failed,
      resolved,
      arrivalRate,
      sessionMeanMs,
      concurrency,
      errorRatePct,
    };
  });
}

// Walks the windows in chronological (= load-ascending, for a ramp test)
// order and picks: the highest-load window that was still essentially
// clean (<=1% errors), and the first window where things clearly broke
// (>5% errors). Windows with too few samples are ignored so a single
// dropped connection early on doesn't get read as "5% error rate".
function computeFindings(result) {
  const COMFORTABLE_MAX_ERR_PCT = 1;
  const BREAKING_MIN_ERR_PCT = 5;
  const MIN_SAMPLE = 5;

  const allWindows = computeWindows(result);
  const usable = allWindows.filter((w) => w.resolved >= MIN_SAMPLE && w.concurrency != null);

  let comfortable = null;
  let breaking = null;
  for (const w of usable) {
    if (w.errorRatePct > BREAKING_MIN_ERR_PCT) {
      breaking = w;
      break;
    }
    if (w.errorRatePct <= COMFORTABLE_MAX_ERR_PCT) {
      if (comfortable === null || w.concurrency > comfortable.concurrency) {
        comfortable = w;
      }
    }
  }
  // Once things start breaking, queued/backlogged requests finish (or
  // time out) in later windows and inflate that window's own session-length
  // mean — which would make "peak" pick a post-breakdown window and report
  // it as if it were healthy. Restrict peak-finding to windows before the
  // break, so it stays a meaningful fallback for the "comfortable capacity"
  // card on runs that never produced a clean low-error window.
  const preBreakWindows = breaking ? usable.filter((w) => w.t < breaking.t) : usable;
  const peak = preBreakWindows.reduce((max, w) => (max === null || w.concurrency > max.concurrency ? w : max), null);

  return { allWindows, usable, comfortable, breaking, peak, neverBroke: !breaking };
}

function buildNarrative(findings, overall) {
  const parts = [];
  if (findings.comfortable) {
    parts.push(
      `Up to roughly ${fmt(findings.comfortable.concurrency, 0)} people using the app at the same time, everything worked normally with essentially no errors.`,
    );
  } else if (findings.peak) {
    parts.push(
      `Even at the highest load reached in this test (roughly ${fmt(findings.peak.concurrency, 0)} concurrent users), the app kept working with no significant errors.`,
    );
  } else {
    parts.push('This run didn’t generate enough traffic in any single window to estimate concurrent users reliably.');
  }

  if (findings.breaking) {
    parts.push(
      `Past roughly ${fmt(findings.breaking.concurrency, 0)} concurrent users, requests started failing — about ${fmt(findings.breaking.errorRatePct, 0)}% of them in that window — which is the breaking point this test found.`,
    );
  } else if (overall.created > 0) {
    parts.push(
      `This test never pushed the app past its limit — the overall failure rate stayed at ${fmt(overall.failRate, 1)}% across the whole run, so the real breaking point is higher than what was tested here.`,
    );
  }
  return parts.join(' ');
}

function extractTarget(scriptPath) {
  if (process.env.LOAD_TEST_TARGET) return process.env.LOAD_TEST_TARGET;
  if (!scriptPath || !fs.existsSync(scriptPath)) return undefined;
  const text = fs.readFileSync(scriptPath, 'utf8');
  const match = text.match(/target[:=]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : undefined;
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
  const latencyChart = timeline.length ? renderTimeSeriesChart({
    width: chartW,
    height: chartH,
    points: timeline,
    lines: [
      { values: timeline.map((p) => p.median ?? 0), color: 'var(--text-muted)', widthPx: 1.5 },
      { values: timeline.map((p) => p.p95 ?? 0), color: 'var(--accent)', widthPx: 2 },
    ],
    bars: { values: timeline.map((p) => p.errs), title: (i) => `${fmt(timeline[i].t, 0)}s: ${timeline[i].errs} error(s)` },
    yFormat: (v) => friendlyDuration(v),
  }) : '';

  // --- Overview tab data ---
  const findings = computeFindings(result);
  const narrative = buildNarrative(findings, { created, failRate });
  const concurrencyChart = findings.allWindows.length ? renderTimeSeriesChart({
    width: chartW,
    height: chartH,
    points: findings.allWindows,
    lines: [{ values: findings.allWindows.map((w) => w.concurrency ?? 0), color: 'var(--accent)', widthPx: 2 }],
    bars: { values: findings.allWindows.map((w) => w.errorRatePct), title: (i) => `${fmt(findings.allWindows[i].t, 0)}s: ${fmt(findings.allWindows[i].errorRatePct, 0)}% errors` },
    yFormat: (v) => fmt(v, 0),
  }) : '';

  const typicalReplyMs = summaries[headlineKey]?.median;

  const comfortableCard = findings.comfortable
    ? `~${fmt(findings.comfortable.concurrency, 0)} users`
    : (findings.peak ? `~${fmt(findings.peak.concurrency, 0)} users (untested further)` : '—');
  const breakingCard = findings.breaking
    ? `~${fmt(findings.breaking.concurrency, 0)} users`
    : 'Not reached in this test';

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
    :root:not([data-theme="light"]) {
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
  :root[data-theme="dark"] {
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
  .meta { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 20px; }
  .status-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 12px; border-radius: 999px; font-weight: 600; font-size: 0.8rem;
    letter-spacing: 0.02em; text-transform: uppercase;
  }
  .status-badge.pass { background: var(--good-soft); color: var(--good); }
  .status-badge.fail { background: var(--bad-soft); color: var(--bad); }

  .tabbar { display: flex; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 4px; margin-bottom: 24px; width: fit-content; }
  .tab-btn {
    appearance: none; border: none; background: transparent; color: var(--text-muted);
    font: inherit; font-weight: 600; font-size: 0.85rem; padding: 8px 18px; border-radius: 7px; cursor: pointer;
  }
  .tab-btn.active { background: var(--accent); color: #fff; }
  .tab-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tab-panel[hidden] { display: none; }

  .verdict { background: var(--accent-soft); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; margin-bottom: 24px; font-size: 0.98rem; }

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
  .card .value.small { font-size: 1.15rem; }
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
  ul.plain { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 16px 16px 34px; margin: 0; }
  ul.plain li { margin-bottom: 10px; }
  ul.plain li:last-child { margin-bottom: 0; }
  ul.plain b { color: var(--text); }
  details.methodology { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; font-size: 0.85rem; color: var(--text-muted); }
  details.methodology summary { cursor: pointer; color: var(--text); font-weight: 600; }
  details.methodology p { margin: 10px 0 0; }
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

  <div class="tabbar" role="tablist">
    <button class="tab-btn active" data-tab="overview" role="tab" aria-selected="true">Overview</button>
    <button class="tab-btn" data-tab="engineering" role="tab" aria-selected="false">Engineering details</button>
  </div>

  <section class="tab-panel" data-tab-panel="overview">
    <div class="verdict">${narrative}</div>

    <div class="cards">
      <div class="card"><div class="label">Comfortable capacity</div><div class="value small">${comfortableCard}</div></div>
      <div class="card"><div class="label">Breaking point</div><div class="value small">${breakingCard}</div></div>
      <div class="card"><div class="label">Errors overall</div><div class="value ${failRate > 0 ? 'bad' : ''}">${fmt(failRate, 1)}%</div></div>
      <div class="card"><div class="label">Typical reply time</div><div class="value small">${friendlyDuration(typicalReplyMs)}</div></div>
    </div>

    <section>
      <h2>Load vs. errors over the test</h2>
      ${findings.allWindows.length ? `
      <div class="chart-wrap">
        <div class="legend">
          <span><span class="swatch" style="background:var(--accent)"></span>estimated concurrent users (left axis)</span>
          <span><span class="swatch" style="background:var(--bad);opacity:.55"></span>error rate in that moment (own scale, hover for %)</span>
        </div>
        <svg viewBox="0 0 ${chartW} ${chartH}" width="100%" height="${chartH}" preserveAspectRatio="none">
          ${concurrencyChart}
        </svg>
      </div>` : `<div class="empty">No time-series data was recorded for this run.</div>`}
    </section>

    <section>
      <h2>What this covered, and what else is worth testing</h2>
      <ul class="plain">
        <li><b>This test:</b> how many people can use the chat at the same time before responses slow down or fail, and roughly where that limit sits today.</li>
        <li><b>Sustained load (soak):</b> running a steady, moderate load for several minutes instead of a short spike — catches slow leaks or gradual slowdowns a quick test misses.</li>
        <li><b>Recovery:</b> after pushing past the breaking point, does the app recover on its own once load drops back down, or does it stay stuck/erroring?</li>
        <li><b>Cold starts:</b> the free hosting tier used here spins the server down after ~15 minutes idle; the first user after that idle period waits 30-60s. Worth deciding if that's acceptable.</li>
        <li><b>Real-AI cost &amp; latency:</b> a smaller test using real OpenAI replies (not the fast mocked ones used to find the ceiling above) to see true response times and per-conversation cost users will actually experience.</li>
        <li><b>Frontend performance:</b> this test talks to the server directly; it doesn't measure how the web page itself performs on a slow device or connection.</li>
      </ul>
    </section>
  </section>

  <section class="tab-panel" data-tab-panel="engineering" hidden>
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
          <span><span class="swatch" style="background:var(--accent)"></span>p95 (left axis)</span>
          <span><span class="swatch" style="background:var(--text-muted)"></span>median (left axis)</span>
          <span><span class="swatch" style="background:var(--bad);opacity:.55"></span>errors / period (own scale, hover for count)</span>
        </div>
        <svg viewBox="0 0 ${chartW} ${chartH}" width="100%" height="${chartH}" preserveAspectRatio="none">
          ${latencyChart}
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

    <section>
      <h2>Concurrent-user estimate, by window</h2>
      <details class="methodology">
        <summary>Methodology</summary>
        <p>Artillery reports connections/sec per 10s window, not concurrent users. This estimates concurrency with Little's Law
        (L = &lambda;W): that window's arrival rate &times; that window's own mean session length (the "Avg. session length"
        column below — multiply it by "Arrival rate /s" yourself to check "Est. concurrency"). Windows use their own local
        session-length mean rather than the run's global mean, since a global mean gets dragged up by any later slow/broken
        windows and would overstate concurrency in the healthy windows. Windows with fewer than 5 resolved (Completed +
        Failed) VUs are excluded from the comfortable/breaking-point analysis (too few samples to trust an error rate
        from), but are still listed below.
        "Error rate" is "Failed" &divide; ("Completed" + "Failed") &mdash; both counted at the moment a VU finishes,
        landing in whichever window that happens to fall in. It's deliberately NOT Failed &divide; Created: once sessions
        start taking longer than one window to resolve, a VU can be created in one window and time out several windows
        later, so comparing that window's failures against its own arrivals stops meaning anything (and can exceed 100%).</p>
      </details>
      ${findings.allWindows.length ? `
      <table style="margin-top:12px;">
        <thead><tr><th>t (s)</th><th>Created</th><th>Completed</th><th>Failed</th><th>Arrival rate /s</th><th>Avg. session length</th><th>Est. concurrency</th><th>Error rate</th></tr></thead>
        <tbody>
          ${findings.allWindows.map((w) => `<tr>
            <td>${fmt(w.t, 0)}</td>
            <td>${fmt(w.created, 0)}</td>
            <td>${fmt(w.completed, 0)}</td>
            <td>${fmt(w.failed, 0)}</td>
            <td>${fmt(w.arrivalRate, 1)}</td>
            <td>${friendlyDuration(w.sessionMeanMs)}</td>
            <td>${w.concurrency != null ? fmt(w.concurrency, 0) : '—'}</td>
            <td class="${w.errorRatePct > 5 ? 'bad' : ''}">${fmt(w.errorRatePct, 1)}%</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<div class="empty">No time-series data was recorded for this run.</div>`}
    </section>
  </section>

  <footer>Generated by scripts/generate-report.js from ${escapeHtml(meta.jsonFile)}</footer>
</main>
<script>
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(function (p) {
        p.hidden = true;
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.querySelector('[data-tab-panel="' + btn.dataset.tab + '"]').hidden = false;
    });
  });
</script>
</body>
</html>
`;
}

function main() {
  const [, , jsonPath, outPath, scriptPath] = process.argv;
  if (!jsonPath) {
    console.error('Usage: node scripts/generate-report.js <result.json> [output.html] [source-script]');
    process.exit(1);
  }
  const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const html = generateHtml(result, {
    name: path.basename(path.dirname(path.dirname(jsonPath))) || 'Load Test',
    timestamp: new Date().toLocaleString(),
    target: extractTarget(scriptPath),
    jsonFile: path.basename(jsonPath),
  });
  const dest = outPath || jsonPath.replace(/\.json$/, '.html');
  fs.writeFileSync(dest, html);
  console.log(`Report written to ${dest}`);
}

if (require.main === module) {
  main();
}

module.exports = { generateHtml, computeFindings, computeWindows };
