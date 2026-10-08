import { describe, expect, it } from "vitest"
import { splitSections } from "../src/extract/text"
import {
  indexText,
  parseExperience,
  proposeCertifications,
  proposeEducationEntries,
  proposeRoles,
  proposeSkillMentions,
  proposeSkillsOffline,
  proposeYearsExplicit,
  proposeYearsFromRanges,
} from "../src/extract/deterministic"

const RESUME = `MAYA OKONKWO
Backend Engineer
maya@example.com | +1 415 555 0134 | Austin, TX

SUMMARY
Backend engineer with 6 years of experience building payment services.

EXPERIENCE
Senior Backend Engineer — Cedar Pay
Jan 2020 – Present
- Built a ledger service in Go and PostgreSQL handling 4k rps.
- Ran the Kubernetes migration for 12 services on AWS, cutting costs 30%.

Backend Engineer — Nordwind
2017 - 2019
- Designed REST APIs in Python and Django.
- Exposure to Terraform in CI templates only.

PROJECTS
Ledger Replay Tool — Go, Redis, built for on-call debugging.
- reduced incident triage time by 40%

SKILLS
Go, PostgreSQL, Kubernetes, AWS, Docker, Kafka, Redis, Python
Also familiar with: Figma mockups, Salesforce reporting

EDUCATION
M.Sc. Computer Science - Technical University of Munich - 2017
`

describe("resume text sections", () => {
  it("splits ALL-CAPS, Title Case and lowercase headings", () => {
    const keys = splitSections(RESUME).map((s) => s.key)
    expect(keys).toEqual(expect.arrayContaining(["summary", "experience", "projects", "skills", "education"]))
  })

  it("does not treat sentences as headings", () => {
    const text = "Experience with Kubernetes and AWS across several teams.\nReal body line."
    expect(splitSections(text).filter((s) => s.key === "experience")).toHaveLength(0)
  })
})

describe("deterministic extraction", () => {
  const idx = indexText(RESUME)

  it("keeps skills used hands-on and drops incidental mentions", () => {
    const skills = proposeSkillsOffline(idx)
    expect(skills).toEqual(expect.arrayContaining(["Go", "PostgreSQL", "Kubernetes", "AWS", "Kafka"]))
    expect(skills).not.toContain("Figma")
    expect(skills).not.toContain("Salesforce")
  })

  it("classifies context per mention", () => {
    const mentions = proposeSkillMentions(idx)
    const byName = new Map(mentions.map((m) => [m.canonical, m]))
    expect(byName.get("Kubernetes")?.context).toBe("used")
    expect(["negated", "weak"]).toContain(byName.get("Terraform")?.context)
    expect(["negated", "weak"]).toContain(byName.get("Figma")?.context)
  })

  it("finds roles, certifications and education", () => {
    expect(proposeRoles(RESUME)).toEqual(
      expect.arrayContaining(["Senior Backend Engineer", "Backend Engineer"]),
    )
    expect(proposeCertifications("AWS Certified Solutions Architect, CKA")).toEqual(
      expect.arrayContaining(["AWS Certified", "CKA"]),
    )
    const education = proposeEducationEntries(RESUME)
    expect(education.join(" | ")).toMatch(/Master's/)
    expect(education.join(" | ")).toMatch(/Munich/)
  })

  it("prefers the explicit claim, and parses dated roles when there is none", () => {
    expect(proposeYearsExplicit(RESUME)).toBe(6)
    const now = new Date("2024-01-01T00:00:00Z")
    const fromDates = proposeYearsFromRanges(RESUME, now)
    expect(fromDates).toBeGreaterThan(5.5)
    expect(fromDates).toBeLessThan(7.5)
  })

  it("never counts education years as work experience", () => {
    const text = "EDUCATION\nB.Tech - Computer Science - 2014 - 2018\n"
    expect(proposeYearsFromRanges(text)).toBeNull()
  })

  it("parses experience entries even when dates sit on their own line", () => {
    const entries = parseExperience(RESUME)
    expect(entries).toHaveLength(2)
    expect(entries[0].role).toMatch(/Senior Backend Engineer/)
    expect(entries[0].company).toMatch(/Cedar Pay/)
    expect(entries[0].startDate).toBe("2020-01")
    expect(entries[0].isCurrent).toBe(true)
    expect(entries[0].bullets.length).toBeGreaterThan(0)
    expect(entries[1].endDate).toBe("2019")
  })

  it("keeps project titles and drops achievement bullets", () => {
    const projects = proposeSkillMentions(idx).length
    expect(projects).toBeGreaterThan(5)
  })
})
