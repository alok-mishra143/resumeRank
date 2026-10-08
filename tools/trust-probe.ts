// Trust probes: is the same input always ranked the same way, and how decisive is
// the top of the shortlist? Run: npx tsx tools/trust-probe.ts [--jev]
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const useJev = process.argv.includes("--jev")
const corpus = process.argv.find((a) => a.startsWith("--corpus="))?.split("=")[1] ?? "corpus"
const { rankJob } = await import("../src/ranking/service")

interface GoldJob {
  id: string
  title: string
  file: string
}
const gold = JSON.parse(await readFile(join(corpus, "gold.json"), "utf8")) as { jobs: Record<string, GoldJob> | GoldJob[] }
const jobs: GoldJob[] = Array.isArray(gold.jobs)
  ? gold.jobs
  : Object.entries(gold.jobs).map(([id, value]) => ({ ...value, id: value.id ?? id, file: value.file ?? `jobs/${id}.md` }))

const RUNS = 5
const signatureCounts = new Map<string, number>()
const gaps: Array<{ job: string; title: string; top1: string; top2: string; gap: number }> = []

for (const job of jobs) {
  const jd = await readFile(join(corpus, job.file), "utf8").catch(() => "")
  if (!jd) continue
  const signatures = new Set<string>()
  for (let run = 0; run < RUNS; run += 1) {
    const result = await rankJob({ saveRanking: false, title: job.title, description: jd, jev: useJev, offline: !useJev, limit: 10 })
    const ranked = result.results.filter((c) => c.rank > 0).sort((a, b) => a.rank - b.rank)
    signatures.add(ranked.map((c) => `${c.resumeId}:${c.rank}:${c.finalScore.toFixed(1)}`).join("|"))
    if (run === 0 && ranked.length >= 2) {
      gaps.push({
        job: job.id,
        title: job.title,
        top1: `${ranked[0].resumeId.slice(0, 14)} ${ranked[0].finalScore.toFixed(1)}`,
        top2: `${ranked[1].resumeId.slice(0, 14)} ${ranked[1].finalScore.toFixed(1)}`,
        gap: Number((ranked[0].finalScore - ranked[1].finalScore).toFixed(1)),
      })
    }
  }
  signatureCounts.set(job.id, signatures.size)
}

console.log(`\n=== stability over ${RUNS} identical runs (${useJev ? "with Jev" : "offline"}) ===`)
let reproducible = 0
for (const [job, distinct] of signatureCounts) {
  if (distinct === 1) reproducible += 1
  console.log(`  ${job.padEnd(4)} ${distinct === 1 ? "identical scores, order and ranks on every run" : `${distinct} distinct orderings`}`)
}
console.log(`  → ${reproducible}/${signatureCounts.size} jobs fully reproducible`)

console.log(`\n=== decision margin (#1 vs #2) ===`)
for (const g of [...gaps].sort((a, b) => a.gap - b.gap)) {
  const verdict = g.gap >= 8 ? "clear win" : g.gap >= 4 ? "moderate" : "close call — review both"
  console.log(`  ${g.job.padEnd(4)} ${g.title.slice(0, 32).padEnd(34)} ${g.top1.padEnd(20)} vs ${g.top2.padEnd(20)} gap ${String(g.gap).padStart(5)}  ${verdict}`)
}
