// Inspect the Jev depth values stored in the skill provenance of the corpus.
import { listResumes } from "../src/store/local"

const resumes = await listResumes()
const all: number[] = []
for (const r of resumes.slice(0, 4)) {
  const provenance = (r as unknown as { extraction?: { provenance?: Record<string, string> } }).extraction?.provenance ?? {}
  const depths = Object.values(provenance)
    .map((v) => Number(String(v).match(/depth=([\d.]+)/)?.[1] ?? 0))
    .filter((n) => n > 0)
  all.push(...depths)
  console.log(`${r.originalFilename.padEnd(32)} ${depths.length} depths: ${depths.slice(0, 10).join(" ")}`)
}
if (all.length) {
  const sorted = [...all].sort((a, b) => a - b)
  console.log(
    `\nrange ${sorted[0]}..${sorted[sorted.length - 1]} · median ${sorted[Math.floor(sorted.length / 2)]} · mean ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(2)}`,
  )
}
