// Performance benchmark: ingest, ranking, search and store operations.
// Usage: RESUMERANK_HOME=… npx tsx tools/bench.ts [--jev]
import { performance } from "node:perf_hooks"
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, stats, skillIndex, searchResumes, ensureStore } = await import("../src/store/local")
const { addResumeFromText } = await import("../src/resumes/service")
const { rankJob } = await import("../src/ranking/service")
const { analyzeJobDescription } = await import("../src/ranking/jd")

const withJev = process.argv.includes("--jev")
const time = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
  const start = performance.now()
  const value = await fn()
  const ms = performance.now() - start
  console.log(`  ${label.padEnd(44)} ${ms.toFixed(1).padStart(9)} ms`)
  return value
}

const summary = await stats()
const { execSync } = await import("node:child_process")
const homeSize = (() => {
  try {
    return Number(execSync(`du -sb ${JSON.stringify(summary.home)}`).toString().split("\t")[0])
  } catch {
    return 0
  }
})()
console.log(`\nstore: ${summary.resumes} resumes · ${summary.skills} skills · ${(summary.bytes / 1024).toFixed(1)} KB of index files · ${(homeSize / 1024 / 1024).toFixed(2)} MB on disk (originals included) · ${summary.textChars} chars\n`)

console.log("reads")
await time("listResumes()", () => listResumes())
await time("skillIndex()", () => skillIndex())
await time("searchResumes('python')", () => searchResumes("python", 20))
await time("stats()", () => stats())

console.log("\njd parsing (no network)")
const jd = `Senior Backend Engineer\n\nRequirements\n- 6+ years of experience\n- Strong Go or Python\n- PostgreSQL, Kubernetes, AWS, Kafka\n\nNice to have\n- Terraform, gRPC\n\nResponsibilities\n- Own services end to end\n- Mentor engineers\n`
await time("analyzeJobDescription()", () => analyzeJobDescription("Senior Backend Engineer", jd))

console.log("\nranking (deterministic only)")
const offline = { title: "Senior Backend Engineer", description: jd, offline: true, limit: 5 }
await time("rankJob() offline, cold", () => rankJob({ saveRanking: false, ...offline }))
for (const i of [1, 2, 3]) {
  const r = await time(`rankJob() offline, run ${i}`, () => rankJob({ saveRanking: false, ...offline }))
  if (i === 1) {
    console.log(`     → ${r.results.length} finalists, ${r.candidateCount} scored, ${r.excluded.length} excluded`)
  }
}

if (withJev) {
  console.log("\nranking (with TypeSafe Jev — network bound)")
  const r = await time("rankJob() with Jev", () => rankJob({ saveRanking: false, title: "Senior Backend Engineer", description: jd, offline: false, limit: 5 }))
  console.log(`     → model ${r.model}, ${r.usage.input_tokens ?? "?"} in / ${r.usage.output_tokens ?? "?"} out tokens`)
}

console.log("\ningest (offline extraction, per resume)")
await ensureStore()
const sample = `JANE DOE\njane@example.com | +1 415 555 0134 | Seattle, WA\n\nSUMMARY\nBackend engineer with 6 years of experience in Go and PostgreSQL.\n\nEXPERIENCE\nSenior Backend Engineer — Northwind Cloud\nJan 2019 – Present\n- Built a ledger service in Go and PostgreSQL handling 4k rps.\n- Ran the Kubernetes migration on AWS.\n\nSKILLS\nGo, PostgreSQL, Kubernetes, AWS, Kafka, Docker, Terraform\n\nEDUCATION\nB.S. Computer Science — University of Washington (2017)\n`
const n = 12
const start = performance.now()
const created: string[] = []
for (let i = 0; i < n; i += 1) {
  const record = await addResumeFromText(`bench-${i}.txt`, sample.replace("JANE DOE", `BENCH USER ${i}`), { jev: false })
  created.push(record.id)
}
const perResume = (performance.now() - start) / n
console.log(`  ${`addResumeFromText() offline ×${n}`.padEnd(44)} ${perResume.toFixed(1).padStart(9)} ms/resume`)

// Leave the store exactly as we found it.
const { removeResume } = await import("../src/store/local")
for (const id of created) await removeResume(id)
console.log(`  (removed the ${created.length} benchmark resumes again)`)

console.log("\nranking scaling (deterministic)")
const poolSize = (await listResumes()).length
await time(`rankJob() with ${poolSize} resumes in the store`, () => rankJob({ saveRanking: false, ...offline }))
console.log(`  ${"process RSS after a full rank".padEnd(44)} ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1).padStart(9)} MB`)
console.log(`  ${"heap used".padEnd(44)} ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1).padStart(9)} MB`)
