// Show the parsed experience section body and the company/date lines for a resume.
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")
const { splitSections } = await import("../src/extract/text")

const needle = process.argv[2] ?? ""
const r = (await listResumes()).find((x) => x.originalFilename.includes(needle))
if (!r) {
  console.log("no match", needle)
  process.exit(1)
}
const text = await resumeText(r.id)
const sections = splitSections(text)
console.log(`sections: ${sections.map((s) => `${s.key}(${s.body.trim().split("\n").length}L)`).join(", ")}`)
const exp = sections.find((s) => s.key === "experience")
if (exp) {
  console.log(`\n--- experience section (first 30 lines) ---`)
  for (const [i, line] of exp.body.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30).entries()) {
    console.log(`[${i}] ${JSON.stringify(line.slice(0, 100))}`)
  }
} else {
  console.log("\nno experience section detected — first 30 non-empty lines of the whole document:")
  for (const [i, line] of text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30).entries()) {
    console.log(`[${i}] ${JSON.stringify(line.slice(0, 100))}`)
  }
}
console.log(`\nparsed roles: ${JSON.stringify(r.structured.experience, null, 1).slice(0, 900)}`)
