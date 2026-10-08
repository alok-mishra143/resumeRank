// Debug helper: dump skill mentions (with sections/context) for one resume.
import { readFile } from "node:fs/promises"
import { indexText, proposeSkillMentions } from "../src/extract/deterministic"

const file = process.argv[2] ?? "corpus/resumes/fullstack-engineer.txt"
const text = await readFile(file, "utf8")
const raw = proposeSkillMentions(indexText(text), { keepNested: true })
const mentions = proposeSkillMentions(indexText(text))
const kept = new Set(mentions.map((m) => m.canonical + '@' + m.alias))
console.log('--- suppressed by nesting ---')
for (const m of raw) {
  if (!kept.has(m.canonical + '@' + m.alias)) {
    const cover = raw.find((o) => o !== m && o.canonical !== m.canonical && new RegExp(o.alias, 'i').test(m.alias))
    console.log(`  ${m.canonical} (alias ${m.alias}) covered by ${cover?.canonical} (alias ${cover?.alias})`)
  }
}
console.log('--- kept ---')
for (const m of mentions) {
  console.log(
    `${m.confidence.toFixed(2)}  ${m.canonical.padEnd(24)} alias=${m.alias.padEnd(18)} ${m.context.padEnd(8)} @${m.section.padEnd(10)} :: ${m.evidence.slice(0, 80)}`,
  )
}
console.log("\n--- js-related lines ---")
for (const line of text.split("\n")) {
  if (/javascript|\bJS\b|typescript|\bTS\b/i.test(line)) console.log(`  ${line.trim().slice(0, 120)}`)
}
