import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { config, isOffline, paths } from "../config"
import { AppError, JevDisabled } from "../errors"

// ---------------------------------------------------------------------------
// TypeSafe Jev (System One) client.
//
// Contract (docs.typesafe.ai/api, verified against the live API):
//   POST https://api.typesafe.ai/v1/systemone
//   Authorization: Bearer <TYPESAFE_API_KEY>
//   { state, model, questions }
//   -> { model, answers, usage }
//
// Question types: noul (P(true) 0..1), choice (option + probabilities +
// confidence), score (probability-weighted position over 2..10 ordered levels).
// Errors: 401 invalid key, 422 malformed request, 429/529 retry with backoff.
// Everything here is optional to the CLI: no key or an error fails open.
// ---------------------------------------------------------------------------

export const TYPESAFE_ENDPOINT_DEFAULT = "https://api.typesafe.ai/v1/systemone"

export type QuestionInstructions = string | Record<string, unknown> | unknown[]

export interface NoulQ {
  type: "noul"
  instructions: QuestionInstructions
  criteria?: { true?: string; false?: string }
}
export interface ChoiceQ {
  type: "choice"
  instructions: QuestionInstructions
  criteria: Record<string, string | null>
}
export interface ScoreQ {
  type: "score"
  instructions: QuestionInstructions
  criteria: string[]
}
export type Question = NoulQ | ChoiceQ | ScoreQ

export function noul(
  instructions: QuestionInstructions,
  criteria?: { true?: string; false?: string },
): NoulQ {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions }
}

export function choice(
  instructions: QuestionInstructions,
  criteria: Record<string, string | null>,
): ChoiceQ {
  return { type: "choice", instructions, criteria }
}

/** Ordered levels; the API requires 2..10. */
export function score(instructions: QuestionInstructions, criteria: string[]): ScoreQ {
  if (criteria.length < 2) throw new AppError("VALIDATION_ERROR", "score() needs at least 2 levels")
  if (criteria.length > 10) throw new AppError("VALIDATION_ERROR", "score() allows at most 10 levels")
  return { type: "score", instructions, criteria }
}

const noulAnswerSchema = z.object({ type: z.literal("noul"), noul: z.number() })
const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional().default({}),
  confidence: z.number().optional().default(0),
})
const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()).optional().default({}),
  probabilities: z.record(z.string(), z.number()).optional().default({}),
  confidence: z.number().optional().default(0),
})
const answerSchema = z.discriminatedUnion("type", [
  noulAnswerSchema,
  choiceAnswerSchema,
  scoreAnswerSchema,
])

const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
})

export type NoulAnswer = z.infer<typeof noulAnswerSchema>
export type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>
export type ScoreAnswer = z.infer<typeof scoreAnswerSchema>
export type Answer = z.infer<typeof answerSchema>
export type SystemOneResponse = z.infer<typeof responseSchema>

export function isNoulAnswer(a: unknown): a is NoulAnswer {
  return !!a && typeof a === "object" && (a as { type?: string }).type === "noul"
}
export function isChoiceAnswer(a: unknown): a is ChoiceAnswer {
  return !!a && typeof a === "object" && (a as { type?: string }).type === "choice"
}
export function isScoreAnswer(a: unknown): a is ScoreAnswer {
  return !!a && typeof a === "object" && (a as { type?: string }).type === "score"
}

/** P(true) of a noul answer, or null when the answer is missing/mistyped. */
export function pTrue(answers: Record<string, Answer>, id: string): number | null {
  const a = answers[id]
  if (!isNoulAnswer(a)) return null
  return clamp01(a.noul)
}

/** Noul P(true) as 0..100, neutral 50 when absent. */
export function noulPercent(answers: Record<string, Answer>, id: string): number {
  const p = pTrue(answers, id)
  return p === null ? 50 : Math.round(p * 1000) / 10
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0
}

export interface JevStats {
  calls: number
  inputTokens: number
  outputTokens: number
  failures: number
  skipped: boolean
  /** Answers served from the local cache instead of the network. */
  cachedAnswers: number
  lastError?: string
}

export const stats: JevStats = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  failures: 0,
  skipped: false,
  cachedAnswers: 0,
}

export function resetStats(): void {
  stats.calls = 0
  stats.inputTokens = 0
  stats.outputTokens = 0
  stats.failures = 0
  stats.skipped = false
  stats.cachedAnswers = 0
  delete stats.lastError
}

/** True when Jev can be called at all right now. */
export function jevAvailable(): boolean {
  return config.typesafe.enabled
}

export function jevStatus(): string {
  if (isOffline()) return "offline (RESUMERANK_OFFLINE=1)"
  if (!config.typesafe.apiKey) return "no key (deterministic + semantic only)"
  return `enabled (${config.typesafe.model})`
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

function retryAfterMs(res: Response): number {
  const raw = res.headers?.get?.("retry-after")
  if (raw) {
    const secs = Number(raw.trim().split(",")[0])
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 5000)
  }
  return 500
}

function errorForStatus(status: number): AppError {
  if (status === 401) {
    return new AppError("MISSING_API_KEY", "TypeSafe API key is invalid. Check TYPESAFE_API_KEY.")
  }
  if (status === 429 || status === 529) {
    return new AppError("RATE_LIMIT", "TypeSafe rate limit / overloaded. Retrying with backoff.")
  }
  if (status === 422) {
    return new AppError("INVALID_AI_RESPONSE", "TypeSafe rejected the question shape (422).")
  }
  return new AppError("AI_FAILURE", `TypeSafe request failed with HTTP ${status}.`)
}

// ---------------------------------------------------------------------------
// Typed-answer cache.
//
// The model's answers are the only non-reproducible input to a ranking: the same
// JD against the same pool was measured at 1/5 reproducible (offline is 5/5)
// because every run re-asked the same questions and got slightly different
// numbers. Caching answers by (model, state, question) makes a re-run identical,
// keeps a new resume from re-asking about all the old ones, and makes repeat
// rankings free. `RESUMERANK_NO_CACHE=1` or `RESUMERANK_FRESH=1` bypasses it.
// ---------------------------------------------------------------------------

interface CachedAnswer {
  at: number
  answer: Answer
}

const ANSWER_CACHE_LIMIT = 5_000
const answerCache = new Map<string, CachedAnswer>()
let answerCacheLoaded = false
let answerCacheLoadedFrom = ""
let answerCacheWrites = 0

function answerCacheFile(): string {
  return paths().jevCache
}

function cachingEnabled(): boolean {
  return process.env.RESUMERANK_NO_CACHE !== "1" && process.env.RESUMERANK_FRESH !== "1"
}

function answerKey(stateHash: string, id: string, question: Question): string {
  const q = createHash("sha256").update(JSON.stringify(question)).digest("hex").slice(0, 24)
  return `${config.typesafe.model}:${stateHash}:${id}:${q}`
}

async function loadAnswerCache(): Promise<void> {
  const file = answerCacheFile()
  if (answerCacheLoaded && answerCacheLoadedFrom === file) return
  answerCacheLoaded = true
  answerCacheLoadedFrom = file
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { entries?: Record<string, CachedAnswer> }
    for (const [key, value] of Object.entries(raw.entries ?? {})) answerCache.set(key, value)
  } catch {
    /* no cache yet */
  }
}

async function persistAnswerCache(): Promise<void> {
  const file = answerCacheFile()
  if (answerCache.size > ANSWER_CACHE_LIMIT) {
    const sorted = [...answerCache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, ANSWER_CACHE_LIMIT)
    answerCache.clear()
    for (const [key, value] of sorted) answerCache.set(key, value)
  }
  answerCacheWrites += 1
  const entries = Object.fromEntries(answerCache)
  await writeFile(file, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries })}\n`, "utf8").catch(
    () => {},
  )
}

/** How many typed answers are cached locally (for `resumerank doctor`). */
export async function answerCacheSize(): Promise<number> {
  await loadAnswerCache()
  return answerCache.size
}

/**
 * Send one state + typed question map to Jev. Throws when disabled or when the
 * request cannot be satisfied. Retries 429/529 and transient network errors
 * with exponential backoff (3 attempts).
 */
export async function systemOne(
  state: unknown,
  questions: Record<string, Question>,
): Promise<SystemOneResponse> {
  if (!config.typesafe.enabled) {
    stats.skipped = true
    throw new JevDisabled()
  }
  const ids = Object.keys(questions)
  if (ids.length === 0) {
    throw new AppError("VALIDATION_ERROR", "systemOne() needs at least one question")
  }

  const useCache = cachingEnabled()
  let stateHash = ""
  const cachedAnswers: Record<string, Answer> = {}
  if (useCache) {
    await loadAnswerCache()
    stateHash = createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 32)
    for (const id of ids) {
      const hit = answerCache.get(answerKey(stateHash, id, questions[id]))
      if (hit) {
        cachedAnswers[id] = hit.answer
        answerCache.set(answerKey(stateHash, id, questions[id]), { at: Date.now(), answer: hit.answer })
      }
    }
    const missing = ids.filter((id) => !(id in cachedAnswers))
    if (missing.length === 0) {
      stats.cachedAnswers += ids.length
      return { model: config.typesafe.model, answers: cachedAnswers, usage: {} }
    }
    // Ask only about what is unknown; reuse the rest.
    const rest = Object.fromEntries(missing.map((id) => [id, questions[id]]))
    const response = await systemOneUncached(state, rest)
    for (const id of missing) {
      const answer = response.answers[id]
      if (answer) answerCache.set(answerKey(stateHash, id, questions[id]), { at: Date.now(), answer })
    }
    stats.cachedAnswers += ids.length - missing.length
    await persistAnswerCache()
    return {
      model: response.model,
      answers: { ...cachedAnswers, ...response.answers },
      usage: response.usage,
    }
  }

  return systemOneUncached(state, questions)
}

async function systemOneUncached(
  state: unknown,
  questions: Record<string, Question>,
): Promise<SystemOneResponse> {
  const body = JSON.stringify({ state, model: config.typesafe.model, questions })
  const attempts = 3
  let lastErr: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response
    try {
      res = await fetch(config.typesafe.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.typesafe.apiKey}`,
        },
        body,
        signal: timeoutSignal(config.typesafe.timeoutMs),
      })
    } catch (err) {
      lastErr = err
      if (attempt < attempts - 1) {
        await sleep(400 * 2 ** attempt)
        continue
      }
      stats.failures += 1
      throw new AppError(
        "AI_FAILURE",
        `Could not reach TypeSafe: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    if (res.status === 429 || res.status === 529) {
      const wait = retryAfterMs(res)
      if (attempt < attempts - 1) {
        await sleep(wait)
        continue
      }
      stats.failures += 1
      throw errorForStatus(res.status)
    }
    if (!res.ok) {
      stats.failures += 1
      throw errorForStatus(res.status)
    }

    let json: unknown
    try {
      json = await res.json()
    } catch {
      stats.failures += 1
      throw new AppError("INVALID_AI_RESPONSE", "TypeSafe returned a non-JSON body.")
    }

    const parsed = responseSchema.safeParse(json)
    if (!parsed.success) {
      stats.failures += 1
      throw new AppError("INVALID_AI_RESPONSE", "TypeSafe returned an unexpected shape.")
    }
    stats.calls += 1
    stats.inputTokens += parsed.data.usage?.input_tokens ?? 0
    stats.outputTokens += parsed.data.usage?.output_tokens ?? 0
    return parsed.data
  }

  stats.failures += 1
  throw new AppError(
    "AI_FAILURE",
    `TypeSafe call failed after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
}

/**
 * Fail-open wrapper: null instead of throwing. Every extraction/ranking caller
 * uses this so a missing key, an offline machine, or a 5xx never breaks a run.
 */
export async function systemOneSafe(
  state: unknown,
  questions: Record<string, Question>,
): Promise<SystemOneResponse | null> {
  if (!config.typesafe.enabled) {
    stats.skipped = true
    return null
  }
  try {
    return await systemOne(state, questions)
  } catch (err) {
    stats.lastError = err instanceof Error ? err.message : String(err)
    if (process.env.RESUMERANK_VERBOSE === "1") {
      console.warn(`[jev] ${stats.lastError}`)
    }
    return null
  }
}
