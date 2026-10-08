// Second-level profile: what inside deterministicScore costs the most?
import { performance } from "node:perf_hooks"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")
const { analyzeJobDescription } = await import("../src/ranking/jd")
const { matchRequirements, coverageFromMatches, tokenize, stemSet, tokenOverlap, jaccard } = await import("../src/ranking/semantic")
const { roleSimilarity } = await import("../src/ranking/scoring")
const { canonicalize, skillInfo } = await import("../src/extract/ontology")

const jd = `Senior Backend Engineer\n\nRequirements\n- 6+ years of experience\n- Strong Go or Python\n- PostgreSQL, Kubernetes, AWS, Kafka, Redis\n\nNice to have\n- Terraform, gRPC\n\nResponsibilities\n- Own services end to end\n- Mentor engineers\n`
const requirements = analyzeJobDescription("Senior Backend Engineer", jd)

const resumes = await listResumes()
const texts = new Map<string, string>()
for (const r of resumes) texts.set(r.id, await resumeText(r.id))

const runs = 50
const total = (label: string, fn: () => void) => {
  const t = performance.now()
  for (let i = 0; i < runs; i += 1) fn()
  console.log(`  ${label.padEnd(46)} ${((performance.now() - t) / runs).toFixed(3).padStart(8)} ms/op`)
}

console.log(`\nover ${resumes.length} candidates per op:\n`)
total("roleSimilarity (all candidates)", () => {
  for (const r of resumes) roleSimilarity(requirements.role, r.metadata?.roles ?? [])
})
total("coverageFromMatches (all)", async () => {})
total("textCoverage-equivalent: tokenOverlap × 2 needs", () => {
  for (const r of resumes) {
    const toks = stemSet(tokenize(texts.get(r.id) ?? ""))
    for (const need of [...(requirements.responsibilities ?? []), ...(requirements.domain ?? [])]) tokenOverlap(need, toks)
  }
})
total("canonicalize × candidate skills (all)", () => {
  for (const r of resumes) for (const s of (r.metadata?.skills ?? []).slice(0, 30)) canonicalize(s)
})
total("skillInfo × candidate skills (all)", () => {
  for (const r of resumes) for (const s of (r.metadata?.skills ?? []).slice(0, 30)) skillInfo(s)
})
const preflist = requirements.preferredSkills ?? []
total(`preferred pass: canonicalize+skillInfo × ${preflist.length} × ${resumes.length}`, () => {
  for (const r of resumes) {
    for (const p of preflist) {
      const canon = canonicalize(p) ?? p
      for (const raw of r.metadata?.skills ?? []) {
        const cand = canonicalize(raw) ?? raw
        const info = skillInfo(cand)
        if (info?.ancestors.some((a) => a.toLowerCase() === canon.toLowerCase())) break
        if (info?.descendants.some((d) => d.toLowerCase() === canon.toLowerCase())) break
      }
    }
  }
})
total("jaccard(requiredRole, roles)", () => {
  for (const r of resumes) for (const role of r.metadata?.roles ?? []) jaccard([requirements.role ?? ""], [role])
})
