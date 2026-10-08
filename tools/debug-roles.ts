// Why does this resume yield fewer roles than it has date ranges?
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")
const { parseExperience } = await import("../src/extract/deterministic")
const { experienceSectionText, splitSections } = await import("../src/extract/text")

const needle = process.argv[2] ?? ""
const r = (await listResumes()).find((x) => x.originalFilename.includes(needle))
if (!r) {
  console.log("no match", needle)
  process.exit(1)
}
const text = await resumeText(r.id)
const section = experienceSectionText(text) ?? ""
console.log(`${r.originalFilename}: section ${section.length} chars`)
const DATE = /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s+\d{4}\s*[-–—]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s+\d{4}|present|current)|\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current))/gi
const ranges = section.match(DATE) ?? []
console.log(`date ranges found in the section: ${ranges.length} → ${JSON.stringify(ranges)}`)
console.log(`parseExperience → ${parseExperience(text).length} entries`)
console.log(`parseExperience(section only) → ${parseExperience(section).length} entries`)
for (const s of splitSections(text)) console.log(`  section ${s.key}: ${s.body.trim().split("\n").length} lines`)
