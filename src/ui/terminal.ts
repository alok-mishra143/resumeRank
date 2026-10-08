// ---------------------------------------------------------------------------
// Terminal dashboard: the whole app without a browser.
//
//   resumerank dash                     interactive (alt screen, vim keys)
//   resumerank dash --snapshot [--view candidates]
//
// No dependencies: raw-mode stdin, ANSI escapes, box drawing. renderFrame is
// pure, so `--snapshot` and the tests can assert a frame without a TTY, and when
// stdin is not a terminal the dashboard just prints one frame and exits.
// ---------------------------------------------------------------------------

import { config, dataHome, isOffline } from "../config"
import { bold as boldInk, dim as dimInk, green as greenInk, red as redInk, truncate, yellow as yellowInk } from "../cli/format"

export type DashView = "overview" | "candidates" | "rankings" | "help"

export interface DashCandidate {
  id: string
  name: string
  filename: string
  role: string
  seniority: string
  years: number | null
  skills: string[]
  confidence: number
  notes: number
  warnings: string[]
}

export interface DashRankRow {
  filename: string
  score: number
  matched: number
  required: number
  flags: string
}

export interface DashRanking {
  id: string
  jobTitle: string
  candidateCount: number
  model: string
  createdAt: string
  top: DashRankRow[]
}

export interface DashData {
  store: { resumes: number; skills: number; rankings: number; notes: number; bytes: number; home: string }
  jev: { status: string; cachedAnswers: number; enabled: boolean }
  candidates: DashCandidate[]
  rankings: DashRanking[]
  skillTop: Array<{ name: string; count: number }>
  version: string
}

export interface DashState {
  view: DashView
  cursor: number
  scroll: number
  filter: string
  filterMode: boolean
  detailOpen: boolean
  message: string
  /** Output of the most recent ranking run, shown in the rankings view. */
  lastRun?: { title: string; model: string; elapsedMs: number; extra: string; rows: DashRankRow[] }
}

export function initialDashState(view: DashView = "overview"): DashState {
  return { view, cursor: 0, scroll: 0, filter: "", filterMode: false, detailOpen: false, message: "" }
}

const VIEWS: DashView[] = ["overview", "candidates", "rankings", "help"]
const VIEW_LABELS: Record<DashView, string> = {
  overview: "Overview",
  candidates: "Candidates",
  rankings: "Rankings",
  help: "Help",
}

// --- printing helpers ------------------------------------------------------

/** Visible length of a string, ignoring ANSI escapes. */
export function visibleLength(s: string): number {
  return stripAnsi(s).length
}

export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "")
}

function pad(s: string, width: number): string {
  const len = visibleLength(s)
  if (len > width) return truncate(stripAnsi(s), width)
  return s + " ".repeat(width - len)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function thinBar(value: number, max: number, width = 14): string {
  const filled = max <= 0 ? 0 : Math.round((value / max) * width)
  return `${"█".repeat(clamp(filled, 0, width))}${"░".repeat(clamp(width - filled, 0, width))}`
}

export function filterCandidates(candidates: DashCandidate[], filter: string): DashCandidate[] {
  const f = filter.trim().toLowerCase()
  if (!f) return candidates
  return candidates.filter((c) => [c.name, c.filename, c.role, ...c.skills].join(" ").toLowerCase().includes(f))
}

// --- frame -----------------------------------------------------------------

export interface RenderOptions {
  width: number
  height: number
  color?: boolean
}

/**
 * Build one frame. Pure: same data, state and size produce the same lines, which
 * is what makes the snapshot mode (and the tests) meaningful.
 */
export function renderFrame(data: DashData, state: DashState, options: RenderOptions): string[] {
  const color = options.color !== false
  const width = clamp(options.width, 60, 400)
  const height = clamp(options.height, 16, 200)
  const bold = (t: string): string => (color ? boldInk(t) : t)
  const dim = (t: string): string => (color ? dimInk(t) : t)
  const green = (t: string): string => (color ? greenInk(t) : t)
  const yellow = (t: string): string => (color ? yellowInk(t) : t)
  const red = (t: string): string => (color ? redInk(t) : t)
  const row = (content: string): string => `│ ${pad(content, width - 4)} │`

  const inner = width - 4
  const lines: string[] = []

  // title bar: the state pill is compact, and both sides shrink instead of
  // overflowing when the terminal is narrow.
  const title = ` resumerank ${data.version} `
  const stats = `${data.store.resumes} resumes · ${data.store.skills} skills · ${data.store.rankings} rankings`
  const pill = (() => {
    if (data.jev.enabled) {
      const model = /\(([^)]+)\)/.exec(data.jev.status)?.[1] ?? "typed layer"
      return green(`● ${model}`)
    }
    if (/no key/i.test(data.jev.status)) return yellow("● offline · no key")
    if (/offline/i.test(data.jev.status)) return yellow("● offline (forced)")
    return yellow(`● ${data.jev.status}`)
  })()
  const room = Math.max(10, inner - visibleLength(stats) - 10)
  const pillFitted = visibleLength(pill) <= room ? pill : yellow("● offline")
  const left = `${bold(title)} ${dim(truncate(stats, Math.max(12, inner - visibleLength(pillFitted) - 4)))}`
  const gap = Math.max(1, inner - visibleLength(left) - visibleLength(pillFitted))
  lines.push(`┌${"─".repeat(inner + 2)}┐`)
  lines.push(row(`${left}${" ".repeat(gap)}${pillFitted}`))

  // tabs + filter
  const tabs = VIEWS.map((v, i) => {
    const label = `${i + 1} ${VIEW_LABELS[v]}`
    return v === state.view ? bold(`[${label}]`) : dim(` ${label} `)
  }).join(" ")
  const filterLabel = state.filter ? `${dim("filter:")} ${state.filter}${state.filterMode ? "▌" : ""}` : dim("/ to filter")
  const tabsGap = Math.max(1, inner - visibleLength(tabs) - visibleLength(filterLabel))
  lines.push(row(`${tabs}${" ".repeat(tabsGap)}${filterLabel}`))
  lines.push(`├${"─".repeat(inner + 2)}┤`)

  const messageRows = state.message ? 2 : 1
  const bodyHeight = height - 6 - messageRows
  const body: string[] = []
  const detailWidth = Math.max(8, inner - 68)

  if (state.view === "overview") {
    body.push(bold("Store"))
    body.push(`  ${dim("data dir")}     ${data.store.home}`)
    body.push(
      `  ${dim("candidates")}   ${data.store.resumes}    ${dim("skills")} ${data.store.skills}    ${dim("notes")} ${data.store.notes}    ${dim("index")} ${bytes(data.store.bytes)}`,
    )
    body.push(
      `  ${dim("typed layer")}  ${data.jev.enabled ? green(data.jev.status) : yellow(data.jev.status)}    ${dim("cached answers")} ${data.jev.cachedAnswers}`,
    )
    body.push("")
    body.push(bold("Top skills in the pool"))
    if (data.skillTop.length === 0) body.push(dim("  no resumes yet — resumerank add <files>"))
    const max = data.skillTop[0]?.count ?? 1
    for (const skill of data.skillTop.slice(0, Math.max(3, bodyHeight - 11))) {
      body.push(`  ${pad(skill.name, 22)} ${thinBar(skill.count, max)} ${skill.count}`)
    }
    body.push("")
    body.push(bold("Recent rankings"))
    if (data.rankings.length === 0) body.push(dim("  none yet — press r to rank the pool"))
    for (const ranking of data.rankings.slice(0, 5)) {
      body.push(
        `  ${dim(ranking.id.slice(0, 11))} ${pad(truncate(ranking.jobTitle, 34), 36)} ${dim(`${ranking.candidateCount} scored · ${ranking.model}`)}`,
      )
    }
  }

  if (state.view === "candidates") {
    const filtered = filterCandidates(data.candidates, state.filter)
    if (state.detailOpen && filtered.length > 0) {
      const c = filtered[clamp(state.cursor, 0, filtered.length - 1)]
      body.push(`${bold(c.name)} ${dim(c.filename)}`)
      body.push(`  ${dim("role")}        ${c.role || "—"}${c.seniority ? dim(` · ${c.seniority}`) : ""}`)
      body.push(`  ${dim("experience")}  ${c.years === null ? "unknown" : `${c.years} yrs`}    ${dim("confidence")} ${c.confidence.toFixed(2)}`)
      body.push(`  ${dim("skills")}      ${c.skills.slice(0, 20).join(", ") || "—"}`)
      if (c.notes > 0) body.push(`  ${dim("notes")}       ${c.notes}`)
      if (c.warnings.length > 0) body.push(`  ${yellow("warnings")}    ${c.warnings.join("; ")}`)
      const available = Math.max(2, bodyHeight - body.length - 2)
      const roles = data.candidates.find((x) => x.id === c.id)?.skills ?? []
      if (roles.length > 20) body.push(`  ${dim("more skills")} ${roles.slice(20, 20 + available * 3).join(", ")}`)
      body.push("")
      body.push(dim("  esc close · o open in the browser · j/k next candidate"))
    } else {
      body.push(`  ${pad(dim("candidate"), 30)} ${pad(dim("role"), 24)} ${pad(dim("yrs"), 5)} ${dim("skills")}`)
      if (filtered.length === 0) body.push(dim("  no candidates match"))
      const rows = Math.max(3, bodyHeight - 1)
      const start = clamp(state.scroll, 0, Math.max(0, filtered.length - rows))
      for (const [index, c] of filtered.slice(start, start + rows).entries()) {
        const selected = start + index === state.cursor
        const marker = selected ? (color ? "\u001b[7m " : ">") : " "
        const end = selected && color ? "\u001b[27m" : ""
        const note = c.notes > 0 ? dim(` ●${c.notes}`) : ""
        body.push(
          `${marker}${pad(truncate(c.name, 28), 30)} ${pad(truncate(c.role || "—", 22), 24)} ${pad(c.years === null ? "?" : String(c.years), 5)} ${truncate(c.skills.slice(0, 6).join(", "), detailWidth)}${note}${end}`,
        )
      }
      if (filtered.length > rows) body.push(dim(`  … ${filtered.length - rows} more — narrow with /`))
    }
  }

  if (state.view === "rankings") {
    const rankRows = state.lastRun ? state.lastRun.rows : []
    if (state.lastRun) {
      body.push(`${bold(state.lastRun.title)} ${dim(`${state.lastRun.model} · ${state.lastRun.elapsedMs} ms`)}`)
      if (state.lastRun.extra) body.push(dim(`  ${state.lastRun.extra}`))
      body.push("")
      body.push(`  ${pad(dim("#"), 4)} ${pad(dim("candidate"), 30)} ${pad(dim("score"), 8)} ${pad(dim("matched"), 10)} ${dim("flags")}`)
      for (const [index, r] of rankRows.entries()) {
        const tone = r.score >= 60 ? green : r.score >= 40 ? yellow : red
        body.push(
          `  ${pad(String(index + 1), 4)} ${pad(truncate(r.filename, 28), 30)} ${pad(tone(r.score.toFixed(1)), 8)} ${pad(`${r.matched}/${r.required}`, 10)} ${dim(truncate(r.flags, Math.max(6, detailWidth)))}`,
        )
      }
      if (rankRows.length === 0) body.push(dim("  nobody cleared the gates for this job"))
    } else {
      body.push(bold("Saved rankings"))
      if (data.rankings.length === 0) body.push(dim("  none yet — press r to rank the pool against a job description"))
      for (const [index, ranking] of data.rankings.entries()) {
        const selected = index === state.cursor
        const marker = selected ? (color ? "\u001b[7m " : ">") : " "
        const end = selected && color ? "\u001b[27m" : ""
        body.push(
          `${marker}${dim(ranking.id.slice(0, 11))} ${pad(truncate(ranking.jobTitle, 30), 32)} ${dim(`${ranking.candidateCount} scored · ${ranking.model}`)}${end}`,
        )
        if (selected) {
          for (const r of ranking.top.slice(0, 5)) {
            body.push(`    ${pad(truncate(r.filename, 30), 32)} ${r.score.toFixed(1).padStart(5)}  ${dim(`${r.matched}/${r.required} required`)}`)
          }
          if (ranking.top.length === 0) body.push(dim("    no eligible candidates"))
        }
      }
    }
  }

  if (state.view === "help") {
    body.push(bold("Keys"))
    for (const [k, v] of [
      ["1 2 3 4", "switch view (overview, candidates, rankings, help)"],
      ["j / k  ↑ / ↓", "move the cursor"],
      ["enter", "open the selected candidate (esc closes)"],
      ["/", "filter candidates (enter applies, esc cancels)"],
      ["r", "rank the pool: type a job description file path"],
      ["o", "open the browser UI on the same store"],
      ["q", "quit"],
    ] as const) {
      body.push(`  ${pad(k, 14)} ${v}`)
    }
    body.push("")
    body.push(bold("The same things from the shell"))
    body.push(dim("  resumerank add ~/resumes/*.pdf"))
    body.push(dim("  resumerank rank --title \"Senior Backend Engineer\" --jd jd.md"))
    body.push(dim("  resumerank explain <id> --jd jd.md     why a candidate scored what it did"))
    body.push(dim("  resumerank cache                        cached typed answers (stable, free re-runs)"))
    body.push("")
    body.push(dim("Everything works offline; a TypeSafe key only sharpens the typed answers."))
  }

  const capacity = Math.max(1, bodyHeight)
  for (const line of body.slice(0, capacity)) lines.push(row(line))
  for (let i = Math.min(body.length, capacity); i < capacity; i += 1) lines.push(row(""))
  if (state.message) {
    lines.push(row(green(state.message)))
    lines.push(row(""))
  } else {
    lines.push(row(""))
  }

  lines.push(`├${"─".repeat(inner + 2)}┤`)
  const footer = state.filterMode
    ? `${dim("filter:")} ${state.filter}▌  ${dim("enter apply · esc cancel")}`
    : dim("j/k move · enter open · / filter · r rank · o browser · q quit")
  lines.push(row(footer))
  lines.push(`└${"─".repeat(inner + 2)}┘`)
  return lines
}

// --- data ------------------------------------------------------------------

export async function loadDashData(): Promise<DashData> {
  const { stats, listResumes, listRankings, countNotes, getRanking } = await import("../store/local")
  const { jevStatus, answerCacheSize } = await import("../ai/jev")
  const { JEV_VERSION } = await import("./version")

  const storeStats = await stats()
  const notes = await countNotes()
  const candidates: DashCandidate[] = (await listResumes()).map((r) => ({
    id: r.id,
    name:
      r.structured?.fullName?.trim() ||
      // no name in the CV (a design-element header, or a multi-person sample PDF):
      // fall back to the filename, cleaned up so it reads like a label.
      r.originalFilename
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    filename: r.originalFilename,
    role: r.metadata.roles?.[0] ?? r.structured?.headline ?? r.metadata.seniority ?? "",
    seniority: r.metadata.seniority ?? "",
    years: r.metadata.yearsOfExperience ?? null,
    skills: r.metadata.skills ?? [],
    confidence: r.quality?.extractionConfidence ?? 0,
    notes: notes[r.id] ?? 0,
    warnings: r.quality?.warnings ?? [],
  }))

  const rankings: DashRanking[] = []
  for (const summary of await listRankings(20)) {
    const record = await getRanking(summary.id)
    const ranked = (record?.results ?? []).filter((r) => r.rank > 0).sort((a, b) => a.rank - b.rank)
    rankings.push({
      id: summary.id,
      jobTitle: summary.jobTitle,
      candidateCount: summary.candidateCount,
      model: summary.model,
      createdAt: summary.createdAt,
      top: ranked.slice(0, 5).map((r) => ({
        filename: r.originalFilename,
        score: r.finalScore,
        matched: r.analysis?.matchedRequirements?.length ?? 0,
        required: (r.analysis?.matchedRequirements?.length ?? 0) + (r.analysis?.missingRequirements?.length ?? 0),
        flags: (r.analysis?.mismatchReasons ?? []).join("; ") || (r.analysis?.mismatch ? "flagged" : ""),
      })),
    })
  }

  const counts = new Map<string, number>()
  for (const c of candidates) for (const s of c.skills) counts.set(s, (counts.get(s) ?? 0) + 1)
  const skillTop = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 12)

  return {
    store: {
      resumes: storeStats.resumes,
      skills: storeStats.skills,
      rankings: storeStats.rankings,
      notes: Object.values(notes).reduce((a, b) => a + b, 0),
      bytes: storeStats.bytes ?? 0,
      home: dataHome(),
    },
    jev: {
      status: jevStatus(),
      cachedAnswers: await answerCacheSize().catch(() => 0),
      enabled: config.typesafe.enabled && !isOffline(),
    },
    candidates,
    rankings,
    skillTop,
    version: JEV_VERSION,
  }
}

// --- interactive runner ----------------------------------------------------

const ALT_SCREEN_ON = "\u001b[?1049h"
const ALT_SCREEN_OFF = "\u001b[?1049l"
const HIDE_CURSOR = "\u001b[?25l"
const SHOW_CURSOR = "\u001b[?25h"
const CLEAR = "\u001b[2J\u001b[H"

export interface DashOptions {
  view?: DashView
  snapshot?: boolean
  width?: number
  height?: number
  color?: boolean
  /** Injected by the CLI so the dashboard can rank without duplicating CLI code. */
  rank?: (title: string, jdPath: string) => Promise<{ title: string; model: string; elapsedMs: number; extra: string; rows: DashRankRow[] }>
  /** Opens the browser UI; keeps the dashboard free of server details. */
  openBrowser?: () => Promise<string>
}

/**
 * Render and drive the dashboard. Interactive when stdin is a TTY, otherwise a
 * single frame is printed (so `dash | head`, CI and the tests all work).
 */
export async function runDashboard(options: DashOptions = {}): Promise<void> {
  const state = initialDashState(options.view ?? "overview")
  let data = await loadDashData()

  const size = () => ({
    width: options.width ?? process.stdout.columns ?? 100,
    height: options.height ?? process.stdout.rows ?? 30,
  })

  const draw = (): void => {
    const { width, height } = size()
    const lines = renderFrame(data, state, { width, height, color: options.color })
    process.stdout.write(`${CLEAR}${lines.join("\n")}\n`)
  }

  if (options.snapshot || !process.stdin.isTTY) {
    const lines = renderFrame(data, state, { ...size(), color: options.snapshot ? false : options.color })
    process.stdout.write(`${lines.join("\n")}\n`)
    return
  }

  process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR)
  draw()

  const onResize = (): void => draw()
  process.stdout.on("resize", onResize)

  const cleanup = (): void => {
    process.stdout.off("resize", onResize)
    process.stdin.setRawMode?.(false)
    process.stdin.pause()
    process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF)
  }

  const filtered = (): DashCandidate[] => filterCandidates(data.candidates, state.filter)
  const clampCursor = (): void => {
    const length = state.view === "candidates" ? filtered().length : data.rankings.length
    state.cursor = clamp(state.cursor, 0, Math.max(0, length - 1))
    const rows = Math.max(3, size().height - 7)
    if (state.cursor < state.scroll) state.scroll = state.cursor
    if (state.cursor >= state.scroll + rows) state.scroll = state.cursor - rows + 1
  }

  const promptLine = (label: string): Promise<string> =>
    new Promise((resolve) => {
      process.stdin.setRawMode?.(false)
      process.stdout.write(SHOW_CURSOR + `\n${label}`)
      let buffer = ""
      const onData = (chunk: Buffer): void => {
        const text = chunk.toString("utf8")
        for (const ch of text) {
          if (ch === "\u007f") buffer = buffer.slice(0, -1)
          else if (ch === "\r" || ch === "\n") {
            process.stdin.off("data", onData)
            process.stdin.setRawMode?.(true)
            process.stdout.write(HIDE_CURSOR)
            resolve(buffer.trim())
            return
          } else if (ch >= " ") buffer += ch
        }
        process.stdout.write(`\r${label}${buffer}   `)
      }
      process.stdin.on("data", onData)
      process.stdin.resume()
    })

  const onKey = async (key: string): Promise<void> => {
    if (state.filterMode) {
      if (key === "\r") {
        state.filterMode = false
        clampCursor()
      } else if (key === "\u001b") {
        state.filterMode = false
        state.filter = ""
        clampCursor()
      } else if (key === "\u007f") {
        state.filter = state.filter.slice(0, -1)
        clampCursor()
      } else if (key >= " ") {
        state.filter += key
        clampCursor()
      }
      draw()
      return
    }

    switch (key) {
      case "q":
      case "\u0003": // ctrl-c
        cleanup()
        process.exit(0)
        return
      case "1":
        state.view = "overview"
        break
      case "2":
        state.view = "candidates"
        state.cursor = 0
        state.detailOpen = false
        break
      case "3":
        state.view = "rankings"
        state.cursor = 0
        break
      case "4":
        state.view = "help"
        break
      case "j":
      case "\u001b[B":
        state.cursor += 1
        break
      case "k":
      case "\u001b[A":
        state.cursor -= 1
        break
      case "g":
        state.cursor = 0
        break
      case "G":
        state.cursor = Number.MAX_SAFE_INTEGER
        break
      case "/":
        state.view = "candidates"
        state.filterMode = true
        break
      case "\u001b":
        if (state.detailOpen) state.detailOpen = false
        else if (state.filter) {
          state.filter = ""
          state.cursor = 0
        }
        break
      case "\r":
        if (state.view === "candidates") {
          state.detailOpen = !state.detailOpen
        } else if (state.view === "rankings" && !state.lastRun && data.rankings.length > 0) {
          const selected = data.rankings[clamp(state.cursor, 0, data.rankings.length - 1)]
          state.lastRun = {
            title: selected.jobTitle,
            model: selected.model,
            elapsedMs: 0,
            extra: `saved ${selected.createdAt.slice(0, 16).replace("T", " ")} · showing the stored result`,
            rows: selected.top,
          }
        }
        break
      case "o": {
        if (options.openBrowser) {
          const url = await options.openBrowser()
          state.message = `browser UI: ${url}`
        }
        break
      }
      case "r": {
        if (!options.rank) break
        const path = await promptLine("job description file (e.g. corpus/jobs/j1.md): ")
        if (!path) {
          state.message = "ranking cancelled"
          break
        }
        state.message = "ranking…"
        draw()
        try {
          const result = await options.rank("", path)
          state.lastRun = result
          state.view = "rankings"
          state.message = `ranked ${result.rows.length} candidates in ${result.elapsedMs} ms (${result.model})`
        } catch (err) {
          state.message = `ranking failed: ${err instanceof Error ? err.message : String(err)}`
        }
        break
      }
      default:
        break
    }
    clampCursor()
    draw()
  }

  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk: string | Buffer) => {
    const text = chunk.toString("utf8")
    // Escape sequences (arrows) arrive as one chunk; handle them as a unit.
    void onKey(text === "\u001b[A" || text === "\u001b[B" ? text : (text[0] ?? ""))
      .then(async () => {
        if (text.length > 1 && text !== "\u001b[A" && text !== "\u001b[B") {
          for (const ch of text.slice(1)) await onKey(ch)
        }
      })
      .catch(() => {})
  })
}
