// Semantic matching layer.
//
// The rule that makes "AWS matches S3" work:
//   * candidate skill X IMPLIES requirement R  -> full credit   (S3  ⇒ AWS)
//   * requirement R IMPLIES candidate skill X  -> partial credit (AWS ⇒ S3, 0.8)
//   * lexical/alias/token similarity            -> proportional credit
//   * optional Jev judgement for the leftovers  -> typed noul probability
//
// Everything is one-way by design: knowing S3 means you know AWS; knowing AWS
// does not mean you know S3. That distinction is what stops mismatched
// candidates from being ranked above genuinely qualified ones.

import { config } from "../config"
import { canonicalize, isPlatformUmbrella, knownSkills, skillInfo } from "../extract/ontology"
import type { SkillMatch } from "../types"
import { noul, pTrue, systemOneSafe } from "../ai/jev"
import type { Question } from "../ai/jev"

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "as", "at", "by",
  "is", "are", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "should", "could", "can", "may", "might", "must", "you", "your", "we", "our",
  "they", "their", "it", "its", "this", "that", "these", "those", "from", "into", "across",
  "including", "etc", "e.g", "i.e", "work", "working", "experience", "experiences",
  "strong", "good", "excellent", "knowledge", "understanding", "ability", "able", "plus",
  "nice", "must", "required", "requirements", "responsibilities", "role", "job", "team",
  "years", "year", "yrs", "minimum", "least", "such", "other", "new", "well", "also",
  "help", "support", "using", "use", "used", "uses", "based", "across", "within", "like",
])

// tokenize / stem / stemSet are pure and called thousands of times per ranking
// (every role comparison re-tokenises the same words), so their results are
// memoised. The key space is tiny — the words that appear in resumes and JDs.
const TOKENIZE_CACHE = new Map<string, string[]>()
const STEM_CACHE = new Map<string, string>()
const STEMSET_CACHE = new Map<string, Set<string>>()
const CACHE_LIMIT = 20_000

function remember<K, V>(cache: Map<K, V>, key: K, value: V): V {
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, value)
  return value
}

export function tokenize(text: string): string[] {
  const cached = TOKENIZE_CACHE.get(text)
  if (cached) return cached
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./\s-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  return remember(TOKENIZE_CACHE, text, tokens)
}

/** Crude stemmer: enough to align "modeling/modelling", "testing/tests". */
export function stem(token: string): string {
  const cached = STEM_CACHE.get(token)
  if (cached) return cached
  let t = token
  if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`
  else if (t.length > 4 && t.endsWith("es") && !t.endsWith("ses")) t = t.slice(0, -2)
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1)
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3)
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2)
  return remember(STEM_CACHE, token, t)
}

export function stemSet(tokens: string[]): Set<string> {
  // Keyed on the token list; identical lists recur across candidates and runs.
  const key = tokens.length < 64 ? tokens.join("\u0001") : ""
  if (key) {
    const cached = STEMSET_CACHE.get(key)
    if (cached) return cached
  }
  const set = new Set(tokens.map(stem))
  if (key) remember(STEMSET_CACHE, key, set)
  return set
}

/** Overlap of distinctive tokens, 0..1. */
export function tokenOverlap(needle: string, haystackTokens: Set<string>): number {
  const tokens = tokenize(needle)
  if (tokens.length === 0) return 0
  let hit = 0
  for (const token of tokens) {
    const s = stem(token)
    if (haystackTokens.has(s)) {
      hit += 1
      continue
    }
    // prefix match for compounds ("microservice" vs "microservices")
    if (s.length >= 5) {
      for (const h of haystackTokens) {
        if (h.startsWith(s.slice(0, 5)) || s.startsWith(h.slice(0, 5))) {
          hit += 0.6
          break
        }
      }
    }
  }
  // A short needle with one strong token should not be diluted to nothing.
  const ratio = hit / tokens.length
  return Math.min(1, tokens.length <= 2 ? Math.min(1, ratio * 1.15) : ratio)
}

/** Jaccard similarity used for role comparison. */
export function jaccard(a: string[], b: string[]): number {
  const sa = stemSet(a.flatMap((s) => tokenize(s)))
  const sb = stemSet(b.flatMap((s) => tokenize(s)))
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter += 1
  return inter / (sa.size + sb.size - inter)
}

export interface SkillVerdict {
  score: number
  via: string
  evidence: string
}

/** Score one candidate skill label against one requirement label. */
export function matchSkillPair(
  requirement: string,
  candidateSkills: string[],
): SkillVerdict {
  const reqCanonical = canonicalize(requirement)
  const reqKey = (reqCanonical ?? requirement).toLowerCase()

  // 1. exact / alias match on canonical names
  for (const raw of candidateSkills) {
    const cand = canonicalize(raw) ?? raw
    if (cand.toLowerCase() === reqKey) {
      return { score: 1, via: cand === requirement ? "exact" : "alias", evidence: raw }
    }
  }

  // 2. candidate skill implies the requirement (S3 ⇒ AWS): full credit
  if (reqCanonical) {
    for (const raw of candidateSkills) {
      const cand = canonicalize(raw) ?? raw
      const info = skillInfo(cand)
      if (info?.ancestors.some((a) => a.toLowerCase() === reqKey)) {
        return { score: 1, via: "specific", evidence: `${raw} ⇒ ${reqCanonical}` }
      }
    }
  }

  // 3. requirement implies the candidate skill (req "S3" vs candidate "AWS"):
  //    partial credit — the candidate knows the platform, not the service.
  //
  // Only genuine platform/umbrella relations count here. A prerequisite is not
  // a platform: TensorFlow implies Python, but a candidate who only knows Python
  // has not demonstrated TensorFlow, so language and practice ancestors are
  // excluded from the credit (otherwise "Python" answered a PyTorch requirement).
  if (reqCanonical) {
    const reqInfo = skillInfo(reqCanonical)
    if (reqInfo) {
      // Only a platform that owns concrete services may cover a specific
      // requirement from above. Everything else is a standard or a concept, and
      // knowing SQL (or "Containers", or "Cloud") does not demonstrate
      // PostgreSQL (or Docker, or AWS): those need the product named, or the
      // typed layer to confirm it.
      const coveringParents = reqInfo.ancestors.filter((ancestor) => {
        const info = skillInfo(ancestor)
        if (!info || info.abstract) return false
        if (info.category === "language" || info.category === "practice") return false
        return isPlatformUmbrella(info.canonical)
      })
      for (const raw of candidateSkills) {
        const cand = canonicalize(raw) ?? raw
        const inFamily = coveringParents.some((a) => a.toLowerCase() === cand.toLowerCase())
        if (inFamily) {
          return {
            score: config.semantic.descendantCredit,
            via: "platform",
            evidence: `${raw} ~ ${reqCanonical} (same platform)`,
          }
        }
      }
    }
  }

  // 4. lexical similarity for anything not in the ontology
  const candTokens = stemSet(candidateSkills.flatMap((s) => [...tokenize(s), ...s.split(/[\s/]+/).map((x) => x.toLowerCase())]))
  const overlap = tokenOverlap(requirement, candTokens)
  if (overlap >= config.semantic.lexicalFloor) {
    return { score: Math.min(0.95, overlap), via: "lexical", evidence: requirement }
  }

  return { score: 0, via: "none", evidence: "" }
}

/**
 * Match a list of requirements against a candidate's skills.
 * `jevAssist` enables a batched Jev judgement for unmatched requirements that
 * name a known skill (typed noul answer, fail-open).
 */
export async function matchRequirements(
  requirements: string[],
  candidateSkills: string[],
  options: { jevAssist?: boolean; jevState?: unknown } = {},
): Promise<SkillMatch[]> {
  const matches: SkillMatch[] = requirements.map((req) => {
    const verdict = matchSkillPair(req, candidateSkills)
    return {
      requirement: req,
      canonical: canonicalize(req) ?? req,
      matched: verdict.score >= 0.6,
      score: verdict.score,
      via: verdict.via,
      evidence: verdict.evidence,
    }
  })

  const unresolved = matches.filter((m) => m.score === 0)
  if (!options.jevAssist || unresolved.length === 0 || unresolved.length > 60) return matches

  // Only ask about requirements whose canonical form is a known skill.
  const askable = unresolved.filter((m) => knownSkills().includes(m.canonical))
  if (askable.length === 0) return matches

  const questions: Record<string, Question> = {}
  askable.forEach((m, i) => {
    questions[`sem__${i}`] = noul(
      `Does a candidate whose stated experience is exactly \`candidate_skills\` satisfy a requirement for "${m.canonical}"? A broader platform skill counts only if the candidate names a concrete service of it. Answer no when the candidate names nothing that belongs to that technology.`,
      {
        true: "the candidate's listed skills demonstrate this requirement",
        false: "the candidate's listed skills do not demonstrate this requirement",
      },
    )
  })

  const res = await systemOneSafe(
    options.jevState ?? { candidate_skills: candidateSkills, requirements: askable.map((m) => m.canonical) },
    questions,
  )
  if (!res) return matches

  askable.forEach((m, i) => {
    const p = pTrue(res.answers, `sem__${i}`)
    if (p === null) return
    const target = matches.find((x) => x.requirement === m.requirement)
    if (!target) return
    if (p >= config.typesafe.keepThreshold) {
      target.score = Math.max(target.score, Math.round(p * 100) / 100)
      target.matched = true
      target.via = "jev"
      target.evidence = `jev P=${p.toFixed(2)}`
    }
  })
  return matches
}

/** Fraction of requirements satisfied (0..1), using graded match scores. */
export function coverageFromMatches(matches: SkillMatch[]): number {
  if (matches.length === 0) return 0.5 // no requirement -> neutral
  const total = matches.reduce((sum, m) => sum + m.score, 0)
  return total / matches.length
}

/**
 * True when two canonical skills are in the same family in the ontology —
 * either one implies the other, or they share a broader skill (S3 ~ Lambda,
 * EKS ~ GKE via Kubernetes, XGBoost ~ scikit-learn via Machine Learning).
 */
export function relatedSkills(a: string, b: string): boolean {
  const ca = canonicalize(a) ?? a
  const cb = canonicalize(b) ?? b
  if (ca.toLowerCase() === cb.toLowerCase()) return true
  const ia = skillInfo(ca)
  const ib = skillInfo(cb)
  if (!ia && !ib) return false
  if (ia?.ancestors.includes(cb) || ia?.descendants.includes(cb)) return true
  if (ib?.ancestors.includes(ca) || ib?.descendants.includes(ca)) return true
  const shared = (ia?.ancestors ?? []).filter((ancestor) => (ib?.ancestors ?? []).includes(ancestor))
  return shared.length > 0
}
