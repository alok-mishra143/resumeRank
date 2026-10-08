// Compare the parsed experience timeline with the resume's own years claim.
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes } = await import("../src/store/local")

const only = process.argv[2]
const resumes = (await listResumes()).filter((r) => !only || r.originalFilename.includes(only))
const dir = "corpus/resumes"

for (const r of resumes) {
  const s = r.structured
  console.log(`\n${r.originalFilename}  claim=${r.metadata.yearsOfExperience} yrs  conf=${r.quality.extractionConfidence}`)
  for (const e of s.experience) {
    console.log(`   ${String(e.role || "(no role)").padEnd(28)} @ ${String(e.company || "(no company)").padEnd(24)} ${e.startDate} → ${e.isCurrent ? "present" : e.endDate}  ${e.bullets.length} bullets`)
  }
  console.log(`   education: ${s.education.map((e) => `${e.degree} ${e.field} ${e.startYear}-${e.endYear}`).join(" | ") || "—"}`)
  console.log(`   warnings: ${(r.quality.warnings || []).join(" | ") || "—"}`)

  // Independent recomputation of the dated span, straight from the file.
  const text = await readFile(join(dir, r.originalFilename), "utf8")
  const spans: Array<[number, number]> = []
  for (const m of text.matchAll(/(\b(?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2}|[Pp]resent|[Cc]urrent)/g)) {
    spans.push([Number(m[1]), m[2].length === 4 ? Number(m[2]) : new Date().getFullYear()])
  }
  if (spans.length) {
    const lo = Math.min(...spans.map((s) => s[0]))
    const hi = Math.max(...spans.map((s) => s[1]))
    console.log(`   file-level year ranges: ${spans.map(([a, b]) => `${a}-${b}`).join(", ")} → widest span ${hi - lo} yrs`)
  }
  const claimed = r.metadata.yearsOfExperience
  const parsedSpan = s.experience.reduce((sum, e) => {
    const a = Number(String(e.startDate).slice(0, 4))
    const b = e.isCurrent ? new Date().getFullYear() : Number(String(e.endDate).slice(0, 4))
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? sum + (b - a) : sum
  }, 0)
  console.log(`   parsed-role sum = ${parsedSpan} yrs (claim ${claimed})`)
}
