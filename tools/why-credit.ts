// Why was a required skill credited? Prints requirement -> matched skill -> how
// it was matched -> the evidence line, for one resume in the store.
//
//   npx tsx tools/why-credit.ts "yangr0-resume.pdf" corpus-real/jd-ml.md
import { readFile } from "node:fs/promises"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const [, , filenameArg, jdArg] = process.argv
const filename = filenameArg ?? ""
const jdFile = jdArg ?? "corpus-real/jd-ml.md"
const jd = await readFile(jdFile, "utf8")
const title = (jd.split("\n").find((l) => l.trim()) ?? "Role").trim()

const { rankJob } = await import("../src/ranking/service")
const { listResumes } = await import("../src/store/local")

const summaries = await listResumes()
const target = summaries.find((r) => r.originalFilename === filename)
if (!target) {
  console.log(`no resume named ${filename} in this store: ${summaries.map((r) => r.originalFilename).join(", ")}`)
  process.exit(1)
}

const wants: string[] = process.argv.slice(4)
const result = await rankJob({ title, description: jd, jev: true, limit: 20 })
const item = result.results.find((r) => r.resumeId === target.id)
if (!item) {
  console.log(`${filename} was not scored for ${title} (excluded or gated out)`)
  process.exit(0)
}

console.log(`\n${filename} → ${title}  (score ${item.finalScore.toFixed(1)}, rank ${item.rank})`)
console.log(`candidate skills: ${(target.metadata.skills ?? []).join(", ")}\n`)
for (const match of item.analysis.skillMatches ?? []) {
  if (wants.length > 0 && !wants.includes(match.requirement)) continue
  const mark = match.matched ? "✓" : "·"
  console.log(
    `${mark} ${match.requirement.padEnd(22)} via ${match.via.padEnd(9)} score ${match.score.toFixed(2).padStart(5)}  ` +
      `${match.canonical ? `→ ${match.canonical}` : ""}`,
  )
  if (match.evidence) console.log(`    evidence: ${match.evidence.slice(0, 120).replace(/\s+/g, " ")}`)
}
