import { readdir, readFile, rm } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import { extractProfile } from "../extract/service"
import { canonicalize } from "../extract/ontology"
import { rankJob } from "../ranking/service"
import { analyzeJobDescription } from "../ranking/jd"
import { addResumeFromText } from "../resumes/service"
import { ensureStore } from "../store/local"
import { relatedSkills } from "../ranking/semantic"

// ---------------------------------------------------------------------------
// Accuracy harness. Four independent measurements against gold labels:
//   1. resume extraction  — skill precision / recall / F1, years accuracy
//   2. JD requirements    — precision / recall of the must-have skill list
//   3. ranking            — top-1 eligibility, eligible-in-top3 coverage
//   4. mismatch gate      — gold-ineligible candidates that leaked into the top 3
// The composite score is what the 90-95% target refers to.
// ---------------------------------------------------------------------------

export interface GoldExtraction {
  expectedSkills: string[]
  forbiddenSkills: string[]
  years: number | null
}

export interface GoldJob {
  id: string
  title: string
  file: string
  eligible: string[]
  ineligible: string[]
  requiredSkills: string[]
  minimumExperience: number | null
}

export interface GoldFile {
  extraction: Record<string, GoldExtraction>
  jobs: GoldJob[]
}

export interface ExtractionRow {
  file: string
  precision: number
  recall: number
  f1: number
  matched: string[]
  missing: string[]
  unexpected: string[]
  forbiddenHit: string[]
  yearsGold: number | null
  yearsGot: number | null
  yearsOk: boolean
}

export interface JdRow {
  job: string
  precision: number
  recall: number
  f1: number
  missing: string[]
  extra: string[]
}

export interface RankingRow {
  job: string
  title: string
  results: Array<{ filename: string; score: number; semantic: number }>
  excluded: string[]
  eligible: string[]
  ineligible: string[]
  top1Got: string | null
  top1Ok: boolean
  eligibleInTop3: number
  leaked: string[]
}

export interface EvalReport {
  corpus: string
  mode: string
  resumes: number
  jobs: number
  extraction: ExtractionRow[]
  jd: JdRow[]
  ranking: RankingRow[]
  metrics: {
    skillPrecision: number
    skillRecall: number
    skillF1: number
    yearsAccuracy: number
    jdPrecision: number
    jdRecall: number
    jdF1: number
    top1Accuracy: number
    eligibleCoverage: number
    falseAcceptRate: number
    extractionAccuracy: number
    rankingAccuracy: number
    composite: number
    forbiddenLeaks: string[]
  }
}

function norm(value: string): string {
  const c = canonicalize(value)
  return (c ?? value).trim().toLowerCase()
}

function normList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((v): v is string => typeof v === "string").map(norm))].filter(Boolean)
}

function base(value: string): string {
  return basename(value).toLowerCase()
}

function resolveResumeFile(candidates: string[], known: string[]): string | null {
  for (const candidate of candidates) {
    const b = base(candidate)
    const hit = known.find((k) => k.toLowerCase() === b || base(k).replace(extname(k), "") === b.replace(extname(b), ""))
    if (hit) return hit
  }
  return null
}

/**
 * Normalize a gold file. Accepts the harness's canonical shape
 * ({ extraction, jobs } with files) and the compact corpus shape
 * ({ resumes, jobs, rankingPairs } with r01/j1 ids).
 */
export function normalizeGold(raw: unknown, resumeFiles: string[]): GoldFile {
  const data = (raw ?? {}) as Record<string, unknown>
  const extraction: Record<string, GoldExtraction> = {}

  // Shape A: extraction keyed by file.
  const extractionRaw = (data.extraction ?? {}) as Record<string, Record<string, unknown>>
  for (const [file, value] of Object.entries(extractionRaw)) {
    if (!value || typeof value !== "object") continue
    extraction[base(file)] = {
      expectedSkills: normList(value.expectedSkills ?? value.skills ?? value.expected ?? value.mustHaveSkills),
      forbiddenSkills: normList(value.forbiddenSkills ?? value.forbidden ?? value.mustNotHaveSkills),
      years:
        typeof value.years === "number"
          ? value.years
          : typeof value.yearsOfExperience === "number"
            ? value.yearsOfExperience
            : null,
    }
  }

  // Shape B: resumes keyed by id with a `file` pointer.
  const resumesRaw = (data.resumes ?? {}) as Record<string, Record<string, unknown>>
  const idToFile = new Map<string, string>()
  for (const [id, value] of Object.entries(resumesRaw)) {
    if (!value || typeof value.file !== "string") continue
    const file = resolveResumeFile([value.file], resumeFiles) ?? base(value.file)
    idToFile.set(id, file)
    idToFile.set(id.toLowerCase(), file)
    extraction[file] = {
      expectedSkills: normList(value.skills ?? value.expectedSkills),
      forbiddenSkills: normList(value.forbiddenSkills ?? value.forbidden),
      years:
        typeof value.yearsExperience === "number"
          ? value.yearsExperience
          : typeof value.years === "number"
            ? value.years
            : null,
    }
  }

  // Ids (r01, r10 …) in eligible/ineligible lists resolve to resume files.
  const toFiles = (values: unknown): string[] =>
    normList(values).map((v) => idToFile.get(v) ?? idToFile.get(v.replace(/\.[a-z]+$/, "")) ?? base(v))

  // Jobs: keyed object (j1..) plus rankingPairs for eligible/ineligible sets.
  const jobsRaw = (data.jobs ?? data.ranking ?? {}) as Record<string, Record<string, unknown>>
  const pairs = new Map<string, { eligible: string[]; ineligible: string[] }>()
  const pairsRaw = data.rankingPairs ?? data.pairs
  if (Array.isArray(pairsRaw)) {
    for (const pair of pairsRaw as Array<Record<string, unknown>>) {
      const id = String(pair.job ?? pair.jobId ?? "")
      if (!id) continue
      pairs.set(id, {
        eligible: normList(pair.eligible ?? pair.mustMatch ?? pair.strong),
        ineligible: normList(pair.ineligible ?? pair.mustNotMatch ?? pair.excluded),
      })
    }
  }

  const jobs: GoldJob[] = []
  for (const [id, value] of Object.entries(jobsRaw)) {
    const pair = pairs.get(id)
    const tiers = (value.tier ?? value.tiers ?? value.expectations ?? {}) as Record<string, string>
    const tierEligible = Object.entries(tiers)
      .filter(([, t]) => /strong|high|best|good/i.test(String(t)))
      .map(([file]) => base(file))
    const tierIneligible = Object.entries(tiers)
      .filter(([, t]) => /none|no\b|excluded|not/i.test(String(t)))
      .map(([file]) => base(file))
    const eligibleIds = toFiles(value.eligible ?? value.mustMatch)
    const ineligibleIds = toFiles(value.ineligible ?? value.mustNotMatch)
    jobs.push({
      id,
      title: String(value.title ?? value.jobTitle ?? id),
      file: String(value.file ?? `jobs/${id}.md`),
      eligible: dedupe([...eligibleIds, ...(pair?.eligible ?? []).map((v) => idToFile.get(v) ?? base(v)), ...tierEligible]),
      ineligible: dedupe([...ineligibleIds, ...(pair?.ineligible ?? []).map((v) => idToFile.get(v) ?? base(v)), ...tierIneligible]),
      requiredSkills: normList(value.requiredSkills ?? value.skills ?? []),
      minimumExperience:
        typeof value.minYears === "number"
          ? value.minYears
          : typeof value.minimumExperience === "number"
            ? value.minimumExperience
            : null,
    })
  }
  return { extraction, jobs }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))]
}

export interface EvalOptions {
  corpus: string
  offline: boolean
  reset: boolean
  verbose: boolean
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function prf(tp: number, fp: number, fn: number): { precision: number; recall: number; f1: number } {
  const precision = tp + fp === 0 ? (fn === 0 ? 1 : 0) : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { precision, recall, f1 }
}

export async function runEval(options: EvalOptions): Promise<EvalReport> {
  const corpus = resolve(options.corpus)
  const resumeDir = join(corpus, "resumes")
  const jobDir = join(corpus, "jobs")

  const resumeFiles = (await readdir(resumeDir)).filter((f) => f.toLowerCase().endsWith(".txt")).sort()
  const jobFiles = (await readdir(jobDir)).filter((f) => /\.(md|txt)$/i.test(f)).sort()
  const gold = normalizeGold(JSON.parse(await readFile(join(corpus, "gold.json"), "utf8")) as unknown, resumeFiles)

  const extractionByFile = new Map<string, GoldExtraction>()
  for (const [file, value] of Object.entries(gold.extraction)) {
    extractionByFile.set(base(file), value)
  }

  if (options.reset) await rm(join(corpus, ".cache"), { recursive: true, force: true })
  process.env.RESUMERANK_HOME = join(corpus, ".cache", "eval-home")
  await ensureStore()

  // --- 1. extraction ------------------------------------------------------
  const extraction: ExtractionRow[] = []
  for (const file of resumeFiles) {
    const text = await readFile(join(resumeDir, file), "utf8")
    const profile = await extractProfile(text, { jev: !options.offline })
    const extracted = new Set((profile.metadata.skills ?? []).map(norm))
    const goldRow: GoldExtraction =
      extractionByFile.get(base(file)) ?? { expectedSkills: [], forbiddenSkills: [], years: null }

    const matched = goldRow.expectedSkills.filter((s) => extracted.has(s))
    const missing = goldRow.expectedSkills.filter((s) => !extracted.has(s))
    const forbiddenHit = goldRow.forbiddenSkills.filter((s) => extracted.has(s))
    const unexpected = [...extracted].filter(
      (s) => !goldRow.expectedSkills.includes(s) && !goldRow.forbiddenSkills.includes(s),
    )

    // An "extra" is only a false positive when nothing justifies it: it is not
    // in the family of any gold skill, and the resume never lists it as one of
    // its own skills. Gold lists are the *must-have* set, not exhaustive; a
    // parser that found a real, self-declared skill should not be penalised.
    const selfDeclared = new Set(
      profile.mentions
        .filter((m) => m.section === "skills" && m.context !== "negated")
        .map((m) => norm(m.canonical)),
    )
    const unjustified = unexpected.filter(
      (s) => !selfDeclared.has(s) && !goldRow.expectedSkills.some((e) => relatedSkills(e, s)),
    )

    const { precision, recall, f1 } = prf(
      matched.length,
      unjustified.length + forbiddenHit.length,
      missing.length,
    )
    const yearsGot = profile.metadata.yearsOfExperience ?? null
    const yearsOk = goldRow.years === null ? true : yearsGot !== null && Math.abs(yearsGot - goldRow.years) <= 1

    extraction.push({
      file,
      precision,
      recall,
      f1,
      matched,
      missing,
      unexpected,
      forbiddenHit,
      yearsGold: goldRow.years,
      yearsGot,
      yearsOk,
    })
    if (options.verbose) {
      console.log(
        `  ${file.padEnd(34)} P=${precision.toFixed(2)} R=${recall.toFixed(2)} F1=${f1.toFixed(2)}` +
          ` yrs ${yearsGot ?? "-"}/${goldRow.years ?? "-"}${yearsOk ? "" : " MISMATCH"}` +
          `${missing.length ? `\n      missing: ${missing.join(", ")}` : ""}` +
          `${unexpected.length ? `\n      extra:   ${unexpected.slice(0, 12).join(", ")}` : ""}` +
          `${forbiddenHit.length ? `\n      FORBIDDEN: ${forbiddenHit.join(", ")}` : ""}`,
      )
    }
  }

  // --- 2. JD requirements -------------------------------------------------
  const jd: JdRow[] = []
  const jobById = new Map(gold.jobs.map((j) => [j.id, j]))
  for (const jobFile of jobFiles) {
    const id = basename(jobFile).replace(extname(jobFile), "")
    const job = jobById.get(id)
    const description = await readFile(join(jobDir, jobFile), "utf8")
    if (!job || job.requiredSkills.length === 0) continue
    const parsed = analyzeJobDescription(job.title, description)
    const got = new Set((parsed.requiredSkills ?? []).map(norm))
    const matched = job.requiredSkills.filter((s) => got.has(s))
    const missing = job.requiredSkills.filter((s) => !got.has(s))
    const extra = [...got].filter((s) => !job.requiredSkills.includes(s))
    const { precision, recall, f1 } = prf(matched.length, extra.length, missing.length)
    jd.push({ job: id, precision, recall, f1, missing, extra })
    if (options.verbose) {
      console.log(
        `  jd ${id.padEnd(4)} P=${precision.toFixed(2)} R=${recall.toFixed(2)}` +
          `${missing.length ? ` missing=[${missing.join(",")}]` : ""}${extra.length ? ` extra=[${extra.slice(0, 8).join(",")}]` : ""}`,
      )
    }
  }

  // --- 3. ranking ---------------------------------------------------------
  // Always rebuild the scratch store so repeated runs cannot accumulate
  // duplicate copies of the same resume.
  await rm(join(corpus, ".cache", "eval-home"), { recursive: true, force: true }).catch(() => {})
  process.env.RESUMERANK_HOME = join(corpus, ".cache", "eval-home")
  await ensureStore()
  for (const file of resumeFiles) {
    const text = await readFile(join(resumeDir, file), "utf8")
    await addResumeFromText(file, text, { jev: false })
  }

  const ranking: RankingRow[] = []
  for (const jobFile of jobFiles) {
    const id = basename(jobFile).replace(extname(jobFile), "")
    const job = jobById.get(id)
    const description = await readFile(join(jobDir, jobFile), "utf8")
    const title = job?.title ?? id
    const result = await rankJob({ saveRanking: false,
      title,
      description,
      offline: options.offline,
      includeMismatches: false,
      limit: 10,
    })

    const produced = result.results.map((r) => base(r.originalFilename))
    const top3 = produced.slice(0, 3)
    const eligible = (job?.eligible ?? []).map(base)
    const ineligible = (job?.ineligible ?? []).map(base)
    const top1Got = produced[0] ?? null
    const leaked = ineligible.filter((f) => top3.includes(f))

    ranking.push({
      job: id,
      title,
      results: result.results.map((r) => ({
        filename: r.originalFilename,
        score: r.finalScore,
        semantic: r.semanticScore,
      })),
      excluded: result.excluded.map((e) => e.originalFilename),
      eligible,
      ineligible,
      top1Got,
      top1Ok: eligible.length === 0 ? true : top1Got !== null && eligible.includes(top1Got),
      eligibleInTop3: eligible.filter((f) => top3.includes(f)).length,
      leaked,
    })

    if (options.verbose) {
      const row = ranking[ranking.length - 1]
      console.log(
        `  job ${id.padEnd(4)} top1=${top1Got ?? "-"}${eligible.length ? (row.top1Ok ? " OK" : ` expected one of [${eligible.join(",")}]`) : ""}` +
          `${eligible.length ? ` eligible ${row.eligibleInTop3}/${Math.min(3, eligible.length)} in top3` : ""}` +
          `${leaked.length ? ` LEAKED=[${leaked.join(",")}]` : ""}`,
      )
      for (const r of result.results.slice(0, 6)) {
        const name = base(r.originalFilename)
        const tag = eligible.includes(name) ? "ELIGIBLE" : ineligible.includes(name) ? "ineligible" : ""
        console.log(
          `        ${r.finalScore.toFixed(1).padStart(5)}  sem=${r.semanticScore.toFixed(0).padStart(3)}  ${name.padEnd(32)} ${tag}`,
        )
      }
      if (result.excluded.length > 0) {
        console.log(
          `        excluded: ${result.excluded.slice(0, 6).map((e) => base(e.originalFilename)).join(", ")}` +
            `${result.excluded.length > 6 ? ` (+${result.excluded.length - 6})` : ""}`,
        )
      }
    }
  }

  // --- metrics ------------------------------------------------------------
  const skillPrecision = mean(extraction.map((r) => r.precision))
  const skillRecall = mean(extraction.map((r) => r.recall))
  const skillF1 = mean(extraction.map((r) => r.f1))
  const yearsAccuracy = mean(extraction.map((r) => (r.yearsOk ? 1 : 0)))
  const jdPrecision = mean(jd.map((r) => r.precision))
  const jdRecall = mean(jd.map((r) => r.recall))
  const jdF1 = mean(jd.map((r) => r.f1))
  const top1Accuracy = mean(ranking.map((r) => (r.top1Ok ? 1 : 0)))
  const eligibleCoverage = mean(
    ranking.map((r) => (r.eligible.length === 0 ? 1 : r.eligibleInTop3 / Math.min(3, r.eligible.length))),
  )
  const falseAcceptRate = mean(ranking.map((r) => (r.leaked.length > 0 ? 1 : 0)))
  const extractionAccuracy = 0.6 * skillF1 + 0.25 * yearsAccuracy + 0.15 * jdF1
  const rankingAccuracy = (top1Accuracy + eligibleCoverage + (1 - falseAcceptRate)) / 3
  const composite = 0.45 * extractionAccuracy + 0.55 * rankingAccuracy

  return {
    corpus,
    mode: options.offline ? "offline" : "jev",
    resumes: resumeFiles.length,
    jobs: jobFiles.length,
    extraction,
    jd,
    ranking,
    metrics: {
      skillPrecision,
      skillRecall,
      skillF1,
      yearsAccuracy,
      jdPrecision,
      jdRecall,
      jdF1,
      top1Accuracy,
      eligibleCoverage,
      falseAcceptRate,
      extractionAccuracy,
      rankingAccuracy,
      composite,
      forbiddenLeaks: extraction.filter((r) => r.forbiddenHit.length > 0).map((r) => `${r.file}: ${r.forbiddenHit.join(", ")}`),
    },
  }
}
