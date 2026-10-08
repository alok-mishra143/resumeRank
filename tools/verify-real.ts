// Ground-truth verification on real resumes: every extracted value is checked
// against the source text. A field that is not supported by the text is a
// hallucination, which is the failure mode that matters in recruiting.
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")

interface Check {
  field: string
  ok: boolean
  detail?: string
}

const rows: Array<{ file: string; checks: Check[]; supported: number; total: number }> = []

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 1))

for (const r of await listResumes()) {
  const text = await resumeText(r.id)
  const haystack = norm(text)
  const firstLines = norm(text.split("\n").slice(0, 12).join(" "))
  const checks: Check[] = []
  const s = r.structured ?? {}
  const contact = s.contact ?? {}

  const inText = (value: string, hay = haystack) => value.length > 2 && hay.includes(norm(value))

  // Contact fields must appear verbatim in the document.
  if (contact.email) checks.push({ field: "email", ok: inText(contact.email), detail: contact.email })
  if (contact.phone) {
    const digits = String(contact.phone).replace(/\D/g, "")
    const textDigits = text.replace(/\D/g, "")
    checks.push({ field: "phone", ok: digits.length >= 7 && textDigits.includes(digits), detail: contact.phone })
  }
  if (s.fullName) {
    const parts = [...tokens(s.fullName)]
    const hits = parts.filter((t) => firstLines.includes(t))
    checks.push({ field: "name", ok: hits.length >= Math.min(2, parts.length), detail: `${s.fullName} (${hits.length}/${parts.length} tokens in header)` })
  }
  if (contact.location) {
    const first = String(contact.location).split(",")[0]
    checks.push({ field: "location", ok: inText(first, firstLines) || inText(String(contact.location)), detail: contact.location })
  }

  // Skills must be mentioned in the resume (via the alias that matched).
  const skills = r.metadata?.skills ?? []
  if (skills.length) {
    const unsupported: string[] = []
    // Short names (Go, S3, R, C#) carry no length to match on: test them as whole
    // words against the raw text, case-sensitively, instead of as substrings.
    const rawFlat = text.replace(/\s+/g, " ")
    const isShort = (alias: string) => norm(alias).replace(/ /g, "").length <= 2
    const shortHit = (alias: string) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      return new RegExp(`(^|[^\\p{L}\\p{N}#+])${escaped}([^\\p{L}\\p{N}+]|$)`, "u").test(rawFlat)
    }
    for (const skill of skills) {
      const { skillInfo } = await import("../src/extract/ontology")
      const aliases = [skill, ...(skillInfo(skill)?.aliases ?? [])]
      const found = aliases.some((alias) =>
        isShort(alias) ? shortHit(alias) : alias.length > 2 && haystack.includes(norm(alias)),
      )
      if (!found) unsupported.push(skill)
    }
    checks.push({
      field: "skills supported",
      ok: unsupported.length === 0,
      detail: unsupported.length ? `${unsupported.length}/${skills.length} unsupported: ${unsupported.slice(0, 4).join(", ")}` : `${skills.length} skills, all traceable`,
    })
  }

  // Experience years must lie inside the range of years the document mentions.
  const years = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]))
  if (r.metadata?.yearsOfExperience != null && years.length) {
    const span = Math.max(...years) - Math.min(...years)
    const claimed = r.metadata.yearsOfExperience
    checks.push({ field: "years plausible", ok: claimed <= span + 2, detail: `${claimed} yrs vs a ${span}-year document span` })
  }

  // Every parsed role must have a real title and a start year present in the file.
  const roles = s.experience ?? []
  if (roles.length) {
    const badTitles = roles.filter((e) => !e.role || e.role.length < 3 || tokens(e.role).size === 0).length
    const badDates = roles.filter((e) => !/\d{4}/.test(String(e.startDate ?? "")) || !years.includes(Number(String(e.startDate).slice(0, 4)))).length
    checks.push({ field: "role titles", ok: badTitles === 0, detail: `${roles.length - badTitles}/${roles.length} have a title` })
    checks.push({ field: "role start years", ok: badDates === 0, detail: `${roles.length - badDates}/${roles.length} start years traced to the document` })
  }

  rows.push({ file: r.originalFilename, checks, supported: checks.filter((c) => c.ok).length, total: checks.length })
}

const all = rows.flatMap((r) => r.checks)
const byField = new Map<string, { ok: number; total: number }>()
for (const c of all) {
  const entry = byField.get(c.field) ?? { ok: 0, total: 0 }
  entry.total += 1
  if (c.ok) entry.ok += 1
  byField.set(c.field, entry)
}

console.log(`${rows.length} resumes, ${all.length} grounded checks\n`)
for (const [field, { ok, total }] of [...byField].sort()) {
  const pct = ((ok / total) * 100).toFixed(1)
  console.log(`  ${field.padEnd(18)} ${String(ok).padStart(3)}/${String(total).padEnd(3)} ${pct.padStart(6)}%`)
}
console.log(`\nOVERALL grounded ${all.filter((c) => c.ok).length}/${all.length} = ${((all.filter((c) => c.ok).length / all.length) * 100).toFixed(1)}%`)
const failing = all.filter((c) => !c.ok)
if (failing.length) {
  console.log("\nunsupported values (audit list):")
  for (const c of failing) console.log(`  - ${c.field}: ${c.detail}`)
}
