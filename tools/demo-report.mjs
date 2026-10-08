// Builds one Markdown report across every saved ranking (for demos/hand-offs).
// Usage: node tools/demo-report.mjs <out.md> [rankingId ...]
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const home = process.env.RESUMERANK_HOME ?? join(homedir(), ".resumerank")
const out = process.argv[2] ?? "reports/all-roles.md"
const ids = process.argv.slice(3)

const index = JSON.parse(readFileSync(join(home, "rankings.json"), "utf8"))
const wanted = ids.length > 0 ? index.rankings.filter((r) => ids.some((id) => r.id.startsWith(id))) : index.rankings
const rankings = wanted.sort((a, b) => a.jobTitle.localeCompare(b.jobTitle))

const lines = [
  "# resumerank — ranking demo",
  "",
  `${rankings.length} role${rankings.length === 1 ? "" : "s"} ranked over the local candidate pool.`,
  "`S&D` = deterministic + semantic score, `Jev` = typed fit score (P the candidate is a credible hire).",
  "",
]

for (const r of rankings) {
  const req = r.requirements ?? {}
  lines.push(`## ${r.jobTitle}`, "")
  lines.push(
    `- **Required:** ${(req.requiredSkills ?? []).join(", ") || "—"}`,
    `- **Preferred:** ${(req.preferredSkills ?? []).join(", ") || "—"}`,
    `- **Minimum experience:** ${req.minimumExperience ?? "not stated"} · **Domain:** ${(req.domain ?? []).join(", ") || "—"}`,
    `- **Model:** ${r.model} · **Candidates scored:** ${r.candidateCount} · ${r.createdAt}`,
    "",
    "| # | Score | S&D | Jev | Candidate | Matched required | Missing required |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  )
  for (const row of r.results) {
    lines.push(
      `| ${row.rank} | ${row.finalScore.toFixed(1)} | ${row.deterministicScore.toFixed(1)} | ${row.aiScore.toFixed(1)} | ${row.originalFilename} | ` +
        `${row.analysis.matchedRequirements.join(", ") || "—"} | ${row.analysis.missingRequirements.join(", ") || "—"} |`,
    )
  }
  if (r.results.length === 0) lines.push("| — | — | — | — | _no candidate cleared the gate_ | — | — |")
  lines.push("")
  if ((r.excluded ?? []).length > 0) {
    lines.push("<details><summary>Excluded as mismatches</summary>", "")
    for (const e of r.excluded) lines.push(`- **${e.originalFilename}** — ${e.reason}`)
    lines.push("", "</details>", "")
  }
  const top = r.results[0]
  if (top) {
    lines.push(`<details><summary>How the top candidate matched every requirement</summary>`, "")
    lines.push("| Requirement | Result | Score | How | Evidence |", "| --- | --- | --- | --- | --- |")
    const tag = { exact: "exact", alias: "alias", specific: "specific service", platform: "same platform", lexical: "lexical", jev: "Jev typed", none: "—" }
    for (const m of top.analysis.skillMatches ?? []) {
      lines.push(
        `| ${m.requirement} | ${m.matched ? "✅" : "❌"} | ${m.score.toFixed(2)} | ${tag[m.via] ?? m.via} | ${m.evidence || "—"} |`,
      )
    }
    lines.push("", "</details>", "")
  }
}

lines.push(
  "---",
  "",
  "Semantic matching rules: a candidate naming a *specific service* of a requirement scores 1.00 " +
    "(`S3 ⇒ AWS`, `EKS ⇒ Kubernetes`, `Terraform ⇒ Infrastructure as Code`); naming only the broader " +
    "*platform* scores 0.80 (`AWS` against an `S3` requirement); a prerequisite never counts " +
    "(`Python` does not satisfy `TensorFlow`).",
  "",
)

writeFileSync(out, `${lines.join("\n")}\n`)
console.log(`wrote ${out} (${rankings.length} rankings)`)
