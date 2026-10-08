// Independent check on real resumes: for a JD, is every skill credited to a
// top-ranked candidate actually present in that candidate's text, and does the
// shortlist separate real matches from the unrelated resumes in the pool?
//
//   npx tsx tools/audit-ranking.ts --jd corpus-real/jd-backend.md [--title "..."] [--offline]
import { readFile } from "node:fs/promises"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const jdFile = arg("--jd", "corpus-real/jd-backend.md")
const offline = process.argv.includes("--offline")
const jd = await readFile(jdFile, "utf8")
const title = arg("--title") ?? (jd.split("\n").find((l) => l.trim()) ?? "Role").trim()

const { rankJob } = await import("../src/ranking/service")
const { resumeText, listResumes } = await import("../src/store/local")
const { canonicalize, skillInfo } = await import("../src/extract/ontology")

const result = await rankJob({ saveRanking: false, title, description: jd, jev: !offline, offline, limit: 12 })
const summaries = new Map((await listResumes()).map((r) => [r.id, r]))
const ranked = result.results.filter((r) => r.rank > 0).sort((a, b) => a.rank - b.rank)
const pool = await listResumes()

console.log(`\nJD: ${title}  (${jdFile})`)
console.log(
  `model ${result.model} · pool ${pool.length} · scored ${result.candidateCount} · flagged/excluded ${result.mismatches.length}\n`,
)

let checked = 0
let grounded = 0
for (const item of ranked.slice(0, 5)) {
  const text = (await resumeText(item.resumeId)).toLowerCase()
  const matched = item.analysis.matchedRequirements ?? []
  const missing: string[] = []
  for (const skill of matched) {
    checked += 1
    // Credit is grounded when the skill, one of its aliases, or one of its
    // narrower skills (the ontology path that granted the credit) is in the text.
    const info = skillInfo(canonicalize(skill) ?? skill)
    const needles = [skill, ...(info?.aliases ?? []), ...(info?.descendants ?? [])]
      .map((n) => n.toLowerCase().trim())
      .filter((n) => n.length >= 2)
    // Short names (Go, S3, R) need word boundaries or they match inside other words.
    const hit = needles.some((n) =>
      n.length <= 4 ? new RegExp(`(^|[^a-z0-9+#.])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9+#.]|$)`, "i").test(text) : text.includes(n),
    )
    if (hit) grounded += 1
    else missing.push(skill)
  }
  const meta = summaries.get(item.resumeId)?.metadata
  const years = meta?.yearsOfExperience ?? "?"
  const role = meta?.roles?.[0] ?? meta?.seniority ?? "role not read"
  console.log(
    `#${item.rank} ${item.originalFilename.padEnd(34)} ${item.finalScore.toFixed(1).padStart(5)}  ` +
      `${String(matched.length).padStart(2)}/${String(matched.length + (item.analysis.missingRequirements ?? []).length).padStart(2)} required · ` +
      `${years} yrs · ${role}`,
  )
  if ((item.analysis.missingRequirements ?? []).length > 0) {
    console.log(`    missing: ${item.analysis.missingRequirements.slice(0, 6).join(", ")}`)
  }
  if ((item.analysis.mismatchReasons ?? []).length > 0) console.log(`    flags: ${item.analysis.mismatchReasons.join("; ")}`)
  // An ungrounded credit is not automatically wrong: the semantic layer may have
  // credited a broader requirement from a narrower candidate skill, so show the
  // path it used (e.g. "MLOps => Model Deployment", "ETL => Data Engineering).
  for (const skill of missing) {
    const match = (item.analysis.skillMatches ?? []).find((m) => m.requirement === skill)
    console.log(`    not literal in text: ${skill} — credited via ${match?.via ?? "?"} (${match?.evidence ?? "no evidence"})`)
  }
}
console.log(`\ngrounded credit: ${grounded}/${checked} credited skills trace to the resume text (name, alias or narrower skill)`)
console.log(`rank-1 margin over rank-2: ${(ranked[0].finalScore - ranked[1].finalScore).toFixed(1)} points`)
