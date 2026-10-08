// The exported dashboard is the file a non-technical user opens by double-click,
// so the tests pin what makes that work: it must be self-contained, escape
// whatever came out of the resume, and still be readable with no data.
import { describe, expect, it } from "vitest"
import { escapeHtml, renderDashboardHtml, shortWarning } from "../src/ui/export-html"
import type { DashData } from "../src/ui/terminal"

const data: DashData = {
  store: { resumes: 2, skills: 5, rankings: 1, notes: 1, bytes: 4096, home: "/home/alok/.resumerank" },
  jev: { status: "enabled (jev-1.13.0)", cachedAnswers: 12, enabled: true },
  candidates: [
    {
      id: "rs_a",
      name: "ALEXANDRA MERCER",
      filename: "backend.txt",
      role: "Backend Engineer",
      seniority: "senior",
      years: 8,
      skills: ["Go", "PostgreSQL"],
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
      skills: ["Zendesk"],
      confidence: 0.9,
      notes: 0,
      warnings: ["no dated roles or explicit years found; unknown"],
    },
  ],
  rankings: [
    {
      id: "rk_1",
      jobTitle: "Senior Backend Engineer",
      candidateCount: 2,
      model: "offline",
      createdAt: "2026-10-08T00:00:00.000Z",
      top: [
        { filename: "backend.txt", score: 92.2, matched: 7, required: 7, flags: "" },
        { filename: "support.txt", score: 41.0, matched: 3, required: 7, flags: "coverage 43% is below the 40% floor" },
      ],
    },
  ],
  skillTop: [
    { name: "Go", count: 1 },
    { name: "Zendesk", count: 1 },
  ],
  version: "1.0.0",
}

const html = renderDashboardHtml(data, { generatedAt: new Date("2026-10-08T12:00:00Z") })

describe("standalone HTML dashboard", () => {
  it("is self-contained: no scripts, no network, nothing to load", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html.toLowerCase()).not.toContain("<script")
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toContain("<link ")
    expect(html).not.toContain("<img ")
    expect(html).toContain("<style>")
  })

  it("shows the pool, the runs and the numbers behind them", () => {
    expect(html).toContain("ALEXANDRA MERCER")
    expect(html).toContain("TOM BRENNAN")
    expect(html).toContain("1/2") // skill bars carry the pool denominator
    expect(html).toContain("Senior Backend Engineer")
    expect(html).toContain("92.2")
    expect(html).toContain("7/7")
    expect(html).toContain("coverage 43% is below the 40% floor")
    expect(html).toContain("candidates ever ranked")
  })

  it("explains the columns for a non-technical reader", () => {
    expect(html).toContain("how well the CV could be read")
    expect(html).toContain("<b>status</b>")
    expect(html).toContain("resumerank ui") // how to get to the interactive app
    expect(html).toContain("no dated roles or explicit years found") // full text on hover
    expect(html).toContain("no dates in CV") // short label, visible without hovering
    expect(html).toContain("stored on this machine only")
    expect(html).not.toContain("/home/alok/.resumerank") // no developer paths in the report
  })

  it("shortens engine warnings into labels a reader can scan", () => {
    expect(shortWarning("no dated roles or explicit years found; unknown")).toBe("no dates in CV")
    expect(shortWarning("duplicate of cv.pdf — this file was already in the library")).toBe("duplicate file")
    expect(shortWarning("dated roles span ~12.4 yrs but the resume claims 8 yrs")).toBe("dates don't add up")
    expect(shortWarning("Jev doubts the derived 9 yrs figure (P=0.89); it was kept but flagged")).toBe("check the years")
    expect(shortWarning("a".repeat(60))).toHaveLength(27) // 26 chars + ellipsis
  })

  it("escapes anything that came out of a resume", () => {
    const nasty = renderDashboardHtml(
      {
        ...data,
        candidates: [
          {
            ...data.candidates[0],
            name: '<script>alert("x")</script>',
            filename: 'a"onmouseover="evil().txt',
            skills: ["<b>bold</b>"],
            warnings: ["<img src=x onerror=alert(1)>"],
          },
        ],
      },
      { generatedAt: new Date("2026-10-08T12:00:00Z") },
    )
    expect(nasty).not.toContain("<script>alert")
    expect(nasty).not.toContain('onmouseover="evil()')
    expect(nasty).not.toContain("<img src=x")
    expect(nasty).not.toContain("<b>bold</b>")
    expect(nasty).toContain("&lt;script&gt;alert")
  })

  it("stays readable with an empty store", () => {
    const empty = renderDashboardHtml(
      {
        ...data,
        candidates: [],
        rankings: [],
        skillTop: [],
        store: { ...data.store, resumes: 0, skills: 0, rankings: 0 },
      },
      { generatedAt: new Date("2026-10-08T12:00:00Z") },
    )
    expect(empty).toContain("No resumes yet.")
    expect(empty).toContain("No candidates yet.")
    expect(empty).not.toContain("undefined")
    expect(empty).not.toContain("NaN")
  })

  it("escapes html entities through the helper", () => {
    expect(escapeHtml('<a href="x">&\'')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;")
  })
})
