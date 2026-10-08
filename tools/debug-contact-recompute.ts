// Recompute contact fields from the stored text (no re-ingest needed).
import { config as loadDotenv } from "dotenv"
loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")
const { proposeContact } = await import("../src/extract/deterministic")
for (const r of await listResumes()) {
  const text = await resumeText(r.id)
  const c = proposeContact(text)
  console.log(`${r.originalFilename.padEnd(32)} name=${JSON.stringify(c.fullName).padEnd(24)} loc=${JSON.stringify(c.location)}`)
}
