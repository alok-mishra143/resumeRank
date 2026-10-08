// Header lines of resumes with no location: is a real location being missed?
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")
const targets = process.argv.slice(2)
for (const r of await listResumes()) {
  if (targets.length && !targets.some((t) => r.originalFilename.includes(t))) continue
  const text = await resumeText(r.id)
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, "").trim()).filter(Boolean).slice(0, 7)
  console.log(`\n${r.originalFilename} — extracted location: ${JSON.stringify(r.structured?.contact?.location ?? "")}`)
  lines.forEach((l, i) => console.log(`  [${i}] ${JSON.stringify(l.slice(0, 88))}`))
}
