import { homedir } from "node:os"
import { join, resolve } from "node:path"

// Single place that reads process.env. Nothing here touches the network.

function num(name: string, fallback: number, min = -Infinity, max = Infinity): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

export function isOffline(): boolean {
  const flag = (process.env.RESUMERANK_OFFLINE ?? "").trim()
  return flag === "1" || flag.toLowerCase() === "true" || flag.toLowerCase() === "yes"
}

export function dataHome(): string {
  const raw = (process.env.RESUMERANK_HOME ?? "").trim()
  if (raw) return resolve(raw.replace(/^~(?=$|\/)/, homedir()))
  return join(homedir(), ".resumerank")
}

/**
 * How many extractions to run in parallel.
 *
 * With the typed layer each resume costs 3-4 network calls, so batching files
 * through a few lanes is where the wall-clock win is (measured 2.9x on 8 PDFs);
 * offline everything is in-process CPU, where lanes only add contention.
 * RESUMERANK_INGEST_LANES overrides it for rate-limited plans.
 */
export function ingestLanes(jevEnabled: boolean, fileCount: number): number {
  const requested = Number(process.env.RESUMERANK_INGEST_LANES ?? "")
  if (Number.isFinite(requested) && requested > 0) return Math.max(1, Math.min(requested, fileCount))
  return jevEnabled ? Math.max(1, Math.min(4, fileCount)) : 1
}

export const config = {
  typesafe: {
    get apiKey(): string {
      return (process.env.TYPESAFE_API_KEY ?? "").trim()
    },
    get model(): string {
      return (process.env.TYPESAFE_MODEL ?? "jev-latest").trim() || "jev-latest"
    },
    get endpoint(): string {
      return (process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone").trim()
    },
    get enabled(): boolean {
      return !isOffline() && (process.env.TYPESAFE_API_KEY ?? "").trim().length > 0
    },
    get keepThreshold(): number {
      return num("TYPESAFE_KEEP_THRESHOLD", 0.5, 0, 1)
    },
    get fireThreshold(): number {
      return num("TYPESAFE_FIRE_THRESHOLD", 0.7, 0, 1)
    },
    get skillLevelMin(): number {
      return num("TYPESAFE_SKILL_LEVEL_MIN", 1.5, 0, 10)
    },
    get timeoutMs(): number {
      return num("TYPESAFE_TIMEOUT_MS", 25_000, 1_000, 120_000)
    },
  },
  ranking: {
    get candidateLimit(): number {
      return num("RANKING_CANDIDATE_LIMIT", 50, 1, 500)
    },
    get finalLimit(): number {
      return num("RANKING_FINAL_LIMIT", 20, 1, 100)
    },
    get deterministicWeight(): number {
      return num("RANKING_DETERMINISTIC_WEIGHT", 0.7, 0, 1)
    },
    get mismatchThreshold(): number {
      return num("RANKING_MISMATCH_THRESHOLD", 0.4, 0, 1)
    },
    /** Below this required-skill coverage a candidate is dropped outright. */
    get hardFloor(): number {
      return num("RANKING_HARD_FLOOR", 0.15, 0, 1)
    },
  },
  semantic: {
    get descendantCredit(): number {
      return num("SEMANTIC_DESCENDANT_CREDIT", 0.8, 0, 1)
    },
    get lexicalFloor(): number {
      return num("SEMANTIC_LEXICAL_FLOOR", 0.72, 0.5, 1)
    },
  },
  extract: {
    /** Offline mention confidence below which a skill is never kept. */
    get offlineKeep(): number {
      return num("EXTRACT_OFFLINE_KEEP", 0.58, 0.3, 1)
    },
    /** Mentions below this are not even proposed to Jev. */
    get proposeFloor(): number {
      return num("EXTRACT_PROPOSE_FLOOR", 0.45, 0.2, 1)
    },
  },
}

export function paths(): {
  home: string
  resumes: string
  rankings: string
  files: string
  config: string
  cache: string
  jevCache: string
} {
  const home = dataHome()
  return {
    home,
    resumes: join(home, "resumes.json"),
    rankings: join(home, "rankings.json"),
    files: join(home, "files"),
    config: join(home, "config.json"),
    cache: join(home, "cache"),
    jevCache: join(home, "jev-cache.json"),
  }
}
