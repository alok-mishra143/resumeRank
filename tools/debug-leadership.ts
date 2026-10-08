// How much leadership/scope evidence does each resume carry?
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")
const { candidateLevel } = await import("../src/ranking/scoring")

const SIGNALS =
  /\b(led|leading|lead|mentor(?:ed|ing)?|managed|coach(?:ed)?|hired|hiring|interview(?:ed|ing)?|architect(?:ed|ure)?|owned|drove|established|scaled|roadmap|team of \d+|grew the team|tech lead|technical lead|principal|staff engineer|head of)\b/gi

for (const r of (await listResumes()).slice(0, 14)) {
  const text = await resumeText(r.id)
  const hits = text.match(SIGNALS) ?? []
  const counts = hits.reduce<Record<string, number>>((acc, h) => ((acc[h.toLowerCase()] = (acc[h.toLowerCase()] ?? 0) + 1), acc), {})
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k}×${v}`)
    .join(" ")
  console.log(`${r.originalFilename.replace(".txt", "").padEnd(30)} band=${String(candidateLevel(r.metadata)).padEnd(7)} signals=${String(hits.length).padStart(2)}  ${top}`)
}
