// Field-completeness audit: what did extraction actually produce per resume?
// Usage: RESUMERANK_HOME=… npx tsx tools/audit-extraction.ts [--json]
import { listResumes } from "../src/store/local"

const asJson = process.argv.includes("--json")
const resumes = await listResumes()

type Row = Record<string, string | number | boolean | null>
const rows: Row[] = []
let totals = { files: 0, name: 0, email: 0, phone: 0, location: 0, skills: 0, years: 0, roles: 0, edu: 0, summary: 0, certs: 0, seniority: 0, domain: 0 }

for (const r of resumes) {
  const s = r.structured ?? {}
  const contact = s.contact ?? {}
  const experience = s.experience ?? []
  const skills = r.metadata?.skills ?? []
  const warnings = r.quality?.warnings ?? []
  const has = (v: unknown) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "") && !(Array.isArray(v) && v.length === 0)

  totals.files += 1
  const flags = {
    name: has(s.fullName),
    email: has(contact.email),
    phone: has(contact.phone),
    location: has(contact.location),
    skills: skills.length > 0,
    years: has(r.metadata?.yearsOfExperience),
    roles: experience.length > 0,
    edu: has(s.education) || has(r.metadata?.education),
    summary: has(s.summary),
    certs: has(r.metadata?.certifications),
    seniority: has(r.metadata?.seniority),
    domain: has(r.metadata?.domain),
  }
  for (const [k, v] of Object.entries(flags)) if (v) (totals as Record<string, number>)[k] += 1

  // Experience timeline sanity: every role needs a title; the start date must
  // begin with a 4-digit year ("2019-01" is fine — that is a real precision).
  const missingTitle = experience.filter((e) => !has(e.role)).length
  const oddDates = experience.filter((e) => !/^(19|20)\d{2}/.test(String(e.startDate ?? ""))).length
  const noCompany = experience.filter((e) => !has(e.company)).length

  if (asJson) {
    rows.push({
      file: r.originalFilename,
      source: r.sourceFormat ?? "?",
      chars: r.textChars ?? 0,
      confidence: r.quality?.extractionConfidence ?? null,
      skills: skills.length,
      years: r.metadata?.yearsOfExperience ?? null,
      roles: experience.length,
      name: s.fullName ?? null,
      email: contact.email ?? null,
      missingTitle,
      oddDates,
      warnings: warnings.length,
      // `flags` uses has_* keys so it cannot shadow the numeric fields above.
      ...Object.fromEntries(Object.entries(flags).map(([k, v]) => [`has_${k}`, v])),
    })
  } else {
    const mark = (ok: boolean | number) => (ok ? "●" : "○")
    console.log(
      `${r.originalFilename.padEnd(34)} ${String(skills.length).padStart(2)} skills · ` +
        `${String(r.metadata?.yearsOfExperience ?? "?").padStart(2)} yrs · ${experience.length} role(s) · conf ${(
          r.quality?.extractionConfidence ?? 0
        ).toFixed(2)}\n` +
        `  name${mark(flags.name)} email${mark(flags.email)} phone${mark(flags.phone)} loc${mark(flags.location)} ` +
        `summary${mark(flags.summary)} edu${mark(flags.edu)} certs${mark(flags.certs)} seniority${mark(flags.seniority)} ` +
        `${missingTitle ? ` · ${missingTitle} role(s) with no title` : ""}` +
        `${noCompany ? ` · ${noCompany} role(s) with no company` : ""}` +
        `${oddDates ? ` · ${oddDates} role(s) with no parseable start year` : ""}${warnings.length ? ` · ${warnings.length} warning(s)` : ""}`,
    )
    if (warnings.length) console.log(`    warnings: ${warnings.slice(0, 3).join(" | ")}`)
    console.log(`    name="${s.fullName ?? ""}" · skills: ${skills.slice(0, 8).join(", ")}${skills.length > 8 ? ", …" : ""}`)
  }
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 1))
} else {
  const pct = (n: number) => `${Math.round((n / Math.max(1, totals.files)) * 100)}%`
  console.log(`\n${totals.files} resumes — field coverage`)
  console.log(
    `  name ${pct(totals.name)} · email ${pct(totals.email)} · phone ${pct(totals.phone)} · location ${pct(totals.location)} · ` +
      `skills ${pct(totals.skills)} · years ${pct(totals.years)} · experience ${pct(totals.roles)} · education ${pct(totals.edu)} · ` +
      `summary ${pct(totals.summary)} · certs ${pct(totals.certs)} · seniority ${pct(totals.seniority)} · domain ${pct(totals.domain)}`,
  )
}
