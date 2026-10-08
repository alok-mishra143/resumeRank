import { config } from "../config"
import { AppError } from "../errors"
import type {
  CandidateAnalysis,
  JobRequirements,
  Judgement,
  RankedItem,
  RankingRecord,
  ResumeMetadata,
  SkillMatch,
} from "../types"
import { noul, noulPercent, pTrue, systemOneSafe, stats } from "../ai/jev"
import type { Question } from "../ai/jev"
import { analyzeJobDescription } from "./jd"
import { coverageFromMatches, matchRequirements } from "./semantic"
import { candidateLevel, deterministicScore, finalScore, getRankingWeights, levelDistance, shouldExclude } from "./scoring"
import {
  addRanking,
  getRanking as storeGetRanking,
  listRankings as storeListRankings,
  listResumes,
  newId,
  resumeText,
  shortId,
} from "../store/local"
import type { ResumeSummary } from "../store/local"

// ---------------------------------------------------------------------------
// Ranking pipeline (no database): load the local index -> semantic +
// deterministic scoring -> hard mismatch gate -> Typed Jev fit battery ->
// blend -> persist a ranking record as JSON.
// ---------------------------------------------------------------------------

export interface RankOptions {
  title: string
  description: string
  /** Disable the cloud fit battery for this run. */
  offline?: boolean
  /** Keep mismatched candidates in the output instead of only listing them. */
  includeMismatches?: boolean
  limit?: number
  /** Persist the result in the local ranking history (default true). */
  saveRanking?: boolean
}

export interface RankJobResult {
  rankingId: string
  jobTitle: string
  requirements: JobRequirements
  model: string
  results: RankedItem[]
  excluded: RankingRecord["excluded"]
  usage: { input_tokens?: number; output_tokens?: number }
  mismatches: CandidateAnalysis[]
  /** Candidates scored (after the mismatch gate unless includeMismatches). */
  candidateCount: number
  /** Share of the final score from deterministic scoring, plus the component weights. */
  deterministicWeight: number
  weights: RankingRecord["weights"]
  /** True when nobody cleared the gate and the closest candidates were shown. */
  fellBack?: boolean
}

function candidateSummary(
  resume: ResumeSummary,
  text: string,
  skillMatches: SkillMatch[],
): Record<string, unknown> {
  return {
    filename: resume.originalFilename,
    headline: resume.metadata.roles?.[0] ?? "",
    seniority: resume.metadata.seniority ?? "",
    domain: resume.metadata.domain ?? "",
    years_of_experience: resume.metadata.yearsOfExperience ?? null,
    skills: (resume.metadata.skills ?? []).slice(0, 30),
    matched_required_skills: skillMatches.filter((m) => m.matched).map((m) => m.requirement).slice(0, 20),
    missing_required_skills: skillMatches.filter((m) => !m.matched).map((m) => m.requirement).slice(0, 20),
    education: resume.metadata.education ?? [],
    certifications: resume.metadata.certifications ?? [],
    // The excerpt is what makes the typed battery expensive: every character goes
    // into the state once per candidate. 1,200 chars covers the summary, the
    // current role and the skills list, which is what the questions actually ask
    // about; the full text is still used locally for scoring.
    resume_excerpt: text.slice(0, 1200),
  }
}

/**
 * A one-line, auditable explanation of the rank: what covered the requirements,
 * what only matched at platform level, what is missing, the experience bar and
 * the typed Jev read. Built from the same numbers the scorer used.
 */
function verdictFor(
  matches: SkillMatch[],
  metadata: ResumeMetadata,
  requirements: JobRequirements,
  fit: { skills: number; experience: number; overall: number; model: string; levelDistance?: number | null },
): string {
  const requiredNames = new Set((requirements.requiredSkills ?? []).map((s) => s.toLowerCase()))
  const optionalNames = new Set((requirements.preferredSkills ?? []).map((s) => s.toLowerCase()))
  const required = matches.filter((m) => requiredNames.has(m.requirement.toLowerCase()))
  const optional = matches.filter((m) => optionalNames.has(m.requirement.toLowerCase()))
  const hit = required.filter((m) => m.score > 0).length
  const total = requirements.requiredSkills?.length ?? 0

  const parts: string[] = []
  if (total) parts.push(`covers ${hit}/${total} required skills`)
  else if (required.length) parts.push(`${hit} requirement${hit === 1 ? "" : "s"} matched`)

  // Semantic wins are the interesting ones: "AWS" satisfied by S3/Lambda.
  const platform = required.filter((m) => m.score > 0 && m.via !== "exact" && m.via !== "alias")
  if (platform.length) {
    parts.push(`platform-level: ${platform.slice(0, 3).map((m) => `${m.requirement} via ${m.via}`).join(", ")}`)
  }

  const misses = required.filter((m) => m.score === 0).map((m) => m.requirement)
  if (misses.length) {
    parts.push(`no evidence for ${misses.slice(0, 3).join(", ")}${misses.length > 3 ? ` +${misses.length - 3} more` : ""}`)
  } else if (total) {
    parts.push("nothing missing")
  }
  if (optional.length) {
    const bonus = optional.filter((m) => m.score > 0).length
    parts.push(`${bonus}/${optional.length} preferred`)
  }

  const years = metadata.yearsOfExperience ?? null
  const min = requirements.minimumExperience ?? null
  if (years !== null) parts.push(min ? `${years} yrs vs ${min} required` : `${years} yrs experience`)
  else if (min) parts.push(`experience not stated (${min} required)`)
  if (requirements.level && metadata.seniority) {
    parts.push(`${metadata.seniority} track vs ${requirements.level} posting`)
  } else if (metadata.seniority) {
    parts.push(`${metadata.seniority} track`)
  }
  if (requirements.level && fit.levelDistance !== undefined && fit.levelDistance !== null && fit.levelDistance >= 2) {
    parts.push(`level mismatch (${fit.levelDistance} bands)`)
  }
  if (metadata.domain && metadata.domain !== "general") parts.push(`${metadata.domain} domain`)

  if (fit.model !== "offline") {
    parts.push(`Jev skills ${fit.skills}% · experience ${fit.experience}% · overall ${fit.overall}%`)
  }

  return parts.join(" — ")
}

/** Required/preferred hit counts for one candidate's match set. */
function hitCounts(matches: SkillMatch[], requirements: JobRequirements) {
  const required = new Set((requirements.requiredSkills ?? []).map((s) => s.toLowerCase()))
  const preferred = new Set((requirements.preferredSkills ?? []).map((s) => s.toLowerCase()))
  let requiredHits = 0
  let preferredHits = 0
  for (const match of matches) {
    const key = match.requirement.toLowerCase()
    if (match.score <= 0) continue
    if (required.has(key)) requiredHits += 1
    else if (preferred.has(key)) preferredHits += 1
  }
  return { requiredHits, preferredHits }
}

function buildAnalysis(
  required: string[],
  matches: SkillMatch[],
  metadata: ResumeMetadata,
  deterministic: number,
  fit: number,
  minimumExperience: number | null | undefined,
  mismatch: boolean,
  mismatchReasons: string[],
): CandidateAnalysis {
  const matched = matches.filter((m) => m.matched)
  const missing = matches.filter((m) => !m.matched)
  const parts = [`Matched ${matched.length} of ${matches.length} required skills.`]
  if (minimumExperience != null && minimumExperience > 0) {
    const have = metadata.yearsOfExperience
    parts.push(
      have != null
        ? `Experience ${have} yrs against ${minimumExperience} required.`
        : `Experience unknown against ${minimumExperience} required.`,
    )
  }
  parts.push(`Semantic/deterministic ${deterministic}, Jev fit ${fit}.`)
  if (mismatch) parts.push(`MISMATCH: ${mismatchReasons.join("; ")}.`)
  return {
    score: fit,
    strengths: matched.slice(0, 6).map((m) => m.requirement),
    gaps: missing.slice(0, 6).map((m) => m.requirement),
    matchedRequirements: matched.map((m) => m.requirement),
    missingRequirements: missing.map((m) => m.requirement),
    reasoning: parts.join(" "),
    skillMatches: matches,
    mismatch,
    mismatchReasons,
  }
}

/** Typed fit battery: three noul questions per candidate, one HTTP call total. */
export interface FitDetail {
  /** P(true) that the candidate's skills demonstrate the required skills. */
  skills: number
  /** P(true) that the candidate meets the experience bar. */
  experience: number
  /** P(true) that this is a credible hire overall. */
  overall: number
  /** Weighted blend actually used for the rank (50/20/30). */
  blended: number
  model: string
}

/** The state shape the fit battery sends; questions may only reference these keys. */
export function fitState(
  job: { title: string; description: string; requirements: JobRequirements },
  candidates: Array<{ id: string; summary: Record<string, unknown> }>,
) {
  const req = job.requirements
  return {
    job: {
      title: job.title,
      description: job.description.slice(0, 4000),
      required_skills: req.requiredSkills ?? [],
      preferred_skills: req.preferredSkills ?? [],
      minimum_experience: req.minimumExperience ?? null,
      responsibilities: req.responsibilities ?? [],
      domain: req.domain ?? [],
    },
    candidates: candidates.map((c) => c.summary),
  }
}

/**
 * The per-candidate typed battery. Questions must address `candidates[i]…`
 * because that is the array in the state — a question pointing at a field that
 * does not exist comes back hedged near 50% for every candidate, which silently
 * destroys the precision layer. `test/fit-questions.test.ts` guards this.
 */
export function fitQuestions(candidates: Array<{ id: string; summary: Record<string, unknown> }>): Record<string, Question> {
  const questions: Record<string, Question> = {}
  candidates.forEach((c, i) => {
    const at = `candidates[${i}]`
    questions[`fit__${i}__skills`] = noul(
      `Does \`${at}.skills\` (with \`${at}.matched_required_skills\` and \`${at}.missing_required_skills\`) demonstrate \`job.required_skills\`?`,
      {
        true: "the candidate demonstrates the required skills, including via related technologies of the same platform",
        false: "the candidate lacks most of the required skills",
      },
    )
    questions[`fit__${i}__experience`] = noul(
      `Do \`${at}.years_of_experience\` and \`${at}.seniority\` meet \`job.minimum_experience\`?`,
      {
        true: "their seniority and years meet or exceed the requirement",
        false: "clearly below the experience bar",
      },
    )
    questions[`fit__${i}__overall`] = noul(
      `Overall: would \`${at}\` be a credible hire for \`job.title\` given \`job.required_skills\`, \`job.responsibilities\` and \`${at}.resume_excerpt\`?`,
      {
        true: "core requirements align: skills, seniority and domain",
        false: "lacks core requirements or works in a different field",
      },
    )
  })
  return questions
}

async function fitScores(
  job: { title: string; description: string; requirements: JobRequirements },
  candidates: Array<{ id: string; summary: Record<string, unknown> }>,
  offline: boolean,
): Promise<{ byId: Map<string, FitDetail>; model: string }> {
  const neutral = new Map(
    candidates.map((c) => [c.id, { skills: 50, experience: 50, overall: 50, blended: 50, model: "offline" }]),
  )
  if (offline || candidates.length === 0 || !config.typesafe.enabled) {
    return { byId: neutral, model: "offline" }
  }
  const questions = fitQuestions(candidates)
  const res = await systemOneSafe(fitState(job, candidates), questions)
  if (!res) return { byId: neutral, model: "offline" }

  const byId = new Map<string, FitDetail>()
  candidates.forEach((c, i) => {
    const s = noulPercent(res.answers, `fit__${i}__skills`)
    const e = noulPercent(res.answers, `fit__${i}__experience`)
    const o = noulPercent(res.answers, `fit__${i}__overall`)
    byId.set(c.id, {
      skills: s,
      experience: e,
      overall: o,
      blended: Math.round((0.5 * s + 0.2 * e + 0.3 * o) * 10) / 10,
      model: res.model ?? config.typesafe.model,
    })
  })
  return { byId, model: res.model ?? config.typesafe.model }
}

/** Confirm JD requirements with Jev (typed), dropping ones the JD does not state. */
async function refineRequirements(
  requirements: JobRequirements,
  description: string,
  offline: boolean,
): Promise<JobRequirements> {
  const required = requirements.requiredSkills ?? []
  if (offline || required.length === 0 || !config.typesafe.enabled || required.length > 40) {
    return requirements
  }
  const questions: Record<string, Question> = {}
  required.forEach((skill, i) => {
    questions[`req__${i}`] = noul(
      `Does ` + "`job_description`" + ` state "${skill}" (or a specific technology belonging to it) as a required / must-have skill for the role?`,
      {
        true: "required or must-have",
        false: "not required: absent, merely nice-to-have, or mentioned only in passing",
      },
    )
  })
  const res = await systemOneSafe({ job_description: description.slice(0, 8000) }, questions)
  if (!res) return requirements
  const keep = config.typesafe.keepThreshold
  const confirmed = required.filter((_, i) => (pTrue(res.answers, `req__${i}`) ?? 1) >= keep)
  return { ...requirements, requiredSkills: confirmed.length > 0 ? confirmed : required }
}

export async function rankJob(options: RankOptions): Promise<RankJobResult> {
  const offline = options.offline === true
  const summaries = await listResumes()
  if (summaries.length === 0) {
    throw new AppError("VALIDATION_ERROR", "No resumes stored yet. Add some first: resumerank add <files...>")
  }

  const parsed = analyzeJobDescription(options.title, options.description)
  const requirements = await refineRequirements(parsed, options.description, offline)

  const weights = getRankingWeights()
  const candidateLimit = config.ranking.candidateLimit
  const finalLimit = options.limit ?? config.ranking.finalLimit

  const scored: Array<{
    resume: ResumeSummary
    text: string
    matches: SkillMatch[]
    deterministic: number
    breakdown: ReturnType<typeof deterministicScore>["breakdown"]
    mismatch: boolean
    mismatchReasons: string[]
    exclude: boolean
    excludeReason: string
  }> = []

  for (const resume of summaries) {
    const text = await resumeText(resume.id)
    const matches = await matchRequirements(requirements.requiredSkills ?? [], resume.canonicalSkills ?? resume.metadata.skills ?? [], {
      jevAssist: !offline,
      jevState: {
        candidate_skills: resume.canonicalSkills ?? resume.metadata.skills ?? [],
        job_title: parsed.role ?? options.title,
      },
    })
    const det = deterministicScore({
      requirements,
      metadata: resume.metadata,
      resumeText: text,
      skillMatches: matches,
      jobDescription: options.description,
      weights,
    })
    const candidateBand = candidateLevel(resume.metadata)
    const gate = shouldExclude({
      requiredCount: (requirements.requiredSkills ?? []).length,
      requiredCoverage: det.breakdown.requiredSkills / 100,
      domainScore: det.breakdown.domain / 100,
      roleScore: det.breakdown.roleSimilarity / 100,
      levelDistance: levelDistance(requirements.level, candidateBand),
      jobLevel: requirements.level ?? null,
      candidateLevel: candidateBand,
    })
    scored.push({
      resume,
      text,
      matches,
      deterministic: det.score,
      breakdown: det.breakdown,
      mismatch: det.mismatch,
      mismatchReasons: det.mismatchReasons,
      exclude: gate.exclude,
      excludeReason: gate.reason,
    })
  }

  const qualified = scored.filter((s) => !s.exclude)
  const hardExcluded = scored.filter((s) => s.exclude)
  const byScore = (a: { deterministic: number }, b: { deterministic: number }): number =>
    b.deterministic - a.deterministic
  let pool = (options.includeMismatches ? scored : qualified).sort(byScore).slice(0, candidateLimit)
  // Never return an empty shortlist when candidates exist: fall back to showing
  // the closest ones, mismatch-labelled, and say so.
  const fellBack = pool.length === 0 && scored.length > 0
  if (fellBack) pool = scored.sort(byScore).slice(0, candidateLimit)

  const fit = await fitScores(
    { title: parsed.role ?? options.title, description: options.description, requirements },
    pool.map((p) => ({
      id: p.resume.id,
      summary: candidateSummary(p.resume, p.text, p.matches),
    })),
    offline,
  )

  const ranked: RankedItem[] = pool.map((entry) => {
    const fitDetail = fit.byId.get(entry.resume.id) ?? {
      skills: 50,
      experience: 50,
      overall: 50,
      blended: 50,
      model: "offline",
    }
    const ai = fitDetail.blended
    const metadata = entry.resume.metadata
    const candidateBand = candidateLevel(metadata)
    return {
      resumeId: entry.resume.id,
      originalFilename: entry.resume.originalFilename,
      rank: 0,
      finalScore: finalScore(entry.deterministic, ai),
      deterministicScore: entry.deterministic,
      semanticScore: entry.breakdown.requiredSkills,
      aiScore: ai,
      judgement: {
        model: fitDetail.model,
        jev: {
          skills: fitDetail.skills,
          experience: fitDetail.experience,
          overall: fitDetail.overall,
          blended: fitDetail.blended,
        },
        components: entry.breakdown,
        matched: entry.matches.filter((m) => m.score > 0).map((m) => ({ requirement: m.requirement, via: m.via, score: m.score })),
        missing: entry.matches
          .filter((m) => m.score === 0)
          .map((m) => ({ requirement: m.requirement, reason: m.evidence?.trim() || "no evidence found in the resume" })),
        resume: {
          fullName: entry.resume.structured.fullName ?? null,
          seniority: metadata.seniority ?? null,
          yearsOfExperience: metadata.yearsOfExperience ?? null,
          roles: metadata.roles ?? [],
          domain: metadata.domain ?? null,
          skillCount: (metadata.skills ?? []).length,
        },
        level: {
          posting: requirements.level ?? null,
          candidate: candidateBand,
          distance: levelDistance(requirements.level, candidateBand),
          leadership: entry.breakdown.leadership,
        },
        bar: {
          minimumExperience: requirements.minimumExperience ?? null,
          requiredCount: (requirements.requiredSkills ?? []).length,
          preferredCount: (requirements.preferredSkills ?? []).length,
          requiredHits: hitCounts(entry.matches, requirements).requiredHits,
          preferredHits: hitCounts(entry.matches, requirements).preferredHits,
        },
        verdict: verdictFor(entry.matches, metadata, requirements, { ...fitDetail, levelDistance: levelDistance(requirements.level, candidateBand) }),
      },
      analysis: buildAnalysis(
        requirements.requiredSkills ?? [],
        entry.matches,
        entry.resume.metadata,
        entry.deterministic,
        ai,
        requirements.minimumExperience,
        entry.mismatch,
        entry.mismatchReasons,
      ),
    }
  })

  // Sort by score, then by how close the candidate's band is to the posting's:
  // between two candidates the scorer cannot separate, the one at the right level
  // goes first.
  const bandDistance = (item: RankedItem): number => {
    const band = candidateLevel({
      ...(item.judgement?.resume.seniority ? { seniority: item.judgement.resume.seniority } : {}),
    } as ResumeMetadata)
    return levelDistance(requirements.level, band) ?? 9
  }
  ranked.sort(
    (a, b) =>
      b.finalScore - a.finalScore ||
      bandDistance(a) - bandDistance(b) ||
      b.deterministicScore - a.deterministicScore ||
      b.semanticScore - a.semanticScore,
  )
  const finalists = ranked.slice(0, finalLimit)
  finalists.forEach((item, index) => {
    item.rank = index + 1
  })

  const record: RankingRecord = {
    id: newId("rk"),
    jobTitle: parsed.role ?? options.title,
    jobDescription: options.description,
    requirements,
    provider: config.typesafe.enabled && !offline ? "typesafe" : "offline",
    model: fit.model,
    candidateCount: pool.length,
    weights,
    deterministicWeight: config.ranking.deterministicWeight,
    results: finalists,
    excluded: hardExcluded.map((m) => ({
      resumeId: m.resume.id,
      originalFilename: m.resume.originalFilename,
      reason: m.excludeReason,
    })),
    createdAt: new Date().toISOString(),
  }
  if (options.saveRanking !== false) await addRanking(record)

  return {
    rankingId: record.id,
    jobTitle: record.jobTitle,
    requirements,
    model: record.model,
    results: finalists,
    excluded: record.excluded,
    usage: { input_tokens: stats.inputTokens, output_tokens: stats.outputTokens },
    candidateCount: record.candidateCount,
    deterministicWeight: record.deterministicWeight,
    weights: record.weights,
    fellBack,
    mismatches: qualified
      .filter((m) => m.mismatch)
      .map((m) =>
        buildAnalysis(
          requirements.requiredSkills ?? [],
          m.matches,
          m.resume.metadata,
          m.deterministic,
          0,
          requirements.minimumExperience,
          true,
          m.mismatchReasons,
        ),
      ),
  }
}

export async function listRankings(limit = 30) {
  return storeListRankings(limit)
}

export async function getRanking(id: string) {
  const record = await storeGetRanking(id)
  if (!record) throw new AppError("NOT_FOUND", `Ranking "${id}" not found.`)
  return record
}

export { shortId, coverageFromMatches }
