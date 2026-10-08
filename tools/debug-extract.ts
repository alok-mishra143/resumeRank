// Debug helper: run the extraction pipeline on one file and print the verdicts.
import { readFile } from "node:fs/promises"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })

const { extractProfile } = await import("../src/extract/service")

const file = process.argv[2]!
const jev = !process.argv.includes("--offline")
const text = await readFile(file, "utf8")
const profile = await extractProfile(text, { jev })

console.log(`file: ${file}  jev=${jev}`)
console.log(`skills (${profile.metadata.skills?.length ?? 0}):`, (profile.metadata.skills ?? []).join(", "))
console.log(`roles:`, profile.metadata.roles?.join(", "))
console.log(`years:`, profile.metadata.yearsOfExperience, " seniority:", profile.metadata.seniority, " domain:", profile.metadata.domain)
console.log(`warnings:`, profile.quality.warnings.join(" | ") || "-")
console.log("provenance:")
for (const [skill, why] of Object.entries(profile.provenance)) {
  console.log(`  ${why.startsWith("rejected") ? "x" : "v"} ${skill.padEnd(24)} ${why}`)
}
console.log("mentions (offline view, top 30):")
for (const m of profile.mentions.slice(0, 30)) {
  console.log(`  ${m.confidence.toFixed(2)}  ${m.canonical.padEnd(22)} alias=${m.alias.padEnd(16)} ${m.context}@${m.section}`)
}
void config
