import { config as loadDotenv } from "dotenv"
loadDotenv({ quiet: true })
const { listResumes, removeResume, stats } = await import("/home/alok/Desktop/resumerank/src/store/local")
let removed = 0
for (const r of await listResumes()) {
  if (/^bench-\d+\.txt$/.test(r.originalFilename)) { await removeResume(r.id); removed += 1 }
}
const s = await stats()
console.log(`removed ${removed} bench resumes → ${s.resumes} resumes left`)
