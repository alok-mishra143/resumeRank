import { AppError } from "../errors"

// Offline text extraction: PDF (pdf.js via unpdf), DOCX (mammoth), TXT.
// No network access, no external services.

const MAX_CHARS = 200_000
const SUPPORTED = new Set([".pdf", ".docx", ".txt", ".md", ".text"])

export function supportedExtensions(): string[] {
  return [...SUPPORTED].filter((e) => e !== ".md" && e !== ".text")
}

export function extOf(filename: string): string {
  const i = filename.lastIndexOf(".")
  return i >= 0 ? filename.slice(i).toLowerCase() : ""
}

export async function extractTextFromBuffer(filename: string, data: Buffer): Promise<string> {
  const ext = extOf(filename)
  if (!SUPPORTED.has(ext) || ext === ".text") {
    throw new AppError(
      "UNSUPPORTED_FILE",
      `Unsupported file type "${ext || "(none)"}". Use PDF, DOCX, or TXT.`,
    )
  }
  if (data.length === 0) throw new AppError("INVALID_DOCUMENT", `File "${filename}" is empty.`)

  const raw = await parseBuffer(ext, filename, data)
  const text = normalizeText(raw)
  if (text.replace(/[\s\p{P}]/gu, "").length < 40) {
    throw new AppError(
      "EMPTY_RESUME",
      `No readable text in "${filename}" (scanned-image PDFs without a text layer are not supported).`,
    )
  }
  return text.slice(0, MAX_CHARS)
}

async function parseBuffer(ext: string, filename: string, data: Buffer): Promise<string> {
  try {
    if (ext === ".pdf") return await extractPdf(data)
    if (ext === ".docx") return (await import("mammoth")).default.extractRawText({ buffer: data }).then((r) => r.value ?? "")
    return data.toString("utf-8")
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError(
      "INVALID_DOCUMENT",
      `Could not parse "${filename}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function extractPdf(data: Buffer): Promise<string> {
  const { extractText } = await import("unpdf")
  // pdf.js can detach the input buffer; hand it a private copy.
  const bytes = new Uint8Array(data.byteLength)
  bytes.set(data)
  const result = await extractText(bytes, { mergePages: true })
  if (Array.isArray(result.text)) return result.text.join("\n")
  if (typeof result.text === "string") return result.text
  return ""
}

/** Normalize whitespace and de-hyphenate line-wrapped words. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim()
}

export interface Section {
  /** Normalized section key: skills | experience | projects | education | certifications | summary | languages | awards | other */
  key: string
  heading: string
  body: string
  /** Line offset of the heading inside the document. */
  startLine: number
}

const SECTION_PATTERNS: Array<[string, RegExp]> = [
  ["summary", /^(professional\s+)?(summary|profile|objective|about( me)?|overview)\b/i],
  ["skills", /^(technical\s+|core\s+|key\s+|relevant\s+)?(skills|competencies|technologies|tech\s+stack|technology\s+stack|toolkit|expertise|proficienc)/i],
  ["experience", /^(work\s+|professional\s+|relevant\s+|employment\s+)?(experience|employment|work history|career history|career|positions held)\b/i],
  ["projects", /^(personal\s+|selected\s+|notable\s+|key\s+)?projects?(\s+(and|&)\s+\w+)?\b/i],
  ["education", /^(education|academic(s| background)?|qualifications)\b/i],
  ["certifications", /^(certifications?|licenses?|courses?|training)\b/i],
  ["languages", /^(languages?|spoken languages)\b/i],
  ["awards", /^(awards?|achievements?|honors?|publications?|volunteering)\b/i],
]

/** True for a short standalone heading line (ALL-CAPS, Title Case or lowercase). */
/**
 * A prose line ("Built core product capabilities for an AI-native platform…")
 * is a bullet that lost its marker in PDF extraction — never a job title or a
 * company. Kept next to looksLikeHeading because the two are opposites.
 */
export function looksLikeProseLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (t.split(/\s+/).length > 9) return true
  if (/[.!?]$/.test(t)) return true
  return /^(built|designed|led|created|improved|managed|developed|worked|owned|drove|delivered|responsible|helped|supported|contributed|implemented|maintained|analy[sz]ed|collaborated|wrote|shipped|ran|used|tested|automated|reduced|increased|partnered|mentored|migrated|scaled|monitored|reviewed|coordinated|assisted|ensured|provided|performed|conducted|trained|taught|oversaw|achieved|generated|presented|documented|spearheaded|streamlined|established)/i.test(
    t,
  )
}

export function looksLikeHeading(line: string): boolean {
  const t = line.trim().replace(/[:\-–—]\s*$/, "").trim()
  if (t.length < 3 || t.length > 48) return false
  if (/\d{4}/.test(t)) return false
  if (t.split(/\s+/).length > 6) return false
  if (/[.!?]$/.test(t)) return false
  if (/^[•\-*·▪◦‣]/.test(t)) return false
  // Sections are written in ALL CAPS, Title Case, or lowercase — but never as
  // a full sentence with punctuation inside.
  if (/[,;:]/.test(t)) return false
  return /^[\p{L}][\p{L}\p{N}\s&/()'.,+-]*$/u.test(t)
}

/** Heading words that end a section but are not interesting on their own. */
export function sectionKeyFor(line: string): string | null {
  const t = line.trim().replace(/[:\-–—]\s*$/, "").trim()
  if (!looksLikeHeading(t)) return null
  for (const [key, re] of SECTION_PATTERNS) {
    const m = t.match(re)
    if (!m) continue
    // The pattern must consume essentially the whole line, so that
    // "Experience with Kubernetes and AWS" is not mistaken for a heading.
    const remainder = t.slice(m[0].length).trim()
    if (remainder.length === 0) return key
    if (remainder.split(/\s+/).filter(Boolean).length <= 2 && !/\d/.test(remainder) && remainder.length <= 16) {
      return key
    }
  }
  return null
}

/**
 * True only for real section headings (EXPERIENCE, Skills, …). Job-title lines
 * such as "Lead SRE - Meridian Payments" look heading-ish but are content, so
 * callers that need to keep titles must use this instead of looksLikeHeading.
 */
export function isSectionHeading(line: string): boolean {
  return sectionKeyFor(line) !== null
}

/**
 * Split a resume into headed sections. When a resume has no recognizable
 * headings the whole text comes back as a single "other" section.
 */
export function splitSections(text: string): Section[] {
  const lines = text.split("\n")
  const sections: Section[] = []
  let current: Section | null = null
  let pendingOther: string[] = []

  const flush = () => {
    if (current) {
      current.body = current.body.trim()
      sections.push(current)
      current = null
    }
    if (pendingOther.length) {
      const body = pendingOther.join("\n").trim()
      if (body) sections.push({ key: "other", heading: "", body, startLine: 0 })
      pendingOther = []
    }
  }

  lines.forEach((line, index) => {
    const key = sectionKeyFor(line)
    if (key) {
      flush()
      current = { key, heading: line.trim(), body: "", startLine: index }
      return
    }
    if (current) current.body += `${line}\n`
    else pendingOther.push(line)
  })
  flush()

  if (sections.length === 0) {
    return [{ key: "other", heading: "", body: text, startLine: 0 }]
  }
  return sections.filter((s) => s.body.length > 0 || s.key !== "other")
}

/** Text of the experience section, or null when the resume has none. */
export function experienceSectionText(text: string): string | null {
  const sections = splitSections(text).filter((x) => x.key === "experience" && x.body.length > 20)
  if (sections.length === 0) return null
  return sections.map((x) => x.body).join("\n")
}

/**
 * Text used for experience-year parsing. Prefers a real EXPERIENCE section;
 * otherwise uses everything except education/certification/summary blocks so
 * degree dates are never counted as work history.
 */
export function experienceText(text: string): string {
  const section = experienceSectionText(text)
  if (section) return section
  const excluded = new Set(["education", "certifications", "summary", "languages", "awards", "skills"])
  return splitSections(text)
    .filter((s) => !excluded.has(s.key))
    .map((s) => s.body)
    .join("\n")
}
