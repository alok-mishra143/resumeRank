// Deterministic proposers: dictionaries + regexes propose candidates for every
// field; Jev (or the offline context classifier) confirms them. Nothing here
// touches the network — this is the offline backbone.

import { canonicalize, isAbstractSkill, isKnownSkill, ONTOLOGY } from "./ontology"
import { experienceSectionText, experienceText, isSectionHeading, looksLikeHeading, looksLikeProseLine, splitSections } from "./text"

// ---------------------------------------------------------------------------
// Alias matcher (precompiled once)
// ---------------------------------------------------------------------------

interface AliasMatcher {
  alias: string
  canonical: string
  re: RegExp
  caseSensitive: boolean
  /** True when the alias is declared explicitly in the ontology. */
  explicit: boolean
}

const PRE = "(?<![\\p{L}\\p{N}_-])"
/** Short tokens (JS, TS, Go, R, S3…) must not match inside "node.js" or "app.ts". */
const PRE_STRICT = "(?<![\\p{L}\\p{N}_.\\-/])"
const POST = "(?![\\p{L}\\p{N}_-])"

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function matcherFor(alias: string, canonical: string, caseSensitive: boolean, explicit: boolean): AliasMatcher {
  const strict = caseSensitive || alias.length <= 3
  return {
    alias,
    canonical,
    caseSensitive,
    explicit,
    re: new RegExp(
      `${strict ? PRE_STRICT : PRE}${escapeRegExp(alias)}${POST}`,
      caseSensitive ? "gu" : "giu",
    ),
  }
}

const MATCHERS: AliasMatcher[] = []
{
  const seen = new Set<string>()
  const explicitAliases = new Set<string>()
  for (const def of ONTOLOGY.definitions) {
    for (const raw of def.aliases ?? []) explicitAliases.add(raw.startsWith("*") ? raw.slice(1) : raw.toLowerCase())
  }
  for (const [alias, canonical] of ONTOLOGY.aliasIndex) {
    if (alias.length < 2) continue
    if (seen.has(alias)) continue
    seen.add(alias)
    const caseSensitive = ONTOLOGY.caseSensitiveAliases.has(alias)
    MATCHERS.push(matcherFor(alias, canonical, caseSensitive, explicitAliases.has(alias)))
  }
  // Longest aliases first so "machine learning" wins before "learning".
  MATCHERS.sort((a, b) => b.alias.length - a.alias.length)
}

export interface TextIndex {
  text: string
  lower: string
  /** Byte offset where each line starts. */
  lineStarts: number[]
  lines: string[]
  sectionOfLine: string[]
}

export function indexText(text: string): TextIndex {
  const lines = text.split("\n")
  const lineStarts: number[] = []
  let offset = 0
  const sectionOfLine: string[] = []

  const sections = splitSections(text)
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }
  // Assign each line to the section it falls in.
  for (let i = 0; i < lines.length; i++) sectionOfLine.push("other")
  for (const section of sections) {
    const sectionLines = section.body.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === sectionLines[0] && section.key !== "other") {
        for (let j = i; j < i + sectionLines.length && j < lines.length; j++) {
          sectionOfLine[j] = section.key
        }
        break
      }
    }
  }
  return { text, lower: text.toLowerCase(), lineStarts, lines, sectionOfLine }
}

function lineIndexAt(idx: TextIndex, offset: number): number {
  let lo = 0
  let hi = idx.lineStarts.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (idx.lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

// ---------------------------------------------------------------------------
// Mention context classification — the core of offline precision
// ---------------------------------------------------------------------------

export type MentionContext = "used" | "weak" | "negated"

/** Language that means "this is a real, personal skill". */
const POSITIVE =
  /\b(built|build|building|developed|developing|implemented|implementing|designed|architected|deployed|migrated|shipped|maintained|optimized|optimised|debugged|integrated|led|lead|owned|automated|scaled|refactored|created|engineered|wrote|written|delivered|launched|used|using|working with|worked with|hands-on|handled|drove|responsible for|managed|improved|reduced|automated|tested|enhanced|expert|proficient|advanced|experienced (in|with)|strong (in|with)|spearheaded|developed|primary)\b/i

/** Language that means "mentioned but not the candidate's own skill". */
const NEGATIVE = [
  // dependency / third-party context
  /\b(the|our|their|this|my|your)\s+(team|company|client|employer|org|organization|department|product|platform|app|application|project)s?\s+(tech\s+stack|stack|uses?|used|built with|runs? on|is built)\b/i,
  /\btech(nology)?\s+stack\s+(of|for|used)\b/i,
  /\bjob\s+(description|posting|ad|advert)\b/i,
  /\brequirements?\s*:\s*$/i,
  /\bnice[\s-]to[\s-]have\b/i,
  /\b(the role|the position|candidate must|you will be working)\b/i,
  // explicit non-possession
  /\b(no|without|never)\s+(hands[\s-]on|experience|exposure|knowledge)\b/i,
  /\b(exposure to|familiar with|familiarity with|awareness of|aware of|basic (knowledge|understanding) of|some knowledge of|coursework in|introduced to|read about|dabbled (in|with)|beginner|learning (to use)?|interested in|looking to (learn|transition)|not used|did not use|haven't used|have not used|no prior)\b/i,
  // pure requirement/information bullets in an ad-like paragraph
  /\b(we are looking for|we're looking for|you should have|must have experience|ideal candidate|qualifications?:)\b/i,
]

export interface SkillMention {
  canonical: string
  alias: string
  count: number
  section: string
  context: MentionContext
  confidence: number
  evidence: string
  offset: number
}

function classifyLine(line: string, section: string): MentionContext {
  const t = line.trim()
  if (!t) return "weak"
  // A sentence inside a summary/other block that is clearly a pasted job ad.
  for (const re of NEGATIVE) {
    if (re.test(t)) {
      // Strong positive verbs in the same line still indicate real work.
      return POSITIVE.test(t) && !/\bexposure to|familiar with|no hands|not used|beginner|learning\b/i.test(t)
        ? "used"
        : "negated"
    }
  }
  if (section === "skills") return "used"
  if (POSITIVE.test(t)) return "used"
  if (section === "experience" || section === "projects") return "weak"
  return "weak"
}

function confidenceFor(context: MentionContext, section: string, count: number): number {
  const bump = Math.min(0.05, Math.max(0, count - 1) * 0.02)
  if (context === "negated") return 0.15
  if (context === "used") {
    if (section === "skills") return Math.min(0.98, 0.92 + bump)
    if (section === "experience" || section === "projects") return Math.min(0.97, 0.9 + bump)
    return Math.min(0.9, 0.82 + bump)
  }
  if (section === "skills") return Math.min(0.8, 0.72 + bump)
  return Math.min(0.72, 0.6 + bump)
}

export interface MentionOptions {
  /**
   * Include umbrella skills (Testing, CI/CD, Site Reliability …). Used for job
   * descriptions, where such a term *is* a requirement; resumes never emit them.
   */
  includeAbstract?: boolean
  /** Diagnostics: skip the nested-alias suppression pass. */
  keepNested?: boolean
}

/** Every ontology skill mentioned in the text, with context-resolved confidence. */
export function proposeSkillMentions(idx: TextIndex, options: MentionOptions = {}): SkillMention[] {
  const mentions = new Map<string, SkillMention>()

  for (const matcher of MATCHERS) {
    // Umbrella skills are matching targets, never candidate skills. For job
    // descriptions they are kept when the phrase is a real requirement term
    // ("Site Reliability", "CI/CD", "REST APIs") rather than a bare word.
    if (!options.includeAbstract && isAbstractSkill(matcher.canonical)) continue
    if (
      options.includeAbstract &&
      isAbstractSkill(matcher.canonical) &&
      !matcher.explicit &&
      !/[ /]/.test(matcher.alias)
    ) {
      continue
    }
    const probe = matcher.caseSensitive ? idx.text : idx.lower
    if (!probe.includes(matcher.caseSensitive ? matcher.alias : matcher.alias.toLowerCase())) continue
    matcher.re.lastIndex = 0
    let m: RegExpExecArray | null
    let total = 0
    const evidence: string[] = []
    let lineKey = ""
    let context: MentionContext = "weak"
    let section = "other"
    let firstOffset = -1

    while ((m = matcher.re.exec(idx.text)) !== null) {
      total += 1
      if (total > 60) break
      const li = lineIndexAt(idx, m.index)
      const line = idx.lines[li] ?? ""
      const sec = idx.sectionOfLine[li] ?? "other"
      const ctx = classifyLine(line, sec)
      if (firstOffset < 0) {
        firstOffset = m.index
        lineKey = line.trim().slice(0, 200)
        context = ctx
        section = sec
      }
      // Keep the strongest context seen anywhere in the document.
      if (ctx === "used") {
        context = "used"
        section = sec
        lineKey = line.trim().slice(0, 200)
      }
      if (evidence.length < 3 && (ctx === "used" || ctx === "negated")) {
        evidence.push(line.trim().slice(0, 160))
      }
    }
    if (total === 0) continue

    const existing = mentions.get(matcher.canonical)
    const confidence = confidenceFor(context, section, total)
    const mention: SkillMention = {
      canonical: matcher.canonical,
      alias: matcher.alias,
      count: total,
      section,
      context,
      confidence: Math.max(confidence, existing?.confidence ?? 0),
      evidence: evidence[0] ?? lineKey,
      offset: firstOffset,
    }
    if (!existing) {
      mentions.set(matcher.canonical, mention)
    } else {
      // Merge: keep the best confidence, sum counts.
      existing.count += total
      if (mention.confidence > existing.confidence) {
        existing.confidence = mention.confidence
        existing.context = mention.context
        existing.section = mention.section
        existing.alias = matcher.alias
        existing.evidence = mention.evidence
        existing.offset = mention.offset
      }
    }
  }

  const merged = [...mentions.values()]
  const list = options.keepNested ? merged : suppressNested(merged)
  return list.sort((a, b) => b.confidence - a.confidence || b.count - a.count)
}

/**
 * Drop a mention when a longer alias elsewhere covers it ("Testing" inside
 * "Usability testing", "React" inside "React Native"). The longer, more
 * specific skill carries the meaning; the umbrella is matched through the
 * implication graph when a requirement asks for it.
 */
function suppressNested(mentions: SkillMention[]): SkillMention[] {
  if (mentions.length < 2) return mentions
  const aliases = mentions.map((m) => m.alias.toLowerCase())
  return mentions.filter((mention, i) => {
    const self = aliases[i]
    return !aliases.some(
      (other, j) =>
        j !== i &&
        other !== self &&
        mentions[j].canonical !== mention.canonical &&
        new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(self)}(?![\\p{L}\\p{N}_-])`, "u").test(other),
    )
  })
}

/** Skills accepted by the offline context classifier alone. */
export function proposeSkillsOffline(idx: TextIndex, keepAt = 0.55): string[] {
  return proposeSkillMentions(idx)
    .filter((m) => m.confidence >= keepAt)
    .map((m) => m.canonical)
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLE_TITLES = [
  "senior software engineer", "staff software engineer", "principal software engineer",  "senior frontend engineer", "senior backend engineer", "senior full stack engineer",
  "senior data engineer", "senior mobile engineer", "senior qa engineer",
  "senior devops engineer", "senior platform engineer", "senior security engineer",
  "senior machine learning engineer", "senior site reliability engineer",
  "senior software developer", "senior web developer", "senior product manager",
  "lead software engineer", "lead frontend engineer", "lead backend engineer",
  "engineering manager", "software engineer", "software developer",
  "frontend engineer", "frontend developer", "react developer", "ui engineer",
  "backend engineer", "backend developer", "api developer",
  "full stack engineer", "fullstack engineer", "full stack developer", "fullstack developer",
  "data engineer", "data scientist", "data analyst", "analytics engineer", "bi developer",
  "machine learning engineer", "ml engineer", "ai engineer", "nlp engineer",
  "devops engineer", "site reliability engineer", "platform engineer", "cloud engineer",
  "infrastructure engineer", "systems engineer", "network engineer", "security engineer",
  "mobile engineer", "ios developer", "ios engineer", "android developer", "android engineer",
  "mobile developer", "flutter developer", "react native developer",
  "qa engineer", "qa analyst", "test engineer", "sdet", "automation engineer",
  "web developer", "wordpress developer", "shopify developer",
  "solutions architect", "software architect", "technical architect", "cloud architect",
  "technical lead", "tech lead", "team lead", "scrum master",
  "product manager", "project manager", "program manager",
  "product designer", "ui designer", "ux designer", "ui/ux designer", "interaction designer",
  "business analyst", "database administrator", "dba",
  "customer support specialist", "support engineer", "support analyst", "technical support",
  "marketing manager", "digital marketing manager", "content writer", "seo specialist",
  "embedded engineer", "firmware engineer", "game developer", "qa lead",
  "sre", "lead sre", "staff sre", "senior sre", "site reliability engineer",
  "staff engineer", "principal engineer", "lead engineer", "head of engineering",
  "data specialist", "product analyst", "support analyst", "technical support specialist",
  "marketing specialist", "growth manager", "operations analyst", "business intelligence analyst",
]

const ROLE_MATCHERS = ROLE_TITLES.map((title) => ({
  title,
  re: new RegExp(`${PRE}${escapeRegExp(title)}${POST}`, "giu"),
})).sort((a, b) => b.title.length - a.title.length)

function titleCase(s: string): string {
  return s.replace(/\p{L}[\p{L}']*/gu, (w) => ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

/** Words that must keep their real casing in job titles. */
const ACRONYMS: Record<string, string> = {
  qa: "QA", ios: "iOS", devops: "DevOps", ui: "UI", ux: "UX", ml: "ML", ai: "AI", sre: "SRE",
  bi: "BI", dba: "DBA", api: "API", hr: "HR", seo: "SEO", sap: "SAP", aws: "AWS", gcp: "GCP",
  sql: "SQL", php: "PHP", qc: "QC", it: "IT", etl: "ETL", nlp: "NLP", sdet: "SDET", crm: "CRM",
  erp: "ERP", cad: "CAD", gis: "GIS", wms: "WMS", cms: "CMS", pos: "POS",
}

/** Job titles held, longest-match-wins per span. */
export function proposeRoles(text: string): string[] {
  const spans: Array<{ start: number; end: number }> = []
  const found: string[] = []
  for (const { title, re } of ROLE_MATCHERS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      if (spans.some((s) => start < s.end && end > s.start)) continue
      spans.push({ start, end })
      found.push(titleCase(title))
      break
    }
  }
  return found
}

/** Seniority bucket from the strongest role title / explicit years. */
export function proposeSeniority(roles: string[], years: number | null): string {
  const joined = roles.join(" | ")
  if (/\b(principal|staff|head of|director)\b/i.test(joined)) return "staff"
  if (/\b(senior|sr\.?|lead)\b/i.test(joined)) return "senior"
  if (years !== null) {
    if (years >= 8) return "staff"
    if (years >= 5) return "senior"
    if (years >= 2) return "mid"
    return "junior"
  }
  if (/\b(junior|intern|trainee|graduate)\b/i.test(joined)) return "junior"
  return "mid"
}

const DOMAIN_HINTS: Array<[string, RegExp]> = [
  ["data", /\b(data engineer|data pipeline|etl|analytics|warehouse|spark|airflow|dbt|bigquery|snowflake|tableau|power bi)\b/i],
  ["ml", /\b(machine learning|deep learning|pytorch|tensorflow|scikit-learn|nlp|computer vision|llm|model training|mlops)\b/i],
  ["mobile", /\b(ios|android|swift|kotlin|flutter|react native|mobile app)\b/i],
  ["devops", /\b(devops|sre|site reliability|kubernetes|terraform|ci\/cd|infrastructure|cloud engineer|platform engineer|on-?call|observability)\b/i],
  ["frontend", /\b(frontend|front-end|react|vue|angular|next\.js|tailwind|ui engineer|css|accessibility)\b/i],
  ["backend", /\b(backend|back-end|api|microservices|node\.js|django|spring boot|postgres|database|server-side)\b/i],
]

/** Primary engineering domain from skills + roles. */
export function proposeDomain(skills: string[], roles: string[], text: string): string {
  const roleText = roles.join(" | ")
  const skillText = skills.join(" | ")
  const haystack = `${roleText} ${skillText} ${text.slice(0, 2000)}`
  const hasFrontend = /frontend|front-end|react|vue|angular|next\.js/i.test(haystack)
  const hasBackend = /backend|back-end|node\.js|express|django|spring boot|fastapi|microservices|postgres/i.test(haystack)
  if (hasFrontend && hasBackend) return "fullstack"
  for (const [name, re] of DOMAIN_HINTS) {
    if (re.test(roleText)) return name
  }
  for (const [name, re] of DOMAIN_HINTS) {
    if (re.test(skillText)) return name
  }
  for (const [name, re] of DOMAIN_HINTS) {
    if (re.test(haystack)) return name
  }
  return "other"
}

// ---------------------------------------------------------------------------
// Experience years
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7,
  september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
}

const MONTH_NAME =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?"
// Dash variants copied from real PDFs: en/em dash, non-breaking hyphen (U+2011),
// figure dash (U+2012), minus sign (U+2212) and the ASCII hyphen.
const RANGE_SEP = "\\s*(?:[\\u2010-\\u2015\\u2212]|-|to|until|through)\\s*"
const PRESENT = "(?:present|current|now|till\\s+date|to\\s+date|ongoing|today)"
const YEAR = "(19\\d{2}|20\\d{2})"

export interface MonthSpan {
  start: number
  end: number
  label?: string
}

function toMonthIndex(year: number, month: number): number {
  return year * 12 + month
}

/** Parse employment date ranges out of free text. `now` is injectable for tests. */
export function parseDateRanges(text: string, now: Date = new Date()): MonthSpan[] {
  const spans: MonthSpan[] = []
  const nowIdx = toMonthIndex(now.getFullYear(), now.getMonth())
  const push = (startY: number, startM: number, endY: number | null, endM: number | null, label?: string) => {
    if (startY < 1970 || startY > now.getFullYear() + 1) return
    const start = toMonthIndex(startY, startM)
    const end = Math.min(endY === null ? nowIdx : toMonthIndex(endY, endM ?? 11), nowIdx)
    if (end >= start - 1) spans.push({ start, end: Math.max(end, start), label })
  }
  const isYear = (t: string): boolean => /\d{4}/.test(t)

  // Jan 2019 – Mar 2022 | January 2019 to Present
  for (const m of text.matchAll(
    new RegExp(`${MONTH_NAME}\\s*,?\\s+(\\d{4})${RANGE_SEP}${MONTH_NAME}\\s*,?\\s+(\\d{4}|${PRESENT})`, "gi"),
  )) {
    const startM = MONTHS[m[1].toLowerCase()]
    const endM = MONTHS[m[3].toLowerCase()]
    const startY = Number(m[2])
    if (startM === undefined || endM === undefined || !Number.isFinite(startY)) continue
    const present = !isYear(m[4])
    push(startY, startM, present ? null : Number(m[4]), present ? null : endM, m[0])
  }
  // Jan 2019 – Present
  for (const m of text.matchAll(new RegExp(`${MONTH_NAME}\\s*,?\\s+(\\d{4})${RANGE_SEP}(${PRESENT})`, "gi"))) {
    const startM = MONTHS[m[1].toLowerCase()]
    const startY = Number(m[2])
    if (startM === undefined || !Number.isFinite(startY)) continue
    push(startY, startM, null, null, m[0])
  }
  // 2019 – 2022 | 2019 – Present (year-only: same month, so the duration is
  // exactly endYear - startYear, matching how the resume states it)
  for (const m of text.matchAll(new RegExp(`\\b${YEAR}${RANGE_SEP}(${YEAR}|${PRESENT})\\b`, "gi"))) {
    const startY = Number(m[1])
    const endY = isYear(m[2]) ? Number(m[2]) : null
    if (!Number.isFinite(startY)) continue
    push(startY, 0, endY, endY === null ? null : 0, m[0])
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})/(${YEAR})${RANGE_SEP}(\\d{1,2})/(${YEAR})\\b`, "gi"))) {
    const startM = Number(m[1]) - 1
    const endM = Number(m[3]) - 1
    if (startM < 0 || startM > 11 || endM < 0 || endM > 11) continue
    push(Number(m[2]), startM, Number(m[4]), endM, m[0])
  }
  return spans
}

/** Merge overlapping month spans into total months. */
function mergedMonths(spans: MonthSpan[]): number {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  let total = 0
  let cur: MonthSpan | null = null
  for (const s of sorted) {
    if (!cur) {
      cur = { ...s }
      continue
    }
    if (s.start <= cur.end + 1) {
      cur.end = Math.max(cur.end, s.end)
    } else {
      total += cur.end - cur.start + 1
      cur = { ...s }
    }
  }
  if (cur) total += cur.end - cur.start + 1
  return total
}

/** Total professional experience in years from dated roles. */
export function proposeYearsFromRanges(text: string, now: Date = new Date()): number | null {
  const section = experienceText(text)
  const months = mergedMonths(parseDateRanges(section, now))
  if (months <= 0) return null
  const years = Math.round((months / 12) * 10) / 10
  if (years <= 0 || years > 60) return null
  return years
}

/** Largest explicit "N years" / "N+ years" mention, sanity-capped. */
export function proposeYearsExplicit(text: string): number | null {
  let max: number | null = null
  for (const m of text.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)) {
    const n = Number(m[1])
    if (!Number.isFinite(n) || n > 45) continue
    if (max === null || n > max) max = n
  }
  return max
}

/** Education start/end years combined: never counted as work experience. */
export function proposeEducationYears(text: string): number[] {
  const out: number[] = []
  for (const section of splitSections(text)) {
    if (section.key !== "education") continue
    for (const m of section.body.matchAll(/\b(19\d{2}|20\d{2})\b/g)) out.push(Number(m[1]))
    for (const m of section.body.matchAll(new RegExp(`${MONTH_NAME}\\s+(\\d{4})`, "gi"))) out.push(Number(m[2]))
  }
  return out
}

// ---------------------------------------------------------------------------
// Education / certifications
// ---------------------------------------------------------------------------

const DEGREE_PATTERNS: Array<[string, RegExp]> = [
  ["PhD", /\b(ph\.?d|doctorate|doctoral)\b/i],
  ["MBA", /\bMBA\b/],
  ["Master's", /\b(master'?s?|m\.?tech|m\.?sc|m\.?c\.?a|msc|mca|mtech|ms in|postgraduate)\b/i],
  ["Bachelor's", /\b(bachelor'?s?|b\.?tech|b\.?e\.?|b\.?sc|bsc|bca|btech|undergraduate|be in|bs in)\b/i],
  ["Associate", /\b(associate'?s? degree|diploma)\b/i],
]

export function proposeDegrees(text: string): string[] {
  return DEGREE_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name)
}

const CERT_PATTERNS: Array<[string, RegExp]> = [
  ["AWS Certified", /\b(aws certified|aws solutions architect|aws developer associate|aws cloud practitioner|aws sysops)\b/i],
  ["Azure Certified", /\b(azure (administrator|developer|solutions architect|fundamentals|az-\d{3}))\b/i],
  ["Google Cloud Certified", /\b(google cloud (certified|professional|associate)|gcp certified|gcp ace)\b/i],
  ["Terraform Certified", /\b(hashicorp certified|terraform associate)\b/i],
  ["CKA", /\b(CKA|CKS|CKAD|certified kubernetes (administrator|developer|security))\b/i],
  ["PMP", /\bPMP\b/],
  ["CSM", /\b(certified scrum master|CSM)\b/],
  ["CISSP", /\bCISSP\b/],
  ["CompTIA", /\b(comptia|security\+|network\+)\b/i],
  ["Oracle Certified", /\b(oracle certified|ocp|ocjp)\b/i],
  ["Salesforce Certified", /\b(salesforce certified|salesforce administrator)\b/i],
  ["CCNA", /\bCCNA\b/],
  ["CCNP", /\bCCNP\b/],
  ["Six Sigma", /\b(six sigma|lean six sigma)\b/i],
  ["ITIL", /\bITIL\b/],
  ["CFA", /\bCFA\b/],
  ["CPA", /\bCPA\b/],
]

export function proposeCertifications(text: string): string[] {
  return CERT_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name)
}

const SCHOOL_HINT = /\b(university|universite|college|institute|institution|school|academy|polytechnic|iit|nit|iiit|bits|vit|srm|nirma|daiict)\b/i

/** Education entries as "Degree, School (years)" strings. */
const SCHOOL_HINT_RE =
  /[\p{L}&.'’-]*(?:\s+[\p{L}&.'’-]+)*\s*\b(?:university|universite|universität|universidad|college|institute|institut|school|academy|polytechnic|iit|nit|iiit|bits)\b[\p{L}&.'’-]*(?:[,\s]+[\p{L}&.'’-]+)*/iu

const DEGREE_LEVEL_RE =
  /^(?:b\.?\s?tech\.?|b\.?\s?e\.?\b|b\.?\s?eng\.?|b\.?\s?sc\.?|b\.?\s?c\.?\s?a|b\.?\s?a\.?\b|b\.?\s?s\.?\b|bachelor(?:'s)?(?:\s+of\s+[\p{L}\s]+?)?|m\.?\s?tech|m\.?\s?sc|m\.?\s?s\.?\b|m\.?\s?e\.?\b|m\.?\s?eng|m\.?\s?a\.?\b|master(?:'s)?(?:\s+of\s+[\p{L}\s]+?)?|mba|ph\.?\s?d\.?\b|doctor(?:ate)?|diploma|pgdm|associate(?:'s)?(?:\s+degree)?|higher\s+secondary|intermediate)/iu

const INSTITUTION_KEY =
  /\b(?:university|universite|universität|universidad|college|institute|institut|school|academy|polytechnic|iit|nit|iiit|bits)\b/iu
/** Field words that are capitalised but are not part of an institution name. */
const FIELD_STOPWORDS =
  /^(?:software|engineering|computer|computing|science|sciences|information|technology|technologies|business|arts|economics|economy|data|electrical|electronic|mechanical|civil|biomedical|chemical|mathematics|maths|physics|chemistry|biology|finance|accounting|management|marketing|design|architecture|law|medicine|nursing|public|health|analytics|statistics|systems|networks|security|robotics|aerospace|industrial|materials|environmental|communication|journalism|psychology|education|social|political|international|humanities|literature|history|languages|philosophy)$/i
const INSTITUTION_CONNECTOR = /^(?:of|de|del|della|van|von|der|for|at|and|the|&)$/i

/**
 * Institution name around the first institution keyword, bounded on both sides
 * by real words: "B.Eng. Software Engineering Imperial College London" →
 * "Imperial College London"; "M.Sc. Computer Science Technical University of
 * Munich" → "Technical University of Munich".
 */
function takeInstitution(value: string): { school: string; rest: string } {
  const words = value.split(/\s+/).filter((w) => w && w !== "-" && w !== "–" && w !== "—")
  const at = words.findIndex((w) => INSTITUTION_KEY.test(w))
  if (at < 0) return { school: "", rest: value }

  let start = at
  while (start > 0) {
    const previous = words[start - 1]
    if (DEGREE_LEVEL_RE.test(previous)) break
    if (FIELD_STOPWORDS.test(previous.replace(/[^\p{L}]/gu, ""))) break
    if (!/^[\p{Lu}\p{N}]/u.test(previous)) break
    start -= 1
  }
  let end = at + 1
  while (end < words.length) {
    const word = words[end]
    if (/^[\p{Lu}]/u.test(word) && !FIELD_STOPWORDS.test(word.replace(/[^\p{L}]/gu, ""))) {
      end += 1
      continue
    }
    if (INSTITUTION_CONNECTOR.test(word) && end + 1 < words.length && /^[\p{Lu}]/u.test(words[end + 1])) {
      end += 2
      continue
    }
    break
  }
  return {
    school: words.slice(start, end).join(" "),
    rest: [...words.slice(0, start), ...words.slice(end)].join(" "),
  }
}

/**
 * Split one education string into degree / field / school / years.
 * Handles the label form the proposer emits ("Bachelor's, Imperial College
 * London (2016)") and raw lines ("B.Eng. Software Engineering Imperial College
 * London (2016)", "M.Sc. Computer Science - Technical University of Munich - 2017").
 */
export function parseEducationEntry(entry: string): {
  degree: string
  field: string
  school: string
  startYear: string
  endYear: string
} {
  const years = (entry.match(/\b(19\d{2}|20\d{2})\b/g) ?? []).map(String)
  let rest = entry
    .replace(/\b(19\d{2}|20\d{2})\b/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\b(?:present|current|ongoing)\b/gi, " ")
    .replace(/\s*[–—]\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:.-]+/, "")
    .replace(/[\s,;:.-]+$/, "")
    .trim()

  // Institution first: the school is what the degree/field words surround.
  let school = ""
  const taken = takeInstitution(rest)
  if (taken.school) {
    school = taken.school
    rest = taken.rest
  } else {
    const parts = rest.split(/\s+-\s+|\s*,\s*/).map((p) => p.trim()).filter(Boolean)
    const candidate = parts.length > 1 ? parts[parts.length - 1] : ""
    if (candidate && candidate.split(/\s+/).length <= 5) {
      school = candidate
      rest = parts.slice(0, -1).join(" ")
    }
  }
  rest = rest.replace(/\s+-\s+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").trim()

  // Degree level + field.
  let degree = ""
  let field = ""
  const level = rest.match(DEGREE_LEVEL_RE)
  if (level) {
    degree = level[0].replace(/\s{2,}/g, " ").trim()
    field = rest
      .slice(level[0].length)
      .replace(/^[\s.,;:\-–—]+/, "")
      .replace(/^(?:in|of|the field of)\s+/i, "")
      .replace(/^[\s.,;:\-–—]+/, "")
      .trim()
  } else {
    degree = rest.slice(0, 90).trim()
  }
  // "B.Eng. Software Engineering" style: if no level matched but the text starts
  // with an abbreviation followed by words, keep it whole as the degree.
  if (degree && field.toLowerCase() === degree.toLowerCase()) field = ""

  return {
    degree: degree.slice(0, 120),
    field: field.slice(0, 120),
    school: school.slice(0, 120),
    startYear: years[0] ?? "",
    endYear: years.length > 1 ? years[years.length - 1] : (years[0] ?? ""),
  }
}

export function proposeEducationEntries(text: string): string[] {
  const cleaned: string[] = []
  const degreeEntries: string[] = []

  for (const section of splitSections(text)) {
    if (section.key !== "education") continue
    const lines = section.body
      .split("\n")
      .map((l) => l.replace(/^[•\-*·▪◦‣]\s+/, "").replace(/\s{2,}/g, " ").trim())
      .filter((l) => l.length > 0 && !looksLikeHeading(l))

    let pendingDegree = ""
    for (const line of lines) {
      const degree = DEGREE_PATTERNS.find(([, re]) => re.test(line))?.[0] ?? ""
      const years = (line.match(/\b(19\d{2}|20\d{2})\b/g) ?? []).map(Number).sort()
      const schoolMatch = line.match(/[^,|-]*\b(?:university|universite|college|institute|school|academy)\b[^,|]*/i)

      if (!degree && !schoolMatch && !SCHOOL_HINT.test(line)) {
        // Continuation of the previous degree line (field of study, CGPA…).
        if (pendingDegree && degreeEntries.length > 0 && line.length < 120) {
          degreeEntries[degreeEntries.length - 1] = `${degreeEntries[degreeEntries.length - 1]} (${line.slice(0, 80)})`
        }
        continue
      }

      const label =
        degree && schoolMatch
          ? `${degree}, ${schoolMatch[0].trim()}`
          : degree
            ? `${degree}, ${line.replace(/^[,\s-]+/, "").slice(0, 90)}`
            : line.slice(0, 120)
      // Years are already present in the raw line: strip them from the label
      // before appending the normalised range, so "… - 2016 (2016)" cannot happen.
      const labelClean = years.length > 0
        ? label.replace(/\b(19\d{2}|20\d{2})\b/g, "").replace(/[\s,–—-]{2,}/g, " ").replace(/[\s,–—-]+$/, "").trim()
        : label
      const withYears = years.length > 0 ? `${labelClean} (${years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0]})` : labelClean
      cleaned.push(withYears)
      if (degree) pendingDegree = degree
    }
  }

  const unique: string[] = []
  for (const entry of cleaned) {
    const tokens = new Set(entry.toLowerCase().match(/[a-z]{4,}/g) ?? [])
    const duplicate = unique.some((existing) => {
      const other = new Set(existing.toLowerCase().match(/[a-z]{4,}/g) ?? [])
      if (tokens.size === 0 || other.size === 0) return false
      const shared = [...tokens].filter((t) => other.has(t)).length
      return shared / Math.min(tokens.size, other.size) >= 0.7
    })
    if (!duplicate) unique.push(entry)
  }
  if (unique.length > 0) return unique.slice(0, 4)

  // No education section: fall back to the degree labels alone.
  return proposeDegrees(text)
}

// ---------------------------------------------------------------------------
// Contact / identity
// ---------------------------------------------------------------------------

export interface Contact {
  fullName: string
  email: string
  phone: string
  location: string
  links: string[]
}

const CITY_HINT =
  /\b(bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|noida|gurgaon|gurugram|kolkata|ahmedabad|jaipur|indore|kochi|remote|london|berlin|paris|amsterdam|dublin|new york|san francisco|seattle|austin|boston|chicago|toronto|vancouver|singapore|dubai|sydney|melbourne|tokyo|bangkok|warsaw|lisbon|madrid|barcelona|zurich|munich|stockholm|prague|bangalore rural)\b/i

export function proposeContact(text: string): Contact {
  const head = text.slice(0, 1500)
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/) ?? [""])[0]
  const phone =
    (text.match(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,4}/) ?? [""])[0].trim()
  const links = [...new Set((text.match(/https?:\/\/[^\s)|,\]]+/g) ?? []).map((l) => l.replace(/[.,;]$/, "")))].slice(0, 6)

  // Location. Two rules learned from real PDFs:
  //   1. a wrong location is worse than none, so a candidate only counts when it
  //      sits on a contact line (email/phone/URL) or an explicitly labelled line
  //      or is the entire line by itself;
  //   2. the value is *found* inside the line, not matched against it — real
  //      headers are "rhorv@proton.me . horv.co . Philadelphia, PA" and
  //      "1234 Care Street, Coon Rapids, MN 55433 ninanursing@gmail.com".
  const LABELLED_LOCATION = /^\s*(?:location|located in|based in|address|residing in|current location)\b\s*[:\-–]?\s*/i
  const LOCATION_IN_LINE =
    /([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s*,\s*([\p{Lu}]{2}|[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)(?:\s+\d{5}(?:-\d{4})?)?/u
  const LOCATION_LINE_ONLY =
    /^([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s*,\s*([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s*,\s*(?:[\p{Lu}]{2}|[\p{Lu}][\p{L}'’-]+)\s*$/u
  // "City, ST" shapes that are not a location.
  const NOT_A_LOCATION =
    /\b(?:r\.?n\.?|m\.?d\.?|ph\.?d\.?|b\.?s\.?n\.?|m\.?s\.?n\.?|cpa|cfa|pmp|inc|ltd|llc|corp|university|college|institute|school|academy|labs?|technologies|solutions|consulting|remote|hybrid|seasonal|zip|state|street|avenue|road)\b/i

  let location = ""
  for (const rawLine of head.split("\n")) {
    const line = rawLine.replace(/\s+$/, "")
    if (!line.trim()) continue
    const flat = line.replace(/[^\p{L}\p{N}\s,.'()@:/-]/gu, " ").replace(/\s{2,}/g, " ").trim()
    if (!flat) continue
    const labelled = LABELLED_LOCATION.test(flat)
    // A real email address, not the "@" of "Engineer @ Company" — that shape is
    // an experience line ("R&D Engineer @ Anytype, Berlin"), not a contact line.
    const isContactLine =
      /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(flat) ||
      /https?:\/\/|www\.|\b(?:linkedin|github)\./i.test(flat) ||
      /(?:\+?\d[\d\s().-]{8,})/.test(flat) ||
      labelled

    // A line that is nothing but "City, State, Country".
    const wholeLine = flat.replace(LABELLED_LOCATION, "").trim()
    const threePart = wholeLine.match(LOCATION_LINE_ONLY)
    if (threePart && !NOT_A_LOCATION.test(wholeLine)) {
      location = `${threePart[1]}, ${threePart[2]}`
      break
    }
    if (!isContactLine) continue
    // "1234 Care Street, Coon Rapids, MN 55433" — drop the street line first, so
    // the scan lands on the city instead of being consumed by "Care Street, …".
    const withoutStreet = wholeLine.replace(
      /^[^,]*?\b\d+[\p{L}\s.]*\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|suite|ste|apt|apartment|unit|floor|fl)\b\.?\s*,?\s*/iu,
      "",
    )
    // Try every candidate in the line: "1234 Care Street, Coon Rapids, MN 55433"
    // must skip the street segment and land on "Coon Rapids, MN".
    for (const found of withoutStreet.matchAll(new RegExp(LOCATION_IN_LINE.source, "gu"))) {
      const value = `${found[1]}, ${found[2]}`
      const firstWord = found[1].split(/\s+/)[0]
      const acronym = firstWord.length >= 3 && firstWord === firstWord.toUpperCase() && !/\d/.test(firstWord)
      if (acronym || NOT_A_LOCATION.test(value)) continue
      location = value
      break
    }
    if (location) break
  }

  // The name is often ALL-CAPS, which also looks like a section heading: accept
  // any short, letter-only, punctuation-free line that is not a real section.
  const CREDENTIAL_SUFFIX =
    /\b(?:r\.?n\.?|l\.?p\.?n\.?|n\.?p\.?|b\.?s\.?n\.?|m\.?s\.?n\.?|d\.?n\.?p\.?|m\.?d\.?|d\.?o\.?|p\.?a\.?-?c?|p\.?h\.?d\.?|m\.?b\.?a\.?|c\.?p\.?a\.?|c\.?f\.?a\.?|p\.?m\.?p\.?|c\.?s\.?m\.?|p\.?e\.?|esq\.?|d\.?d\.?s\.?|d\.?v\.?m\.?|l\.?c\.?s\.?w\.?|m\.?p\.?h\.?|b\.?s\.?c?\.?|m\.?s\.?c?\.?|b\.?e\.?|m\.?e\.?|b\.?tech\.?|m\.?tech\.?|cisa|cissp|ceh|aws|azure|gcp|pmp|six sigma)\b/i

  const nameFrom = (raw: string): string => {
    // "SAMMY SPARTAN, RN, BSN" → "SAMMY SPARTAN"; "Jane Doe | Engineer" → "Jane Doe".
    const head = raw
      .split(/[|•·]/)[0]
      .split(/\s+[–—]\s+|\s+-\s+/)[0]
      .trim()
    const segments = head.split(",").map((s) => s.trim()).filter(Boolean)
    const kept: string[] = []
    for (const segment of segments) {
      // Keep the name; drop trailing credential/qualification segments.
      if (kept.length > 0 && CREDENTIAL_SUFFIX.test(segment) && segment.split(/\s+/).length <= 4) continue
      if (kept.length > 0 && /^(?:mba|phd|md|rn|bsn|msn)$/i.test(segment)) continue
      kept.push(segment)
    }
    return kept.join(" ").trim()
  }

  // Last resort: prose in the summary ("I'm a software engineer from Berlin").
  if (!location) {
    const prose = head.slice(0, 600).match(/(?:based in|located in|living in|currently in|from)\s+([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)/u)
    if (prose && !NOT_A_LOCATION.test(prose[1])) location = prose[1]
  }

  const nameLine = head.split("\n").find((line, index) => {
    let t = nameFrom(line)
    if (!t || t.length > 42) return false
    if (/[@\d]/.test(t)) return false
    if (isSectionHeading(t)) return false
    if (index > 6) return false
    if (/\b(engineer|developer|manager|analyst|designer|consultant|specialist|architect|scientist)\b/i.test(t)) return false
    // Nicknames in quotes are common ("Alexandra \"Alex\" Mercer"): test the
    // line without its quote marks, but keep the original text as the name.
    const bare = t.replace(/["'“”‘’]/g, "")
    return /^\p{L}[\p{L}'.-]*(\s+\p{L}[\p{L}'.-]*){1,3}$/u.test(bare)
  })
  return {
    fullName: nameLine ? nameFrom(nameLine) : "",
    email,
    phone: phone.replace(/\s{2,}/g, " ").slice(0, 32),
    location: location.slice(0, 60),
    links,
  }
}

function titleCaseWord(s: string): string {
  return s.replace(/\p{L}[\p{L}']*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

/** Spoken languages, only from a dedicated section or an explicit list. */
export function proposeLanguages(text: string): string[] {
  const known = ["english", "hindi", "spanish", "french", "german", "mandarin", "chinese", "japanese", "korean", "arabic", "portuguese", "russian", "italian", "dutch", "tamil", "telugu", "marathi", "bengali", "kannada", "malayalam", "gujarati", "punjabi", "urdu", "bhojpuri", "nepali", "swedish", "polish", "turkish", "vietnamese", "thai", "indonesian"]
  const out = new Set<string>()
  for (const section of splitSections(text)) {
    if (section.key !== "languages") continue
    for (const lang of known) {
      if (new RegExp(`\\b${lang}\\b`, "i").test(section.body)) {
        out.add(lang.charAt(0).toUpperCase() + lang.slice(1))
      }
    }
  }
  return [...out]
}

// ---------------------------------------------------------------------------
// Structured experience entries
// ---------------------------------------------------------------------------

export interface ParsedExperience {
  company: string
  role: string
  startDate: string
  endDate: string
  isCurrent: boolean
  bullets: string[]
}

function parseRangeLabel(label: string): { start: string; end: string; current: boolean } {
  const y = label.match(/\b(19\d{2}|20\d{2})\b/g) ?? []
  const months = [...label.matchAll(new RegExp(MONTH_NAME, "gi"))].map((m) => m[1])
  const current = new RegExp(PRESENT, "i").test(label)
  const fmt = (year?: string, month?: string): string => {
    if (!year) return ""
    const m = month ? MONTHS[month.toLowerCase()] : undefined
    return m === undefined ? year : `${year}-${String(m + 1).padStart(2, "0")}`
  }
  const start = fmt(y[0], months[0])
  const end = current ? "" : fmt(y[1] ?? (y.length > 1 ? y[1] : undefined), months[1] ?? months[0])
  return { start, end, current: current || (!!end && false) }
}

/** Parse the experience section into entries (best-effort, offline). */
export function parseExperience(text: string): ParsedExperience[] {
  const section =
    experienceSectionText(text) ??
    splitSections(text)
      .filter((s) => !["education", "certifications", "skills", "languages", "awards"].includes(s.key))
      .map((s) => s.body)
      .join("\n")
  const lines = section
    .split("\n")
    // Drop PDF page furniture: "Page 3", "3 / 12", bare page numbers. They read
    // as one-word headers and end up as a company ("Page") or a job title.
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^(?:page|cv|resume)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(t)) return false
      if (/^\d+\s*(?:\/|of)\s*\d+$/i.test(t)) return false
      if (/^\d{1,3}$/.test(t)) return false
      return true
    })

  const entries: ParsedExperience[] = []
  let current: ParsedExperience | null = null
  let pending: string[] = []

  const dateRe = new RegExp(
    `(?:${MONTH_NAME}\\s*,?\\s+\\d{4}\\s*${RANGE_SEP}(?:${MONTH_NAME}\\s*,?\\s+\\d{4}|${PRESENT})|\\b(?:19|20)\\d{2}\\s*${RANGE_SEP}(?:(?:19|20)\\d{2}|${PRESENT}))`,
    "i",
  )

  const startEntry = (line: string, rangeLabel: string): ParsedExperience => {
    const range = parseRangeLabel(rangeLabel)
    // Strip the date range and tidy separators at the *ends* only: separators in
    // the middle ("Role | Company", "Role, Company") are what we split on, so
    // they must survive this step.
    const stripDates = (value: string): string =>
      value
        .replace(dateRe, " ")
        .replace(/[()]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .replace(/^[\s,–—|:;-]+|[\s,–—|:;-]+$/g, "")
        .trim()

    const isProse = looksLikeProseLine
    const companyish = (value: string): boolean =>
      /\b(inc|ltd|llc|corp|corporation|gmbh|technologies|technology|labs?|systems|solutions|group|studio|health|bank|consulting|university|media|partners|services|software|capital|ventures|agency|clinic|hospital|school|academy|network|digital|global|holdings|industries)\b/i.test(
        value,
      ) ||
      /,[^,]*\b[A-Z]{2}\b\s*$/u.test(value) || // "… , CA"
      /^[\p{Lu}][\p{L}&.'’-]*(?:\s+[\p{Lu}][\p{L}&.'’-]*){0,3}$/u.test(value) // Capitalised words only

    const candidates = [...pending, line.trim()]
      .map(stripDates)
      .filter((v) => v.replace(/[\s|,–—()-]/g, "").length >= 3)

    // Prefer, in order: a line the role dictionary recognises, a line that is
    // not prose, then whatever is left.
    const titleLine =
      candidates.find((v) => proposeRoles(v).length > 0) ??
      candidates.find((v) => !isProse(v)) ??
      candidates[0] ??
      ""
    pending = []

    const parts = titleLine
      .split(/\s+(?:at|@)\s+|\s*[|–—]\s*|\s+-\s+|\s*,\s*/i)
      .map((p) => p.trim())
      .filter(Boolean)

    let role = proposeRoles(titleLine)[0] ?? ""
    let company = ""
    if (parts.length >= 2) {
      // Whichever part the dictionary did not claim as the role is the company.
      const rolePart = role ? parts.find((p) => p.toLowerCase().includes(role.toLowerCase())) : undefined
      const rest = parts.filter((p) => p !== rolePart)
      company = rest.find((p) => companyish(p) && !isProse(p)) ?? rest.find((p) => !isProse(p)) ?? rest[0] ?? ""
      if (!role) role = parts.find((p) => !companyish(p) && !isProse(p)) ?? parts[0]
      // A title/company line split across two pending lines: use the other one.
      if (!company) company = candidates.find((v) => v !== titleLine && companyish(v) && !isProse(v)) ?? ""
    } else {
      if (!role) role = isProse(titleLine) ? "" : titleLine
      company = candidates.find((v) => v !== titleLine && companyish(v) && !isProse(v)) ?? ""
    }
    // Drop a trailing location from the company ("Stripe, San Francisco, CA"),
    // but keep legal suffixes ("Acme, Inc.").
    const COMPANY_SUFFIX = /\b(inc|ltd|llc|l\.l\.c|corp|corporation|gmbh|plc|pty|s\.a|bv|nv|ag|oy|ab|kk|co)\b\.?$/i
    const segments = company.split(",").map((x) => x.trim()).filter(Boolean)
    while (segments.length > 1 && !COMPANY_SUFFIX.test(segments[segments.length - 1])) {
      segments.pop()
    }
    company = segments.join(", ")

    current = {
      company: company.replace(/^[\s,–—|:;-]+|[\s,–—|:;-]+$/g, "").slice(0, 80),
      role: role.slice(0, 80),
      startDate: range.start,
      endDate: range.end,
      isCurrent: range.current,
      bullets: [],
    }
    return current
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // Only real section headings are skipped: "Lead SRE - Meridian Payments"
    // looks heading-ish but is the role line we need.
    if (isSectionHeading(line)) continue
    const isBullet = /^[•\-*·▪◦‣o]\s+/.test(line)
    const rangeMatch = line.match(dateRe)

    if (isBullet) {
      if (current) current.bullets.push(line.replace(/^[•\-*·▪◦‣o]\s+/, "").slice(0, 400))
      continue
    }
    if (rangeMatch) {
      if (current) entries.push(current)
      current = startEntry(line, rangeMatch[0])
      continue
    }
    // Prose while an entry is open is a bullet whose marker was lost, not a
    // header candidate — otherwise the next date range picks it up as the role.
    if (current && looksLikeProseLine(line) && (line.length > 45 || /[.!?]$/.test(line))) {
      current.bullets.push(line.slice(0, 400))
      continue
    }
    // A title/company line whose dates sit on the next line (common layout).
    if (line.length <= 90) pending = [...pending, line].slice(-2)
  }
  if (current) entries.push(current)
  // An entry with neither a title nor a single bullet carries no information —
  // it is a stray date range, not a job.
  return entries.filter((e) => (e.role && e.role.trim().length > 2) || e.bullets.length > 0).slice(0, 12)
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function proposeProjects(text: string): string[] {
  const out: string[] = []
  for (const section of splitSections(text)) {
    if (section.key !== "projects") continue
    for (const line of section.body.split("\n")) {
      const t = line.trim()
      if (!t || looksLikeHeading(t)) continue
      if (t.length < 12 || t.split(/\s+/).length > 30) continue
      if (/^[•\-*·▪◦‣]\s+/.test(t)) continue // bullet of a project, not a title
      // Project titles start with a name; achievement bullets start with a verb.
      if (!/^[\p{Lu}\p{N}]/u.test(t)) continue
      out.push(t.replace(/^[•\-*·▪◦‣]\s+/, "").slice(0, 220))
    }
  }
  return dedupe(out).slice(0, 8)
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

export { canonicalize, isKnownSkill }
