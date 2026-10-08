// Rank one pool against the same role at four seniority levels (offline, deterministic).
import { config as loadDotenv } from "dotenv"
loadDotenv({ quiet: true })
const { rankJob } = await import("../src/ranking/service")
const { readFileSync } = await import("node:fs")

const files = ["b-junior.md", "b-mid.md", "b-senior.md", "b-staff.md"]
for (const f of files) {
  const description = readFileSync(`corpus/levels/${f}`, "utf8")
  const title = description.split("\n")[0].trim()
  const r = await rankJob({ title, description, offline: true, limit: 5, includeMismatches: false })
  console.log(`\n### ${title} — min ${r.requirements.minimumExperience ?? "-"} yrs`)
  for (const item of r.results) {
    const j = item.judgement
    console.log(
      `  ${String(item.rank).padStart(2)}  ${item.finalScore.toFixed(1).padStart(5)}  ${String(j?.resume.yearsOfExperience ?? "?").padStart(2)}y  ` +
        `${String(j?.resume.seniority ?? "?").padEnd(7)} ${item.originalFilename.replace(".txt", "").padEnd(30)} cov ${j?.bar.requiredHits}/${j?.bar.requiredCount}`,
    )
  }
  console.log(`  excluded: ${r.excluded.length}`)
  for (const e of r.excluded.slice(0, 14)) console.log(`     - ${e.originalFilename.replace(".txt","").padEnd(30)} ${e.reason}`)
}
