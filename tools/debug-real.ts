// Diagnose per-resume text layer and experience parsing against the raw lines.
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")

const needle = process.argv[2] ?? ""
const only = process.argv.slice(3)
const resumes = (await listResumes()).filter(
  (r) => r.originalFilename.includes(needle) && (only.length === 0 || only.some((o) => r.originalFilename.includes(o))),
)

for (const r of resumes) {
  const text = (await resumeText(r.id)) ?? ""
  console.log(`\n=== ${r.originalFilename} — ${text.length} chars, conf ${r.quality.extractionConfidence}`)
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  console.log(`first lines: ${lines.slice(0, 8).map((l) => JSON.stringify(l.slice(0, 70))).join(" | ")}`)
  const exp = r.structured.experience
  console.log(`parsed ${exp.length} role(s):`)
  for (const e of exp) {
    console.log(`   role=${JSON.stringify(e.role)} company=${JSON.stringify(e.company)} ${e.startDate}→${e.isCurrent ? "present" : e.endDate}`)
  }
  // What do the lines around the first parsed role look like in the source?
  if (exp.length) {
    const anchor = exp[0].role?.slice(0, 18)
    const idx = lines.findIndex((l) => anchor && l.toLowerCase().includes(anchor.toLowerCase()))
    if (idx >= 0) {
      console.log(`   source context around first role:`)
      for (let i = Math.max(0, idx - 2); i < Math.min(lines.length, idx + 5); i += 1) {
        console.log(`     [${i}] ${JSON.stringify(lines[i].slice(0, 90))}`)
      }
    } else {
      console.log(`   source context: role text not found verbatim in the text layer`)
    }
  }
}
