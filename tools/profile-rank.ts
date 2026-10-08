// Micro-profile of the ranking hot path: which step costs what, per candidate.
import { performance } from "node:perf_hooks"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")
const { analyzeJobDescription } = await import("../src/ranking/jd")
const { matchRequirements } = await import("../src/ranking/semantic")
const { deterministicScore } = await import("../src/ranking/scoring")
const { indexText, proposeSkillMentions } = await import("../src/extract/deterministic")
const { stemSet, tokenize } = await import("../src/ranking/semantic")

const jd = `Senior Backend Engineer\n\nRequirements\n- 6+ years of experience\n- Strong Go or Python\n- PostgreSQL, Kubernetes, AWS, Kafka, Redis\n\nNice to have\n- Terraform, gRPC\n\nResponsibilities\n- Own services end to end\n- Mentor engineers\n`

const total = (label: string, ms: number, runs: number) => console.log(`  ${label.padEnd(40)} ${(ms / runs).toFixed(3).padStart(8)} ms/op`)

const resumes = await listResumes()
const texts = new Map<string, string>()
for (const r of resumes) texts.set(r.id, await resumeText(r.id))

// 1. JD parse
let t = performance.now()
const runs = 20
for (let i = 0; i < runs; i += 1) analyzeJobDescription("Senior Backend Engineer", jd)
total("analyzeJobDescription", performance.now() - t, runs)
const requirements = analyzeJobDescription("Senior Backend Engineer", jd)

// 2. per-candidate: matching
t = performance.now()
let matches: Awaited<ReturnType<typeof matchRequirements>> = []
for (let i = 0; i < runs; i += 1) {
  for (const r of resumes) {
    matches = await matchRequirements(requirements.requiredSkills ?? [], r.metadata?.skills ?? [], { jevAssist: false })
  }
}
total(`matchRequirements × ${resumes.length} candidates`, performance.now() - t, runs)

// 3. per-candidate: text tokenisation (the suspected hotspot)
t = performance.now()
for (let i = 0; i < runs; i += 1) {
  for (const r of resumes) stemSet(tokenize(texts.get(r.id) ?? ""))
}
total(`stemSet(tokenize(text)) × ${resumes.length}`, performance.now() - t, runs)

// 4. per-candidate: deterministic score (includes tokenisation)
t = performance.now()
for (let i = 0; i < runs; i += 1) {
  for (const r of resumes) {
    deterministicScore({
      requirements,
      metadata: r.metadata,
      resumeText: texts.get(r.id) ?? "",
      skillMatches: matches,
      jobDescription: jd,
    })
  }
}
total(`deterministicScore × ${resumes.length}`, performance.now() - t, runs)

// 5. ingestion-side: section split + mention proposal on one text
const sample = texts.get(resumes[0].id) ?? ""
t = performance.now()
for (let i = 0; i < runs; i += 1) proposeSkillMentions(indexText(sample))
total("indexText + proposeSkillMentions (1 resume)", performance.now() - t, runs)
