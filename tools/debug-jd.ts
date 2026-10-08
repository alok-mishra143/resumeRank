// Why does the JD parser miss a skill? Raw mention dump per line.
import { readFileSync } from "node:fs"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { analyzeJobDescription } = await import("../src/ranking/jd")
const { proposeSkillMentions } = await import("../src/extract/deterministic")
const { indexText } = await import("../src/extract/deterministic")

const file = process.argv[2] ?? "corpus-real/jd-backend.md"
const text = readFileSync(file, "utf8")
const title = process.argv[3] ?? "Senior Backend Engineer"

const req = analyzeJobDescription(title, text)
console.log("parsed:", JSON.stringify(req.requiredSkills), "| preferred:", JSON.stringify(req.preferredSkills))

const idx = indexText(text)
const mentions = proposeSkillMentions(idx, { includeAbstract: true })
console.log(`\n${mentions.length} raw mentions:`)
for (const m of mentions) console.log(`  ${m.canonical.padEnd(22)} alias=${JSON.stringify(m.alias).padEnd(20)} conf=${m.confidence.toFixed(2)}`)
console.log("\nlines:")
idx.lines.forEach((l, i) => console.log(`  [${i}] ${JSON.stringify(l)}`))
