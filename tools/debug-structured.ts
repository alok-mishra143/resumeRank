// Raw dump of one resume's structured record (education/contact/certifications).
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes } = await import("../src/store/local")

const needle = process.argv[2] ?? ""
const r = (await listResumes()).find((x) => x.originalFilename.includes(needle))
if (!r) {
  console.log("no resume matching", needle)
  process.exit(1)
}
console.log(JSON.stringify({ file: r.originalFilename, structured: r.structured, metadata: r.metadata, quality: r.quality }, null, 1))
