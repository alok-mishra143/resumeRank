// For resumes where no location was extracted, is one actually present in the text?
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")

const CITYLIKE =
  /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*(?:[A-Z]{2}|[A-Z][a-z]+)\b|\b(?:bangalore|bengaluru|mumbai|london|berlin|paris|amsterdam|dublin|new york|san francisco|seattle|austin|boston|toronto|singapore|dubai|sydney|tokyo|munich|zurich|barcelona|madrid|lisbon|warsaw|prague|stockholm|remote)\b/i

for (const r of await listResumes()) {
  const hasLocation = Boolean(r.structured?.contact?.location)
  const text = await resumeText(r.id)
  if (hasLocation) {
    console.log(`✓ ${r.originalFilename.padEnd(32)} → ${r.structured.contact.location}`)
    continue
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12)
  const hits = lines.filter((l) => CITYLIKE.test(l))
  console.log(`✗ ${r.originalFilename.padEnd(32)} no location; city-like lines in the header: ${hits.length ? JSON.stringify(hits.slice(0, 3).map((l) => l.slice(0, 80))) : "NONE"}`)
}
