import { config } from "../config"
import type {
  JobRequirements,
  RankingWeights,
  ResumeMetadata,
  ScoreBreakdown,
  SeniorityLevel,
  SkillMatch,
} from "../types"
import { canonicalize, skillInfo } from "../extract/ontology"
import { coverageFromMatches, jaccard, stemSet, tokenOverlap, tokenize } from "./semantic"

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  requiredSkills: 30,
  experience: 15,
  roleSimilarity: 13,
  responsibilities: 13,
  domain: 9,
  preferredSkills: 5,
  levelFit: 16,
  leadership: 12,
}

export function getRankingWeights(): RankingWeights {
  try {
    const raw = process.env.RANKING_WEIGHTS
    if (!raw) return DEFAULT_RANKING_WEIGHTS
    return { ...DEFAULT_RANKING_WEIGHTS, ...(JSON.parse(raw) as Partial<RankingWeights>) }
  } catch {
    return DEFAULT_RANKING_WEIGHTS
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0
}

/**
 * Role similarity: token Jaccard blended with ontology-aware token overlap.
 *
 * A posting often names two roles ("Staff Backend Engineer / Architect",
 * "DevOps / Site Reliability Engineer"). Matching the whole title against the
 * candidate's title scores a real Solutions Architect at ~18%, so each
 * alternative is scored separately and the best one wins.
 */
// A ranking compares one JD against every candidate, and the UI re-ranks the same
// pool repeatedly: cache the comparison itself. Keys are short and bounded.
const ROLE_SIM_CACHE = new Map<string, number>()

export function roleSimilarity(requiredRole: string | undefined, candidateRoles: string[]): number {
  if (!requiredRole || candidateRoles.length === 0) return 0.4 // neutral when either side is unknown
  const cacheKey = `${requiredRole}\u0001${candidateRoles.join("\u0002")}`
  const cached = ROLE_SIM_CACHE.get(cacheKey)
  if (cached !== undefined) return cached
  const value = computeRoleSimilarity(requiredRole, candidateRoles)
  if (ROLE_SIM_CACHE.size >= 5_000) ROLE_SIM_CACHE.clear()
  ROLE_SIM_CACHE.set(cacheKey, value)
  return value
}

function computeRoleSimilarity(requiredRole: string, candidateRoles: string[]): number {
  const alternatives = requiredRole
    .split(/\s*(?:[/|]|\bor\b|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
  if (alternatives.length > 1) {
    return Math.max(...alternatives.map((alt) => computeRoleSimilarity(alt, candidateRoles)))
  }
  const reqSkillFacts = tokenize(requiredRole)
    .map((t) => canonicalize(t))
    .filter((x): x is string => !!x)

  let best = 0
  for (const role of candidateRoles) {
    const j = jaccard([requiredRole], [role])
    const roleTokens = stemSet(tokenize(role))
    const overlap = tokenOverlap(requiredRole, roleTokens)
    // Domain-family bonus: "frontend engineer" vs "react developer".
    let familyBonus = 0
    const roleCanonical = tokenize(role)
      .map((t) => canonicalize(t))
      .filter((x): x is string => !!x)
    if (reqSkillFacts.length > 0 && roleCanonical.length > 0) {
      const shared = reqSkillFacts.filter((r) => roleCanonical.some((c) => c === r || (skillInfo(c)?.ancestors ?? []).includes(r)))
      if (shared.length > 0) familyBonus = 0.35
    }
    const score = clamp01(0.55 * j + 0.3 * overlap + familyBonus)
    if (score > best) best = score
  }
  return best
}

function experienceScore(required: number | null | undefined, actual: number | null | undefined): number {
  if (required == null || required <= 0) return 0.7
  if (actual == null) return 0.3
  if (actual >= required) return 1
  return clamp01(actual / required)
}

const LEVEL_ORDER: SeniorityLevel[] = ["junior", "mid", "senior", "staff"]

/** The band a candidate sits in, from their stated seniority or from their years. */
export function candidateLevel(metadata: ResumeMetadata): SeniorityLevel | null {
  const stated = (metadata.seniority ?? "").toLowerCase().trim()
  if (/\b(intern|trainee|graduate|entry|junior|jr)\b/.test(stated)) return "junior"
  if (/\b(lead|staff|principal|architect|head|director|manager|vp|chief)\b/.test(stated)) return "staff"
  if (/\bsenior|sr\b/.test(stated)) return "senior"
  if (/\bmid|intermediate|associate\b/.test(stated)) return "mid"
  const years = metadata.yearsOfExperience
  if (years == null) return null
  if (years < 3) return "junior"
  if (years < 5.5) return "mid"
  if (years < 9) return "senior"
  return "staff"
}

/**
 * Fit between the posting's band and the candidate's band.
 *
 * An explicit matrix beats a distance formula here because the two directions are
 * not symmetric. Under-qualification is always penalised (a mid cannot do a staff
 * job). Over-qualification is penalised only where it actually hurts: an 8-year
 * senior answering a 1-2 year junior req is a retention risk, while a staff
 * engineer answering a senior req is a *good* hire, so that direction scores 1.
 */
/**
 * Leadership / scope evidence. For senior-and-above postings this is the signal
 * that actually separates candidates: the same years and the same stack mean very
 * different things depending on whether the person led architecture and mentored,
 * or only shipped tickets. Weighted counts, not prose generation.
 */
const LEADERSHIP_ROLE = /\b(lead|staff|principal|architect|head of|director|manager|chief)\b/gi
const LEADERSHIP_VERB =
  /\b(led|leading|mentor(?:ed|ing|s)?|managed|coach(?:ed|ing)?|hired|interview(?:ed|ing)|architect(?:ed|ing)?|owned|drove|established|scaled|set the (?:direction|roadmap)|defined the roadmap|technical leadership|cross[-\s]team)\b/gi
const LEADERSHIP_SCOPE = /\b(team of \d+|\d+ engineers|org[-\s]wide|company[-\s]wide|multiple teams|hiring|roadmap|tech lead|technical lead)\b/gi

export function leadershipScore(text: string): number {
  const roleHits = (text.match(LEADERSHIP_ROLE) ?? []).length
  const verbHits = (text.match(LEADERSHIP_VERB) ?? []).length
  const scopeHits = (text.match(LEADERSHIP_SCOPE) ?? []).length
  const weighted = roleHits * 2 + verbHits + scopeHits * 2
  if (weighted === 0) return 0.15
  if (weighted <= 2) return 0.45
  if (weighted <= 5) return 0.7
  if (weighted <= 10) return 0.85
  return 1
}

/** Does the posting itself ask for leadership scope? */
export function jobWantsLeadership(level: SeniorityLevel | null | undefined, text: string): boolean {
  if (level === "staff") return true
  return /\b(lead|leading|mentor|architect|architectural|team of|technical leadership|ownership of|roadmap|staff|principal)\b/i.test(text)
}

const LEVEL_FIT_MATRIX: Record<SeniorityLevel, Record<SeniorityLevel, number>> = {
  //                  candidate: junior  mid    senior staff
  junior: { junior: 1, mid: 0.85, senior: 0.35, staff: 0.15 },
  mid: { junior: 0.75, mid: 1, senior: 1, staff: 0.8 },
  senior: { junior: 0.25, mid: 0.6, senior: 1, staff: 1 },
  staff: { junior: 0.1, mid: 0.3, senior: 0.75, staff: 1 },
}

export function levelFitScore(
  jobLevel: SeniorityLevel | null | undefined,
  candidate: SeniorityLevel | null,
  years?: number | null,
): number {
  if (!jobLevel || !candidate) return 0.6 // neutral when either side is unknown
  const base = LEVEL_FIT_MATRIX[jobLevel][candidate]
  // A very large years gap compounds an over-qualification: 15 years against a
  // 2-year bar is a different conversation from 8 years against it.
  const jobIndex = LEVEL_ORDER.indexOf(jobLevel)
  const candidateIndex = LEVEL_ORDER.indexOf(candidate)
  if (candidateIndex > jobIndex && years != null) {
    const bar = { junior: 2, mid: 4, senior: 8, staff: 12 }[jobLevel]
    if (years >= bar * 2) return Math.max(0.05, base - 0.2)
  }
  return base
}

/** How many bands apart, for the mismatch/exclusion rules. */
export function levelDistance(jobLevel: SeniorityLevel | null | undefined, candidate: SeniorityLevel | null): number | null {
  if (!jobLevel || !candidate) return null
  return Math.abs(LEVEL_ORDER.indexOf(jobLevel) - LEVEL_ORDER.indexOf(candidate))
}

/**
 * Requirement coverage over free text (responsibilities / domain keywords).
 * Graded: a responsibility is satisfied proportionally to how many of its
 * distinctive tokens appear in the resume text.
 */
function textCoverage(needles: string[], textTokens: Set<string>): number {
  if (needles.length === 0) return 0.5
  let sum = 0
  for (const needle of needles) {
    const o = tokenOverlap(needle, textTokens)
    sum += o >= 0.75 ? 1 : o >= 0.5 ? 0.7 : o
  }
  return clamp01(sum / needles.length)
}

export interface DeterministicInput {
  requirements: JobRequirements
  metadata: ResumeMetadata
  resumeText: string
  skillMatches: SkillMatch[]
  /** The posting's own text — used to decide whether leadership is being asked for. */
  jobDescription?: string
  weights?: RankingWeights
}

export interface DeterministicResult {
  score: number
  breakdown: ScoreBreakdown
  mismatch: boolean
  mismatchReasons: string[]
}

export function deterministicScore(input: DeterministicInput): DeterministicResult {
  const weights = input.weights ?? getRankingWeights()
  const req = input.requirements
  const meta = input.metadata
  const textTokens = stemSet(tokenize(input.resumeText))

  const requiredSkills = coverageFromMatches(input.skillMatches)
  const requiredCount = (req.requiredSkills ?? []).length
  const hardMatched = input.skillMatches.filter((m) => m.score >= 0.6).length

  const experience = experienceScore(req.minimumExperience, meta.yearsOfExperience)
  const level = candidateLevel(meta)
  const levelFit = levelFitScore(req.level, level, meta.yearsOfExperience)
  // Leadership only counts when the posting asks for it, and then it is weighted:
  // an unasked-for extra must not dilute the score.
  // Only the posting decides this — never the candidate's own prose.
  const wantsLeadership = jobWantsLeadership(req.level, `${req.role ?? ""} ${input.jobDescription ?? ""} ${(req.responsibilities ?? []).join(" ")}`)
  const leadership = wantsLeadership ? leadershipScore(input.resumeText) : null
  const role = roleSimilarity(req.role, meta.roles ?? [])
  const responsibilities = textCoverage(req.responsibilities ?? [], textTokens)
  const domain = textCoverage(req.domain ?? [], textTokens)

  // Preferred skills: cheap semantic pass over the same skill set.
  const preferred = req.preferredSkills?.length
    ? clamp01(
        req.preferredSkills
          .map((p) => {
            const canonical = canonicalize(p) ?? p
            const hit = availableSkillScore(canonical, meta.skills ?? [])
            return hit
          })
          .reduce((a, b) => a + b, 0) / req.preferredSkills.length,
      )
    : 0.5

  const breakdown: ScoreBreakdown = {
    requiredSkills: round1(requiredSkills * 100),
    experience: round1(experience * 100),
    roleSimilarity: round1(role * 100),
    responsibilities: round1(responsibilities * 100),
    domain: round1(domain * 100),
    preferredSkills: round1(preferred * 100),
    levelFit: round1(levelFit * 100),
    leadership: leadership === null ? null : round1(leadership * 100),
  }

  const totalWeight =
    weights.requiredSkills + weights.experience + weights.roleSimilarity +
    weights.responsibilities + weights.domain + weights.preferredSkills + weights.levelFit +
    (leadership === null ? 0 : weights.leadership)
  const raw =
    totalWeight === 0
      ? 0
      : (requiredSkills * weights.requiredSkills +
          experience * weights.experience +
          role * weights.roleSimilarity +
          responsibilities * weights.responsibilities +
          domain * weights.domain +
          preferred * weights.preferredSkills +
          levelFit * weights.levelFit +
          (leadership === null ? 0 : leadership * weights.leadership)) /
        totalWeight

  // Mismatch labelling: surfaced on every result so a reviewer sees why a
  // candidate was flagged, and used for the hard exclusion list.
  const mismatchReasons: string[] = []
  if (requiredCount > 0 && requiredSkills < config.ranking.mismatchThreshold) {
    mismatchReasons.push(
      `required-skill coverage ${(requiredSkills * 100).toFixed(0)}% is below the ${(config.ranking.mismatchThreshold * 100).toFixed(0)}% floor (${hardMatched}/${requiredCount} matched)`,
    )
  }
  if (requiredCount > 0 && requiredSkills < 0.6 && domain < 0.35) {
    mismatchReasons.push("out-of-domain candidate: neither the skills nor the domain keywords line up")
  }
  if (req.level && level) {
    const distance = Math.abs(LEVEL_ORDER.indexOf(req.level) - LEVEL_ORDER.indexOf(level))
    const over = LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(req.level)
    if (distance >= 3) {
      mismatchReasons.push(
        `seniority mismatch: the posting is ${req.level}, this candidate reads as ${level} (${
          over ? "far above the level advertised" : "below the level required"
        })`,
      )
    } else if (distance === 2) {
      mismatchReasons.push(
        `level mismatch: the posting is ${req.level}, this candidate reads as ${level} (${
          over ? "well above the level — likely to be under-challenged" : "well below the level — likely to be stretched"
        })`,
      )
    }
  }
  if (req.minimumExperience != null && req.minimumExperience > 0 && meta.yearsOfExperience != null) {
    const ratio = meta.yearsOfExperience / req.minimumExperience
    if (ratio < 0.5) {
      mismatchReasons.push(
        `experience ${meta.yearsOfExperience} yrs is less than half of the ${req.minimumExperience} yrs required`,
      )
    }
  }

  return {
    score: round1(clamp01(raw) * 100),
    breakdown,
    mismatch: mismatchReasons.length > 0,
    mismatchReasons,
  }
}

/**
 * Hard exclusion: only candidates that plainly belong to a different field.
 * Everything else keeps a rank and carries a mismatch flag instead of being
 * dropped, so the shortlist never hides a plausible candidate.
 */
export function shouldExclude(input: {
  requiredCount: number
  requiredCoverage: number
  domainScore: number
  roleScore: number
  /** Two bands apart: a staff engineer answering a junior req, or the reverse. */
  levelDistance?: number | null
  jobLevel?: SeniorityLevel | null
  candidateLevel?: SeniorityLevel | null
}): { exclude: boolean; reason: string } {
  // Level mismatch. For an entry-level posting, over-qualification *is* the
  // disqualifier — a posted junior role screens out seniors and staff, which is
  // why the threshold is two bands there and three everywhere else. On a
  // senior/staff posting the same candidate keeps a rank and a flag instead.
  const distance = input.levelDistance ?? 0
  const bar = input.jobLevel === "junior" ? 2 : 3
  if (distance >= bar) {
    const over = LEVEL_ORDER.indexOf(input.candidateLevel ?? "mid") > LEVEL_ORDER.indexOf(input.jobLevel ?? "mid")
    return {
      exclude: true,
      reason: `seniority mismatch: the posting is ${input.jobLevel}, this candidate reads as ${input.candidateLevel} (${
        over ? `${distance === 2 ? "two" : "three"} bands over — above the level advertised` : `${distance === 2 ? "two" : "three"} bands under — below the level required`
      })`,
    }
  }
  if (input.requiredCount === 0) return { exclude: false, reason: "" }
  if (input.requiredCoverage < config.ranking.hardFloor) {
    return {
      exclude: true,
      reason: `matches only ${(input.requiredCoverage * 100).toFixed(0)}% of the required skills (hard floor ${(config.ranking.hardFloor * 100).toFixed(0)}%)`,
    }
  }
  if (input.requiredCoverage < 0.3 && input.domainScore < 0.2 && input.roleScore < 0.3) {
    return {
      exclude: true,
      reason: "different field: required skills, domain keywords and role all point elsewhere",
    }
  }
  return { exclude: false, reason: "" }
}

/** Best score for a single skill label against a list of candidate skills. */
function availableSkillScore(requirement: string, candidateSkills: string[]): number {
  const reqLower = requirement.toLowerCase()
  for (const raw of candidateSkills) {
    const cand = canonicalize(raw) ?? raw
    if (cand.toLowerCase() === reqLower) return 1
    const info = skillInfo(cand)
    if (info?.ancestors.some((a) => a.toLowerCase() === reqLower)) return 1
    if (info?.descendants.some((d) => d.toLowerCase() === reqLower)) return config.semantic.descendantCredit
  }
  return 0
}

/** Blend of deterministic and Jev fit scores. */
export function finalScore(deterministic: number, ai: number): number {
  const w = config.ranking.deterministicWeight
  return Math.round((w * deterministic + (1 - w) * ai) * 10) / 10
}
