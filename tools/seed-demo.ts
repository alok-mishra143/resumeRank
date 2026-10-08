// Re-ingest the whole test corpus into the current store (RESUMERANK_HOME).
// Usage: RESUMERANK_HOME=/tmp/rr-demo npx tsx tools/seed-demo.ts [corpusDir] [--offline]
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })

const { listResumes, removeResume, listRankings, removeRanking, stats, ensureStore } = await import("../src/store/local")
const { addResumeFile } = await import("../src/resumes/service")

await ensureStore()

const corpus = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "corpus"
const offline = process.argv.includes("--offline")

for (const resume of await listResumes()) await removeResume(resume.id)
for (const ranking of await listRankings(1000)) await removeRanking(ranking.id)
console.log("store cleared")

const files = (await readdir(join(corpus, "resumes"))).filter((f) => f.endsWith(".txt")).sort()
for (const file of files) {
  const record = await addResumeFile(join(corpus, "resumes", file), { jev: !offline })
  console.log(
    `${record.originalFilename.padEnd(32)} ${String(record.metadata.skills?.length ?? 0).padStart(2)} skills · ` +
      `${record.metadata.yearsOfExperience ?? "?"} yrs · name="${record.structured.fullName}" · ` +
      `${record.structured.experience.length} roles · conf ${record.quality.extractionConfidence}`,
  )
}
const summary = await stats()
console.log(`\n${summary.resumes} resumes, ${summary.skills} skills indexed, ${summary.textChars} chars`)
