// For skills the checker could not trace, show the context in the source text.
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")
const { skillInfo } = await import("../src/extract/ontology")

const targets = process.argv.slice(2)
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

for (const r of await listResumes()) {
  const text = await resumeText(r.id)
  const hay = norm(text)
  const missing: string[] = []
  for (const skill of r.metadata?.skills ?? []) {
    const aliases = [skill, ...(skillInfo(skill)?.aliases ?? [])]
    if (!aliases.some((a) => a.length > 2 && hay.includes(norm(a)))) missing.push(skill)
  }
  if (!missing.length) continue
  if (targets.length && !targets.some((t) => r.originalFilename.includes(t))) continue
  console.log(`\n${r.originalFilename}: ${missing.join(", ")}`)
  for (const skill of missing) {
    // Find any word in the text that looks related to the skill.
    const stem = norm(skill).split(" ")[0].slice(0, 3)
    const hits = [...text.matchAll(new RegExp(`[^\\n]{0,40}${stem}[^\\n]{0,40}`, "gi"))].slice(0, 3)
    console.log(`   ${skill}: ${hits.length ? hits.map((h) => JSON.stringify(h[0].trim())).join(" | ") : "no close match in the text"}`)
    console.log(`     aliases in ontology: ${(skillInfo(skill)?.aliases ?? []).join(", ") || "(none)"}`)
  }
}
