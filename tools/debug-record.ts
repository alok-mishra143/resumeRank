// Debug helper: dump one stored resume's structured fields.
import { getResume } from "../src/store/local"

const id = process.argv[2]!
const r = await getResume(id)
if (!r) {
  console.log("not found:", id)
  process.exit(1)
}
console.log("file:      ", r.originalFilename)
console.log("fullName:  ", JSON.stringify(r.structured.fullName))
console.log("headline:  ", JSON.stringify(r.structured.headline))
console.log("contact:   ", JSON.stringify(r.structured.contact))
console.log("education: ", JSON.stringify(r.metadata.education))
console.log("roles:     ", JSON.stringify(r.metadata.roles))
console.log("experience:", r.structured.experience.length, "entries")
for (const e of r.structured.experience) {
  console.log(`   ${e.role || "?"} @ ${e.company || "?"} ${e.startDate} -> ${e.endDate || (e.isCurrent ? "now" : "?")} (${e.bullets.length} bullets)`)
}
console.log("--- first 600 chars of text ---")
console.log(r.extractedText.slice(0, 600))
