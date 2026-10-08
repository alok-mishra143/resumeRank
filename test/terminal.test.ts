// The terminal dashboard is a pure renderer plus a thin key loop, so the frame
// itself is what gets tested: every view renders, nothing overflows the width,
// snapshots carry no ANSI, and the filter/detail/ranking states behave.
import { describe, expect, it } from "vitest"
import {
  filterCandidates,
  initialDashState,
  renderFrame,
  stripAnsi,
  type DashData,
  type DashView,
} from "../src/ui/terminal"

const data: DashData = {
  store: { resumes: 3, skills: 12, rankings: 1, notes: 2, bytes: 2048, home: "/home/alok/.resumerank" },
  jev: { status: "enabled (jev-1.13.0)", cachedAnswers: 42, enabled: true },
  candidates: [
    {
      id: "rs_a",
      name: "ALEXANDRA MERCER",
      filename: "backend.txt",
      role: "Backend Engineer",
      seniority: "senior",
      years: 8,
      skills: ["Go", "PostgreSQL", "Kubernetes"],
      confidence: 0.95,
      notes: 1,
      warnings: [],
    },
    {
      id: "rs_b",
      name: "TOM BRENNAN",
      filename: "support.txt",
      role: "Support Ticket Analyst",
      seniority: "mid",
      years: 4,
      skills: ["Zendesk", "SQL"],
      confidence: 0.9,
      notes: 0,
      warnings: ["no dated roles found"],
    },
    {
      id: "rs_c",
      name: "ELENA MORENO",
      filename: "designer.txt",
      role: "Product Designer",
      seniority: "mid",
      years: 6,
      skills: ["Figma", "User Research"],
      confidence: 0.93,
      notes: 1,
      warnings: [],
    },
  ],
  rankings: [
    {
      id: "rk_1",
      jobTitle: "Senior Backend Engineer",
      candidateCount: 3,
      model: "jev-1.13.0",
      createdAt: "2026-10-08T00:00:00.000Z",
      top: [{ filename: "backend.txt", score: 92.2, matched: 7, required: 7, flags: "" }],
    },
  ],
  skillTop: [
    { name: "Go", count: 1 },
    { name: "SQL", count: 1 },
  ],
  version: "1.0.0",
}

const render = (view: DashView, state = initialDashState(view), width = 100, height = 26): string[] =>
  renderFrame(data, state, { width, height, color: false })

describe("terminal dashboard", () => {
  it("renders every view inside the requested width", () => {
    for (const view of ["overview", "candidates", "rankings", "help"] as const) {
      const lines = render(view, initialDashState(view))
      expect(lines.length, view).toBeGreaterThan(10)
      for (const line of lines) expect(line.length, `${view}: ${line}`).toBeLessThanOrEqual(100)
      expect(lines[0].startsWith("┌")).toBe(true)
      expect(lines[lines.length - 1].startsWith("└")).toBe(true)
    }
  })

  it("shows the store, the typed-layer state and the pool in the overview", () => {
    const text = render("overview").join("\n")
    expect(text).toContain("/home/alok/.resumerank")
    expect(text).toContain("3 resumes")
    expect(text).toContain("cached answers 42")
    expect(text).toContain("Top skills in the pool")
    expect(text).toContain("Senior Backend Engineer")
  })

  it("lists candidates and marks the selected row", () => {
    const state = initialDashState("candidates")
    state.cursor = 1
    const text = render("candidates", state).join("\n")
    expect(text).toContain("ALEXANDRA MERCER")
    expect(text).toContain("TOM BRENNAN")
    expect(text).toContain(">TOM BRENNAN") // the offline cursor marker
    expect(text).toContain("Zendesk")
  })

  it("opens a candidate detail with its warnings", () => {
    const state = initialDashState("candidates")
    state.cursor = 1
    state.detailOpen = true
    const text = render("candidates", state).join("\n")
    expect(text).toContain("experience  4 yrs")
    expect(text).toContain("no dated roles found")
    expect(text).toContain("esc close")
  })

  it("filters candidates by name, role or skill", () => {
    expect(filterCandidates(data.candidates, "figma").map((c) => c.name)).toEqual(["ELENA MORENO"])
    expect(filterCandidates(data.candidates, "engineer").map((c) => c.name)).toEqual(["ALEXANDRA MERCER"])
    expect(filterCandidates(data.candidates, "zzz")).toHaveLength(0)
    expect(filterCandidates(data.candidates, "")).toHaveLength(3)
  })

  it("renders a ranking run as a table with scores and coverage", () => {
    const state = initialDashState("rankings")
    state.lastRun = {
      title: "Senior Backend Engineer",
      model: "offline",
      elapsedMs: 66,
      extra: "1 ranked · saved as rk_1",
      rows: [
        { filename: "backend.txt", score: 92.2, matched: 7, required: 7, flags: "" },
        { filename: "support.txt", score: 41.0, matched: 3, required: 7, flags: "coverage 43% is low" },
      ],
    }
    const text = render("rankings", state).join("\n")
    expect(text).toContain("Senior Backend Engineer")
    expect(text).toContain("66 ms")
    expect(text).toContain("92.2")
    expect(text).toContain("7/7")
    expect(text).toContain("coverage 43% is low")
  })

  it("keeps snapshots free of escape codes", () => {
    const lines = renderFrame(data, initialDashState("candidates"), { width: 90, height: 20, color: false })
    expect(lines.join("\n")).not.toMatch(/\u001b\[/)
    // Colour mode is the same frame with SGR codes and reverse-video selection
    // (a " " instead of the ">" marker), so the plain renderer is not a substring
    // of it: compare the geometry and the content instead.
    const coloured = renderFrame(data, initialDashState("candidates"), { width: 90, height: 20, color: true })
    expect(coloured.join("\n")).toMatch(/\u001b\[/)
    const stripped = stripAnsi(coloured.join("\n")).split("\n")
    expect(stripped).toHaveLength(lines.length)
    for (const line of stripped) expect(line.length).toBeLessThanOrEqual(90)
    const names = ["ALEXANDRA MERCER", "TOM BRENNAN", "ELENA MORENO"]
    for (const name of names) expect(stripAnsi(coloured.join("\n"))).toContain(name.slice(0, 12))
  })
})
