// ---------------------------------------------------------------------------
// Standalone HTML dashboard.
//
// A non-technical user should not have to run a server: `resumerank dashboard`
// writes one self-contained .html file (styles and data inlined, no scripts, no
// network) that opens by double-click and can be emailed or printed. It mirrors
// the live UI's editorial theme: warm paper, ink, copper.
//
// Rendering is server-side and script-free on purpose — a static file that works
// from file://, in any browser, with nothing to load.
// ---------------------------------------------------------------------------

import { writeFile } from "node:fs/promises"
import type { DashCandidate, DashData, DashRanking } from "./terminal"

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function scoreTone(score: number): string {
  if (score >= 60) return "ok"
  if (score >= 40) return "warn"
  return "bad"
}

function bar(value: number, max: number): string {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100))
  return `<span class="bar"><i style="width:${pct}%"></i></span>`
}

function skillsList(skills: string[], limit = 8): string {
  if (skills.length === 0) return `<span class="muted">no skills read</span>`
  const shown = skills.slice(0, limit)
  const rest = skills.length - shown.length
  return (
    shown.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join("") +
    (rest > 0 ? `<span class="chip more">+${rest}</span>` : "")
  )
}

/**
 * A warning is only useful to a reader if it says what it is at a glance, so the
 * long engine strings are mapped to short labels and the full text stays in the
 * hover tooltip.
 */
export function shortWarning(warning: string): string {
  if (/duplicate of/i.test(warning)) return "duplicate file"
  if (/no dated roles|no dates/i.test(warning)) return "no dates in CV"
  if (/doubts the derived/i.test(warning)) return "check the years"
  if (/dated roles span/i.test(warning)) return "dates don't add up"
  if (/could not read|no readable text/i.test(warning)) return "could not read this PDF"
  const trimmed = warning.replace(/\s+/g, " ").trim()
  return trimmed.length > 28 ? `${trimmed.slice(0, 26)}…` : trimmed
}

function candidateRow(candidate: DashCandidate): string {
  const years = candidate.years === null ? "—" : `${candidate.years}`
  const warn =
    candidate.warnings.length > 0
      ? `<span class="tag warn" title="${escapeHtml(candidate.warnings.join("; "))}">${escapeHtml(shortWarning(candidate.warnings[0]))}</span>` +
        (candidate.warnings.length > 1 ? `<span class="tag muted" title="${escapeHtml(candidate.warnings.slice(1).join("; "))}">+${candidate.warnings.length - 1}</span>` : "")
      : ""
  const notes = candidate.notes > 0 ? `<span class="tag muted">${candidate.notes} note${candidate.notes > 1 ? "s" : ""}</span>` : ""
  return `<tr>
    <td class="name"><strong>${escapeHtml(candidate.name)}</strong><span class="file">${escapeHtml(candidate.filename)}</span></td>
    <td>${escapeHtml(candidate.role || "—")}${candidate.seniority ? `<span class="file">${escapeHtml(candidate.seniority)}</span>` : ""}</td>
    <td class="num">${years}</td>
    <td>${skillsList(candidate.skills)}</td>
    <td class="num">${candidate.confidence.toFixed(2)}</td>
    <td>${warn}${notes}</td>
  </tr>`
}

function rankingCard(ranking: DashRanking): string {
  const rows = ranking.top
    .map(
      (row, index) => `<tr>
      <td class="num rank">${index + 1}</td>
      <td class="name"><strong>${escapeHtml(row.filename)}</strong></td>
      <td class="num">${row.score.toFixed(1)}</td>
      <td class="num ${scoreTone(row.score)}">${row.matched}/${row.required}</td>
      <td>${row.flags ? `<span class="tag warn">${escapeHtml(row.flags)}</span>` : `<span class="tag muted">clear</span>`}</td>
    </tr>`,
    )
    .join("")
  return `<section class="card">
    <header class="card-head">
      <h3>${escapeHtml(ranking.jobTitle)}</h3>
      <span class="meta">${ranking.candidateCount} scored · ${escapeHtml(ranking.model)} · ${escapeHtml(ranking.createdAt.slice(0, 16).replace("T", " "))}</span>
    </header>
    ${
      ranking.top.length === 0
        ? `<p class="muted">No candidate cleared the gates for this job.</p>`
        : `<table class="table">
      <thead><tr><th class="num">#</th><th>candidate</th><th class="num">score</th><th class="num">required</th><th>flags</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    }
  </section>`
}

/** Build the whole document. Pure: same data in, same HTML out. */
export function renderDashboardHtml(data: DashData, options: { generatedAt?: Date } = {}): string {
  const generated = options.generatedAt ?? new Date()
  const pool = Math.max(1, data.store.resumes)
  const scoredFilenames = new Set<string>()
  for (const ranking of data.rankings) for (const row of ranking.top) scoredFilenames.add(row.filename)
  const warnings = data.candidates.filter((c) => c.warnings.length > 0).length

  const skillRows = data.skillTop
    .map(
      (skill) => `<li>
      <span class="skill-name">${escapeHtml(skill.name)}</span>
      ${bar(skill.count, pool)}
      <span class="num">${skill.count}/${data.store.resumes}</span>
    </li>`,
    )
    .join("")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>resumerank — candidate pool</title>
<style>
  :root {
    --paper:#f3f1ec; --surface:#fff; --surface-2:#faf8f5; --sunken:#eeece7;
    --line:#e3dfd6; --ink:#191819; --ink-2:#444249; --muted:#74716a;
    --accent:#b4541f; --accent-soft:rgba(180,84,31,.1); --teal:#0f6f68;
    --ok:#146c43; --ok-soft:rgba(20,108,67,.1); --warn:#8a5a09; --warn-soft:rgba(138,90,9,.12);
    --bad:#a32020; --bad-soft:rgba(163,32,32,.09);
    --radius:12px; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Ubuntu,sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper:#0f1114; --surface:#171a1f; --surface-2:#1c2026; --sunken:#12151a;
      --line:#272c34; --ink:#ebe8e2; --ink-2:#c3bfb8; --muted:#8d8a83;
      --accent:#d4794a; --accent-soft:rgba(212,121,74,.14); --teal:#4fb3a9;
      --ok:#63c08a; --ok-soft:rgba(99,192,138,.14); --warn:#d7a13f; --warn-soft:rgba(215,161,63,.14);
      --bad:#e07b7b; --bad-soft:rgba(224,123,123,.14);
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 24px 64px; background:var(--paper); color:var(--ink); font-family:var(--sans); font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1080px; margin:0 auto; }
  header.top { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding-bottom:20px; border-bottom:1px solid var(--line); }
  .brand { display:flex; align-items:center; gap:12px; }
  .mark { width:38px; height:38px; border-radius:11px; background:var(--ink); color:var(--paper); display:grid; place-items:center; font-weight:700; font-size:19px; }
  h1 { margin:0; font-size:20px; letter-spacing:-.01em; }
  .sub { color:var(--muted); font-size:13px; }
  .stamp { text-align:right; color:var(--muted); font-size:12.5px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:24px 0 8px; }
  .kpi { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px; }
  .kpi b { display:block; font-size:24px; letter-spacing:-.02em; }
  .kpi span { color:var(--muted); font-size:12.5px; }
  section.card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:18px 20px; margin-top:20px; }
  .card-head { display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin-bottom:12px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0; }
  h3 { margin:0; font-size:16px; }
  .meta { color:var(--muted); font-size:12.5px; font-family:var(--mono); }
  ul.skills { list-style:none; margin:0; padding:0; }
  ul.skills li { display:flex; align-items:center; gap:10px; padding:5px 0; font-size:14px; }
  .skill-name { width:190px; flex:none; }
  .bar { display:inline-block; flex:1; height:8px; border-radius:99px; background:var(--sunken); overflow:hidden; }
  .bar i { display:block; height:100%; background:var(--accent); border-radius:99px; }
  .num { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  table.table { width:100%; border-collapse:collapse; }
  table.table th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; padding:6px 8px; border-bottom:1px solid var(--line); }
  table.table td { padding:9px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  table.table tr:last-child td { border-bottom:0; }
  th.num, td.num { text-align:right; }
  td.name strong { display:block; }
  .file { display:block; color:var(--muted); font-size:12px; font-family:var(--mono); }
  .chip { display:inline-block; padding:2px 8px; margin:1px 3px 1px 0; border:1px solid var(--line); border-radius:99px; font-size:12px; color:var(--ink-2); background:var(--surface-2); }
  .chip.more { color:var(--muted); }
  .tag { display:inline-block; padding:1px 7px; border-radius:99px; font-size:11.5px; border:1px solid var(--line); }
  .tag.ok { color:var(--ok); background:var(--ok-soft); border-color:transparent; }
  .tag.warn { color:var(--warn); background:var(--warn-soft); border-color:transparent; }
  .tag.muted { color:var(--muted); }
  .rank { color:var(--accent); font-weight:600; }
  td.ok { color:var(--ok); } td.warn { color:var(--warn); } td.bad { color:var(--bad); }
  .muted { color:var(--muted); }
  .legend { margin:0 0 12px; color:var(--muted); font-size:12.5px; }
  .legend b { color:var(--ink-2); font-weight:600; }
  footer { margin-top:32px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:12.5px; }
  @media print { body { background:#fff; padding:0; } section.card, .kpi { break-inside:avoid; } }
  @media (max-width:720px) { .skill-name { width:120px; } td:nth-child(4) { display:none; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <div class="mark">r</div>
      <div>
        <h1>resumerank</h1>
        <div class="sub">Candidate pool · ${data.store.resumes} resumes · ${data.jev.enabled ? "AI-assisted verification on" : "offline — nothing left this machine"}</div>
      </div>
    </div>
    <div class="stamp">generated ${escapeHtml(generated.toISOString().slice(0, 16).replace("T", " "))}<br>stored on this machine only</div>
  </header>

  <div class="kpis">
    <div class="kpi"><b>${data.store.resumes}</b><span>candidates</span></div>
    <div class="kpi"><b>${data.store.skills}</b><span>distinct skills</span></div>
    <div class="kpi"><b>${data.rankings.length}</b><span>saved rankings</span></div>
    <div class="kpi"><b>${scoredFilenames.size || 0}</b><span>candidates ever ranked</span></div>
    <div class="kpi"><b>${warnings}</b><span>CVs that need a quick look</span></div>
  </div>

  <section class="card">
    <div class="card-head"><h2>Skills across the pool</h2><span class="meta">how many candidates have each skill</span></div>
    ${skillRows ? `<ul class="skills">${skillRows}</ul>` : `<p class="muted">No resumes yet.</p>`}
  </section>

  <section class="card">
    <div class="card-head"><h2>Candidates</h2><span class="meta">${data.candidates.length} in the pool, newest first</span></div>
    <p class="legend"><b>years</b> = experience read from the CV &nbsp;·&nbsp; <b>read</b> = how well the CV could be read, 1.00 meaning every field was found &nbsp;·&nbsp; <b>status</b> = anything to know before shortlisting, e.g. a CV with no dates, dates that do not add up, or the same file added twice</p>
    ${
      data.candidates.length === 0
        ? `<p class="muted">No candidates yet.</p>`
        : `<table class="table">
      <thead><tr><th>candidate</th><th>role</th><th class="num">years</th><th>skills</th><th class="num">read</th><th>status</th></tr></thead>
      <tbody>${data.candidates.map(candidateRow).join("")}</tbody>
    </table>`
    }
  </section>

  ${data.rankings.map(rankingCard).join("\n")}

  <footer>
    <strong>Adding resumes or running a new ranking needs the app:</strong> run
    <code>resumerank ui</code> (it opens in your browser) or <code>resumerank dash</code>
    for the terminal. This page is a snapshot — regenerate it any time with
    <code>resumerank dashboard</code>. Every credited skill carries its provenance and
    nothing leaves this machine.
  </footer>
</div>
</body>
</html>
`
}

/** Write the dashboard to disk and return the path. */
export async function writeDashboardHtml(file: string, data: DashData): Promise<string> {
  await writeFile(file, renderDashboardHtml(data), "utf8")
  return file
}
