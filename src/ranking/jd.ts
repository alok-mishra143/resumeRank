import { canonicalize } from "../extract/ontology"
import { indexText, proposeSeniority, proposeRoles, proposeSkillMentions } from "../extract/deterministic"
import { splitSections } from "../extract/text"
import type { JobRequirements, SeniorityLevel } from "../types"

// Offline job-description analysis: sections + ontology mentions + regexes.
// No LLM: a JD is just another document to scan for known skills.

const REQUIREMENT_HEADING =
  /^(requirements?|must[\s-]?have|required|qualifications?|what you'?ll need|who you are|skills? (required|needed)|skills?|technical skills|basic qualifications?|minimum qualifications?|expected)\b/i
const PREFERRED_HEADING =
  /^(nice[\s-]to[\s-]haves?|preferred|bonus|plus(es)?|desirable|good to have|additional)\b/i
const RESPONSIBILITY_HEADING =
  /^(responsibilities|what you'?ll do|the role|duties|day[\s-]to[\s-]day|key (tasks|responsibilities)|about the role|role overview|your impact)\b/i

/** "Requirements: Go, Kubernetes" — a list that never leaves its own line. */
const INLINE_LIST = /^([A-Za-z][A-Za-z\s'/]{2,40}?)\s*[:\-–]\s*(.{3,})$/
/** Every label that can start a list segment, used to split one-liners. */
const LABEL_RE =
  /(requirements?|required|must[\s-]?have|qualifications?|technical skills|skills?|nice[\s-]to[\s-]haves?|preferred|bonus|plus(es)?|desirable|responsibilities)\s*[:\-–]\s*/gi

/** Split a one-line "Requirements: A, B. Nice to have: C" into labelled segments. */
export function parseInlineSegments(line: string): Array<{ key: "required" | "preferred" | "responsibilities"; text: string }> {
  const matches = [...line.matchAll(LABEL_RE)]
  if (matches.length === 0) return []
  const out: Array<{ key: "required" | "preferred" | "responsibilities"; text: string }> = []
  matches.forEach((match, i) => {
    const start = (match.index ?? 0) + match[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? line.length) : line.length
    const text = line.slice(start, end).trim().replace(/^[.,;:]\s*/, "")
    const label = match[1].toLowerCase()
    const key = PREFERRED_HEADING.test(label)
      ? "preferred"
      : RESPONSIBILITY_HEADING.test(label)
        ? "responsibilities"
        : "required"
    if (text.length >= 2) out.push({ key, text })
  })
  return out
}

const DOMAINS: Array<[string, RegExp]> = [
  ["fintech", /\b(fintech|payments?|banking|financial services|lending|trading|wealth|insurance|neobank|upi|cards?)\b/i],
  ["healthcare", /\b(healthcare|health ?tech|clinical|medical|patient|ehr|hipaa|telemedicine|pharma)\b/i],
  ["e-commerce", /\b(e-?commerce|marketplace|retail|checkout|cart|shopify|orders?|catalog)\b/i],
  ["edtech", /\b(ed-?tech|education|learning platform|lms|students?|courses?)\b/i],
  ["gaming", /\b(gaming|game (dev|engine)|unity|unreal|esports)\b/i],
  ["saas", /\b(saas|b2b platform|multi-?tenant|subscription|enterprise software)\b/i],
  ["logistics", /\b(logistics|supply chain|fleet|delivery|warehouse|shipping)\b/i],
  ["telecom", /\b(telecom|5g|network operator|isp)\b/i],
  // Bare "streaming" is usually event/data streaming, not a media company.
  ["media", /\b(media|ott|broadcast|publishing|news(room)?|streaming (?:service|platform|video|app))\b/i],
  ["travel", /\b(travel|booking|airline|hotel|tourism)\b/i],
  ["real estate", /\b(real estate|proptech|property)\b/i],
  ["cybersecurity", /\b(cyber ?security|security operations|soc team|threat|penetration)\b/i],
  ["AI/ML", /\b(ai|ml|machine learning|llm|genai|deep learning|data science)\b/i],
  ["crypto/web3", /\b(crypto|web3|blockchain|defi|nft|ethereum)\b/i],
  ["adtech", /\b(adtech|advertising|programmatic|campaigns?|marketing platform)\b/i],
  ["HR tech", /\b(hr ?tech|recruit(ing|ment)|talent|payroll)\b/i],
  ["automotive", /\b(automotive|vehicle|mobility|ev charging)\b/i],
  ["energy", /\b(energy|solar|utilities|grid|sustainability)\b/i],
]

const EXPERIENCE_RE = [
  /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)\s*(\d{1,2})\s*(?:\+)?\s*years?/i,
  /(?:minimum|at least|min\.?|over|more than)\s*(?:of\s*)?(\d{1,2})(?:\s*\+)?\s*years?/i,
  /(\d{1,2})\s*\+\s*years?/i,
  /(\d{1,2})\s*years?\s*(?:of\s*)?(?:professional|relevant|industry|hands-?on|software|engineering|experience)/i,
  /(\d{1,2})\s*years?\s*(?:experience|working)/i,
]

export function parseMinimumExperience(text: string): number | null {
  const head = text.slice(0, 4000)
  for (const re of EXPERIENCE_RE) {
    const m = head.match(re)
    if (!m) continue
    const value = Number(m[1])
    if (Number.isFinite(value) && value > 0 && value <= 40) return value
  }
  return null
}

interface HeadingLine {
  key: "required" | "preferred" | "responsibilities" | "other"
  index: number
}

function headingLines(lines: string[]): HeadingLine[] {
  const out: HeadingLine[] = []
  lines.forEach((line, index) => {
    // Strip markdown decoration (#, ##, **, bullets) before matching.
    const t = line
      .trim()
      .replace(/^[#*\-\s>]+/, "")
      .replace(/[:*#\s]+$/, "")
      .trim()
    if (!t || t.length > 80) return

    // A one-line list ("Requirements: Go, Kubernetes") is a section *and* its
    // content; the segment pass handles those separately.
    if (parseInlineSegments(t).length > 0) return

    const isHeadingish = t.length <= 60 && !/[.!?]$/.test(t)
    if (!isHeadingish) return
    if (REQUIREMENT_HEADING.test(t)) out.push({ key: "required", index })
    else if (PREFERRED_HEADING.test(t)) out.push({ key: "preferred", index })
    else if (RESPONSIBILITY_HEADING.test(t)) out.push({ key: "responsibilities", index })
    else out.push({ key: "other", index })
  })
  return out
}

function bullets(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^([•\-*·▪◦‣]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^([•\-*·▪◦‣]|\d+[.)])\s+/, "").trim())
    .filter((l) => l.length > 12)
}

/**
 * Deterministic JD analysis. `title` wins for the role; everything else is
 * read out of the description text.
 */
export function analyzeJobDescription(title: string, description: string): JobRequirements {
  const text = description.trim()
  const lines = text.split("\n")
  const headings = headingLines(lines)

  const sectionFor = (lineNo: number): "required" | "preferred" | "responsibilities" | "other" => {
    let current: "required" | "preferred" | "responsibilities" | "other" = "other"
    for (const h of headings) {
      if (h.index <= lineNo && h.key !== "other") current = h.key
      if (h.index > lineNo) break
    }
    return current
  }

  const idx = indexText(text)
  const mentions = proposeSkillMentions(idx, { includeAbstract: true })

  const required = new Set<string>()
  const preferred = new Set<string>()

  // One-line lists are parsed per labelled segment, so "Requirements: Go, K8s.
  // Nice to have: Terraform" keeps required and preferred apart.
  const inlineLines = new Map<number, Array<{ key: "required" | "preferred" | "responsibilities"; text: string }>>()
  idx.lines.forEach((line, i) => {
    const segments = parseInlineSegments(line.trim())
    if (segments.length > 0) inlineLines.set(i, segments)
  })
  for (const segments of inlineLines.values()) {
    for (const segment of segments) {
      for (const mention of proposeSkillMentions(indexText(segment.text), { includeAbstract: true })) {
        if (mention.confidence < 0.4) continue
        if (segment.key === "preferred") preferred.add(mention.canonical)
        else required.add(mention.canonical)
      }
    }
  }

  for (const mention of mentions) {
    // Attribute the mention to the *strongest* line it appears on, not simply the
    // first: a JD titled "Senior Backend Engineer (Go / Python)" also lists Go and
    // Python under Requirements, and the title line alone would drop them.
    const aliasRe = new RegExp(`\\b${escapeRe(mention.alias)}\\b`, "i")
    const hits = idx.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => aliasRe.test(line))
      .filter(({ index }) => !inlineLines.has(index))
    if (hits.length === 0) continue
    const rank = { required: 0, responsibilities: 1, preferred: 2, other: 3 } as const
    const best = hits.reduce((a, b) => (rank[sectionFor(a.index) as keyof typeof rank] <= rank[sectionFor(b.index) as keyof typeof rank] ? a : b))
    const lineNo = best.index
    const section = sectionFor(lineNo)
    const insideList = section !== "other"
    // Outside a requirements/responsibilities list, only a confident mention
    // counts: "we care about observability" in prose is not a requirement.
    const proseOnly = !insideList && mention.confidence < 0.72
    if (!insideList && (mention.confidence < 0.5 || proseOnly)) continue
    // Inside a list, section wins over phrasing: "Familiarity with Kafka" under
    // Requirements *is* a requirement, even though "familiarity with" reads as
    // a soft signal on a resume.
    if (section === "preferred") {
      preferred.add(mention.canonical)
      continue
    }
    if (section === "required" || section === "responsibilities") {
      required.add(mention.canonical)
      continue
    }
    // No usable headings: a mention next to must/required language is required,
    // otherwise treat it as required too (JDs list the stack either way).
    const line = lineNo >= 0 ? idx.lines[lineNo] ?? "" : ""
    if (/\b(nice|plus|bonus|preferred|desirable|familiarity)\b/i.test(line)) preferred.add(mention.canonical)
    else required.add(mention.canonical)
  }

  // Skills in the job title are requirements by definition ("DevOps / Site
  // Reliability Engineer" requires both phrases).
  if (title.trim()) {
    for (const mention of proposeSkillMentions(indexText(title), { includeAbstract: true })) {
      if (mention.confidence >= 0.6) required.add(mention.canonical)
    }
  }

  // Skills that appear only in "nice to have" never stay required.
  for (const skill of preferred) if (!/\b(must|required|strong)\b/i.test(text)) required.delete(skill)

  const role =
    (title.trim() ? titleCaseTitle(title) : "") ||
    proposeRoles(text)[0] ||
    ""

  const responsibilities = (() => {
    const idxList = headings.filter((h) => h.key === "responsibilities").map((h) => h.index)
    if (idxList.length === 0) {
      const all = bullets(text)
      return all.filter((b) => /\b(build|develop|design|own|lead|maintain|collaborate|implement|write|review|ship)\b/i.test(b)).slice(0, 8)
    }
    const start = Math.min(...idxList)
    const next = headings.find((h) => h.index > start && h.key !== "responsibilities")
    const body = lines.slice(start, next ? next.index : lines.length).join("\n")
    return bullets(body).slice(0, 8)
  })()

  const domain = DOMAINS.filter(([, re]) => re.test(text)).map(([name]) => name).slice(0, 4)
  const minimumExperience = parseMinimumExperience(text)

  return {
    role,
    requiredSkills: [...required].slice(0, 40),
    preferredSkills: [...preferred].filter((p) => !required.has(p)).slice(0, 25),
    minimumExperience,
    responsibilities,
    domain,
    level: jobLevel(title, text, minimumExperience),
  }
}

/**
 * The seniority band a posting is hiring for. Title keywords win over the years
 * bar, because "Junior Engineer, 0-2 years" and "Graduate Engineer, 1 year" say
 * the same thing while "Staff Engineer" with no bar clearly is not a junior role.
 */
export function jobLevel(title: string, description: string, minimumExperience?: number | null): SeniorityLevel {
  const head = `${title}\n${description.slice(0, 600)}`
  const titleLower = title.toLowerCase()
  // Words that signal a staff/principal scope, even in a job title with no years bar.
  if (/\b(staff|principal|architect|distinguished|fellow|head of|director|vp|chief)\b/.test(titleLower)) return "staff"
  if (/\b(lead|tech lead|team lead|manager)\b/.test(titleLower)) return "staff"
  if (/\b(senior|sr\.?)\b/.test(titleLower)) return "senior"
  if (/\b(junior|jr\.?|entry[-\s]?level|graduate|intern|trainee|apprentice)\b/.test(titleLower)) return "junior"
  if (/\b(mid|intermediate|ii\b|associate)\b/.test(titleLower)) return "mid"
  // No level in the title: fall back to the years bar, then to prose signals.
  const bar = minimumExperience ?? parseMinimumExperience(head)
  if (bar != null) {
    if (bar <= 2) return "junior"
    if (bar <= 4) return "mid"
    if (bar <= 8) return "senior"
    return "staff"
  }
  if (/\b(entry[-\s]?level|new grad|recent graduate|0-2 years)\b/i.test(head)) return "junior"
  if (/\b(10\+ years|15\+ years|deep architectural|technical leadership)\b/i.test(head)) return "staff"
  return "senior"
}

/** Seniority of a JD, useful for the report header. */
export function jobSeniority(title: string, description: string): string {
  const roles = proposeRoles(`${title}\n${description}`)
  return proposeSeniority(roles, parseMinimumExperience(description))
}

function titleCaseTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Skills in a JD, canonicalized (used by the eval harness). */
export function jdSkills(description: string): string[] {
  const idx = indexText(description)
  return proposeSkillMentions(idx)
    .filter((m) => m.confidence >= 0.5)
    .map((m) => canonicalize(m.canonical) ?? m.canonical)
}
