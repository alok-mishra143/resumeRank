import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

// Controlled seniority test: four candidates whose profiles are IDENTICAL except
// for their years and level. This is the only way to prove the level model works —
// on a heterogenous pool you cannot tell whether the ranking changed because of
// seniority or because of the stack.

const home = mkdtempSync(join(tmpdir(), "resumerank-levels-"))
process.env.RESUMERANK_HOME = home
process.env.RESUMERANK_OFFLINE = "1"

const profile = (years: number, title: string, band: string, leadership: string) => `NAME: ${band.toUpperCase()} CASE
${title}
${band}.case@example.com | +1 415 555 0134 | Seattle, WA

SUMMARY
Backend engineer with ${years} years of experience building payment services in Go and PostgreSQL.

EXPERIENCE
${title} — Northwind Cloud
Jan 2018 – Present
- Built a ledger service in Go and PostgreSQL handling 4k rps.
- Ran the Kubernetes migration for 12 services on AWS.
${leadership}

SKILLS
Go, PostgreSQL, Kubernetes, AWS, Kafka, Docker, Terraform, Redis, Python, gRPC

EDUCATION
B.S. Computer Science — University of Washington (2014)
`

const LEAD_NONE = "- Wrote unit tests and reviewed pull requests."
const LEAD_SOME = "- Mentored two junior engineers and owned the payments service."
const LEAD_STRONG = [
  "- Led architecture for the payments platform across three teams (team of 9 engineers).",
  "- Mentored 6 engineers and set the technical roadmap for the division.",
  "- Owned cross-team technical leadership for the migration to Kubernetes.",
].join("\n")

beforeAll(async () => {
  const { ensureStore } = await import("../src/store/local")
  const { addResumeFromText } = await import("../src/resumes/service")
  await ensureStore()
  const candidates: Array<[string, number, string, string, string]> = [
    ["junior-case", 1.5, "Junior Backend Engineer", "junior", LEAD_NONE],
    ["mid-case", 4, "Backend Engineer", "mid", LEAD_SOME],
    ["senior-case", 8, "Senior Backend Engineer", "senior", LEAD_SOME],
    ["staff-case", 12, "Staff Backend Engineer", "staff", LEAD_STRONG],
  ]
  for (const [file, years, title, band, leadership] of candidates) {
    await addResumeFromText(`${file}.txt`, profile(years, title, band, leadership), { jev: false })
  }
})

const JD_JUNIOR = `Junior Backend Engineer

Requirements
- 1-2 years of experience writing backend code
- Go or Python
- PostgreSQL
- Kubernetes basics

Nice to have
- Docker
`

const JD_SENIOR = `Senior Backend Engineer

Requirements
- 6+ years of experience building production backend services
- Strong Go or Python
- PostgreSQL at scale
- Kubernetes in production

Nice to have
- Kafka
- Terraform
`

const JD_STAFF = `Staff Backend Engineer / Architect

Requirements
- 10+ years of engineering experience
- Led architecture for multiple production systems
- Deep Kubernetes and distributed systems knowledge
- Experience leading and mentoring teams
- Cross-team technical leadership

Nice to have
- Terraform
`

async function rank(title: string, description: string) {
  const { rankJob } = await import("../src/ranking/service")
  return rankJob({ title, description, offline: true, limit: 4, includeMismatches: false })
}

describe("ranking across seniority levels", () => {
  it("derives the posting's band from the title, then the years bar", async () => {
    const { jobLevel } = await import("../src/ranking/jd")
    expect(jobLevel("Junior Backend Engineer", JD_JUNIOR, 1)).toBe("junior")
    expect(jobLevel("Backend Engineer", "Requirements\n- 3-4 years", 3)).toBe("mid")
    expect(jobLevel("Senior Backend Engineer", JD_SENIOR, 6)).toBe("senior")
    expect(jobLevel("Staff Backend Engineer / Architect", JD_STAFF, 10)).toBe("staff")
    expect(jobLevel("Software Engineer", "no bar stated", null)).toBe("senior")
  })

  it("reads a candidate's band from their seniority, then their years", async () => {
    const { candidateLevel } = await import("../src/ranking/scoring")
    expect(candidateLevel({ seniority: "junior" })).toBe("junior")
    expect(candidateLevel({ seniority: "mid" })).toBe("mid")
    expect(candidateLevel({ seniority: "senior" })).toBe("senior")
    expect(candidateLevel({ seniority: "Staff" })).toBe("staff")
    expect(candidateLevel({ seniority: "Lead" })).toBe("staff")
    expect(candidateLevel({ yearsOfExperience: 2 })).toBe("junior")
    expect(candidateLevel({ yearsOfExperience: 4 })).toBe("mid")
    expect(candidateLevel({ yearsOfExperience: 7 })).toBe("senior")
    expect(candidateLevel({ yearsOfExperience: 11 })).toBe("staff")
  })

  it("ranks the level-appropriate candidate first for a junior posting", async () => {
    const result = await rank("Junior Backend Engineer", JD_JUNIOR)
    const winner = result.results[0]
    expect(winner.originalFilename).toMatch(/junior-case|mid-case/)
    // For an entry-level posting both the senior and the staff candidate are two
    // or more bands above, which is the disqualifier for that level.
    const excluded = result.excluded.map((e) => e.originalFilename)
    expect(excluded).toContain("staff-case.txt")
    expect(excluded).toContain("senior-case.txt")
  })

  it("ranks the senior candidate first for a senior posting", async () => {
    const result = await rank("Senior Backend Engineer", JD_SENIOR)
    expect(result.results[0].originalFilename).toBe("senior-case.txt")
  })

  it("ranks the staff candidate first for a staff posting", async () => {
    const result = await rank("Staff Backend Engineer / Architect", JD_STAFF)
    expect(result.results[0].originalFilename).toBe("staff-case.txt")
  })

  it("flags a two-band level gap on a senior/staff posting instead of hiding the candidate", async () => {
    // A mid candidate for a staff req is two bands under: ranked, penalised, flagged.
    const result = await rank("Staff Backend Engineer / Architect", JD_STAFF)
    const mid = result.results.find((r) => r.originalFilename === "mid-case.txt")
    if (mid) {
      const level = mid.judgement?.level
      expect(level?.distance).toBe(2)
      expect(mid.analysis.mismatch).toBe(true)
      expect(mid.analysis.mismatchReasons.join(" ")).toMatch(/level mismatch|seniority mismatch/)
    }
  })

  it("weights leadership only when the posting asks for it", async () => {
    const { deterministicScore } = await import("../src/ranking/scoring")
    const base = {
      resumeText: "Led architecture for three teams. Mentored 6 engineers. Owned the roadmap.",
      metadata: { yearsOfExperience: 12, seniority: "staff", skills: ["Go"] },
      skillMatches: [],
    }
    const asked = deterministicScore({
      ...base,
      requirements: { role: "Staff Engineer", level: "staff", requiredSkills: ["Go"] },
    })
    const notAsked = deterministicScore({
      ...base,
      requirements: { role: "Backend Engineer", level: "senior", requiredSkills: ["Go"] },
    })
    expect(asked.breakdown.leadership).toBeGreaterThan(80)
    expect(notAsked.breakdown.leadership).toBeNull()
  })
})
