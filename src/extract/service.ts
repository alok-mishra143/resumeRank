import { config } from "../config"
import type { ResumeMetadata, ResumeStructured } from "../types"
import { choice, noul, pTrue, isChoiceAnswer, isScoreAnswer, score, systemOneSafe } from "../ai/jev"
import type { Answer, Question } from "../ai/jev"
import { canonicalize, skillInfo } from "./ontology"
import {
  indexText,
  parseExperience,
  proposeCertifications,
  proposeContact,
  proposeDegrees,
  proposeDomain,
  proposeEducationEntries,
  proposeLanguages,
  proposeProjects,
  proposeRoles,
  proposeSeniority,
  proposeSkillMentions,
  proposeYearsExplicit,
  proposeYearsFromRanges,
  parseEducationEntry,
  type SkillMention,
  type TextIndex,
} from "./deterministic"

/**
 * Education entries arrive as free text ("Bachelor's, Imperial College London
 * (2016)"). Parse each one into degree / field / school / years and drop
 * duplicates, so the profile can show separate, correct columns.
 */
function dedupeEducation(entries: string[]) {
  const out: ReturnType<typeof parseEducationEntry>[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const parsed = parseEducationEntry(entry)
    const key = `${parsed.degree}|${parsed.school}|${parsed.startYear}`.toLowerCase().replace(/\s+/g, " ")
    if (seen.has(key)) continue
    // Drop an entry that is fully contained in another one we already kept.
    const contained = out.some(
      (e) =>
        e.degree.toLowerCase() === parsed.degree.toLowerCase() &&
        (e.field === parsed.field || parsed.field === "") &&
        (e.school === parsed.school || parsed.school === ""),
    )
    if (contained) continue
    seen.add(key)
    out.push(parsed)
  }
  return out.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Extraction pipeline:
//   text -> deterministic proposals (dictionary + regex + context classifier)
//        -> Typed Jev batteries (noul / score / choice) confirming each field
//        -> flat ResumeMetadata + rich ResumeStructured + provenance
//
// The deterministic pass is the recall engine and works offline. Jev is the
// precision engine: every field it keeps is backed by a *typed* answer
// (P(true) for presence, a rubric score for depth), never by generated prose.
// ---------------------------------------------------------------------------

const SOURCE_MAX_CHARS = 12_000
const MAX_SKILL_QUESTIONS = 45
const MAX_ROLE_QUESTIONS = 10
const MAX_EDU_QUESTIONS = 6
const MAX_CERT_QUESTIONS = 12

export const SKILL_LEVELS = [
  "no evidence the candidate used it",
  "only mentioned in passing, on someone else's behalf, or as something they would like to use",
  "claimed as the candidate's own skill (listed among their skills) or used in coursework or a personal project",
  "used professionally, hands-on, on real work",
  "deep expertise: led, architected, or mentored with it",
]

const SENIORITY_OPTIONS = {
  junior: "0-2 years, entry-level roles, internships",
  mid: "2-5 years, independent contributor",
  senior: "5+ years, leads projects or mentors",
  staff: "8+ years, staff/principal scope, org-level impact",
}

const DOMAIN_OPTIONS = {
  frontend: "UI, React/Vue/Angular, web client work",
  backend: "APIs, services, databases, server-side",
  fullstack: "both frontend and backend",
  data: "data engineering, analytics, BI, ETL",
  ml: "machine learning, AI, model training",
  mobile: "iOS, Android, mobile apps",
  devops: "infrastructure, CI/CD, SRE, cloud platform",
  other: "none of the above (e.g. design, support, marketing, sales)",
}

export interface ExtractionResult {
  metadata: ResumeMetadata
  structured: ResumeStructured
  provenance: Record<string, string>
  canonicalSkills: string[]
  verification?: {
    model: string
    scores: Record<string, number>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  quality: { extractionConfidence: number; warnings: string[] }
  mentions: SkillMention[]
}

interface Proposals {
  idx: TextIndex
  mentions: SkillMention[]
  roles: string[]
  education: string[]
  certifications: string[]
  projects: string[]
  languages: string[]
  yearsFromRanges: number | null
  yearsExplicit: number | null
  contact: ReturnType<typeof proposeContact>
  experience: ReturnType<typeof parseExperience>
  degrees: string[]
}

function proposeAll(text: string): Proposals {
  const idx = indexText(text)
  return {
    idx,
    mentions: proposeSkillMentions(idx),
    roles: proposeRoles(text),
    education: proposeEducationEntries(text),
    certifications: proposeCertifications(text),
    projects: proposeProjects(text),
    languages: proposeLanguages(text),
    yearsFromRanges: proposeYearsFromRanges(text),
    yearsExplicit: proposeYearsExplicit(text),
    contact: proposeContact(text),
    experience: parseExperience(text),
    degrees: proposeDegrees(text),
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item.trim())
  }
  return out
}

// ---------------------------------------------------------------------------
// Tier 1: skill presence + depth (typed per candidate skill)
// ---------------------------------------------------------------------------

interface SkillVerdicts {
  kept: string[]
  /** skill -> provenance string */
  provenance: Record<string, string>
  scores: Record<string, number>
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

function offlineSkillVerdicts(mentions: SkillMention[]): SkillVerdicts {
  const kept: string[] = []
  const provenance: Record<string, string> = {}
  const scores: Record<string, number> = {}
  for (const mention of mentions) {
    if (mention.confidence < config.extract.offlineKeep) continue
    kept.push(mention.canonical)
    provenance[mention.canonical] = `offline:${mention.context}@${mention.section} (${mention.confidence.toFixed(2)})`
    scores[mention.canonical] = Math.round(mention.confidence * 100) / 100
  }
  return { kept, provenance, scores }
}

async function jevSkillVerdicts(text: string, proposals: Proposals): Promise<SkillVerdicts> {
  const fallback = offlineSkillVerdicts(proposals.mentions)
  const candidates = proposals.mentions
    .filter((m) => m.confidence >= config.extract.proposeFloor)
    .slice(0, MAX_SKILL_QUESTIONS)
  if (candidates.length === 0) return fallback

  const questions: Record<string, Question> = {}
  candidates.forEach((mention, i) => {
    // Tell the judge where and how the skill surfaced — that context is computed
    // locally and is exactly what a human reviewer would look at.
    const where =
      mention.section === "skills"
        ? " It appears in the candidate's skills / technology list."
        : mention.section === "experience"
          ? " It appears in a work-experience entry."
          : mention.section === "projects"
            ? " It appears in a project description."
            : mention.section === "certifications"
              ? " It appears in the certifications section."
              : ""
    const aliasNote =
      mention.alias.toLowerCase() === mention.canonical.toLowerCase()
        ? ""
        : ` (written as "${mention.alias}")`
    const evidence = mention.evidence ? ` Nearby text: "${mention.evidence}".` : ""

    questions[`skill_present__${i}`] = noul(
      `Is "${mention.canonical}"${aliasNote} one of the candidate's own skills in ` +
        "`resume_text`" +
        ` — listed among their skills, or shown in work they did — as opposed to someone else's stack, a pasted job description, an aspiration, or unrelated text?${where}${evidence}`,
      {
        true: "it is the candidate's own skill or tool",
        false: "it belongs to someone else, to a job ad, or is only an aspiration",
      },
    )
    questions[`skill_depth__${i}`] = score(
      `How strong is the evidence that the candidate of ` +
        "`resume_text`" +
        ` has used "${mention.canonical}"${aliasNote}?${where}${evidence}`,
      SKILL_LEVELS,
    )
  })

  const res = await systemOneSafe({ resume_text: text.slice(0, SOURCE_MAX_CHARS) }, questions)
  if (!res) return fallback

  const kept: string[] = []
  const provenance: Record<string, string> = {}
  const scores: Record<string, number> = {}

  candidates.forEach((mention, i) => {
    const present = pTrue(res.answers, `skill_present__${i}`)
    const depthAnswer = res.answers[`skill_depth__${i}`]
    const depth = isScoreAnswer(depthAnswer) ? depthAnswer.score : null
    if (present === null && depth === null) return
    const p = present ?? 0
    const d = depth ?? 0
    scores[mention.canonical] = Math.round(p * 1000) / 1000
    const keep =
      p >= config.typesafe.keepThreshold && d >= config.typesafe.skillLevelMin
    if (keep) {
      kept.push(mention.canonical)
      provenance[mention.canonical] =
        `jev:P=${p.toFixed(2)} depth=${d.toFixed(1)}/${SKILL_LEVELS.length - 1} (proposal: ${mention.context}@${mention.section})`
    } else {
      provenance[mention.canonical] = `rejected:jev P=${p.toFixed(2)} depth=${d.toFixed(1)}`
    }
  })

  // Fail-open: if Jev answered nothing usable, keep the offline verdicts.
  if (kept.length === 0 && candidates.length > 0) return fallback
  return { kept, provenance, scores, model: res.model, usage: res.usage }
}

// ---------------------------------------------------------------------------
// Tier 2: whole-record verification (hallucination / omission battery)
// ---------------------------------------------------------------------------

export interface VerifyReport {
  fired: string[]
  scores: Record<string, number>
  escalate: boolean
  fieldScores: Record<string, number>
}

function previewValue(v: unknown): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v)
    return (s ?? "").slice(0, 240)
  } catch {
    return String(v)
  }
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === "string") return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  return false
}

export async function verifyExtraction(
  text: string,
  extraction: Record<string, unknown>,
): Promise<VerifyReport | null> {
  const questions: Record<string, Question> = {}
  for (const [field, value] of Object.entries(extraction)) {
    if (isEmptyValue(value)) {
      questions[`${field}::absence_wrong`] = noul(
        `Field "${field}" came back empty. Does ` + "`resume_text`" + ` genuinely contain this information, making the empty result wrong?`,
        { true: "the resume does contain it and the empty value is wrong", false: "the resume does not contain it" },
      )
      continue
    }
    if (field === "yearsOfExperience") {
      // Aggregated from dated roles, never stated verbatim: ask whether the
      // evidence is *contradicted*, not whether the number appears literally.
      questions[`${field}::hallucinated`] = noul(
        `The dated employment in ` + "`resume_text`" + ` was measured as ${String(value)} years of experience. Do the dates clearly span less than that (off by more than one year)?`,
        {
          true: "the dates support clearly fewer years than extracted",
          false: "the dates support the extracted amount, within about a year",
        },
      )
      continue
    }
    const preview = previewValue(value)
    questions[`${field}::hallucinated`] = noul(
      `Field "${field}" was extracted as ${preview}. Is any of that value absent from or unsupported by ` +
        "`resume_text`" +
        ` (invented, mistyped, or taken from a different person's text)?`,
      { true: "part of the value is unsupported by the source", false: "the value is supported by the source" },
    )
  }
  if (Object.keys(questions).length === 0) return null

  const res = await systemOneSafe({ resume_text: text.slice(0, SOURCE_MAX_CHARS), extraction }, questions)
  if (!res) return null

  const threshold = config.typesafe.fireThreshold
  const fired: string[] = []
  const scores: Record<string, number> = {}
  const fieldScores: Record<string, number> = {}
  for (const [id, answer] of Object.entries(res.answers)) {
    const p = pTrue(res.answers, id)
    if (p === null) continue
    scores[id] = p
    fieldScores[id] = p
    if (p > threshold) fired.push(id)
  }
  fired.sort()
  return { fired, scores, escalate: fired.length > 0, fieldScores }
}

function emptyEquivalent(value: unknown): unknown {
  if (Array.isArray(value)) return []
  if (typeof value === "string") return ""
  if (typeof value === "number") return null
  return value ?? null
}

/** Drop fields Jev flagged as hallucinated. Absence firings only record a warning. */
function repair(
  extraction: Record<string, unknown>,
  report: VerifyReport | null,
): Record<string, unknown> {
  if (!report) return extraction
  const fields = new Set(
    report.fired
      .map((id) => id.split("::"))
      .filter(([, metric]) => metric === "hallucinated")
      .map(([field]) => field as string),
  )
  if (fields.size === 0) return extraction
  const out = { ...extraction }
  for (const field of fields) {
    if (field in out && !isEmptyValue(out[field])) out[field] = emptyEquivalent(out[field])
  }
  return out
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function extractProfile(
  text: string,
  options: { jev?: boolean } = {},
): Promise<ExtractionResult> {
  const proposals = proposeAll(text)
  const warnings: string[] = []
  const jev = options.jev !== false

  const skills = jev
    ? await jevSkillVerdicts(text, proposals)
    : offlineSkillVerdicts(proposals.mentions)

  // --- roles ---------------------------------------------------------------
  const roleProposals = dedupe([
    ...proposals.experience.map((e) => e.role).filter(Boolean),
    ...proposals.roles,
  ]).slice(0, MAX_ROLE_QUESTIONS)

  // --- education / certifications -----------------------------------------
  const educationProposals = dedupe([...proposals.education, ...proposals.degrees]).slice(0, MAX_EDU_QUESTIONS)
  const certProposals = proposals.certifications.slice(0, MAX_CERT_QUESTIONS)

  let roles = roleProposals
  let education = educationProposals
  let certifications = certProposals
  let model: string | undefined
  let usage: { input_tokens?: number; output_tokens?: number } | undefined

  if (jev && (roleProposals.length || educationProposals.length || certProposals.length)) {
    const questions: Record<string, Question> = {}
    roleProposals.forEach((r, i) => {
      questions[`role__${i}`] = noul(
        `Did the candidate of ` + "`resume_text`" + ` actually hold the job title "${r}"?`,
        {
          true: "the resume lists it as a position the candidate held",
          false: "it appears only as a target role, in someone else's text, or not at all",
        },
      )
    })
    educationProposals.forEach((e, i) => {
      questions[`education__${i}`] = noul(
        `Does ` + "`resume_text`" + ` state that the candidate completed "${e}"?`,
        { true: "it is stated as completed or in progress by the candidate", false: "it is not their own qualification" },
      )
    })
    certProposals.forEach((c, i) => {
      questions[`cert__${i}`] = noul(
        `Does ` + "`resume_text`" + ` show the candidate holding the "${c}" certification?`,
        { true: "listed as earned by the candidate", false: "not stated, or only in unrelated text" },
      )
    })
    questions["seniority"] = choice("What seniority level does this resume reflect?", SENIORITY_OPTIONS)
    questions["domain"] = choice("What primary domain does this resume reflect?", DOMAIN_OPTIONS)

    const res = await systemOneSafe({ resume_text: text.slice(0, SOURCE_MAX_CHARS) }, questions)
    if (res) {
      model = res.model
      usage = res.usage
      const keep = config.typesafe.keepThreshold
      const confirmed = (prefix: string, values: string[], cap: number): string[] =>
        values
          .map((value, i) => ({ value, p: pTrue(res.answers, `${prefix}__${i}`) ?? 0 }))
          .filter((x) => x.p >= keep)
          .sort((a, b) => b.p - a.p)
          .slice(0, cap)
          .map((x) => x.value)
      const confirmedRoles = confirmed("role", roleProposals, 6)
      const confirmedEdu = confirmed("education", educationProposals, 4)
      const confirmedCerts = confirmed("cert", certProposals, 10)
      if (confirmedRoles.length > 0) roles = confirmedRoles
      if (confirmedEdu.length > 0) education = confirmedEdu
      certifications = confirmedCerts
      ;(proposals as Proposals & { jevSeniority?: string; jevDomain?: string }).jevSeniority = choiceOf(
        res.answers["seniority"],
      )
      ;(proposals as Proposals & { jevSeniority?: string; jevDomain?: string }).jevDomain = choiceOf(
        res.answers["domain"],
      )
    }
  }

  // --- experience years ----------------------------------------------------
  // The resume's own explicit claim ("6 years of experience") is what a human
  // reads first and is the most reliable single number; dated roles decide when
  // the claim looks inflated or when no claim exists.
  const ranges = proposals.yearsFromRanges
  const explicit = proposals.yearsExplicit
  let yearsOfExperience: number | null = null
  if (explicit !== null && (ranges === null || explicit <= ranges + 3)) {
    yearsOfExperience = explicit
    if (ranges !== null && explicit < ranges - 1) {
      warnings.push(`dated roles span ~${ranges} yrs but the resume claims ${explicit} yrs`)
    }
  } else if (ranges !== null) {
    yearsOfExperience = Math.round(ranges * 10) / 10
    if (explicit !== null) {
      warnings.push(
        `explicit "${explicit} yrs" conflicts with dated roles (~${ranges} yrs); using the dated evidence`,
      )
    }
  }
  if (yearsOfExperience === null) warnings.push("no dated roles or explicit years found; unknown")

  // --- assembled flat metadata --------------------------------------------
  const seniority =
    (proposals as Proposals & { jevSeniority?: string }).jevSeniority ??
    proposeSeniority(roles, yearsOfExperience)
  const domain =
    (proposals as Proposals & { jevDomain?: string }).jevDomain ??
    proposeDomain(skills.kept, roles, text)

  const metadata: ResumeMetadata = {
    skills: skills.kept,
    roles,
    yearsOfExperience,
    education,
    projects: proposals.projects,
    certifications,
    seniority,
    domain,
  }

  // Only the list-ish fields Jev has not already verified item-by-item are
  // re-checked here; skills and roles each carry their own typed answer.
  if (jev) {
    const report = await verifyExtraction(text, {
      education: metadata.education,
      projects: metadata.projects,
      certifications: metadata.certifications,
    })
    const repaired = repair(
      {
        education: metadata.education,
        projects: metadata.projects,
        certifications: metadata.certifications,
      },
      report,
    )
    if (repaired.education !== undefined) metadata.education = repaired.education as string[]
    if (repaired.projects !== undefined) metadata.projects = repaired.projects as string[]
    if (repaired.certifications !== undefined) metadata.certifications = repaired.certifications as string[]

    // The years figure is derived from dated roles, so a disagreement is a
    // warning rather than a hallucination: keep the number, note the doubt.
    const yearsReport = yearsOfExperience === null
      ? null
      : await verifyExtraction(text, { yearsOfExperience })
    if (yearsReport?.fired.includes("yearsOfExperience::hallucinated")) {
      warnings.push(
        `Jev doubts the derived ${yearsOfExperience} yrs figure (P=${yearsReport.scores["yearsOfExperience::hallucinated"]?.toFixed(2)}); it was kept but flagged`,
      )
    }
  }

  // --- rich structured view ------------------------------------------------
  const canonicalSkills = dedupe(
    (metadata.skills ?? []).map((s) => canonicalize(s) ?? s),
  )

  const structured: ResumeStructured = {
    fullName: proposals.contact.fullName,
    headline: roles[0] ?? "",
    summary: summaryOf(text),
    contact: {
      email: proposals.contact.email,
      phone: proposals.contact.phone,
      location: proposals.contact.location,
      links: proposals.contact.links,
    },
    skills: (metadata.skills ?? []).map((name) => {
      const canonical = canonicalize(name) ?? name
      return {
        name: canonical,
        level: levelLabel(skills.scores[canonical] ?? skills.scores[name] ?? 0.6),
        years: inferSkillYears(text, canonical, proposals.experience.length),
      }
    }),
    experience: proposals.experience.map((e) => ({
      company: e.company,
      role: e.role,
      startDate: e.startDate,
      endDate: e.endDate,
      isCurrent: e.isCurrent,
      bullets: e.bullets,
      skills: dedupe(
        (metadata.skills ?? []).filter((s) =>
          e.bullets.some((b) => b.toLowerCase().includes(s.toLowerCase())),
        ),
      ).slice(0, 12),
    })),
    education: dedupeEducation(metadata.education ?? []),
    projects: (metadata.projects ?? []).map((p) => ({
      name: p.split(/[—–:|-]/)[0]?.trim().slice(0, 80) ?? p.slice(0, 80),
      description: p,
      skills: [],
      url: (p.match(/https?:\/\/\S+/) ?? [""])[0],
    })),
    certifications: (metadata.certifications ?? []).map((name) => ({ name, issuer: "", year: "" })),
    languages: proposals.languages.map((name) => ({ name, proficiency: "" })),
    totalYearsExperience: yearsOfExperience,
  }

  // --- quality -------------------------------------------------------------
  const keptCount = metadata.skills?.length ?? 0
  const signal = proposals.idx.text.length / 1000
  const confidence = clamp01(
    0.35 +
      0.35 * Math.min(1, keptCount / 12) +
      0.15 * Math.min(1, signal / 3) +
      (yearsOfExperience !== null ? 0.1 : 0) +
      (proposals.contact.email ? 0.05 : 0),
  )

  return {
    metadata,
    structured,
    provenance: skills.provenance,
    canonicalSkills,
    verification:
      model || Object.keys(skills.scores).length > 0
        ? { model: model ?? config.typesafe.model, scores: skills.scores, usage }
        : undefined,
    quality: { extractionConfidence: Math.round(confidence * 100) / 100, warnings },
    mentions: proposals.mentions,
  }
}

function choiceOf(answer: Answer | undefined): string | undefined {
  return isChoiceAnswer(answer) && answer.choice ? answer.choice : undefined
}

function levelLabel(scoreValue: number): string {
  if (scoreValue >= 0.9) return "expert"
  if (scoreValue >= 0.75) return "advanced"
  if (scoreValue >= 0.6) return "intermediate"
  return "basic"
}

function inferSkillYears(text: string, skill: string, _experienceCount: number): number | null {
  const info = skillInfo(skill)
  if (!info) return null
  const re = new RegExp(
    `\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.]{0,24}?(\\d{1,2})\\s*(?:\\+)?\\s*(?:years?|yrs?)`,
    "i",
  )
  const m = text.match(re)
  if (!m) return null
  const n = Number(m[1])
  return n > 0 && n <= 40 ? n : null
}

function summaryOf(text: string): string {
  const lines = text.split("\n")
  const start = lines.findIndex((l) => /^(professional\s+)?(summary|profile|objective|about)\b/i.test(l.trim()))
  if (start < 0) return ""
  const rest = lines.slice(start + 1, start + 8).map((l) => l.trim()).filter(Boolean)
  const stop = rest.findIndex((l) => /^[A-Z\s&/()-]{3,40}$/.test(l))
  return (stop > 0 ? rest.slice(0, stop) : rest).join(" ").slice(0, 600)
}
