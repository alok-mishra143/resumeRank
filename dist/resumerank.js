#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/config.ts
var config_exports = {};
__export(config_exports, {
  config: () => config,
  dataHome: () => dataHome,
  ingestLanes: () => ingestLanes,
  isOffline: () => isOffline,
  paths: () => paths
});
import { homedir } from "node:os";
import { join, resolve } from "node:path";
function num(name, fallback, min = -Infinity, max = Infinity) {
  const raw = process.env[name];
  if (raw === void 0 || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
function isOffline() {
  const flag = (process.env.RESUMERANK_OFFLINE ?? "").trim();
  return flag === "1" || flag.toLowerCase() === "true" || flag.toLowerCase() === "yes";
}
function dataHome() {
  const raw = (process.env.RESUMERANK_HOME ?? "").trim();
  if (raw) return resolve(raw.replace(/^~(?=$|\/)/, homedir()));
  return join(homedir(), ".resumerank");
}
function ingestLanes(jevEnabled2, fileCount) {
  const requested = Number(process.env.RESUMERANK_INGEST_LANES ?? "");
  if (Number.isFinite(requested) && requested > 0) return Math.max(1, Math.min(requested, fileCount));
  return jevEnabled2 ? Math.max(1, Math.min(4, fileCount)) : 1;
}
function paths() {
  const home = dataHome();
  return {
    home,
    resumes: join(home, "resumes.json"),
    rankings: join(home, "rankings.json"),
    files: join(home, "files"),
    config: join(home, "config.json"),
    cache: join(home, "cache"),
    jevCache: join(home, "jev-cache.json")
  };
}
var config;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    config = {
      typesafe: {
        get apiKey() {
          return (process.env.TYPESAFE_API_KEY ?? "").trim();
        },
        get model() {
          return (process.env.TYPESAFE_MODEL ?? "jev-latest").trim() || "jev-latest";
        },
        get endpoint() {
          return (process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone").trim();
        },
        get enabled() {
          return !isOffline() && (process.env.TYPESAFE_API_KEY ?? "").trim().length > 0;
        },
        get keepThreshold() {
          return num("TYPESAFE_KEEP_THRESHOLD", 0.5, 0, 1);
        },
        get fireThreshold() {
          return num("TYPESAFE_FIRE_THRESHOLD", 0.7, 0, 1);
        },
        get skillLevelMin() {
          return num("TYPESAFE_SKILL_LEVEL_MIN", 1.5, 0, 10);
        },
        get timeoutMs() {
          return num("TYPESAFE_TIMEOUT_MS", 25e3, 1e3, 12e4);
        }
      },
      ranking: {
        get candidateLimit() {
          return num("RANKING_CANDIDATE_LIMIT", 50, 1, 500);
        },
        get finalLimit() {
          return num("RANKING_FINAL_LIMIT", 20, 1, 100);
        },
        get deterministicWeight() {
          return num("RANKING_DETERMINISTIC_WEIGHT", 0.7, 0, 1);
        },
        get mismatchThreshold() {
          return num("RANKING_MISMATCH_THRESHOLD", 0.4, 0, 1);
        },
        /** Below this required-skill coverage a candidate is dropped outright. */
        get hardFloor() {
          return num("RANKING_HARD_FLOOR", 0.15, 0, 1);
        }
      },
      semantic: {
        get descendantCredit() {
          return num("SEMANTIC_DESCENDANT_CREDIT", 0.8, 0, 1);
        },
        get lexicalFloor() {
          return num("SEMANTIC_LEXICAL_FLOOR", 0.72, 0.5, 1);
        }
      },
      extract: {
        /** Offline mention confidence below which a skill is never kept. */
        get offlineKeep() {
          return num("EXTRACT_OFFLINE_KEEP", 0.58, 0.3, 1);
        },
        /** Mentions below this are not even proposed to Jev. */
        get proposeFloor() {
          return num("EXTRACT_PROPOSE_FLOOR", 0.45, 0.2, 1);
        }
      }
    };
  }
});

// src/errors.ts
var errors_exports = {};
__export(errors_exports, {
  AppError: () => AppError,
  JevDisabled: () => JevDisabled,
  toUserError: () => toUserError
});
function toUserError(err) {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return new AppError("AI_FAILURE", err.message);
  return new AppError("AI_FAILURE", String(err));
}
var AppError, JevDisabled;
var init_errors = __esm({
  "src/errors.ts"() {
    "use strict";
    AppError = class extends Error {
      code;
      constructor(code, message) {
        super(message);
        this.name = "AppError";
        this.code = code;
      }
    };
    JevDisabled = class extends Error {
      constructor(message = "TypeSafe Jev is not configured (offline mode)") {
        super(message);
        this.name = "JevDisabled";
      }
    };
  }
});

// src/ai/jev.ts
var jev_exports = {};
__export(jev_exports, {
  TYPESAFE_ENDPOINT_DEFAULT: () => TYPESAFE_ENDPOINT_DEFAULT,
  answerCacheSize: () => answerCacheSize,
  choice: () => choice,
  isChoiceAnswer: () => isChoiceAnswer,
  isNoulAnswer: () => isNoulAnswer,
  isScoreAnswer: () => isScoreAnswer,
  jevAvailable: () => jevAvailable,
  jevStatus: () => jevStatus,
  noul: () => noul,
  noulPercent: () => noulPercent,
  pTrue: () => pTrue,
  resetStats: () => resetStats,
  score: () => score,
  stats: () => stats,
  systemOne: () => systemOne,
  systemOneSafe: () => systemOneSafe
});
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
function noul(instructions, criteria) {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}
function choice(instructions, criteria) {
  return { type: "choice", instructions, criteria };
}
function score(instructions, criteria) {
  if (criteria.length < 2) throw new AppError("VALIDATION_ERROR", "score() needs at least 2 levels");
  if (criteria.length > 10) throw new AppError("VALIDATION_ERROR", "score() allows at most 10 levels");
  return { type: "score", instructions, criteria };
}
function isNoulAnswer(a) {
  return !!a && typeof a === "object" && a.type === "noul";
}
function isChoiceAnswer(a) {
  return !!a && typeof a === "object" && a.type === "choice";
}
function isScoreAnswer(a) {
  return !!a && typeof a === "object" && a.type === "score";
}
function pTrue(answers, id) {
  const a = answers[id];
  if (!isNoulAnswer(a)) return null;
  return clamp01(a.noul);
}
function noulPercent(answers, id) {
  const p = pTrue(answers, id);
  return p === null ? 50 : Math.round(p * 1e3) / 10;
}
function clamp01(n) {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
}
function resetStats() {
  stats.calls = 0;
  stats.inputTokens = 0;
  stats.outputTokens = 0;
  stats.failures = 0;
  stats.skipped = false;
  stats.cachedAnswers = 0;
  delete stats.lastError;
}
function jevAvailable() {
  return config.typesafe.enabled;
}
function jevStatus() {
  if (isOffline()) return "offline (RESUMERANK_OFFLINE=1)";
  if (!config.typesafe.apiKey) return "no key (deterministic + semantic only)";
  return `enabled (${config.typesafe.model})`;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}
function retryAfterMs(res) {
  const raw = res.headers?.get?.("retry-after");
  if (raw) {
    const secs = Number(raw.trim().split(",")[0]);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1e3, 5e3);
  }
  return 500;
}
function errorForStatus(status) {
  if (status === 401) {
    return new AppError("MISSING_API_KEY", "TypeSafe API key is invalid. Check TYPESAFE_API_KEY.");
  }
  if (status === 429 || status === 529) {
    return new AppError("RATE_LIMIT", "TypeSafe rate limit / overloaded. Retrying with backoff.");
  }
  if (status === 422) {
    return new AppError("INVALID_AI_RESPONSE", "TypeSafe rejected the question shape (422).");
  }
  return new AppError("AI_FAILURE", `TypeSafe request failed with HTTP ${status}.`);
}
function answerCacheFile() {
  return paths().jevCache;
}
function cachingEnabled() {
  return process.env.RESUMERANK_NO_CACHE !== "1" && process.env.RESUMERANK_FRESH !== "1";
}
function answerKey(stateHash, id, question) {
  const q = createHash("sha256").update(JSON.stringify(question)).digest("hex").slice(0, 24);
  return `${config.typesafe.model}:${stateHash}:${id}:${q}`;
}
async function loadAnswerCache() {
  const file = answerCacheFile();
  if (answerCacheLoaded && answerCacheLoadedFrom === file) return;
  answerCacheLoaded = true;
  answerCacheLoadedFrom = file;
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    for (const [key, value] of Object.entries(raw.entries ?? {})) answerCache.set(key, value);
  } catch {
  }
}
async function persistAnswerCache() {
  const file = answerCacheFile();
  if (answerCache.size > ANSWER_CACHE_LIMIT) {
    const sorted = [...answerCache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, ANSWER_CACHE_LIMIT);
    answerCache.clear();
    for (const [key, value] of sorted) answerCache.set(key, value);
  }
  answerCacheWrites += 1;
  const entries = Object.fromEntries(answerCache);
  await writeFile(file, `${JSON.stringify({ version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), entries })}
`, "utf8").catch(
    () => {
    }
  );
}
async function answerCacheSize() {
  await loadAnswerCache();
  return answerCache.size;
}
async function systemOne(state, questions) {
  if (!config.typesafe.enabled) {
    stats.skipped = true;
    throw new JevDisabled();
  }
  const ids = Object.keys(questions);
  if (ids.length === 0) {
    throw new AppError("VALIDATION_ERROR", "systemOne() needs at least one question");
  }
  const useCache = cachingEnabled();
  let stateHash = "";
  const cachedAnswers = {};
  if (useCache) {
    await loadAnswerCache();
    stateHash = createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 32);
    for (const id of ids) {
      const hit = answerCache.get(answerKey(stateHash, id, questions[id]));
      if (hit) {
        cachedAnswers[id] = hit.answer;
        answerCache.set(answerKey(stateHash, id, questions[id]), { at: Date.now(), answer: hit.answer });
      }
    }
    const missing = ids.filter((id) => !(id in cachedAnswers));
    if (missing.length === 0) {
      stats.cachedAnswers += ids.length;
      return { model: config.typesafe.model, answers: cachedAnswers, usage: {} };
    }
    const rest = Object.fromEntries(missing.map((id) => [id, questions[id]]));
    const response = await systemOneUncached(state, rest);
    for (const id of missing) {
      const answer = response.answers[id];
      if (answer) answerCache.set(answerKey(stateHash, id, questions[id]), { at: Date.now(), answer });
    }
    stats.cachedAnswers += ids.length - missing.length;
    await persistAnswerCache();
    return {
      model: response.model,
      answers: { ...cachedAnswers, ...response.answers },
      usage: response.usage
    };
  }
  return systemOneUncached(state, questions);
}
async function systemOneUncached(state, questions) {
  const body = JSON.stringify({ state, model: config.typesafe.model, questions });
  const attempts = 3;
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res;
    try {
      res = await fetch(config.typesafe.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.typesafe.apiKey}`
        },
        body,
        signal: timeoutSignal(config.typesafe.timeoutMs)
      });
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      stats.failures += 1;
      throw new AppError(
        "AI_FAILURE",
        `Could not reach TypeSafe: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (res.status === 429 || res.status === 529) {
      const wait = retryAfterMs(res);
      if (attempt < attempts - 1) {
        await sleep(wait);
        continue;
      }
      stats.failures += 1;
      throw errorForStatus(res.status);
    }
    if (!res.ok) {
      stats.failures += 1;
      throw errorForStatus(res.status);
    }
    let json;
    try {
      json = await res.json();
    } catch {
      stats.failures += 1;
      throw new AppError("INVALID_AI_RESPONSE", "TypeSafe returned a non-JSON body.");
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) {
      stats.failures += 1;
      throw new AppError("INVALID_AI_RESPONSE", "TypeSafe returned an unexpected shape.");
    }
    stats.calls += 1;
    stats.inputTokens += parsed.data.usage?.input_tokens ?? 0;
    stats.outputTokens += parsed.data.usage?.output_tokens ?? 0;
    return parsed.data;
  }
  stats.failures += 1;
  throw new AppError(
    "AI_FAILURE",
    `TypeSafe call failed after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}
async function systemOneSafe(state, questions) {
  if (!config.typesafe.enabled) {
    stats.skipped = true;
    return null;
  }
  try {
    return await systemOne(state, questions);
  } catch (err) {
    stats.lastError = err instanceof Error ? err.message : String(err);
    if (process.env.RESUMERANK_VERBOSE === "1") {
      console.warn(`[jev] ${stats.lastError}`);
    }
    return null;
  }
}
var TYPESAFE_ENDPOINT_DEFAULT, noulAnswerSchema, choiceAnswerSchema, scoreAnswerSchema, answerSchema, responseSchema, stats, ANSWER_CACHE_LIMIT, answerCache, answerCacheLoaded, answerCacheLoadedFrom, answerCacheWrites;
var init_jev = __esm({
  "src/ai/jev.ts"() {
    "use strict";
    init_config();
    init_errors();
    TYPESAFE_ENDPOINT_DEFAULT = "https://api.typesafe.ai/v1/systemone";
    noulAnswerSchema = z.object({ type: z.literal("noul"), noul: z.number() });
    choiceAnswerSchema = z.object({
      type: z.literal("choice"),
      choice: z.string(),
      probabilities: z.record(z.string(), z.number()).optional().default({}),
      confidence: z.number().optional().default(0)
    });
    scoreAnswerSchema = z.object({
      type: z.literal("score"),
      score: z.number(),
      legend: z.record(z.string(), z.string()).optional().default({}),
      probabilities: z.record(z.string(), z.number()).optional().default({}),
      confidence: z.number().optional().default(0)
    });
    answerSchema = z.discriminatedUnion("type", [
      noulAnswerSchema,
      choiceAnswerSchema,
      scoreAnswerSchema
    ]);
    responseSchema = z.object({
      model: z.string().optional(),
      answers: z.record(z.string(), answerSchema),
      usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional()
    });
    stats = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      failures: 0,
      skipped: false,
      cachedAnswers: 0
    };
    ANSWER_CACHE_LIMIT = 5e3;
    answerCache = /* @__PURE__ */ new Map();
    answerCacheLoaded = false;
    answerCacheLoadedFrom = "";
    answerCacheWrites = 0;
  }
});

// src/store/local.ts
var local_exports = {};
__export(local_exports, {
  addNote: () => addNote,
  addRanking: () => addRanking,
  addResume: () => addResume,
  contentHash: () => contentHash,
  countNotes: () => countNotes,
  ensureStore: () => ensureStore,
  findByContentHash: () => findByContentHash,
  getRanking: () => getRanking,
  getResume: () => getResume,
  listNotes: () => listNotes,
  listRankings: () => listRankings,
  listResumes: () => listResumes,
  loadConfig: () => loadConfig,
  newId: () => newId,
  originalFile: () => originalFile,
  removeNote: () => removeNote,
  removeRanking: () => removeRanking,
  removeResume: () => removeResume,
  resumeText: () => resumeText,
  saveConfig: () => saveConfig,
  saveOriginalFile: () => saveOriginalFile,
  searchResumes: () => searchResumes,
  shortId: () => shortId,
  skillIndex: () => skillIndex,
  stats: () => stats2,
  updateNote: () => updateNote,
  withStoreLock: () => withStoreLock
});
import { chmod, copyFile, mkdir, open, readFile as readFile2, rename, rm, stat, unlink, writeFile as writeFile2 } from "node:fs/promises";
import { createHash as createHash2 } from "node:crypto";
import { join as join2 } from "node:path";
function inProcessLock(fn) {
  const run2 = writeQueue.then(fn, fn);
  writeQueue = run2.then(
    () => void 0,
    () => void 0
  );
  return run2;
}
async function acquireFileLock(lockPath) {
  const deadline = Date.now() + 1e4;
  for (; ; ) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(String(process.pid), "utf8");
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(() => {
        });
      };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 15e3) {
          await unlink(lockPath).catch(() => {
          });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        await unlink(lockPath).catch(() => {
        });
        continue;
      }
      await new Promise((resolve5) => setTimeout(resolve5, 10 + Math.random() * 25));
    }
  }
}
async function withStoreLock(fn) {
  return inProcessLock(async () => {
    await ensureStore();
    const release = await acquireFileLock(join2(paths().home, ".store.lock"));
    try {
      return await fn();
    } finally {
      await release();
    }
  });
}
async function ensureStore() {
  const p = paths();
  await mkdir(p.home, { recursive: true });
  await mkdir(p.files, { recursive: true });
  await mkdir(join2(p.home, "text"), { recursive: true });
}
async function readJson(file, fallback) {
  let st;
  try {
    st = await stat(file);
  } catch {
    return fallback;
  }
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.value;
  try {
    const raw = await readFile2(file, "utf8");
    const value = JSON.parse(raw);
    cache.set(file, { mtimeMs: st.mtimeMs, value });
    return value;
  } catch (err) {
    const backup = await readFile2(`${file}.bak`, "utf8").catch(() => null);
    if (backup) {
      try {
        const value = JSON.parse(backup);
        cache.set(file, { mtimeMs: st.mtimeMs, value });
        console.warn(`warn ${file} was unreadable; recovered the previous copy (${err instanceof Error ? err.message : String(err)})`);
        return value;
      } catch {
      }
    }
    throw new AppError("STORE_ERROR", `Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function maybeBackup(file, payload) {
  const now = Date.now();
  const last = lastBackupAt.get(file) ?? 0;
  const hasBackup = await stat(`${file}.bak`).then(
    () => true,
    () => false
  );
  if (hasBackup && now - last < BACKUP_INTERVAL_MS) return;
  lastBackupAt.set(file, now);
  const info = await stat(file).catch(() => null);
  if (!info) {
    await writeFile2(`${file}.bak`, payload, "utf8").catch(() => {
    });
    return;
  }
  await copyFile(file, `${file}.bak`).catch(() => {
  });
}
async function writeJsonAtomic(file, value) {
  const payload = `${JSON.stringify(value, null, 0)}
`;
  if (payload.length <= 262144) JSON.parse(payload);
  tempCounter += 1;
  const tmp = `${file}.${process.pid}.${tempCounter}.tmp`;
  await writeFile2(tmp, payload, "utf8");
  await maybeBackup(file, payload);
  await rename(tmp, file);
  cache.delete(file);
}
function contentHash(text) {
  return createHash2("sha256").update(text.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 32);
}
function newId(prefix) {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${now}${rand}`;
}
function shortId(id) {
  const i = id.indexOf("_");
  return i >= 0 ? id.slice(i + 1, i + 9) : id.slice(0, 8);
}
async function loadResumeIndex() {
  return readJson(paths().resumes, EMPTY_RESUMES);
}
async function saveResumeIndex(index) {
  index.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeJsonAtomic(paths().resumes, index);
}
async function loadRankingIndex() {
  return readJson(paths().rankings, EMPTY_RANKINGS);
}
async function rebuildSkillIndex(resumes) {
  const skills = {};
  for (const resume of resumes) {
    for (const skill of resume.canonicalSkills ?? []) {
      const bucket = skills[skill] ?? (skills[skill] = []);
      bucket.push(resume.id);
    }
  }
  await writeJsonAtomic(paths().home ? join2(paths().home, "skills.json") : "skills.json", {
    version: 1,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    skills
  });
}
async function skillIndex() {
  const idx = await readJson(join2(paths().home, "skills.json"), {
    version: 1,
    updatedAt: "",
    skills: {}
  });
  return idx.skills;
}
async function listResumes() {
  const index = await loadResumeIndex();
  return [...index.resumes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function matchesId(candidate, query) {
  const q = query.trim();
  if (!q) return false;
  if (candidate === q) return true;
  if (shortId(candidate) === q) return true;
  if (candidate.startsWith(q) || shortId(candidate).startsWith(q)) return true;
  return false;
}
async function getResume(id) {
  const index = await loadResumeIndex();
  const summary = index.resumes.find((r) => matchesId(r.id, id));
  if (!summary) return null;
  const text = await resumeText(summary.id);
  const { textChars: _textChars, ...rest } = summary;
  return { ...rest, extractedText: text };
}
async function resumeText(id) {
  const cached = textCache.get(id);
  if (cached !== void 0) return cached;
  try {
    const text = await readFile2(join2(paths().home, "text", `${id}.txt`), "utf8");
    textCache.set(id, text);
    return text;
  } catch {
    return "";
  }
}
async function addResume(record) {
  await withStoreLock(async () => {
    const index = await loadResumeIndex();
    index.resumes = index.resumes.filter((r) => r.id !== record.id);
    const { extractedText, ...rest } = record;
    index.resumes.push({ ...rest, textChars: extractedText.length });
    await saveResumeIndex(index);
    await writeFile2(join2(paths().home, "text", `${record.id}.txt`), extractedText, "utf8");
    textCache.set(record.id, extractedText);
    await rebuildSkillIndex(index.resumes);
  });
}
async function findByContentHash(text) {
  const hash = contentHash(text);
  const index = await loadResumeIndex();
  for (const row of index.resumes) {
    if (row.contentHash) {
      if (row.contentHash === hash) return row;
      continue;
    }
    const existing = await resumeText(row.id);
    if (existing && contentHash(existing) === hash) {
      row.contentHash = hash;
      return row;
    }
  }
  return null;
}
async function saveOriginalFile(id, filename, data) {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  await writeFile2(join2(paths().files, `${id}${ext}`), data);
}
async function originalFile(id) {
  const { readdir: readdir2 } = await import("node:fs/promises");
  const entries = await readdir2(paths().files).catch(() => []);
  const match = entries.find((f) => f.startsWith(`${id}.`));
  if (!match) return null;
  const full = join2(paths().files, match);
  return { path: full, data: await readFile2(full) };
}
async function removeResume(id) {
  return withStoreLock(async () => {
    const index = await loadResumeIndex();
    const target = index.resumes.find((r) => matchesId(r.id, id));
    if (!target) return false;
    index.resumes = index.resumes.filter((r) => r.id !== target.id);
    await saveResumeIndex(index);
    await rm(join2(paths().home, "text", `${target.id}.txt`), { force: true });
    const original = await originalFile(target.id);
    if (original) await rm(original.path, { force: true });
    textCache.delete(target.id);
    const notes = await readJson(notesFile(), EMPTY_NOTES);
    if (notes.notes.some((n) => n.resumeId === target.id)) {
      notes.notes = notes.notes.filter((n) => n.resumeId !== target.id);
      notes.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await writeJsonAtomic(notesFile(), notes);
    }
    await rebuildSkillIndex(index.resumes);
    return true;
  });
}
async function searchResumes(query, limit = 50) {
  const all = await listResumes();
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const resume of all) {
    const meta = [
      resume.originalFilename,
      ...resume.metadata.skills ?? [],
      ...resume.metadata.roles ?? [],
      ...resume.metadata.education ?? [],
      ...resume.metadata.projects ?? [],
      ...resume.metadata.certifications ?? []
    ].join(" ").toLowerCase();
    let hits = tokens.filter((t) => meta.includes(t)).length;
    if (hits === 0) {
      const text = await resumeText(resume.id);
      hits = tokens.filter((t) => text.toLowerCase().includes(t)).length;
    }
    if (hits > 0) scored.push({ resume, hits });
  }
  scored.sort((a, b) => b.hits - a.hits || b.resume.createdAt.localeCompare(a.resume.createdAt));
  return scored.slice(0, limit).map((s) => s.resume);
}
async function listRankings(limit = 30) {
  const index = await loadRankingIndex();
  return index.rankings.map((r) => ({
    id: r.id,
    jobTitle: r.jobTitle,
    candidateCount: r.candidateCount,
    model: r.model,
    createdAt: r.createdAt
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
async function getRanking(id) {
  const index = await loadRankingIndex();
  return index.rankings.find((r) => matchesId(r.id, id)) ?? null;
}
async function addRanking(record) {
  await withStoreLock(async () => {
    const index = await loadRankingIndex();
    index.rankings = index.rankings.filter((r) => r.id !== record.id);
    index.rankings.push(record);
    const MAX_RANKINGS = 50;
    if (index.rankings.length > MAX_RANKINGS) {
      index.rankings = index.rankings.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_RANKINGS);
    }
    index.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await writeJsonAtomic(paths().rankings, index);
  });
}
async function removeRanking(id) {
  return withStoreLock(async () => {
    const index = await loadRankingIndex();
    const target = index.rankings.find((r) => matchesId(r.id, id));
    if (!target) return false;
    index.rankings = index.rankings.filter((r) => r.id !== target.id);
    index.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await writeJsonAtomic(paths().rankings, index);
    return true;
  });
}
function notesFile() {
  return join2(paths().home, "notes.json");
}
async function listNotes(resumeId) {
  const index = await readJson(notesFile(), EMPTY_NOTES);
  const notes = resumeId ? index.notes.filter((n) => n.resumeId === resumeId) : index.notes;
  return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function countNotes() {
  const index = await readJson(notesFile(), EMPTY_NOTES);
  const counts = {};
  for (const note of index.notes) counts[note.resumeId] = (counts[note.resumeId] ?? 0) + 1;
  return counts;
}
async function addNote(resumeId, content) {
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("VALIDATION_ERROR", "A note cannot be empty.");
  return withStoreLock(async () => {
    const index = await readJson(notesFile(), EMPTY_NOTES);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const note = { id: newId("nt"), resumeId, content: trimmed.slice(0, 4e3), createdAt: now, updatedAt: now };
    index.notes.push(note);
    index.updatedAt = now;
    await writeJsonAtomic(notesFile(), index);
    return note;
  });
}
async function updateNote(noteId, content) {
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("VALIDATION_ERROR", "A note cannot be empty.");
  return withStoreLock(async () => {
    const index = await readJson(notesFile(), EMPTY_NOTES);
    const note = index.notes.find((n) => n.id === noteId || n.id.endsWith(noteId));
    if (!note) return null;
    note.content = trimmed.slice(0, 4e3);
    note.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    index.updatedAt = note.updatedAt;
    await writeJsonAtomic(notesFile(), index);
    return note;
  });
}
async function removeNote(noteId) {
  return withStoreLock(async () => {
    const index = await readJson(notesFile(), EMPTY_NOTES);
    const before = index.notes.length;
    index.notes = index.notes.filter((n) => n.id !== noteId && !n.id.endsWith(noteId));
    if (index.notes.length === before) return false;
    index.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await writeJsonAtomic(notesFile(), index);
    return true;
  });
}
async function loadConfig() {
  try {
    return JSON.parse(await readFile2(paths().config, "utf8"));
  } catch {
    return null;
  }
}
async function saveConfig(config3) {
  const file = paths().config;
  await withStoreLock(async () => {
    await writeJsonAtomic(file, { ...config3, initialisedAt: config3.initialisedAt ?? (/* @__PURE__ */ new Date()).toISOString() });
  });
  try {
    await chmod(file, 384);
  } catch {
  }
  return file;
}
async function stats2() {
  const resumes = await listResumes();
  const rankings = await listRankings(1e3);
  const skills = await skillIndex();
  let bytes2 = 0;
  for (const file of [paths().resumes, paths().rankings, join2(paths().home, "skills.json")]) {
    try {
      bytes2 += (await stat(file)).size;
    } catch {
    }
  }
  return {
    resumes: resumes.length,
    rankings: rankings.length,
    skills: Object.keys(skills).length,
    textChars: resumes.reduce((n, r) => n + (r.textChars ?? 0), 0),
    bytes: bytes2,
    home: paths().home
  };
}
var cache, textCache, tempCounter, writeQueue, BACKUP_INTERVAL_MS, lastBackupAt, EMPTY_RESUMES, EMPTY_RANKINGS, EMPTY_NOTES;
var init_local = __esm({
  "src/store/local.ts"() {
    "use strict";
    init_config();
    init_errors();
    cache = /* @__PURE__ */ new Map();
    textCache = /* @__PURE__ */ new Map();
    tempCounter = 0;
    writeQueue = Promise.resolve();
    BACKUP_INTERVAL_MS = 1e4;
    lastBackupAt = /* @__PURE__ */ new Map();
    EMPTY_RESUMES = { version: 1, updatedAt: "", resumes: [] };
    EMPTY_RANKINGS = { version: 1, updatedAt: "", rankings: [] };
    EMPTY_NOTES = { version: 1, updatedAt: "", notes: [] };
  }
});

// src/extract/text.ts
function extOf(filename) {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}
async function extractTextFromBuffer(filename, data) {
  const ext = extOf(filename);
  if (!SUPPORTED.has(ext) || ext === ".text") {
    throw new AppError(
      "UNSUPPORTED_FILE",
      `Unsupported file type "${ext || "(none)"}". Use PDF, DOCX, or TXT.`
    );
  }
  if (data.length === 0) throw new AppError("INVALID_DOCUMENT", `File "${filename}" is empty.`);
  const raw = await parseBuffer(ext, filename, data);
  const text = normalizeText(raw);
  if (text.replace(/[\s\p{P}]/gu, "").length < 40) {
    throw new AppError(
      "EMPTY_RESUME",
      `No readable text in "${filename}" (scanned-image PDFs without a text layer are not supported).`
    );
  }
  return text.slice(0, MAX_CHARS);
}
async function parseBuffer(ext, filename, data) {
  try {
    if (ext === ".pdf") return await extractPdf(data);
    if (ext === ".docx") return (await import("mammoth")).default.extractRawText({ buffer: data }).then((r) => r.value ?? "");
    return data.toString("utf-8");
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "INVALID_DOCUMENT",
      `Could not parse "${filename}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
async function extractPdf(data) {
  const { extractText } = await import("unpdf");
  const bytes2 = new Uint8Array(data.byteLength);
  bytes2.set(data);
  const result = await extractText(bytes2, { mergePages: true });
  if (Array.isArray(result.text)) return result.text.join("\n");
  if (typeof result.text === "string") return result.text;
  return "";
}
function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[ \t]+/g, " ").replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2").replace(/\n{3,}/g, "\n\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();
}
function looksLikeProseLine(line) {
  const t = line.trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 9) return true;
  if (/[.!?]$/.test(t)) return true;
  return /^(built|designed|led|created|improved|managed|developed|worked|owned|drove|delivered|responsible|helped|supported|contributed|implemented|maintained|analy[sz]ed|collaborated|wrote|shipped|ran|used|tested|automated|reduced|increased|partnered|mentored|migrated|scaled|monitored|reviewed|coordinated|assisted|ensured|provided|performed|conducted|trained|taught|oversaw|achieved|generated|presented|documented|spearheaded|streamlined|established)/i.test(
    t
  );
}
function looksLikeHeading(line) {
  const t = line.trim().replace(/[:\-–—]\s*$/, "").trim();
  if (t.length < 3 || t.length > 48) return false;
  if (/\d{4}/.test(t)) return false;
  if (t.split(/\s+/).length > 6) return false;
  if (/[.!?]$/.test(t)) return false;
  if (/^[•\-*·▪◦‣]/.test(t)) return false;
  if (/[,;:]/.test(t)) return false;
  return /^[\p{L}][\p{L}\p{N}\s&/()'.,+-]*$/u.test(t);
}
function sectionKeyFor(line) {
  const t = line.trim().replace(/[:\-–—]\s*$/, "").trim();
  if (!looksLikeHeading(t)) return null;
  for (const [key, re] of SECTION_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    const remainder = t.slice(m[0].length).trim();
    if (remainder.length === 0) return key;
    if (remainder.split(/\s+/).filter(Boolean).length <= 2 && !/\d/.test(remainder) && remainder.length <= 16) {
      return key;
    }
  }
  return null;
}
function isSectionHeading(line) {
  return sectionKeyFor(line) !== null;
}
function splitSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;
  let pendingOther = [];
  const flush = () => {
    if (current) {
      current.body = current.body.trim();
      sections.push(current);
      current = null;
    }
    if (pendingOther.length) {
      const body = pendingOther.join("\n").trim();
      if (body) sections.push({ key: "other", heading: "", body, startLine: 0 });
      pendingOther = [];
    }
  };
  lines.forEach((line, index) => {
    const key = sectionKeyFor(line);
    if (key) {
      flush();
      current = { key, heading: line.trim(), body: "", startLine: index };
      return;
    }
    if (current) current.body += `${line}
`;
    else pendingOther.push(line);
  });
  flush();
  if (sections.length === 0) {
    return [{ key: "other", heading: "", body: text, startLine: 0 }];
  }
  return sections.filter((s) => s.body.length > 0 || s.key !== "other");
}
function experienceSectionText(text) {
  const sections = splitSections(text).filter((x) => x.key === "experience" && x.body.length > 20);
  if (sections.length === 0) return null;
  return sections.map((x) => x.body).join("\n");
}
function experienceText(text) {
  const section = experienceSectionText(text);
  if (section) return section;
  const excluded = /* @__PURE__ */ new Set(["education", "certifications", "summary", "languages", "awards", "skills"]);
  return splitSections(text).filter((s) => !excluded.has(s.key)).map((s) => s.body).join("\n");
}
var MAX_CHARS, SUPPORTED, SECTION_PATTERNS;
var init_text = __esm({
  "src/extract/text.ts"() {
    "use strict";
    init_errors();
    MAX_CHARS = 2e5;
    SUPPORTED = /* @__PURE__ */ new Set([".pdf", ".docx", ".txt", ".md", ".text"]);
    SECTION_PATTERNS = [
      ["summary", /^(professional\s+)?(summary|profile|objective|about( me)?|overview)\b/i],
      ["skills", /^(technical\s+|core\s+|key\s+|relevant\s+)?(skills|competencies|technologies|tech\s+stack|technology\s+stack|toolkit|expertise|proficienc)/i],
      ["experience", /^(work\s+|professional\s+|relevant\s+|employment\s+)?(experience|employment|work history|career history|career|positions held)\b/i],
      ["projects", /^(personal\s+|selected\s+|notable\s+|key\s+)?projects?(\s+(and|&)\s+\w+)?\b/i],
      ["education", /^(education|academic(s| background)?|qualifications)\b/i],
      ["certifications", /^(certifications?|licenses?|courses?|training)\b/i],
      ["languages", /^(languages?|spoken languages)\b/i],
      ["awards", /^(awards?|achievements?|honors?|publications?|volunteering)\b/i]
    ];
  }
});

// src/extract/ontology.ts
function aliasKey(alias) {
  return alias.startsWith("*") ? alias.slice(1) : alias.toLowerCase();
}
function addSkill(def) {
  const entry = byName.get(def.name);
  if (entry) return entry;
  const fresh = {
    canonical: def.name,
    aliases: [def.name.toLowerCase(), ...(def.aliases ?? []).map(aliasKey)],
    category: def.category,
    abstract: def.abstract === true,
    ancestors: [],
    descendants: []
  };
  byName.set(def.name, fresh);
  return fresh;
}
function ancestorsOf(name, seen = /* @__PURE__ */ new Set()) {
  const out = [];
  for (const parent of impliesEdges.get(name) ?? []) {
    if (seen.has(parent)) continue;
    seen.add(parent);
    out.push(parent);
    out.push(...ancestorsOf(parent, seen));
  }
  return out;
}
function knownSkills() {
  return [...byName.keys()];
}
function isPlatformUmbrella(canonical) {
  return PLATFORM_UMBRELLAS.has(canonical);
}
function skillInfo(canonical) {
  return byName.get(canonical);
}
function isAbstractSkill(canonical) {
  return byName.get(canonical)?.abstract === true;
}
function canonicalize(raw) {
  const cleaned = raw.trim().replace(/^[•\-*\s]+/, "").replace(/[.;,]+$/, "").trim();
  if (!cleaned) return null;
  const direct = aliasIndex.get(cleaned) ?? aliasIndex.get(cleaned.toLowerCase());
  if (direct) return direct;
  const lower = ` ${cleaned.toLowerCase()} `;
  let best = null;
  for (const [alias, canonical] of aliasIndex) {
    if (alias.length < 3) continue;
    if (lower.includes(` ${alias} `) || lower.includes(`${alias},`) || lower.includes(`(${alias})`)) {
      if (!best || alias.length > best.len) best = { canonical, len: alias.length };
    }
  }
  return best?.canonical ?? null;
}
var SKILLS, byName, aliasIndex, caseSensitiveAliases, impliesEdges, PLATFORM_UMBRELLAS, ONTOLOGY;
var init_ontology = __esm({
  "src/extract/ontology.ts"() {
    "use strict";
    SKILLS = [
      // --- abstract umbrella skills (targets of implication edges) -------------
      { name: "Programming", category: "practice", abstract: true },
      { name: "Frontend", category: "frontend", abstract: true },
      { name: "Backend", category: "backend", abstract: true },
      { name: "Full Stack", category: "practice", implies: ["Frontend", "Backend"], abstract: true },
      { name: "Mobile", category: "mobile", abstract: true },
      { name: "Cloud", category: "cloud", abstract: true },
      { name: "DevOps", category: "devops", implies: ["Cloud"], abstract: true },
      { name: "Site Reliability", aliases: ["sre", "site reliability engineering"], category: "devops", implies: ["DevOps"], abstract: true },
      { name: "Data Engineering", category: "data" },
      { name: "Analytics", aliases: ["analytics", "data analytics"], category: "data" },
      { name: "Big Data", category: "data" },
      { name: "Data Warehouse", category: "data" },
      { name: "Business Intelligence", aliases: ["business intelligence", "*BI"], category: "data" },
      { name: "Machine Learning", category: "ml" },
      { name: "Deep Learning", category: "ml", implies: ["Machine Learning"] },
      { name: "Generative AI", category: "ml", implies: ["Machine Learning"] },
      { name: "Natural Language Processing", category: "ml", implies: ["Machine Learning"] },
      { name: "Computer Vision", category: "ml", implies: ["Machine Learning"] },
      { name: "MLOps", category: "ml", implies: ["Machine Learning", "DevOps"] },
      { name: "Testing", category: "testing" },
      { name: "Test Automation", aliases: ["test automation", "automated testing"], category: "testing", implies: ["Testing"] },
      { name: "Performance Testing", category: "testing", implies: ["Testing"] },
      { name: "Security", category: "security" },
      { name: "Networking", category: "devops", abstract: true },
      { name: "Databases", aliases: ["databases", "database"], category: "database", abstract: true },
      { name: "Relational Databases", category: "database", implies: ["Databases"], abstract: true },
      { name: "NoSQL", aliases: ["nosql", "non-relational"], category: "database", implies: ["Databases"], abstract: true },
      { name: "Search Engines", category: "database", abstract: true },
      { name: "Caching", category: "backend", abstract: true },
      { name: "Streaming", category: "data", abstract: true },
      { name: "Message Queues", category: "backend" },
      { name: "System Design", category: "practice" },
      { name: "Distributed Systems", category: "practice", implies: ["System Design"] },
      { name: "Microservices", aliases: ["microservice", "microservices"], category: "backend", implies: ["System Design"] },
      { name: "REST APIs", aliases: ["rest api", "restful", "*REST", "rest apis"], category: "backend" },
      { name: "GraphQL", category: "backend", abstract: true },
      { name: "WebSockets", aliases: ["websocket", "websockets"], category: "backend", abstract: true },
      { name: "Containers", aliases: ["containers", "containerization"], category: "devops", abstract: true },
      { name: "Orchestration", category: "devops", abstract: true },
      { name: "Infrastructure as Code", aliases: ["infrastructure as code", "*IaC"], category: "devops", abstract: true },
      { name: "CI/CD", aliases: ["ci/cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"], category: "devops" },
      { name: "Observability", aliases: ["monitoring", "observability"], category: "devops" },
      { name: "Agile", aliases: ["agile", "scrum", "kanban"], category: "practice" },
      { name: "Accessibility", aliases: ["a11y", "wcag", "accessibility"], category: "frontend" },
      { name: "UI/UX", aliases: ["ui/ux", "user experience", "ux design"], category: "design" },
      { name: "Product Management", aliases: ["product management", "product owner"], category: "product", abstract: true },
      // --- languages ----------------------------------------------------------
      { name: "JavaScript", aliases: ["javascript", "*JS", "es6", "es2015", "ecmascript"], implies: ["Programming"], category: "language" },
      { name: "TypeScript", aliases: ["typescript", "*TS"], implies: ["JavaScript", "Programming"], category: "language" },
      { name: "Python", aliases: ["python", "python3"], implies: ["Programming"], category: "language" },
      { name: "Java", aliases: ["java", "java 8", "java 11", "java 17"], implies: ["Programming"], category: "language" },
      { name: "Kotlin", implies: ["Java", "Programming"], category: "language" },
      { name: "Scala", implies: ["Java", "Programming"], category: "language" },
      { name: "Groovy", implies: ["Java", "Programming"], category: "language" },
      { name: "C", aliases: ["*C", "c language"], implies: ["Programming"], category: "language" },
      { name: "C++", aliases: ["*C++", "cplusplus", "cpp"], implies: ["C", "Programming"], category: "language" },
      { name: "C#", aliases: ["*C#", "csharp", "c sharp"], implies: ["Programming"], category: "language" },
      { name: "Go", aliases: ["*Go", "golang"], implies: ["Programming"], category: "language" },
      { name: "Rust", implies: ["Programming"], category: "language" },
      { name: "Ruby", implies: ["Programming"], category: "language" },
      { name: "PHP", aliases: ["php", "php8"], implies: ["Programming"], category: "language" },
      { name: "Swift", aliases: ["swift", "swift 5"], implies: ["Programming"], category: "language" },
      { name: "Objective-C", aliases: ["objective-c", "objc"], implies: ["C"], category: "language" },
      { name: "Dart", implies: ["Programming"], category: "language" },
      { name: "R", aliases: ["*R", "r language"], implies: ["Programming"], category: "language" },
      { name: "MATLAB", implies: ["Programming"], category: "language" },
      { name: "SQL", aliases: ["sql", "ansi sql"], implies: ["Relational Databases"], category: "database" },
      { name: "PL/SQL", aliases: ["pl/sql", "plsql"], implies: ["SQL"], category: "database" },
      { name: "T-SQL", aliases: ["t-sql", "tsql"], implies: ["SQL"], category: "database" },
      { name: "Shell", aliases: ["bash", "shell scripting", "zsh", "shell"], implies: ["Programming"], category: "language" },
      { name: "PowerShell", implies: ["Shell"], category: "language" },
      { name: "Perl", implies: ["Programming"], category: "language" },
      { name: "Haskell", implies: ["Programming"], category: "language" },
      { name: "Elixir", implies: ["Programming"], category: "language" },
      { name: "Erlang", implies: ["Programming"], category: "language" },
      { name: "Clojure", implies: ["Programming"], category: "language" },
      { name: "Lua", implies: ["Programming"], category: "language" },
      { name: "Solidity", implies: ["Programming"], category: "language" },
      // --- frontend -----------------------------------------------------------
      { name: "HTML", aliases: ["html", "html5"], implies: ["Frontend"], category: "frontend" },
      { name: "CSS", aliases: ["css", "css3"], implies: ["Frontend"], category: "frontend" },
      { name: "Sass", aliases: ["sass", "scss"], implies: ["CSS"], category: "frontend" },
      { name: "Tailwind", aliases: ["tailwind", "tailwindcss", "tailwind css"], implies: ["CSS"], category: "frontend" },
      { name: "Bootstrap", implies: ["CSS"], category: "frontend" },
      { name: "Material UI", aliases: ["material ui", "material-ui", "*MUI"], implies: ["React", "CSS"], category: "frontend" },
      { name: "React", aliases: ["react", "react.js", "reactjs", "react 18", "react 19"], implies: ["JavaScript", "Frontend"], category: "frontend" },
      { name: "Next.js", aliases: ["next.js", "nextjs", "next js"], implies: ["React", "Frontend"], category: "frontend" },
      { name: "Angular", aliases: ["angular", "angularjs"], implies: ["TypeScript", "Frontend"], category: "frontend" },
      { name: "Vue", aliases: ["vue", "vue.js", "vuejs", "nuxt"], implies: ["JavaScript", "Frontend"], category: "frontend" },
      { name: "Svelte", aliases: ["svelte", "sveltekit"], implies: ["JavaScript", "Frontend"], category: "frontend" },
      { name: "Remix", implies: ["React", "Frontend"], category: "frontend" },
      { name: "Astro", implies: ["Frontend"], category: "frontend" },
      { name: "Redux", aliases: ["redux", "redux toolkit"], implies: ["React"], category: "frontend" },
      { name: "React Query", aliases: ["react query", "tanstack query"], implies: ["React"], category: "frontend" },
      { name: "jQuery", implies: ["JavaScript"], category: "frontend" },
      { name: "Vite", aliases: ["vite", "vitejs"], implies: ["Frontend"], category: "frontend" },
      { name: "Webpack", implies: ["Frontend"], category: "frontend" },
      { name: "Babel", implies: ["JavaScript"], category: "frontend" },
      { name: "ESLint", implies: ["JavaScript"], category: "tooling" },
      { name: "Three.js", aliases: ["three.js", "threejs"], implies: ["JavaScript"], category: "frontend" },
      { name: "D3", aliases: ["d3.js", "*D3", "d3js"], implies: ["JavaScript"], category: "frontend" },
      { name: "GSAP", implies: ["JavaScript"], category: "frontend" },
      { name: "WebGL", implies: ["Frontend"], category: "frontend" },
      { name: "Progressive Web Apps", aliases: ["pwa", "progressive web app"], implies: ["Frontend"], category: "frontend" },
      { name: "SEO", aliases: ["*SEO", "search engine optimization"], category: "frontend" },
      { name: "Design Systems", aliases: ["design system", "design systems"], implies: ["UI/UX"], category: "design" },
      { name: "Figma", implies: ["UI/UX"], category: "design" },
      { name: "Wireframing", aliases: ["wireframe", "wireframing"], implies: ["UI/UX"], category: "design" },
      { name: "Prototyping", aliases: ["prototyping", "prototype"], implies: ["UI/UX"], category: "design" },
      { name: "User Research", aliases: ["user research", "usability testing"], implies: ["UI/UX"], category: "design" },
      // --- backend / runtimes -------------------------------------------------
      { name: "Node.js", aliases: ["node.js", "nodejs", "node js", "node"], implies: ["JavaScript", "Backend"], category: "backend" },
      { name: "Bun", aliases: ["bun runtime", "bun.js"], implies: ["JavaScript", "Backend"], category: "backend" },
      { name: "Deno", implies: ["JavaScript", "Backend"], category: "backend" },
      { name: "Express", aliases: ["express", "express.js", "expressjs"], implies: ["Node.js", "Backend"], category: "backend" },
      { name: "NestJS", aliases: ["nestjs", "nest.js"], implies: ["Node.js", "Backend"], category: "backend" },
      { name: "Fastify", implies: ["Node.js", "Backend"], category: "backend" },
      { name: "Django", aliases: ["django", "django rest framework"], implies: ["Python", "Backend"], category: "backend" },
      { name: "Flask", implies: ["Python", "Backend"], category: "backend" },
      { name: "FastAPI", aliases: ["fastapi", "fast api"], implies: ["Python", "Backend"], category: "backend" },
      { name: "Spring Boot", aliases: ["spring boot", "springboot", "spring framework", "spring"], implies: ["Java", "Backend"], category: "backend" },
      { name: "Ruby on Rails", aliases: ["ruby on rails", "rails"], implies: ["Ruby", "Backend"], category: "backend" },
      { name: "Laravel", implies: ["PHP", "Backend"], category: "backend" },
      { name: "ASP.NET", aliases: ["asp.net", "asp net", "aspnet"], implies: [".NET", "Backend"], category: "backend" },
      { name: ".NET", aliases: [".net", "dotnet", ".net core", ".net 6", ".net 8"], implies: ["C#", "Backend"], category: "backend" },
      { name: "gRPC", implies: ["REST APIs", "Microservices"], category: "backend" },
      { name: "Kafka", aliases: ["kafka", "apache kafka"], implies: ["Streaming", "Message Queues"], category: "data" },
      { name: "RabbitMQ", implies: ["Message Queues"], category: "backend" },
      { name: "NATS", implies: ["Message Queues"], category: "backend" },
      { name: "Celery", implies: ["Python", "Message Queues"], category: "backend" },
      { name: "OAuth", aliases: ["oauth", "oauth2", "oauth 2.0"], implies: ["Security"], category: "security" },
      { name: "JWT", aliases: ["*JWT", "json web token"], implies: ["Security"], category: "security" },
      { name: "SAML", aliases: ["saml", "sso"], implies: ["Security"], category: "security" },
      { name: "Keycloak", implies: ["Security"], category: "security" },
      { name: "Payment Integration", aliases: ["stripe", "razorpay", "payment gateway", "payments"], implies: ["Backend"], category: "backend" },
      { name: "Web Scraping", aliases: ["web scraping", "scraping", "puppeteer", "beautifulsoup"], implies: ["Backend"], category: "backend" },
      // --- mobile -------------------------------------------------------------
      { name: "iOS", aliases: ["ios", "ios development"], implies: ["Mobile"], category: "mobile" },
      { name: "Android", aliases: ["android", "android development"], implies: ["Mobile"], category: "mobile" },
      { name: "React Native", aliases: ["react native", "react-native"], implies: ["React", "Mobile"], category: "mobile" },
      { name: "Flutter", aliases: ["flutter", "dart flutter"], implies: ["Dart", "Mobile"], category: "mobile" },
      { name: "SwiftUI", implies: ["Swift", "iOS"], category: "mobile" },
      { name: "UIKit", implies: ["Swift", "iOS"], category: "mobile" },
      { name: "Jetpack Compose", aliases: ["jetpack compose", "compose"], implies: ["Kotlin", "Android"], category: "mobile" },
      { name: "Xcode", implies: ["iOS"], category: "tooling" },
      { name: "Android Studio", implies: ["Android"], category: "tooling" },
      { name: "Gradle", implies: ["Android"], category: "tooling" },
      { name: "Expo", implies: ["React Native"], category: "mobile" },
      { name: "Firebase", aliases: ["firebase", "firestore"], implies: ["Cloud", "NoSQL"], category: "cloud" },
      // --- databases ----------------------------------------------------------
      { name: "PostgreSQL", aliases: ["postgresql", "postgres", "psql", "pg"], implies: ["Relational Databases", "SQL"], category: "database" },
      { name: "MySQL", implies: ["Relational Databases", "SQL"], category: "database" },
      { name: "MariaDB", implies: ["MySQL"], category: "database" },
      { name: "SQL Server", aliases: ["sql server", "mssql", "microsoft sql server"], implies: ["Relational Databases", "SQL"], category: "database" },
      { name: "Oracle DB", aliases: ["oracle db", "oracle database", "oracle sql"], implies: ["Relational Databases", "SQL"], category: "database" },
      { name: "SQLite", implies: ["Relational Databases", "SQL"], category: "database" },
      { name: "MongoDB", aliases: ["mongodb", "mongo", "mongoose"], implies: ["NoSQL"], category: "database" },
      { name: "DynamoDB", aliases: ["dynamodb", "dynamo db"], implies: ["NoSQL", "AWS"], category: "database" },
      { name: "Cassandra", implies: ["NoSQL"], category: "database" },
      { name: "Redis", implies: ["NoSQL", "Caching"], category: "database" },
      { name: "Memcached", implies: ["Caching"], category: "database" },
      { name: "Elasticsearch", aliases: ["elasticsearch", "elastic search", "opensearch", "elk stack", "elk"], implies: ["Search Engines", "NoSQL"], category: "database" },
      { name: "Neo4j", aliases: ["neo4j", "graph database"], implies: ["NoSQL"], category: "database" },
      { name: "Snowflake", implies: ["Data Warehouse", "SQL"], category: "data" },
      { name: "BigQuery", aliases: ["bigquery", "big query"], implies: ["Data Warehouse", "SQL", "GCP"], category: "data" },
      { name: "Redshift", aliases: ["redshift", "amazon redshift"], implies: ["Data Warehouse", "SQL", "AWS"], category: "data" },
      { name: "Databricks", implies: ["Big Data", "Data Warehouse"], category: "data" },
      { name: "Prisma", implies: ["Relational Databases", "TypeScript"], category: "database" },
      { name: "TypeORM", implies: ["Relational Databases", "TypeScript"], category: "database" },
      { name: "Sequelize", implies: ["Relational Databases", "Node.js"], category: "database" },
      { name: "Hibernate", aliases: ["hibernate", "jpa"], implies: ["Java", "Relational Databases"], category: "database" },
      { name: "Supabase", implies: ["PostgreSQL", "Cloud"], category: "database" },
      // --- cloud: AWS ---------------------------------------------------------
      { name: "AWS", aliases: ["aws", "amazon web services"], implies: ["Cloud"], category: "cloud" },
      { name: "EC2", aliases: ["ec2", "elastic compute cloud"], implies: ["AWS"], category: "cloud" },
      { name: "S3", aliases: ["*S3", "amazon s3", "s3 bucket", "simple storage service"], implies: ["AWS"], category: "cloud" },
      { name: "Lambda", aliases: ["lambda", "aws lambda"], implies: ["AWS", "Serverless"], category: "cloud" },
      { name: "ECS", aliases: ["ecs", "elastic container service"], implies: ["AWS", "Containers"], category: "cloud" },
      { name: "EKS", aliases: ["eks", "elastic kubernetes service"], implies: ["AWS", "Kubernetes", "Containers"], category: "cloud" },
      { name: "Fargate", implies: ["ECS", "AWS"], category: "cloud" },
      { name: "RDS", aliases: ["rds", "aurora", "amazon aurora"], implies: ["AWS", "Relational Databases"], category: "cloud" },
      { name: "SQS", implies: ["AWS", "Message Queues"], category: "cloud" },
      { name: "SNS", implies: ["AWS", "Message Queues"], category: "cloud" },
      { name: "EventBridge", implies: ["AWS"], category: "cloud" },
      { name: "Step Functions", aliases: ["step functions", "aws step functions"], implies: ["AWS"], category: "cloud" },
      { name: "API Gateway", aliases: ["api gateway", "apigateway"], implies: ["AWS", "REST APIs"], category: "cloud" },
      { name: "CloudFront", aliases: ["cloudfront", "cdn"], implies: ["AWS"], category: "cloud" },
      { name: "Route 53", aliases: ["route 53", "route53", "amazon route 53"], implies: ["AWS", "DNS"], category: "cloud" },
      { name: "IAM", aliases: ["*IAM"], implies: ["AWS", "Security"], category: "security" },
      { name: "CloudWatch", implies: ["AWS", "Observability"], category: "cloud" },
      { name: "CloudFormation", aliases: ["cloudformation", "cloud formation", "aws cdk", "cdk"], implies: ["AWS", "Infrastructure as Code"], category: "cloud" },
      { name: "CodePipeline", aliases: ["codepipeline", "codebuild", "codecommit", "aws codepipeline"], implies: ["AWS", "CI/CD"], category: "cloud" },
      { name: "Glue", aliases: ["aws glue", "glue etl"], implies: ["AWS", "ETL", "Data Engineering"], category: "data" },
      { name: "Athena", aliases: ["aws athena", "athena query"], implies: ["AWS", "SQL", "Big Data"], category: "data" },
      { name: "Kinesis", aliases: ["kinesis", "kinesis firehose"], implies: ["AWS", "Streaming"], category: "data" },
      { name: "EMR", aliases: ["*EMR", "emr cluster"], implies: ["AWS", "Big Data", "Spark"], category: "data" },
      { name: "SageMaker", aliases: ["sagemaker", "sagemaker studio"], implies: ["AWS", "Machine Learning"], category: "ml" },
      { name: "Cognito", implies: ["AWS", "Security"], category: "security" },
      { name: "Secrets Manager", aliases: ["secrets manager", "aws secrets manager", "parameter store"], implies: ["AWS", "Security"], category: "security" },
      { name: "ElastiCache", implies: ["AWS", "Caching"], category: "cloud" },
      { name: "EBS", aliases: ["*EBS", "ebs volume"], implies: ["AWS"], category: "cloud" },
      { name: "Amplify", implies: ["AWS", "Frontend"], category: "cloud" },
      // --- cloud: GCP / Azure -------------------------------------------------
      { name: "GCP", aliases: ["gcp", "google cloud", "google cloud platform"], implies: ["Cloud"], category: "cloud" },
      { name: "GKE", aliases: ["gke", "google kubernetes engine"], implies: ["GCP", "Kubernetes"], category: "cloud" },
      { name: "Cloud Run", aliases: ["cloud run", "google cloud run"], implies: ["GCP", "Serverless", "Containers"], category: "cloud" },
      { name: "Cloud Functions", aliases: ["cloud functions", "google cloud functions"], implies: ["GCP", "Serverless"], category: "cloud" },
      { name: "Pub/Sub", aliases: ["pub/sub", "pubsub", "google pubsub"], implies: ["GCP", "Message Queues"], category: "cloud" },
      { name: "Dataflow", aliases: ["dataflow", "apache beam"], implies: ["GCP", "Big Data"], category: "data" },
      { name: "Dataproc", implies: ["GCP", "Big Data", "Spark"], category: "data" },
      { name: "Vertex AI", aliases: ["vertex ai", "vertex"], implies: ["GCP", "Machine Learning"], category: "ml" },
      { name: "Spanner", aliases: ["bigtable", "spanner"], implies: ["GCP", "NoSQL"], category: "database" },
      { name: "Azure", aliases: ["azure", "microsoft azure"], implies: ["Cloud"], category: "cloud" },
      { name: "AKS", aliases: ["aks", "azure kubernetes service"], implies: ["Azure", "Kubernetes"], category: "cloud" },
      { name: "Azure Functions", aliases: ["azure functions", "azure function app"], implies: ["Azure", "Serverless"], category: "cloud" },
      { name: "Azure DevOps", aliases: ["azure devops", "azure pipelines"], implies: ["Azure", "CI/CD"], category: "cloud" },
      { name: "Cosmos DB", aliases: ["cosmos db", "cosmosdb"], implies: ["Azure", "NoSQL"], category: "database" },
      { name: "Blob Storage", aliases: ["blob storage", "azure blob"], implies: ["Azure"], category: "cloud" },
      { name: "Synapse", aliases: ["synapse", "azure synapse"], implies: ["Azure", "Data Warehouse"], category: "data" },
      { name: "Data Factory", aliases: ["data factory", "azure data factory"], implies: ["Azure", "ETL"], category: "data" },
      { name: "Entra ID", aliases: ["entra id", "azure ad", "active directory"], implies: ["Azure", "Security"], category: "security" },
      { name: "Serverless", aliases: ["serverless"], implies: ["Cloud"], category: "cloud" },
      // --- devops / infra -----------------------------------------------------
      { name: "Docker", aliases: ["docker", "dockerfile", "docker compose"], implies: ["Containers"], category: "devops" },
      { name: "Kubernetes", aliases: ["kubernetes", "*K8s", "kube"], implies: ["Containers", "Orchestration"], category: "devops" },
      { name: "Helm", aliases: ["helm", "helm charts"], implies: ["Kubernetes"], category: "devops" },
      { name: "ArgoCD", aliases: ["argocd", "argo cd", "argo workflows"], implies: ["Kubernetes", "CI/CD"], category: "devops" },
      { name: "Istio", aliases: ["istio", "service mesh"], implies: ["Kubernetes", "Networking"], category: "devops" },
      { name: "Terraform", aliases: ["terraform", "tf modules"], implies: ["Infrastructure as Code"], category: "devops" },
      { name: "Pulumi", implies: ["Infrastructure as Code"], category: "devops" },
      { name: "Ansible", aliases: ["ansible", "ansible playbook"], implies: ["Infrastructure as Code"], category: "devops" },
      { name: "Jenkins", implies: ["CI/CD"], category: "devops" },
      { name: "GitHub Actions", aliases: ["github actions", "gh actions"], implies: ["CI/CD"], category: "devops" },
      { name: "GitLab CI", aliases: ["gitlab ci", "gitlab pipelines"], implies: ["CI/CD"], category: "devops" },
      { name: "CircleCI", implies: ["CI/CD"], category: "devops" },
      { name: "Nginx", aliases: ["nginx", "reverse proxy"], implies: ["Networking"], category: "devops" },
      { name: "Linux", aliases: ["linux", "ubuntu", "debian", "rhel", "centos"], category: "devops" },
      { name: "Unix", implies: ["Linux"], category: "devops" },
      { name: "Networking", aliases: ["tcp/ip", "*TCP", "http/2", "http", "dns", "*DNS"], category: "devops" },
      { name: "Prometheus", aliases: ["prometheus", "promql"], implies: ["Observability"], category: "devops" },
      { name: "Grafana", implies: ["Observability"], category: "devops" },
      { name: "Datadog", implies: ["Observability"], category: "devops" },
      { name: "Splunk", implies: ["Observability"], category: "devops" },
      { name: "OpenTelemetry", aliases: ["opentelemetry", "otel", "jaeger"], implies: ["Observability"], category: "devops" },
      { name: "New Relic", aliases: ["new relic", "newrelic"], implies: ["Observability"], category: "devops" },
      { name: "Load Balancing", aliases: ["load balancing", "load balancer", "elb", "alb"], implies: ["Networking"], category: "devops" },
      { name: "Scripting", aliases: ["scripting", "automation scripting"], implies: ["Programming"], category: "devops" },
      { name: "Vagrant", implies: ["DevOps"], category: "devops" },
      { name: "Vercel", implies: ["Cloud", "Frontend"], category: "cloud" },
      { name: "Cloudflare", aliases: ["cloudflare", "cloudflare workers"], implies: ["Cloud"], category: "cloud" },
      { name: "Heroku", implies: ["Cloud"], category: "cloud" },
      { name: "DigitalOcean", aliases: ["digitalocean", "digital ocean"], implies: ["Cloud"], category: "cloud" },
      // --- data / analytics ---------------------------------------------------
      { name: "Pandas", aliases: ["pandas"], implies: ["Python", "Analytics"], category: "data" },
      { name: "NumPy", aliases: ["numpy"], implies: ["Python", "Analytics"], category: "data" },
      { name: "Polars", implies: ["Python", "Analytics"], category: "data" },
      { name: "Spark", aliases: ["spark", "apache spark", "pyspark"], implies: ["Big Data"], category: "data" },
      { name: "Hadoop", aliases: ["hadoop", "hdfs", "hive"], implies: ["Big Data"], category: "data" },
      { name: "Airflow", aliases: ["airflow", "apache airflow", "dagster", "prefect"], implies: ["Data Engineering", "Orchestration"], category: "data" },
      { name: "dbt", aliases: ["dbt", "data build tool"], implies: ["ETL", "SQL", "Data Warehouse"], category: "data" },
      { name: "ETL", aliases: ["*ETL", "elt", "data pipelines", "data pipeline"], implies: ["Data Engineering"], category: "data" },
      { name: "Data Modeling", aliases: ["data modeling", "data modelling", "dimensional modeling"], implies: ["Data Engineering", "Databases"], category: "data" },
      { name: "Tableau", implies: ["Business Intelligence"], category: "data" },
      { name: "Power BI", aliases: ["power bi", "powerbi"], implies: ["Business Intelligence"], category: "data" },
      { name: "Looker", aliases: ["looker", "looker studio"], implies: ["Business Intelligence"], category: "data" },
      { name: "Excel", aliases: ["excel", "ms excel", "microsoft excel", "spreadsheets"], category: "data" },
      { name: "Jupyter", aliases: ["jupyter", "jupyter notebook"], implies: ["Python"], category: "data" },
      { name: "Statistics", aliases: ["statistics", "statistical analysis", "hypothesis testing"], implies: ["Analytics"], category: "data" },
      { name: "A/B Testing", aliases: ["a/b testing", "ab testing", "experimentation"], implies: ["Analytics"], category: "data" },
      { name: "Data Visualization", aliases: ["data visualization", "data visualisation", "matplotlib", "seaborn", "plotly"], implies: ["Analytics"], category: "data" },
      { name: "Data Governance", aliases: ["data governance", "data quality", "data catalog"], implies: ["Data Engineering"], category: "data" },
      { name: "S3 Data Lake", aliases: ["data lake", "data lakehouse", "delta lake", "iceberg"], implies: ["Data Engineering", "Big Data"], category: "data" },
      // --- ml -----------------------------------------------------------------
      { name: "scikit-learn", aliases: ["scikit-learn", "sklearn"], implies: ["Python", "Machine Learning"], category: "ml" },
      { name: "TensorFlow", aliases: ["tensorflow", "keras"], implies: ["Deep Learning", "Python"], category: "ml" },
      { name: "PyTorch", aliases: ["pytorch", "torch", "lightning"], implies: ["Deep Learning", "Python"], category: "ml" },
      { name: "Hugging Face", aliases: ["hugging face", "huggingface", "transformers library"], implies: ["Natural Language Processing", "Generative AI"], category: "ml" },
      { name: "LangChain", aliases: ["langchain", "llamaindex", "langgraph"], implies: ["Generative AI", "Python"], category: "ml" },
      { name: "RAG", aliases: ["*RAG", "retrieval augmented generation", "vector database", "pinecone", "weaviate", "qdrant", "pgvector"], implies: ["Generative AI"], category: "ml" },
      { name: "LLM", aliases: ["*LLM", "llms", "large language model", "large language models", "gpt", "openai api", "claude api", "prompt engineering"], implies: ["Generative AI"], category: "ml" },
      { name: "Fine-tuning", aliases: ["fine-tuning", "finetuning", "lora", "peft"], implies: ["Deep Learning"], category: "ml" },
      { name: "Model Deployment", aliases: ["model deployment", "model serving", "vllm", "triton", "onnx"], implies: ["MLOps", "Machine Learning"], category: "ml" },
      { name: "Feature Engineering", aliases: ["feature engineering", "feature store"], implies: ["Machine Learning"], category: "ml" },
      { name: "Recommendation Systems", aliases: ["recommendation system", "recommender", "recsys"], implies: ["Machine Learning"], category: "ml" },
      { name: "Time Series", aliases: ["time series", "forecasting"], implies: ["Machine Learning", "Statistics"], category: "ml" },
      { name: "OpenCV", implies: ["Computer Vision", "Python"], category: "ml" },
      // --- testing ------------------------------------------------------------
      { name: "Jest", implies: ["JavaScript", "Testing"], category: "testing" },
      { name: "Vitest", implies: ["JavaScript", "Testing"], category: "testing" },
      { name: "Mocha", aliases: ["mocha", "chai"], implies: ["JavaScript", "Testing"], category: "testing" },
      { name: "Playwright", aliases: ["playwright"], implies: ["Test Automation"], category: "testing" },
      { name: "Cypress", implies: ["Test Automation", "Frontend"], category: "testing" },
      { name: "Selenium", implies: ["Test Automation"], category: "testing" },
      { name: "Appium", implies: ["Test Automation", "Mobile"], category: "testing" },
      { name: "Pytest", aliases: ["pytest", "unittest"], implies: ["Python", "Testing"], category: "testing" },
      { name: "JUnit", aliases: ["junit", "testng", "mockito"], implies: ["Java", "Testing"], category: "testing" },
      { name: "Postman", implies: ["Testing", "REST APIs"], category: "testing" },
      { name: "JMeter", aliases: ["jmeter", "k6", "gatling"], implies: ["Performance Testing"], category: "testing" },
      { name: "TDD", aliases: ["*TDD", "test-driven development", "test driven"], implies: ["Testing"], category: "testing" },
      { name: "Unit Testing", aliases: ["unit testing", "unit tests"], implies: ["Testing"], category: "testing" },
      { name: "Integration Testing", aliases: ["integration testing", "integration tests", "end-to-end testing", "e2e testing"], implies: ["Testing"], category: "testing" },
      { name: "Code Review", aliases: ["code review", "code reviews", "peer review"], implies: ["Testing"], category: "practice" },
      // --- security -----------------------------------------------------------
      { name: "Penetration Testing", aliases: ["penetration testing", "pentest", "burp suite", "owasp"], implies: ["Security"], category: "security" },
      { name: "Encryption", aliases: ["encryption", "tls", "cryptography"], implies: ["Security"], category: "security" },
      { name: "Compliance", aliases: ["gdpr", "soc 2", "hipaa", "pci dss", "compliance"], implies: ["Security"], category: "security" },
      // --- tooling / process --------------------------------------------------
      { name: "Git", aliases: ["git", "version control"], category: "tooling" },
      { name: "GitHub", aliases: ["github", "gh cli"], implies: ["Git"], category: "tooling" },
      { name: "GitLab", implies: ["Git"], category: "tooling" },
      { name: "Bitbucket", implies: ["Git"], category: "tooling" },
      { name: "Jira", aliases: ["jira", "atlassian"], category: "tooling" },
      { name: "Confluence", implies: ["Jira"], category: "tooling" },
      { name: "Notion", category: "tooling" },
      { name: "Slack", category: "tooling" },
      { name: "VS Code", aliases: ["vs code", "vscode", "visual studio code"], category: "tooling" },
      { name: "IntelliJ", aliases: ["intellij", "pycharm", "webstorm"], category: "tooling" },
      { name: "Vim", aliases: ["vim", "neovim"], category: "tooling" },
      { name: "Swagger", aliases: ["swagger", "openapi", "open api"], implies: ["REST APIs"], category: "tooling" },
      { name: "npm", aliases: ["npm", "yarn", "pnpm"], implies: ["Node.js"], category: "tooling" },
      { name: "Maven", aliases: ["maven", "gradle build", "ant build"], implies: ["Java"], category: "tooling" },
      { name: "Stakeholder Management", aliases: ["stakeholder management", "stakeholders", "cross-functional"], category: "product" },
      { name: "Mentoring", aliases: ["mentoring", "mentorship", "mentored", "coaching", "onboarding engineers"], category: "practice" },
      { name: "Technical Writing", aliases: ["technical writing", "documentation", "rfc"], category: "practice" },
      { name: "Copywriting", aliases: ["copywriting", "content writing", "seo content"], category: "design" },
      { name: "Salesforce", aliases: ["salesforce", "apex"], category: "product" },
      { name: "SAP", aliases: ["*SAP", "sap erp"], category: "product" },
      { name: "ServiceNow", aliases: ["servicenow", "itsm"], category: "product" },
      { name: "Customer Support", aliases: ["customer support", "customer service", "help desk", "ticketing", "support tickets", "technical support", "support analyst"], category: "product" },
      { name: "Zendesk", aliases: ["zendesk"], implies: ["Customer Support"], category: "product" },
      { name: "Ticket Triage", aliases: ["ticket triage", "triage", "ticket routing"], implies: ["Customer Support"], category: "product" },
      { name: "Knowledge Base", aliases: ["knowledge base", "kb articles", "help center", "documentation articles"], implies: ["Customer Support"], category: "product" },
      { name: "SLA Management", aliases: ["sla management", "sla", "service level agreements", "slas"], implies: ["Customer Support"], category: "product" },
      { name: "Customer Communication", aliases: ["customer communication", "written communication", "email support", "client communication"], implies: ["Customer Support"], category: "practice" },
      { name: "Digital Marketing", aliases: ["digital marketing", "campaigns", "marketing campaigns"], category: "product" },
      { name: "Google Analytics", aliases: ["google analytics", "ga4"], implies: ["Digital Marketing"], category: "product" },
      { name: "Google Ads", aliases: ["google ads", "adwords", "ppc", "paid search"], implies: ["Digital Marketing"], category: "product" },
      { name: "HubSpot", aliases: ["hubspot", "crm"], implies: ["Digital Marketing"], category: "product" },
      { name: "Email Marketing", aliases: ["email marketing", "mailchimp", "klaviyo", "drip campaign", "newsletter"], implies: ["Digital Marketing"], category: "product" },
      { name: "Content Strategy", aliases: ["content strategy", "content marketing", "content planning", "editorial calendar"], implies: ["Digital Marketing"], category: "product" },
      { name: "Mixpanel", aliases: ["mixpanel"], implies: ["Analytics"], category: "data" },
      { name: "Amplitude", aliases: ["amplitude", "product analytics"], implies: ["Analytics"], category: "data" },
      { name: "Roadmapping", aliases: ["roadmapping", "roadmap", "product roadmap", "backlog grooming"], implies: ["Product Management"], category: "product" },
      { name: "Requirements Gathering", aliases: ["requirements gathering", "requirements elicitation", "user stories", "business requirements", "brd"], implies: ["Product Management"], category: "product" },
      { name: "Process Mapping", aliases: ["process mapping", "process modelling", "process modeling", "bpmn", "as-is process"], category: "practice" },
      { name: "XGBoost", aliases: ["xgboost", "gradient boosting", "lightgbm", "catboost"], implies: ["Machine Learning", "scikit-learn"], category: "ml" },
      { name: "Interaction Design", aliases: ["interaction design", "interaction designer"], implies: ["UI/UX"], category: "design" },
      { name: "Usability Testing", aliases: ["usability testing", "usability test", "usability studies"], implies: ["UI/UX"], category: "design" },
      { name: "Combine", aliases: ["combine framework", "combine publishers"], implies: ["iOS", "Swift"], category: "mobile" },
      { name: "Core Data", aliases: ["core data", "coredata", "realm", "swiftdata"], implies: ["iOS"], category: "mobile" },
      { name: "XCTest", aliases: ["xctest", "xctestcase", "quick/nimble"], implies: ["iOS", "Test Automation"], category: "testing" },
      { name: "Fastlane", aliases: ["fastlane"], implies: ["iOS", "CI/CD"], category: "mobile" },
      { name: "API Testing", aliases: ["api testing", "api tests", "contract testing"], implies: ["Testing"], category: "testing" }
    ];
    byName = /* @__PURE__ */ new Map();
    aliasIndex = /* @__PURE__ */ new Map();
    caseSensitiveAliases = /* @__PURE__ */ new Set();
    for (const def of SKILLS) {
      const entry = addSkill(def);
      for (const raw of [def.name, ...def.aliases ?? []]) {
        const key = aliasKey(raw);
        if (raw.startsWith("*")) caseSensitiveAliases.add(key);
        if (!aliasIndex.has(key)) aliasIndex.set(key, def.name);
        if (!aliasIndex.has(key.toLowerCase()) && key !== key.toLowerCase()) {
          aliasIndex.set(key.toLowerCase(), def.name);
        }
      }
      if (!entry.aliases.includes(def.name.toLowerCase())) entry.aliases.push(def.name.toLowerCase());
    }
    impliesEdges = /* @__PURE__ */ new Map();
    for (const def of SKILLS) {
      if (def.implies?.length) impliesEdges.set(def.name, def.implies);
    }
    for (const def of SKILLS) {
      const entry = byName.get(def.name);
      entry.ancestors = [...new Set(ancestorsOf(def.name))];
    }
    for (const entry of byName.values()) {
      for (const ancestor of entry.ancestors) {
        const parent = byName.get(ancestor);
        if (parent && !parent.descendants.includes(entry.canonical)) {
          parent.descendants.push(entry.canonical);
        }
      }
    }
    PLATFORM_UMBRELLAS = /* @__PURE__ */ new Set([
      "AWS",
      "Google Cloud",
      "Microsoft Azure",
      "Kubernetes",
      "Docker",
      "Salesforce",
      "Snowflake",
      "Databricks",
      "Cloudflare",
      "Terraform",
      "Hadoop",
      "Spark",
      "Elasticsearch",
      "Datadog",
      "GitHub Actions",
      "Jenkins",
      "Firebase",
      "Supabase",
      "Vercel",
      "Shopify",
      "WordPress",
      "SAP",
      "Salesforce Platform"
    ]);
    ONTOLOGY = {
      skills: byName,
      aliasIndex,
      caseSensitiveAliases,
      /** The raw definitions (used to tell declared aliases from canonical names). */
      definitions: SKILLS
    };
  }
});

// src/extract/deterministic.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function matcherFor(alias, canonical, caseSensitive, explicit) {
  const strict = caseSensitive || alias.length <= 3;
  return {
    alias,
    canonical,
    caseSensitive,
    explicit,
    re: new RegExp(
      `${strict ? PRE_STRICT : PRE}${escapeRegExp(alias)}${POST}`,
      caseSensitive ? "gu" : "giu"
    )
  };
}
function indexText(text) {
  const lines = text.split("\n");
  const lineStarts = [];
  let offset = 0;
  const sectionOfLine = [];
  const sections = splitSections(text);
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  for (let i = 0; i < lines.length; i++) sectionOfLine.push("other");
  for (const section of sections) {
    const sectionLines = section.body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === sectionLines[0] && section.key !== "other") {
        for (let j = i; j < i + sectionLines.length && j < lines.length; j++) {
          sectionOfLine[j] = section.key;
        }
        break;
      }
    }
  }
  return { text, lower: text.toLowerCase(), lineStarts, lines, sectionOfLine };
}
function lineIndexAt(idx, offset) {
  let lo = 0;
  let hi = idx.lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (idx.lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
function classifyLine(line, section) {
  const t = line.trim();
  if (!t) return "weak";
  for (const re of NEGATIVE) {
    if (re.test(t)) {
      return POSITIVE.test(t) && !/\bexposure to|familiar with|no hands|not used|beginner|learning\b/i.test(t) ? "used" : "negated";
    }
  }
  if (section === "skills") return "used";
  if (POSITIVE.test(t)) return "used";
  if (section === "experience" || section === "projects") return "weak";
  return "weak";
}
function confidenceFor(context, section, count) {
  const bump = Math.min(0.05, Math.max(0, count - 1) * 0.02);
  if (context === "negated") return 0.15;
  if (context === "used") {
    if (section === "skills") return Math.min(0.98, 0.92 + bump);
    if (section === "experience" || section === "projects") return Math.min(0.97, 0.9 + bump);
    return Math.min(0.9, 0.82 + bump);
  }
  if (section === "skills") return Math.min(0.8, 0.72 + bump);
  return Math.min(0.72, 0.6 + bump);
}
function proposeSkillMentions(idx, options = {}) {
  const mentions = /* @__PURE__ */ new Map();
  for (const matcher of MATCHERS) {
    if (!options.includeAbstract && isAbstractSkill(matcher.canonical)) continue;
    if (options.includeAbstract && isAbstractSkill(matcher.canonical) && !matcher.explicit && !/[ /]/.test(matcher.alias)) {
      continue;
    }
    const probe = matcher.caseSensitive ? idx.text : idx.lower;
    if (!probe.includes(matcher.caseSensitive ? matcher.alias : matcher.alias.toLowerCase())) continue;
    matcher.re.lastIndex = 0;
    let m;
    let total = 0;
    const evidence = [];
    let lineKey = "";
    let context = "weak";
    let section = "other";
    let firstOffset = -1;
    while ((m = matcher.re.exec(idx.text)) !== null) {
      total += 1;
      if (total > 60) break;
      const li = lineIndexAt(idx, m.index);
      const line = idx.lines[li] ?? "";
      const sec = idx.sectionOfLine[li] ?? "other";
      const ctx = classifyLine(line, sec);
      if (firstOffset < 0) {
        firstOffset = m.index;
        lineKey = line.trim().slice(0, 200);
        context = ctx;
        section = sec;
      }
      if (ctx === "used") {
        context = "used";
        section = sec;
        lineKey = line.trim().slice(0, 200);
      }
      if (evidence.length < 3 && (ctx === "used" || ctx === "negated")) {
        evidence.push(line.trim().slice(0, 160));
      }
    }
    if (total === 0) continue;
    const existing = mentions.get(matcher.canonical);
    const confidence = confidenceFor(context, section, total);
    const mention = {
      canonical: matcher.canonical,
      alias: matcher.alias,
      count: total,
      section,
      context,
      confidence: Math.max(confidence, existing?.confidence ?? 0),
      evidence: evidence[0] ?? lineKey,
      offset: firstOffset
    };
    if (!existing) {
      mentions.set(matcher.canonical, mention);
    } else {
      existing.count += total;
      if (mention.confidence > existing.confidence) {
        existing.confidence = mention.confidence;
        existing.context = mention.context;
        existing.section = mention.section;
        existing.alias = matcher.alias;
        existing.evidence = mention.evidence;
        existing.offset = mention.offset;
      }
    }
  }
  const merged = [...mentions.values()];
  const list = options.keepNested ? merged : suppressNested(merged);
  return list.sort((a, b) => b.confidence - a.confidence || b.count - a.count);
}
function suppressNested(mentions) {
  if (mentions.length < 2) return mentions;
  const aliases = mentions.map((m) => m.alias.toLowerCase());
  return mentions.filter((mention, i) => {
    const self = aliases[i];
    return !aliases.some(
      (other, j) => j !== i && other !== self && mentions[j].canonical !== mention.canonical && new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(self)}(?![\\p{L}\\p{N}_-])`, "u").test(other)
    );
  });
}
function titleCase(s) {
  return s.replace(/\p{L}[\p{L}']*/gu, (w) => ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function proposeRoles(text) {
  const spans = [];
  const found = [];
  for (const { title, re } of ROLE_MATCHERS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ start, end });
      found.push(titleCase(title));
      break;
    }
  }
  return found;
}
function proposeSeniority(roles, years) {
  const joined = roles.join(" | ");
  if (/\b(principal|staff|head of|director)\b/i.test(joined)) return "staff";
  if (/\b(senior|sr\.?|lead)\b/i.test(joined)) return "senior";
  if (years !== null) {
    if (years >= 8) return "staff";
    if (years >= 5) return "senior";
    if (years >= 2) return "mid";
    return "junior";
  }
  if (/\b(junior|intern|trainee|graduate)\b/i.test(joined)) return "junior";
  return "mid";
}
function proposeDomain(skills, roles, text) {
  const roleText = roles.join(" | ");
  const skillText = skills.join(" | ");
  const haystack = `${roleText} ${skillText} ${text.slice(0, 2e3)}`;
  const hasFrontend = /frontend|front-end|react|vue|angular|next\.js/i.test(haystack);
  const hasBackend = /backend|back-end|node\.js|express|django|spring boot|fastapi|microservices|postgres/i.test(haystack);
  if (hasFrontend && hasBackend) return "fullstack";
  for (const [name, re] of DOMAIN_HINTS) {
    if (re.test(roleText)) return name;
  }
  for (const [name, re] of DOMAIN_HINTS) {
    if (re.test(skillText)) return name;
  }
  for (const [name, re] of DOMAIN_HINTS) {
    if (re.test(haystack)) return name;
  }
  return "other";
}
function toMonthIndex(year, month) {
  return year * 12 + month;
}
function parseDateRanges(text, now = /* @__PURE__ */ new Date()) {
  const spans = [];
  const nowIdx = toMonthIndex(now.getFullYear(), now.getMonth());
  const push = (startY, startM, endY, endM, label) => {
    if (startY < 1970 || startY > now.getFullYear() + 1) return;
    const start = toMonthIndex(startY, startM);
    const end = Math.min(endY === null ? nowIdx : toMonthIndex(endY, endM ?? 11), nowIdx);
    if (end >= start - 1) spans.push({ start, end: Math.max(end, start), label });
  };
  const isYear = (t) => /\d{4}/.test(t);
  for (const m of text.matchAll(
    new RegExp(`${MONTH_NAME}\\s*,?\\s+(\\d{4})${RANGE_SEP}${MONTH_NAME}\\s*,?\\s+(\\d{4}|${PRESENT})`, "gi")
  )) {
    const startM = MONTHS[m[1].toLowerCase()];
    const endM = MONTHS[m[3].toLowerCase()];
    const startY = Number(m[2]);
    if (startM === void 0 || endM === void 0 || !Number.isFinite(startY)) continue;
    const present = !isYear(m[4]);
    push(startY, startM, present ? null : Number(m[4]), present ? null : endM, m[0]);
  }
  for (const m of text.matchAll(new RegExp(`${MONTH_NAME}\\s*,?\\s+(\\d{4})${RANGE_SEP}(${PRESENT})`, "gi"))) {
    const startM = MONTHS[m[1].toLowerCase()];
    const startY = Number(m[2]);
    if (startM === void 0 || !Number.isFinite(startY)) continue;
    push(startY, startM, null, null, m[0]);
  }
  for (const m of text.matchAll(new RegExp(`\\b${YEAR}${RANGE_SEP}(${YEAR}|${PRESENT})\\b`, "gi"))) {
    const startY = Number(m[1]);
    const endY = isYear(m[2]) ? Number(m[2]) : null;
    if (!Number.isFinite(startY)) continue;
    push(startY, 0, endY, endY === null ? null : 0, m[0]);
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})/(${YEAR})${RANGE_SEP}(\\d{1,2})/(${YEAR})\\b`, "gi"))) {
    const startM = Number(m[1]) - 1;
    const endM = Number(m[3]) - 1;
    if (startM < 0 || startM > 11 || endM < 0 || endM > 11) continue;
    push(Number(m[2]), startM, Number(m[4]), endM, m[0]);
  }
  return spans;
}
function mergedMonths(spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let total = 0;
  let cur = null;
  for (const s of sorted) {
    if (!cur) {
      cur = { ...s };
      continue;
    }
    if (s.start <= cur.end + 1) {
      cur.end = Math.max(cur.end, s.end);
    } else {
      total += cur.end - cur.start + 1;
      cur = { ...s };
    }
  }
  if (cur) total += cur.end - cur.start + 1;
  return total;
}
function proposeYearsFromRanges(text, now = /* @__PURE__ */ new Date()) {
  const section = experienceText(text);
  const months = mergedMonths(parseDateRanges(section, now));
  if (months <= 0) return null;
  const years = Math.round(months / 12 * 10) / 10;
  if (years <= 0 || years > 60) return null;
  return years;
}
function proposeYearsExplicit(text) {
  let max = null;
  for (const m of text.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n > 45) continue;
    if (max === null || n > max) max = n;
  }
  return max;
}
function proposeDegrees(text) {
  return DEGREE_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}
function proposeCertifications(text) {
  return CERT_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}
function takeInstitution(value) {
  const words = value.split(/\s+/).filter((w) => w && w !== "-" && w !== "\u2013" && w !== "\u2014");
  const at = words.findIndex((w) => INSTITUTION_KEY.test(w));
  if (at < 0) return { school: "", rest: value };
  let start = at;
  while (start > 0) {
    const previous = words[start - 1];
    if (DEGREE_LEVEL_RE.test(previous)) break;
    if (FIELD_STOPWORDS.test(previous.replace(/[^\p{L}]/gu, ""))) break;
    if (!/^[\p{Lu}\p{N}]/u.test(previous)) break;
    start -= 1;
  }
  let end = at + 1;
  while (end < words.length) {
    const word = words[end];
    if (/^[\p{Lu}]/u.test(word) && !FIELD_STOPWORDS.test(word.replace(/[^\p{L}]/gu, ""))) {
      end += 1;
      continue;
    }
    if (INSTITUTION_CONNECTOR.test(word) && end + 1 < words.length && /^[\p{Lu}]/u.test(words[end + 1])) {
      end += 2;
      continue;
    }
    break;
  }
  return {
    school: words.slice(start, end).join(" "),
    rest: [...words.slice(0, start), ...words.slice(end)].join(" ")
  };
}
function parseEducationEntry(entry) {
  const years = (entry.match(/\b(19\d{2}|20\d{2})\b/g) ?? []).map(String);
  let rest = entry.replace(/\b(19\d{2}|20\d{2})\b/g, " ").replace(/\(\s*\)/g, " ").replace(/\b(?:present|current|ongoing)\b/gi, " ").replace(/\s*[–—]\s*/g, " - ").replace(/\s{2,}/g, " ").replace(/^[\s,;:.-]+/, "").replace(/[\s,;:.-]+$/, "").trim();
  let school = "";
  const taken = takeInstitution(rest);
  if (taken.school) {
    school = taken.school;
    rest = taken.rest;
  } else {
    const parts = rest.split(/\s+-\s+|\s*,\s*/).map((p) => p.trim()).filter(Boolean);
    const candidate = parts.length > 1 ? parts[parts.length - 1] : "";
    if (candidate && candidate.split(/\s+/).length <= 5) {
      school = candidate;
      rest = parts.slice(0, -1).join(" ");
    }
  }
  rest = rest.replace(/\s+-\s+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").trim();
  let degree = "";
  let field = "";
  const level = rest.match(DEGREE_LEVEL_RE);
  if (level) {
    degree = level[0].replace(/\s{2,}/g, " ").trim();
    field = rest.slice(level[0].length).replace(/^[\s.,;:\-–—]+/, "").replace(/^(?:in|of|the field of)\s+/i, "").replace(/^[\s.,;:\-–—]+/, "").trim();
  } else {
    degree = rest.slice(0, 90).trim();
  }
  if (degree && field.toLowerCase() === degree.toLowerCase()) field = "";
  return {
    degree: degree.slice(0, 120),
    field: field.slice(0, 120),
    school: school.slice(0, 120),
    startYear: years[0] ?? "",
    endYear: years.length > 1 ? years[years.length - 1] : years[0] ?? ""
  };
}
function proposeEducationEntries(text) {
  const cleaned = [];
  const degreeEntries = [];
  for (const section of splitSections(text)) {
    if (section.key !== "education") continue;
    const lines = section.body.split("\n").map((l) => l.replace(/^[•\-*·▪◦‣]\s+/, "").replace(/\s{2,}/g, " ").trim()).filter((l) => l.length > 0 && !looksLikeHeading(l));
    let pendingDegree = "";
    for (const line of lines) {
      const degree = DEGREE_PATTERNS.find(([, re]) => re.test(line))?.[0] ?? "";
      const years = (line.match(/\b(19\d{2}|20\d{2})\b/g) ?? []).map(Number).sort();
      const schoolMatch = line.match(/[^,|-]*\b(?:university|universite|college|institute|school|academy)\b[^,|]*/i);
      if (!degree && !schoolMatch && !SCHOOL_HINT.test(line)) {
        if (pendingDegree && degreeEntries.length > 0 && line.length < 120) {
          degreeEntries[degreeEntries.length - 1] = `${degreeEntries[degreeEntries.length - 1]} (${line.slice(0, 80)})`;
        }
        continue;
      }
      const label = degree && schoolMatch ? `${degree}, ${schoolMatch[0].trim()}` : degree ? `${degree}, ${line.replace(/^[,\s-]+/, "").slice(0, 90)}` : line.slice(0, 120);
      const labelClean = years.length > 0 ? label.replace(/\b(19\d{2}|20\d{2})\b/g, "").replace(/[\s,–—-]{2,}/g, " ").replace(/[\s,–—-]+$/, "").trim() : label;
      const withYears = years.length > 0 ? `${labelClean} (${years.length > 1 ? `${years[0]}\u2013${years[years.length - 1]}` : years[0]})` : labelClean;
      cleaned.push(withYears);
      if (degree) pendingDegree = degree;
    }
  }
  const unique = [];
  for (const entry of cleaned) {
    const tokens = new Set(entry.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    const duplicate = unique.some((existing) => {
      const other = new Set(existing.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      if (tokens.size === 0 || other.size === 0) return false;
      const shared = [...tokens].filter((t) => other.has(t)).length;
      return shared / Math.min(tokens.size, other.size) >= 0.7;
    });
    if (!duplicate) unique.push(entry);
  }
  if (unique.length > 0) return unique.slice(0, 4);
  return proposeDegrees(text);
}
function proposeContact(text) {
  const head = text.slice(0, 1500);
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/) ?? [""])[0];
  const phone = (text.match(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,4}/) ?? [""])[0].trim();
  const links = [...new Set((text.match(/https?:\/\/[^\s)|,\]]+/g) ?? []).map((l) => l.replace(/[.,;]$/, "")))].slice(0, 6);
  const LABELLED_LOCATION = /^\s*(?:location|located in|based in|address|residing in|current location)\b\s*[:\-–]?\s*/i;
  const LOCATION_IN_LINE = /([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s*,\s*([\p{Lu}]{2}|[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)(?:\s+\d{5}(?:-\d{4})?)?/u;
  const LOCATION_LINE_ONLY = /^([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s*,\s*([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s*,\s*(?:[\p{Lu}]{2}|[\p{Lu}][\p{L}'’-]+)\s*$/u;
  const NOT_A_LOCATION = /\b(?:r\.?n\.?|m\.?d\.?|ph\.?d\.?|b\.?s\.?n\.?|m\.?s\.?n\.?|cpa|cfa|pmp|inc|ltd|llc|corp|university|college|institute|school|academy|labs?|technologies|solutions|consulting|remote|hybrid|seasonal|zip|state|street|avenue|road)\b/i;
  let location = "";
  for (const rawLine of head.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const flat = line.replace(/[^\p{L}\p{N}\s,.'()@:/-]/gu, " ").replace(/\s{2,}/g, " ").trim();
    if (!flat) continue;
    const labelled = LABELLED_LOCATION.test(flat);
    const isContactLine = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(flat) || /https?:\/\/|www\.|\b(?:linkedin|github)\./i.test(flat) || /(?:\+?\d[\d\s().-]{8,})/.test(flat) || labelled;
    const wholeLine = flat.replace(LABELLED_LOCATION, "").trim();
    const threePart = wholeLine.match(LOCATION_LINE_ONLY);
    if (threePart && !NOT_A_LOCATION.test(wholeLine)) {
      location = `${threePart[1]}, ${threePart[2]}`;
      break;
    }
    if (!isContactLine) continue;
    const withoutStreet = wholeLine.replace(
      /^[^,]*?\b\d+[\p{L}\s.]*\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|suite|ste|apt|apartment|unit|floor|fl)\b\.?\s*,?\s*/iu,
      ""
    );
    for (const found of withoutStreet.matchAll(new RegExp(LOCATION_IN_LINE.source, "gu"))) {
      const value = `${found[1]}, ${found[2]}`;
      const firstWord = found[1].split(/\s+/)[0];
      const acronym = firstWord.length >= 3 && firstWord === firstWord.toUpperCase() && !/\d/.test(firstWord);
      if (acronym || NOT_A_LOCATION.test(value)) continue;
      location = value;
      break;
    }
    if (location) break;
  }
  const CREDENTIAL_SUFFIX = /\b(?:r\.?n\.?|l\.?p\.?n\.?|n\.?p\.?|b\.?s\.?n\.?|m\.?s\.?n\.?|d\.?n\.?p\.?|m\.?d\.?|d\.?o\.?|p\.?a\.?-?c?|p\.?h\.?d\.?|m\.?b\.?a\.?|c\.?p\.?a\.?|c\.?f\.?a\.?|p\.?m\.?p\.?|c\.?s\.?m\.?|p\.?e\.?|esq\.?|d\.?d\.?s\.?|d\.?v\.?m\.?|l\.?c\.?s\.?w\.?|m\.?p\.?h\.?|b\.?s\.?c?\.?|m\.?s\.?c?\.?|b\.?e\.?|m\.?e\.?|b\.?tech\.?|m\.?tech\.?|cisa|cissp|ceh|aws|azure|gcp|pmp|six sigma)\b/i;
  const nameFrom = (raw) => {
    const head2 = raw.split(/[|•·]/)[0].split(/\s+[–—]\s+|\s+-\s+/)[0].trim();
    const segments = head2.split(",").map((s) => s.trim()).filter(Boolean);
    const kept = [];
    for (const segment of segments) {
      if (kept.length > 0 && CREDENTIAL_SUFFIX.test(segment) && segment.split(/\s+/).length <= 4) continue;
      if (kept.length > 0 && /^(?:mba|phd|md|rn|bsn|msn)$/i.test(segment)) continue;
      kept.push(segment);
    }
    return kept.join(" ").trim();
  };
  if (!location) {
    const prose = head.slice(0, 600).match(/(?:based in|located in|living in|currently in|from)\s+([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)/u);
    if (prose && !NOT_A_LOCATION.test(prose[1])) location = prose[1];
  }
  const nameLine = head.split("\n").find((line, index) => {
    let t = nameFrom(line);
    if (!t || t.length > 42) return false;
    if (/[@\d]/.test(t)) return false;
    if (isSectionHeading(t)) return false;
    if (index > 6) return false;
    if (/\b(engineer|developer|manager|analyst|designer|consultant|specialist|architect|scientist)\b/i.test(t)) return false;
    const bare = t.replace(/["'“”‘’]/g, "");
    return /^\p{L}[\p{L}'.-]*(\s+\p{L}[\p{L}'.-]*){1,3}$/u.test(bare);
  });
  return {
    fullName: nameLine ? nameFrom(nameLine) : "",
    email,
    phone: phone.replace(/\s{2,}/g, " ").slice(0, 32),
    location: location.slice(0, 60),
    links
  };
}
function proposeLanguages(text) {
  const known = ["english", "hindi", "spanish", "french", "german", "mandarin", "chinese", "japanese", "korean", "arabic", "portuguese", "russian", "italian", "dutch", "tamil", "telugu", "marathi", "bengali", "kannada", "malayalam", "gujarati", "punjabi", "urdu", "bhojpuri", "nepali", "swedish", "polish", "turkish", "vietnamese", "thai", "indonesian"];
  const out = /* @__PURE__ */ new Set();
  for (const section of splitSections(text)) {
    if (section.key !== "languages") continue;
    for (const lang of known) {
      if (new RegExp(`\\b${lang}\\b`, "i").test(section.body)) {
        out.add(lang.charAt(0).toUpperCase() + lang.slice(1));
      }
    }
  }
  return [...out];
}
function parseRangeLabel(label) {
  const y = label.match(/\b(19\d{2}|20\d{2})\b/g) ?? [];
  const months = [...label.matchAll(new RegExp(MONTH_NAME, "gi"))].map((m) => m[1]);
  const current = new RegExp(PRESENT, "i").test(label);
  const fmt = (year, month) => {
    if (!year) return "";
    const m = month ? MONTHS[month.toLowerCase()] : void 0;
    return m === void 0 ? year : `${year}-${String(m + 1).padStart(2, "0")}`;
  };
  const start = fmt(y[0], months[0]);
  const end = current ? "" : fmt(y[1] ?? (y.length > 1 ? y[1] : void 0), months[1] ?? months[0]);
  return { start, end, current: current || !!end && false };
}
function parseExperience(text) {
  const section = experienceSectionText(text) ?? splitSections(text).filter((s) => !["education", "certifications", "skills", "languages", "awards"].includes(s.key)).map((s) => s.body).join("\n");
  const lines = section.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (/^(?:page|cv|resume)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(t)) return false;
    if (/^\d+\s*(?:\/|of)\s*\d+$/i.test(t)) return false;
    if (/^\d{1,3}$/.test(t)) return false;
    return true;
  });
  const entries = [];
  let current = null;
  let pending = [];
  const dateRe = new RegExp(
    `(?:${MONTH_NAME}\\s*,?\\s+\\d{4}\\s*${RANGE_SEP}(?:${MONTH_NAME}\\s*,?\\s+\\d{4}|${PRESENT})|\\b(?:19|20)\\d{2}\\s*${RANGE_SEP}(?:(?:19|20)\\d{2}|${PRESENT}))`,
    "i"
  );
  const startEntry = (line, rangeLabel) => {
    const range = parseRangeLabel(rangeLabel);
    const stripDates = (value) => value.replace(dateRe, " ").replace(/[()]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s,–—|:;-]+|[\s,–—|:;-]+$/g, "").trim();
    const isProse = looksLikeProseLine;
    const companyish = (value) => /\b(inc|ltd|llc|corp|corporation|gmbh|technologies|technology|labs?|systems|solutions|group|studio|health|bank|consulting|university|media|partners|services|software|capital|ventures|agency|clinic|hospital|school|academy|network|digital|global|holdings|industries)\b/i.test(
      value
    ) || /,[^,]*\b[A-Z]{2}\b\s*$/u.test(value) || // "… , CA"
    /^[\p{Lu}][\p{L}&.'’-]*(?:\s+[\p{Lu}][\p{L}&.'’-]*){0,3}$/u.test(value);
    const candidates = [...pending, line.trim()].map(stripDates).filter((v) => v.replace(/[\s|,–—()-]/g, "").length >= 3);
    const titleLine = candidates.find((v) => proposeRoles(v).length > 0) ?? candidates.find((v) => !isProse(v)) ?? candidates[0] ?? "";
    pending = [];
    const parts = titleLine.split(/\s+(?:at|@)\s+|\s*[|–—]\s*|\s+-\s+|\s*,\s*/i).map((p) => p.trim()).filter(Boolean);
    let role = proposeRoles(titleLine)[0] ?? "";
    let company = "";
    if (parts.length >= 2) {
      const rolePart = role ? parts.find((p) => p.toLowerCase().includes(role.toLowerCase())) : void 0;
      const rest = parts.filter((p) => p !== rolePart);
      company = rest.find((p) => companyish(p) && !isProse(p)) ?? rest.find((p) => !isProse(p)) ?? rest[0] ?? "";
      if (!role) role = parts.find((p) => !companyish(p) && !isProse(p)) ?? parts[0];
      if (!company) company = candidates.find((v) => v !== titleLine && companyish(v) && !isProse(v)) ?? "";
    } else {
      if (!role) role = isProse(titleLine) ? "" : titleLine;
      company = candidates.find((v) => v !== titleLine && companyish(v) && !isProse(v)) ?? "";
    }
    const COMPANY_SUFFIX = /\b(inc|ltd|llc|l\.l\.c|corp|corporation|gmbh|plc|pty|s\.a|bv|nv|ag|oy|ab|kk|co)\b\.?$/i;
    const segments = company.split(",").map((x) => x.trim()).filter(Boolean);
    while (segments.length > 1 && !COMPANY_SUFFIX.test(segments[segments.length - 1])) {
      segments.pop();
    }
    company = segments.join(", ");
    current = {
      company: company.replace(/^[\s,–—|:;-]+|[\s,–—|:;-]+$/g, "").slice(0, 80),
      role: role.slice(0, 80),
      startDate: range.start,
      endDate: range.end,
      isCurrent: range.current,
      bullets: []
    };
    return current;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isSectionHeading(line)) continue;
    const isBullet = /^[•\-*·▪◦‣o]\s+/.test(line);
    const rangeMatch = line.match(dateRe);
    if (isBullet) {
      if (current) current.bullets.push(line.replace(/^[•\-*·▪◦‣o]\s+/, "").slice(0, 400));
      continue;
    }
    if (rangeMatch) {
      if (current) entries.push(current);
      current = startEntry(line, rangeMatch[0]);
      continue;
    }
    if (current && looksLikeProseLine(line) && (line.length > 45 || /[.!?]$/.test(line))) {
      current.bullets.push(line.slice(0, 400));
      continue;
    }
    if (line.length <= 90) pending = [...pending, line].slice(-2);
  }
  if (current) entries.push(current);
  return entries.filter((e) => e.role && e.role.trim().length > 2 || e.bullets.length > 0).slice(0, 12);
}
function proposeProjects(text) {
  const out = [];
  for (const section of splitSections(text)) {
    if (section.key !== "projects") continue;
    for (const line of section.body.split("\n")) {
      const t = line.trim();
      if (!t || looksLikeHeading(t)) continue;
      if (t.length < 12 || t.split(/\s+/).length > 30) continue;
      if (/^[•\-*·▪◦‣]\s+/.test(t)) continue;
      if (!/^[\p{Lu}\p{N}]/u.test(t)) continue;
      out.push(t.replace(/^[•\-*·▪◦‣]\s+/, "").slice(0, 220));
    }
  }
  return dedupe(out).slice(0, 8);
}
function dedupe(items) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}
var PRE, PRE_STRICT, POST, MATCHERS, POSITIVE, NEGATIVE, ROLE_TITLES, ROLE_MATCHERS, ACRONYMS, DOMAIN_HINTS, MONTHS, MONTH_NAME, RANGE_SEP, PRESENT, YEAR, DEGREE_PATTERNS, CERT_PATTERNS, SCHOOL_HINT, DEGREE_LEVEL_RE, INSTITUTION_KEY, FIELD_STOPWORDS, INSTITUTION_CONNECTOR;
var init_deterministic = __esm({
  "src/extract/deterministic.ts"() {
    "use strict";
    init_ontology();
    init_text();
    PRE = "(?<![\\p{L}\\p{N}_-])";
    PRE_STRICT = "(?<![\\p{L}\\p{N}_.\\-/])";
    POST = "(?![\\p{L}\\p{N}_-])";
    MATCHERS = [];
    {
      const seen = /* @__PURE__ */ new Set();
      const explicitAliases = /* @__PURE__ */ new Set();
      for (const def of ONTOLOGY.definitions) {
        for (const raw of def.aliases ?? []) explicitAliases.add(raw.startsWith("*") ? raw.slice(1) : raw.toLowerCase());
      }
      for (const [alias, canonical] of ONTOLOGY.aliasIndex) {
        if (alias.length < 2) continue;
        if (seen.has(alias)) continue;
        seen.add(alias);
        const caseSensitive = ONTOLOGY.caseSensitiveAliases.has(alias);
        MATCHERS.push(matcherFor(alias, canonical, caseSensitive, explicitAliases.has(alias)));
      }
      MATCHERS.sort((a, b) => b.alias.length - a.alias.length);
    }
    POSITIVE = /\b(built|build|building|developed|developing|implemented|implementing|designed|architected|deployed|migrated|shipped|maintained|optimized|optimised|debugged|integrated|led|lead|owned|automated|scaled|refactored|created|engineered|wrote|written|delivered|launched|used|using|working with|worked with|hands-on|handled|drove|responsible for|managed|improved|reduced|automated|tested|enhanced|expert|proficient|advanced|experienced (in|with)|strong (in|with)|spearheaded|developed|primary)\b/i;
    NEGATIVE = [
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
      /\b(we are looking for|we're looking for|you should have|must have experience|ideal candidate|qualifications?:)\b/i
    ];
    ROLE_TITLES = [
      "senior software engineer",
      "staff software engineer",
      "principal software engineer",
      "senior frontend engineer",
      "senior backend engineer",
      "senior full stack engineer",
      "senior data engineer",
      "senior mobile engineer",
      "senior qa engineer",
      "senior devops engineer",
      "senior platform engineer",
      "senior security engineer",
      "senior machine learning engineer",
      "senior site reliability engineer",
      "senior software developer",
      "senior web developer",
      "senior product manager",
      "lead software engineer",
      "lead frontend engineer",
      "lead backend engineer",
      "engineering manager",
      "software engineer",
      "software developer",
      "frontend engineer",
      "frontend developer",
      "react developer",
      "ui engineer",
      "backend engineer",
      "backend developer",
      "api developer",
      "full stack engineer",
      "fullstack engineer",
      "full stack developer",
      "fullstack developer",
      "data engineer",
      "data scientist",
      "data analyst",
      "analytics engineer",
      "bi developer",
      "machine learning engineer",
      "ml engineer",
      "ai engineer",
      "nlp engineer",
      "devops engineer",
      "site reliability engineer",
      "platform engineer",
      "cloud engineer",
      "infrastructure engineer",
      "systems engineer",
      "network engineer",
      "security engineer",
      "mobile engineer",
      "ios developer",
      "ios engineer",
      "android developer",
      "android engineer",
      "mobile developer",
      "flutter developer",
      "react native developer",
      "qa engineer",
      "qa analyst",
      "test engineer",
      "sdet",
      "automation engineer",
      "web developer",
      "wordpress developer",
      "shopify developer",
      "solutions architect",
      "software architect",
      "technical architect",
      "cloud architect",
      "technical lead",
      "tech lead",
      "team lead",
      "scrum master",
      "product manager",
      "project manager",
      "program manager",
      "product designer",
      "ui designer",
      "ux designer",
      "ui/ux designer",
      "interaction designer",
      "business analyst",
      "database administrator",
      "dba",
      "customer support specialist",
      "support engineer",
      "support analyst",
      "technical support",
      "marketing manager",
      "digital marketing manager",
      "content writer",
      "seo specialist",
      "embedded engineer",
      "firmware engineer",
      "game developer",
      "qa lead",
      "sre",
      "lead sre",
      "staff sre",
      "senior sre",
      "site reliability engineer",
      "staff engineer",
      "principal engineer",
      "lead engineer",
      "head of engineering",
      "data specialist",
      "product analyst",
      "support analyst",
      "technical support specialist",
      "marketing specialist",
      "growth manager",
      "operations analyst",
      "business intelligence analyst"
    ];
    ROLE_MATCHERS = ROLE_TITLES.map((title) => ({
      title,
      re: new RegExp(`${PRE}${escapeRegExp(title)}${POST}`, "giu")
    })).sort((a, b) => b.title.length - a.title.length);
    ACRONYMS = {
      qa: "QA",
      ios: "iOS",
      devops: "DevOps",
      ui: "UI",
      ux: "UX",
      ml: "ML",
      ai: "AI",
      sre: "SRE",
      bi: "BI",
      dba: "DBA",
      api: "API",
      hr: "HR",
      seo: "SEO",
      sap: "SAP",
      aws: "AWS",
      gcp: "GCP",
      sql: "SQL",
      php: "PHP",
      qc: "QC",
      it: "IT",
      etl: "ETL",
      nlp: "NLP",
      sdet: "SDET",
      crm: "CRM",
      erp: "ERP",
      cad: "CAD",
      gis: "GIS",
      wms: "WMS",
      cms: "CMS",
      pos: "POS"
    };
    DOMAIN_HINTS = [
      ["data", /\b(data engineer|data pipeline|etl|analytics|warehouse|spark|airflow|dbt|bigquery|snowflake|tableau|power bi)\b/i],
      ["ml", /\b(machine learning|deep learning|pytorch|tensorflow|scikit-learn|nlp|computer vision|llm|model training|mlops)\b/i],
      ["mobile", /\b(ios|android|swift|kotlin|flutter|react native|mobile app)\b/i],
      ["devops", /\b(devops|sre|site reliability|kubernetes|terraform|ci\/cd|infrastructure|cloud engineer|platform engineer|on-?call|observability)\b/i],
      ["frontend", /\b(frontend|front-end|react|vue|angular|next\.js|tailwind|ui engineer|css|accessibility)\b/i],
      ["backend", /\b(backend|back-end|api|microservices|node\.js|django|spring boot|postgres|database|server-side)\b/i]
    ];
    MONTHS = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      sept: 8,
      oct: 9,
      nov: 10,
      dec: 11
    };
    MONTH_NAME = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
    RANGE_SEP = "\\s*(?:[\\u2010-\\u2015\\u2212]|-|to|until|through)\\s*";
    PRESENT = "(?:present|current|now|till\\s+date|to\\s+date|ongoing|today)";
    YEAR = "(19\\d{2}|20\\d{2})";
    DEGREE_PATTERNS = [
      ["PhD", /\b(ph\.?d|doctorate|doctoral)\b/i],
      ["MBA", /\bMBA\b/],
      ["Master's", /\b(master'?s?|m\.?tech|m\.?sc|m\.?c\.?a|msc|mca|mtech|ms in|postgraduate)\b/i],
      ["Bachelor's", /\b(bachelor'?s?|b\.?tech|b\.?e\.?|b\.?sc|bsc|bca|btech|undergraduate|be in|bs in)\b/i],
      ["Associate", /\b(associate'?s? degree|diploma)\b/i]
    ];
    CERT_PATTERNS = [
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
      ["CPA", /\bCPA\b/]
    ];
    SCHOOL_HINT = /\b(university|universite|college|institute|institution|school|academy|polytechnic|iit|nit|iiit|bits|vit|srm|nirma|daiict)\b/i;
    DEGREE_LEVEL_RE = /^(?:b\.?\s?tech\.?|b\.?\s?e\.?\b|b\.?\s?eng\.?|b\.?\s?sc\.?|b\.?\s?c\.?\s?a|b\.?\s?a\.?\b|b\.?\s?s\.?\b|bachelor(?:'s)?(?:\s+of\s+[\p{L}\s]+?)?|m\.?\s?tech|m\.?\s?sc|m\.?\s?s\.?\b|m\.?\s?e\.?\b|m\.?\s?eng|m\.?\s?a\.?\b|master(?:'s)?(?:\s+of\s+[\p{L}\s]+?)?|mba|ph\.?\s?d\.?\b|doctor(?:ate)?|diploma|pgdm|associate(?:'s)?(?:\s+degree)?|higher\s+secondary|intermediate)/iu;
    INSTITUTION_KEY = /\b(?:university|universite|universität|universidad|college|institute|institut|school|academy|polytechnic|iit|nit|iiit|bits)\b/iu;
    FIELD_STOPWORDS = /^(?:software|engineering|computer|computing|science|sciences|information|technology|technologies|business|arts|economics|economy|data|electrical|electronic|mechanical|civil|biomedical|chemical|mathematics|maths|physics|chemistry|biology|finance|accounting|management|marketing|design|architecture|law|medicine|nursing|public|health|analytics|statistics|systems|networks|security|robotics|aerospace|industrial|materials|environmental|communication|journalism|psychology|education|social|political|international|humanities|literature|history|languages|philosophy)$/i;
    INSTITUTION_CONNECTOR = /^(?:of|de|del|della|van|von|der|for|at|and|the|&)$/i;
  }
});

// src/extract/service.ts
function dedupeEducation(entries) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const parsed = parseEducationEntry(entry);
    const key = `${parsed.degree}|${parsed.school}|${parsed.startYear}`.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    const contained = out.some(
      (e) => e.degree.toLowerCase() === parsed.degree.toLowerCase() && (e.field === parsed.field || parsed.field === "") && (e.school === parsed.school || parsed.school === "")
    );
    if (contained) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out.slice(0, 4);
}
function proposeAll(text) {
  const idx = indexText(text);
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
    degrees: proposeDegrees(text)
  };
}
function clamp012(n) {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
}
function dedupe2(items) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}
function offlineSkillVerdicts(mentions) {
  const kept = [];
  const provenance = {};
  const scores = {};
  for (const mention of mentions) {
    if (mention.confidence < config.extract.offlineKeep) continue;
    kept.push(mention.canonical);
    provenance[mention.canonical] = `offline:${mention.context}@${mention.section} (${mention.confidence.toFixed(2)})`;
    scores[mention.canonical] = Math.round(mention.confidence * 100) / 100;
  }
  return { kept, provenance, scores };
}
async function jevSkillVerdicts(text, proposals) {
  const fallback = offlineSkillVerdicts(proposals.mentions);
  const candidates = proposals.mentions.filter((m) => m.confidence >= config.extract.proposeFloor).slice(0, MAX_SKILL_QUESTIONS);
  if (candidates.length === 0) return fallback;
  const questions = {};
  candidates.forEach((mention, i) => {
    const where = mention.section === "skills" ? " It appears in the candidate's skills / technology list." : mention.section === "experience" ? " It appears in a work-experience entry." : mention.section === "projects" ? " It appears in a project description." : mention.section === "certifications" ? " It appears in the certifications section." : "";
    const aliasNote = mention.alias.toLowerCase() === mention.canonical.toLowerCase() ? "" : ` (written as "${mention.alias}")`;
    const evidence = mention.evidence ? ` Nearby text: "${mention.evidence}".` : "";
    questions[`skill_present__${i}`] = noul(
      `Is "${mention.canonical}"${aliasNote} one of the candidate's own skills in \`resume_text\` \u2014 listed among their skills, or shown in work they did \u2014 as opposed to someone else's stack, a pasted job description, an aspiration, or unrelated text?${where}${evidence}`,
      {
        true: "it is the candidate's own skill or tool",
        false: "it belongs to someone else, to a job ad, or is only an aspiration"
      }
    );
    questions[`skill_depth__${i}`] = score(
      `How strong is the evidence that the candidate of \`resume_text\` has used "${mention.canonical}"${aliasNote}?${where}${evidence}`,
      SKILL_LEVELS
    );
  });
  const res = await systemOneSafe({ resume_text: text.slice(0, SOURCE_MAX_CHARS) }, questions);
  if (!res) return fallback;
  const kept = [];
  const provenance = {};
  const scores = {};
  candidates.forEach((mention, i) => {
    const present = pTrue(res.answers, `skill_present__${i}`);
    const depthAnswer = res.answers[`skill_depth__${i}`];
    const depth = isScoreAnswer(depthAnswer) ? depthAnswer.score : null;
    if (present === null && depth === null) return;
    const p = present ?? 0;
    const d = depth ?? 0;
    scores[mention.canonical] = Math.round(p * 1e3) / 1e3;
    const keep = p >= config.typesafe.keepThreshold && d >= config.typesafe.skillLevelMin;
    if (keep) {
      kept.push(mention.canonical);
      provenance[mention.canonical] = `jev:P=${p.toFixed(2)} depth=${d.toFixed(1)}/${SKILL_LEVELS.length - 1} (proposal: ${mention.context}@${mention.section})`;
    } else {
      provenance[mention.canonical] = `rejected:jev P=${p.toFixed(2)} depth=${d.toFixed(1)}`;
    }
  });
  if (kept.length === 0 && candidates.length > 0) return fallback;
  return { kept, provenance, scores, model: res.model, usage: res.usage };
}
function previewValue(v) {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return (s ?? "").slice(0, 240);
  } catch {
    return String(v);
  }
}
function isEmptyValue(v) {
  if (v === null || v === void 0) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
async function verifyExtraction(text, extraction) {
  const questions = {};
  for (const [field, value] of Object.entries(extraction)) {
    if (isEmptyValue(value)) {
      questions[`${field}::absence_wrong`] = noul(
        `Field "${field}" came back empty. Does \`resume_text\` genuinely contain this information, making the empty result wrong?`,
        { true: "the resume does contain it and the empty value is wrong", false: "the resume does not contain it" }
      );
      continue;
    }
    if (field === "yearsOfExperience") {
      questions[`${field}::hallucinated`] = noul(
        `The dated employment in \`resume_text\` was measured as ${String(value)} years of experience. Do the dates clearly span less than that (off by more than one year)?`,
        {
          true: "the dates support clearly fewer years than extracted",
          false: "the dates support the extracted amount, within about a year"
        }
      );
      continue;
    }
    const preview = previewValue(value);
    questions[`${field}::hallucinated`] = noul(
      `Field "${field}" was extracted as ${preview}. Is any of that value absent from or unsupported by \`resume_text\` (invented, mistyped, or taken from a different person's text)?`,
      { true: "part of the value is unsupported by the source", false: "the value is supported by the source" }
    );
  }
  if (Object.keys(questions).length === 0) return null;
  const res = await systemOneSafe({ resume_text: text.slice(0, SOURCE_MAX_CHARS), extraction }, questions);
  if (!res) return null;
  const threshold = config.typesafe.fireThreshold;
  const fired = [];
  const scores = {};
  const fieldScores = {};
  for (const [id, answer] of Object.entries(res.answers)) {
    const p = pTrue(res.answers, id);
    if (p === null) continue;
    scores[id] = p;
    fieldScores[id] = p;
    if (p > threshold) fired.push(id);
  }
  fired.sort();
  return { fired, scores, escalate: fired.length > 0, fieldScores };
}
function emptyEquivalent(value) {
  if (Array.isArray(value)) return [];
  if (typeof value === "string") return "";
  if (typeof value === "number") return null;
  return value ?? null;
}
function repair(extraction, report) {
  if (!report) return extraction;
  const fields = new Set(
    report.fired.map((id) => id.split("::")).filter(([, metric]) => metric === "hallucinated").map(([field]) => field)
  );
  if (fields.size === 0) return extraction;
  const out = { ...extraction };
  for (const field of fields) {
    if (field in out && !isEmptyValue(out[field])) out[field] = emptyEquivalent(out[field]);
  }
  return out;
}
async function extractProfile(text, options = {}) {
  const proposals = proposeAll(text);
  const warnings = [];
  const jev = options.jev !== false;
  const skills = jev ? await jevSkillVerdicts(text, proposals) : offlineSkillVerdicts(proposals.mentions);
  const roleProposals = dedupe2([
    ...proposals.experience.map((e) => e.role).filter(Boolean),
    ...proposals.roles
  ]).slice(0, MAX_ROLE_QUESTIONS);
  const educationProposals = dedupe2([...proposals.education, ...proposals.degrees]).slice(0, MAX_EDU_QUESTIONS);
  const certProposals = proposals.certifications.slice(0, MAX_CERT_QUESTIONS);
  let roles = roleProposals;
  let education = educationProposals;
  let certifications = certProposals;
  let model;
  let usage;
  if (jev && (roleProposals.length || educationProposals.length || certProposals.length)) {
    const questions = {};
    roleProposals.forEach((r, i) => {
      questions[`role__${i}`] = noul(
        `Did the candidate of \`resume_text\` actually hold the job title "${r}"?`,
        {
          true: "the resume lists it as a position the candidate held",
          false: "it appears only as a target role, in someone else's text, or not at all"
        }
      );
    });
    educationProposals.forEach((e, i) => {
      questions[`education__${i}`] = noul(
        `Does \`resume_text\` state that the candidate completed "${e}"?`,
        { true: "it is stated as completed or in progress by the candidate", false: "it is not their own qualification" }
      );
    });
    certProposals.forEach((c, i) => {
      questions[`cert__${i}`] = noul(
        `Does \`resume_text\` show the candidate holding the "${c}" certification?`,
        { true: "listed as earned by the candidate", false: "not stated, or only in unrelated text" }
      );
    });
    questions["seniority"] = choice("What seniority level does this resume reflect?", SENIORITY_OPTIONS);
    questions["domain"] = choice("What primary domain does this resume reflect?", DOMAIN_OPTIONS);
    const res = await systemOneSafe({ resume_text: text.slice(0, SOURCE_MAX_CHARS) }, questions);
    if (res) {
      model = res.model;
      usage = res.usage;
      const keep = config.typesafe.keepThreshold;
      const confirmed = (prefix, values, cap) => values.map((value, i) => ({ value, p: pTrue(res.answers, `${prefix}__${i}`) ?? 0 })).filter((x) => x.p >= keep).sort((a, b) => b.p - a.p).slice(0, cap).map((x) => x.value);
      const confirmedRoles = confirmed("role", roleProposals, 6);
      const confirmedEdu = confirmed("education", educationProposals, 4);
      const confirmedCerts = confirmed("cert", certProposals, 10);
      if (confirmedRoles.length > 0) roles = confirmedRoles;
      if (confirmedEdu.length > 0) education = confirmedEdu;
      certifications = confirmedCerts;
      proposals.jevSeniority = choiceOf(
        res.answers["seniority"]
      );
      proposals.jevDomain = choiceOf(
        res.answers["domain"]
      );
    }
  }
  const ranges = proposals.yearsFromRanges;
  const explicit = proposals.yearsExplicit;
  let yearsOfExperience = null;
  if (explicit !== null && (ranges === null || explicit <= ranges + 3)) {
    yearsOfExperience = explicit;
    if (ranges !== null && explicit < ranges - 1) {
      warnings.push(`dated roles span ~${ranges} yrs but the resume claims ${explicit} yrs`);
    }
  } else if (ranges !== null) {
    yearsOfExperience = Math.round(ranges * 10) / 10;
    if (explicit !== null) {
      warnings.push(
        `explicit "${explicit} yrs" conflicts with dated roles (~${ranges} yrs); using the dated evidence`
      );
    }
  }
  if (yearsOfExperience === null) warnings.push("no dated roles or explicit years found; unknown");
  const seniority = proposals.jevSeniority ?? proposeSeniority(roles, yearsOfExperience);
  const domain = proposals.jevDomain ?? proposeDomain(skills.kept, roles, text);
  const metadata = {
    skills: skills.kept,
    roles,
    yearsOfExperience,
    education,
    projects: proposals.projects,
    certifications,
    seniority,
    domain
  };
  if (jev) {
    const report = await verifyExtraction(text, {
      education: metadata.education,
      projects: metadata.projects,
      certifications: metadata.certifications
    });
    const repaired = repair(
      {
        education: metadata.education,
        projects: metadata.projects,
        certifications: metadata.certifications
      },
      report
    );
    if (repaired.education !== void 0) metadata.education = repaired.education;
    if (repaired.projects !== void 0) metadata.projects = repaired.projects;
    if (repaired.certifications !== void 0) metadata.certifications = repaired.certifications;
    const yearsReport = yearsOfExperience === null ? null : await verifyExtraction(text, { yearsOfExperience });
    if (yearsReport?.fired.includes("yearsOfExperience::hallucinated")) {
      warnings.push(
        `Jev doubts the derived ${yearsOfExperience} yrs figure (P=${yearsReport.scores["yearsOfExperience::hallucinated"]?.toFixed(2)}); it was kept but flagged`
      );
    }
  }
  const canonicalSkills = dedupe2(
    (metadata.skills ?? []).map((s) => canonicalize(s) ?? s)
  );
  const structured = {
    fullName: proposals.contact.fullName,
    headline: roles[0] ?? "",
    summary: summaryOf(text),
    contact: {
      email: proposals.contact.email,
      phone: proposals.contact.phone,
      location: proposals.contact.location,
      links: proposals.contact.links
    },
    skills: (metadata.skills ?? []).map((name) => {
      const canonical = canonicalize(name) ?? name;
      return {
        name: canonical,
        level: levelLabel(skills.scores[canonical] ?? skills.scores[name] ?? 0.6),
        years: inferSkillYears(text, canonical, proposals.experience.length)
      };
    }),
    experience: proposals.experience.map((e) => ({
      company: e.company,
      role: e.role,
      startDate: e.startDate,
      endDate: e.endDate,
      isCurrent: e.isCurrent,
      bullets: e.bullets,
      skills: dedupe2(
        (metadata.skills ?? []).filter(
          (s) => e.bullets.some((b) => b.toLowerCase().includes(s.toLowerCase()))
        )
      ).slice(0, 12)
    })),
    education: dedupeEducation(metadata.education ?? []),
    projects: (metadata.projects ?? []).map((p) => ({
      name: p.split(/[—–:|-]/)[0]?.trim().slice(0, 80) ?? p.slice(0, 80),
      description: p,
      skills: [],
      url: (p.match(/https?:\/\/\S+/) ?? [""])[0]
    })),
    certifications: (metadata.certifications ?? []).map((name) => ({ name, issuer: "", year: "" })),
    languages: proposals.languages.map((name) => ({ name, proficiency: "" })),
    totalYearsExperience: yearsOfExperience
  };
  const keptCount = metadata.skills?.length ?? 0;
  const signal = proposals.idx.text.length / 1e3;
  const confidence = clamp012(
    0.35 + 0.35 * Math.min(1, keptCount / 12) + 0.15 * Math.min(1, signal / 3) + (yearsOfExperience !== null ? 0.1 : 0) + (proposals.contact.email ? 0.05 : 0)
  );
  return {
    metadata,
    structured,
    provenance: skills.provenance,
    canonicalSkills,
    verification: model || Object.keys(skills.scores).length > 0 ? { model: model ?? config.typesafe.model, scores: skills.scores, usage } : void 0,
    quality: { extractionConfidence: Math.round(confidence * 100) / 100, warnings },
    mentions: proposals.mentions
  };
}
function choiceOf(answer) {
  return isChoiceAnswer(answer) && answer.choice ? answer.choice : void 0;
}
function levelLabel(scoreValue) {
  if (scoreValue >= 0.9) return "expert";
  if (scoreValue >= 0.75) return "advanced";
  if (scoreValue >= 0.6) return "intermediate";
  return "basic";
}
function inferSkillYears(text, skill, _experienceCount) {
  const info = skillInfo(skill);
  if (!info) return null;
  const re = new RegExp(
    `\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.]{0,24}?(\\d{1,2})\\s*(?:\\+)?\\s*(?:years?|yrs?)`,
    "i"
  );
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 40 ? n : null;
}
function summaryOf(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^(professional\s+)?(summary|profile|objective|about)\b/i.test(l.trim()));
  if (start < 0) return "";
  const rest = lines.slice(start + 1, start + 8).map((l) => l.trim()).filter(Boolean);
  const stop = rest.findIndex((l) => /^[A-Z\s&/()-]{3,40}$/.test(l));
  return (stop > 0 ? rest.slice(0, stop) : rest).join(" ").slice(0, 600);
}
var SOURCE_MAX_CHARS, MAX_SKILL_QUESTIONS, MAX_ROLE_QUESTIONS, MAX_EDU_QUESTIONS, MAX_CERT_QUESTIONS, SKILL_LEVELS, SENIORITY_OPTIONS, DOMAIN_OPTIONS;
var init_service = __esm({
  "src/extract/service.ts"() {
    "use strict";
    init_config();
    init_jev();
    init_ontology();
    init_deterministic();
    SOURCE_MAX_CHARS = 12e3;
    MAX_SKILL_QUESTIONS = 45;
    MAX_ROLE_QUESTIONS = 10;
    MAX_EDU_QUESTIONS = 6;
    MAX_CERT_QUESTIONS = 12;
    SKILL_LEVELS = [
      "no evidence the candidate used it",
      "only mentioned in passing, on someone else's behalf, or as something they would like to use",
      "claimed as the candidate's own skill (listed among their skills) or used in coursework or a personal project",
      "used professionally, hands-on, on real work",
      "deep expertise: led, architected, or mentored with it"
    ];
    SENIORITY_OPTIONS = {
      junior: "0-2 years, entry-level roles, internships",
      mid: "2-5 years, independent contributor",
      senior: "5+ years, leads projects or mentors",
      staff: "8+ years, staff/principal scope, org-level impact"
    };
    DOMAIN_OPTIONS = {
      frontend: "UI, React/Vue/Angular, web client work",
      backend: "APIs, services, databases, server-side",
      fullstack: "both frontend and backend",
      data: "data engineering, analytics, BI, ETL",
      ml: "machine learning, AI, model training",
      mobile: "iOS, Android, mobile apps",
      devops: "infrastructure, CI/CD, SRE, cloud platform",
      other: "none of the above (e.g. design, support, marketing, sales)"
    };
  }
});

// src/resumes/service.ts
var service_exports = {};
__export(service_exports, {
  addResumeFile: () => addResumeFile,
  addResumeFromBuffer: () => addResumeFromBuffer,
  addResumeFromText: () => addResumeFromText,
  deleteResume: () => deleteResume,
  getResumeRecord: () => getResumeRecord,
  listResumeRecords: () => listResumeRecords,
  resumeText: () => resumeText,
  shortId: () => shortId
});
import { readFile as readFile3 } from "node:fs/promises";
import { basename } from "node:path";
async function addResumeFile(file, options = {}) {
  let data;
  try {
    data = await readFile3(file);
  } catch {
    throw new AppError("VALIDATION_ERROR", `Cannot read file "${file}".`);
  }
  return addResumeFromBuffer(basename(file), data, options);
}
async function addResumeFromBuffer(filename, data, options = {}) {
  const text = await extractTextFromBuffer(filename, data);
  const duplicate = await findByContentHash(text);
  if (duplicate) {
    const existing = await getResume(duplicate.id);
    if (existing) {
      existing.quality.warnings = [
        ...existing.quality.warnings.filter((w) => !w.startsWith("duplicate of")),
        `duplicate of ${existing.originalFilename} \u2014 this file was already in the library`
      ];
      return existing;
    }
  }
  const profile = await extractProfile(text, { jev: options.jev });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const id = newId("rs");
  const record = {
    id,
    originalFilename: filename,
    extractedText: text,
    metadata: profile.metadata,
    structured: profile.structured,
    provenance: profile.provenance,
    verification: profile.verification,
    canonicalSkills: profile.canonicalSkills,
    quality: profile.quality,
    createdAt: now,
    updatedAt: now,
    byteSize: data.length,
    contentHash: contentHash(text)
  };
  await addResume(record);
  await saveOriginalFile(id, filename, data).catch(() => {
  });
  return record;
}
async function addResumeFromText(filename, text, options = {}) {
  return addResumeFromBuffer(filename, Buffer.from(text, "utf8"), options);
}
async function listResumeRecords(search, limit = 100) {
  const rows = search ? await searchResumes(search, limit) : await listResumes();
  return rows.slice(0, limit);
}
async function getResumeRecord(id) {
  const record = await getResume(id);
  if (!record) throw new AppError("NOT_FOUND", `Resume "${id}" not found.`);
  return record;
}
async function deleteResume(id) {
  const ok = await removeResume(id);
  if (!ok) throw new AppError("NOT_FOUND", `Resume "${id}" not found.`);
}
var init_service2 = __esm({
  "src/resumes/service.ts"() {
    "use strict";
    init_errors();
    init_text();
    init_service();
    init_local();
  }
});

// src/ranking/jd.ts
var jd_exports = {};
__export(jd_exports, {
  analyzeJobDescription: () => analyzeJobDescription,
  jdSkills: () => jdSkills,
  jobLevel: () => jobLevel,
  jobSeniority: () => jobSeniority,
  parseInlineSegments: () => parseInlineSegments,
  parseMinimumExperience: () => parseMinimumExperience
});
function parseInlineSegments(line) {
  const matches = [...line.matchAll(LABEL_RE)];
  if (matches.length === 0) return [];
  const out = [];
  matches.forEach((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? line.length : line.length;
    const text = line.slice(start, end).trim().replace(/^[.,;:]\s*/, "");
    const label = match[1].toLowerCase();
    const key = PREFERRED_HEADING.test(label) ? "preferred" : RESPONSIBILITY_HEADING.test(label) ? "responsibilities" : "required";
    if (text.length >= 2) out.push({ key, text });
  });
  return out;
}
function parseMinimumExperience(text) {
  const head = text.slice(0, 4e3);
  for (const re of EXPERIENCE_RE) {
    const m = head.match(re);
    if (!m) continue;
    const value = Number(m[1]);
    if (Number.isFinite(value) && value > 0 && value <= 40) return value;
  }
  return null;
}
function headingLines(lines) {
  const out = [];
  lines.forEach((line, index) => {
    const t = line.trim().replace(/^[#*\-\s>]+/, "").replace(/[:*#\s]+$/, "").trim();
    if (!t || t.length > 80) return;
    if (parseInlineSegments(t).length > 0) return;
    const isHeadingish = t.length <= 60 && !/[.!?]$/.test(t);
    if (!isHeadingish) return;
    if (REQUIREMENT_HEADING.test(t)) out.push({ key: "required", index });
    else if (PREFERRED_HEADING.test(t)) out.push({ key: "preferred", index });
    else if (RESPONSIBILITY_HEADING.test(t)) out.push({ key: "responsibilities", index });
    else out.push({ key: "other", index });
  });
  return out;
}
function bullets(text) {
  return text.split("\n").map((l) => l.trim()).filter((l) => /^([•\-*·▪◦‣]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^([•\-*·▪◦‣]|\d+[.)])\s+/, "").trim()).filter((l) => l.length > 12);
}
function analyzeJobDescription(title, description) {
  const text = description.trim();
  const lines = text.split("\n");
  const headings = headingLines(lines);
  const sectionFor = (lineNo) => {
    let current = "other";
    for (const h of headings) {
      if (h.index <= lineNo && h.key !== "other") current = h.key;
      if (h.index > lineNo) break;
    }
    return current;
  };
  const idx = indexText(text);
  const mentions = proposeSkillMentions(idx, { includeAbstract: true });
  const required = /* @__PURE__ */ new Set();
  const preferred = /* @__PURE__ */ new Set();
  const inlineLines = /* @__PURE__ */ new Map();
  idx.lines.forEach((line, i) => {
    const segments = parseInlineSegments(line.trim());
    if (segments.length > 0) inlineLines.set(i, segments);
  });
  for (const segments of inlineLines.values()) {
    for (const segment of segments) {
      for (const mention of proposeSkillMentions(indexText(segment.text), { includeAbstract: true })) {
        if (mention.confidence < 0.4) continue;
        if (segment.key === "preferred") preferred.add(mention.canonical);
        else required.add(mention.canonical);
      }
    }
  }
  for (const mention of mentions) {
    const aliasRe = new RegExp(`\\b${escapeRe(mention.alias)}\\b`, "i");
    const hits = idx.lines.map((line2, index) => ({ line: line2, index })).filter(({ line: line2 }) => aliasRe.test(line2)).filter(({ index }) => !inlineLines.has(index));
    if (hits.length === 0) continue;
    const rank = { required: 0, responsibilities: 1, preferred: 2, other: 3 };
    const best = hits.reduce((a, b) => rank[sectionFor(a.index)] <= rank[sectionFor(b.index)] ? a : b);
    const lineNo = best.index;
    const section = sectionFor(lineNo);
    const insideList = section !== "other";
    const proseOnly = !insideList && mention.confidence < 0.72;
    if (!insideList && (mention.confidence < 0.5 || proseOnly)) continue;
    if (section === "preferred") {
      preferred.add(mention.canonical);
      continue;
    }
    if (section === "required" || section === "responsibilities") {
      required.add(mention.canonical);
      continue;
    }
    const line = lineNo >= 0 ? idx.lines[lineNo] ?? "" : "";
    if (/\b(nice|plus|bonus|preferred|desirable|familiarity)\b/i.test(line)) preferred.add(mention.canonical);
    else required.add(mention.canonical);
  }
  if (title.trim()) {
    for (const mention of proposeSkillMentions(indexText(title), { includeAbstract: true })) {
      if (mention.confidence >= 0.6) required.add(mention.canonical);
    }
  }
  for (const skill of preferred) if (!/\b(must|required|strong)\b/i.test(text)) required.delete(skill);
  const role = (title.trim() ? titleCaseTitle(title) : "") || proposeRoles(text)[0] || "";
  const responsibilities = (() => {
    const idxList = headings.filter((h) => h.key === "responsibilities").map((h) => h.index);
    if (idxList.length === 0) {
      const all = bullets(text);
      return all.filter((b) => /\b(build|develop|design|own|lead|maintain|collaborate|implement|write|review|ship)\b/i.test(b)).slice(0, 8);
    }
    const start = Math.min(...idxList);
    const next = headings.find((h) => h.index > start && h.key !== "responsibilities");
    const body = lines.slice(start, next ? next.index : lines.length).join("\n");
    return bullets(body).slice(0, 8);
  })();
  const domain = DOMAINS.filter(([, re]) => re.test(text)).map(([name]) => name).slice(0, 4);
  const minimumExperience = parseMinimumExperience(text);
  return {
    role,
    requiredSkills: [...required].slice(0, 40),
    preferredSkills: [...preferred].filter((p) => !required.has(p)).slice(0, 25),
    minimumExperience,
    responsibilities,
    domain,
    level: jobLevel(title, text, minimumExperience)
  };
}
function jobLevel(title, description, minimumExperience) {
  const head = `${title}
${description.slice(0, 600)}`;
  const titleLower = title.toLowerCase();
  if (/\b(staff|principal|architect|distinguished|fellow|head of|director|vp|chief)\b/.test(titleLower)) return "staff";
  if (/\b(lead|tech lead|team lead|manager)\b/.test(titleLower)) return "staff";
  if (/\b(senior|sr\.?)\b/.test(titleLower)) return "senior";
  if (/\b(junior|jr\.?|entry[-\s]?level|graduate|intern|trainee|apprentice)\b/.test(titleLower)) return "junior";
  if (/\b(mid|intermediate|ii\b|associate)\b/.test(titleLower)) return "mid";
  const bar4 = minimumExperience ?? parseMinimumExperience(head);
  if (bar4 != null) {
    if (bar4 <= 2) return "junior";
    if (bar4 <= 4) return "mid";
    if (bar4 <= 8) return "senior";
    return "staff";
  }
  if (/\b(entry[-\s]?level|new grad|recent graduate|0-2 years)\b/i.test(head)) return "junior";
  if (/\b(10\+ years|15\+ years|deep architectural|technical leadership)\b/i.test(head)) return "staff";
  return "senior";
}
function jobSeniority(title, description) {
  const roles = proposeRoles(`${title}
${description}`);
  return proposeSeniority(roles, parseMinimumExperience(description));
}
function titleCaseTitle(title) {
  return title.trim().replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function jdSkills(description) {
  const idx = indexText(description);
  return proposeSkillMentions(idx).filter((m) => m.confidence >= 0.5).map((m) => canonicalize(m.canonical) ?? m.canonical);
}
var REQUIREMENT_HEADING, PREFERRED_HEADING, RESPONSIBILITY_HEADING, LABEL_RE, DOMAINS, EXPERIENCE_RE;
var init_jd = __esm({
  "src/ranking/jd.ts"() {
    "use strict";
    init_ontology();
    init_deterministic();
    REQUIREMENT_HEADING = /^(requirements?|must[\s-]?have|required|qualifications?|what you'?ll need|who you are|skills? (required|needed)|skills?|technical skills|basic qualifications?|minimum qualifications?|expected)\b/i;
    PREFERRED_HEADING = /^(nice[\s-]to[\s-]haves?|preferred|bonus|plus(es)?|desirable|good to have|additional)\b/i;
    RESPONSIBILITY_HEADING = /^(responsibilities|what you'?ll do|the role|duties|day[\s-]to[\s-]day|key (tasks|responsibilities)|about the role|role overview|your impact)\b/i;
    LABEL_RE = /(requirements?|required|must[\s-]?have|qualifications?|technical skills|skills?|nice[\s-]to[\s-]haves?|preferred|bonus|plus(es)?|desirable|responsibilities)\s*[:\-–]\s*/gi;
    DOMAINS = [
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
      ["energy", /\b(energy|solar|utilities|grid|sustainability)\b/i]
    ];
    EXPERIENCE_RE = [
      /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)\s*(\d{1,2})\s*(?:\+)?\s*years?/i,
      /(?:minimum|at least|min\.?|over|more than)\s*(?:of\s*)?(\d{1,2})(?:\s*\+)?\s*years?/i,
      /(\d{1,2})\s*\+\s*years?/i,
      /(\d{1,2})\s*years?\s*(?:of\s*)?(?:professional|relevant|industry|hands-?on|software|engineering|experience)/i,
      /(\d{1,2})\s*years?\s*(?:experience|working)/i
    ];
  }
});

// src/ranking/semantic.ts
var semantic_exports = {};
__export(semantic_exports, {
  coverageFromMatches: () => coverageFromMatches,
  jaccard: () => jaccard,
  matchRequirements: () => matchRequirements,
  matchSkillPair: () => matchSkillPair,
  relatedSkills: () => relatedSkills,
  stem: () => stem,
  stemSet: () => stemSet,
  tokenOverlap: () => tokenOverlap,
  tokenize: () => tokenize
});
function remember(cache2, key, value) {
  if (cache2.size >= CACHE_LIMIT) cache2.clear();
  cache2.set(key, value);
  return value;
}
function tokenize(text) {
  const cached = TOKENIZE_CACHE.get(text);
  if (cached) return cached;
  const tokens = text.toLowerCase().replace(/[^\p{L}\p{N}+#./\s-]/gu, " ").split(/\s+/).map((t) => t.replace(/^[-.]+|[-.]+$/g, "")).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return remember(TOKENIZE_CACHE, text, tokens);
}
function stem(token) {
  const cached = STEM_CACHE.get(token);
  if (cached) return cached;
  let t = token;
  if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith("es") && !t.endsWith("ses")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  return remember(STEM_CACHE, token, t);
}
function stemSet(tokens) {
  const key = tokens.length < 64 ? tokens.join("") : "";
  if (key) {
    const cached = STEMSET_CACHE.get(key);
    if (cached) return cached;
  }
  const set = new Set(tokens.map(stem));
  if (key) remember(STEMSET_CACHE, key, set);
  return set;
}
function tokenOverlap(needle, haystackTokens) {
  const tokens = tokenize(needle);
  if (tokens.length === 0) return 0;
  let hit = 0;
  for (const token of tokens) {
    const s = stem(token);
    if (haystackTokens.has(s)) {
      hit += 1;
      continue;
    }
    if (s.length >= 5) {
      for (const h of haystackTokens) {
        if (h.startsWith(s.slice(0, 5)) || s.startsWith(h.slice(0, 5))) {
          hit += 0.6;
          break;
        }
      }
    }
  }
  const ratio = hit / tokens.length;
  return Math.min(1, tokens.length <= 2 ? Math.min(1, ratio * 1.15) : ratio);
}
function jaccard(a, b) {
  const sa = stemSet(a.flatMap((s) => tokenize(s)));
  const sb = stemSet(b.flatMap((s) => tokenize(s)));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}
function matchSkillPair(requirement, candidateSkills) {
  const reqCanonical = canonicalize(requirement);
  const reqKey = (reqCanonical ?? requirement).toLowerCase();
  for (const raw of candidateSkills) {
    const cand = canonicalize(raw) ?? raw;
    if (cand.toLowerCase() === reqKey) {
      return { score: 1, via: cand === requirement ? "exact" : "alias", evidence: raw };
    }
  }
  if (reqCanonical) {
    for (const raw of candidateSkills) {
      const cand = canonicalize(raw) ?? raw;
      const info = skillInfo(cand);
      if (info?.ancestors.some((a) => a.toLowerCase() === reqKey)) {
        return { score: 1, via: "specific", evidence: `${raw} \u21D2 ${reqCanonical}` };
      }
    }
  }
  if (reqCanonical) {
    const reqInfo = skillInfo(reqCanonical);
    if (reqInfo) {
      const coveringParents = reqInfo.ancestors.filter((ancestor) => {
        const info = skillInfo(ancestor);
        if (!info || info.abstract) return false;
        if (info.category === "language" || info.category === "practice") return false;
        return isPlatformUmbrella(info.canonical);
      });
      for (const raw of candidateSkills) {
        const cand = canonicalize(raw) ?? raw;
        const inFamily = coveringParents.some((a) => a.toLowerCase() === cand.toLowerCase());
        if (inFamily) {
          return {
            score: config.semantic.descendantCredit,
            via: "platform",
            evidence: `${raw} ~ ${reqCanonical} (same platform)`
          };
        }
      }
    }
  }
  const candTokens = stemSet(candidateSkills.flatMap((s) => [...tokenize(s), ...s.split(/[\s/]+/).map((x) => x.toLowerCase())]));
  const overlap = tokenOverlap(requirement, candTokens);
  if (overlap >= config.semantic.lexicalFloor) {
    return { score: Math.min(0.95, overlap), via: "lexical", evidence: requirement };
  }
  return { score: 0, via: "none", evidence: "" };
}
async function matchRequirements(requirements, candidateSkills, options = {}) {
  const matches = requirements.map((req) => {
    const verdict = matchSkillPair(req, candidateSkills);
    return {
      requirement: req,
      canonical: canonicalize(req) ?? req,
      matched: verdict.score >= 0.6,
      score: verdict.score,
      via: verdict.via,
      evidence: verdict.evidence
    };
  });
  const unresolved = matches.filter((m) => m.score === 0);
  if (!options.jevAssist || unresolved.length === 0 || unresolved.length > 60) return matches;
  const askable = unresolved.filter((m) => knownSkills().includes(m.canonical));
  if (askable.length === 0) return matches;
  const questions = {};
  askable.forEach((m, i) => {
    questions[`sem__${i}`] = noul(
      `Does a candidate whose stated experience is exactly \`candidate_skills\` satisfy a requirement for "${m.canonical}"? A broader platform skill counts only if the candidate names a concrete service of it. Answer no when the candidate names nothing that belongs to that technology.`,
      {
        true: "the candidate's listed skills demonstrate this requirement",
        false: "the candidate's listed skills do not demonstrate this requirement"
      }
    );
  });
  const res = await systemOneSafe(
    options.jevState ?? { candidate_skills: candidateSkills, requirements: askable.map((m) => m.canonical) },
    questions
  );
  if (!res) return matches;
  askable.forEach((m, i) => {
    const p = pTrue(res.answers, `sem__${i}`);
    if (p === null) return;
    const target = matches.find((x) => x.requirement === m.requirement);
    if (!target) return;
    if (p >= config.typesafe.keepThreshold) {
      target.score = Math.max(target.score, Math.round(p * 100) / 100);
      target.matched = true;
      target.via = "jev";
      target.evidence = `jev P=${p.toFixed(2)}`;
    }
  });
  return matches;
}
function coverageFromMatches(matches) {
  if (matches.length === 0) return 0.5;
  const total = matches.reduce((sum, m) => sum + m.score, 0);
  return total / matches.length;
}
function relatedSkills(a, b) {
  const ca = canonicalize(a) ?? a;
  const cb = canonicalize(b) ?? b;
  if (ca.toLowerCase() === cb.toLowerCase()) return true;
  const ia = skillInfo(ca);
  const ib = skillInfo(cb);
  if (!ia && !ib) return false;
  if (ia?.ancestors.includes(cb) || ia?.descendants.includes(cb)) return true;
  if (ib?.ancestors.includes(ca) || ib?.descendants.includes(ca)) return true;
  const shared = (ia?.ancestors ?? []).filter((ancestor) => (ib?.ancestors ?? []).includes(ancestor));
  return shared.length > 0;
}
var STOPWORDS, TOKENIZE_CACHE, STEM_CACHE, STEMSET_CACHE, CACHE_LIMIT;
var init_semantic = __esm({
  "src/ranking/semantic.ts"() {
    "use strict";
    init_config();
    init_ontology();
    init_jev();
    STOPWORDS = /* @__PURE__ */ new Set([
      "a",
      "an",
      "the",
      "and",
      "or",
      "of",
      "for",
      "to",
      "in",
      "on",
      "with",
      "as",
      "at",
      "by",
      "is",
      "are",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "should",
      "could",
      "can",
      "may",
      "might",
      "must",
      "you",
      "your",
      "we",
      "our",
      "they",
      "their",
      "it",
      "its",
      "this",
      "that",
      "these",
      "those",
      "from",
      "into",
      "across",
      "including",
      "etc",
      "e.g",
      "i.e",
      "work",
      "working",
      "experience",
      "experiences",
      "strong",
      "good",
      "excellent",
      "knowledge",
      "understanding",
      "ability",
      "able",
      "plus",
      "nice",
      "must",
      "required",
      "requirements",
      "responsibilities",
      "role",
      "job",
      "team",
      "years",
      "year",
      "yrs",
      "minimum",
      "least",
      "such",
      "other",
      "new",
      "well",
      "also",
      "help",
      "support",
      "using",
      "use",
      "used",
      "uses",
      "based",
      "across",
      "within",
      "like"
    ]);
    TOKENIZE_CACHE = /* @__PURE__ */ new Map();
    STEM_CACHE = /* @__PURE__ */ new Map();
    STEMSET_CACHE = /* @__PURE__ */ new Map();
    CACHE_LIMIT = 2e4;
  }
});

// src/ranking/scoring.ts
var scoring_exports = {};
__export(scoring_exports, {
  DEFAULT_RANKING_WEIGHTS: () => DEFAULT_RANKING_WEIGHTS,
  candidateLevel: () => candidateLevel,
  deterministicScore: () => deterministicScore,
  finalScore: () => finalScore,
  getRankingWeights: () => getRankingWeights,
  jobWantsLeadership: () => jobWantsLeadership,
  leadershipScore: () => leadershipScore,
  levelDistance: () => levelDistance,
  levelFitScore: () => levelFitScore,
  roleSimilarity: () => roleSimilarity,
  shouldExclude: () => shouldExclude
});
function getRankingWeights() {
  try {
    const raw = process.env.RANKING_WEIGHTS;
    if (!raw) return DEFAULT_RANKING_WEIGHTS;
    return { ...DEFAULT_RANKING_WEIGHTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_RANKING_WEIGHTS;
  }
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function clamp013(n) {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
}
function roleSimilarity(requiredRole, candidateRoles) {
  if (!requiredRole || candidateRoles.length === 0) return 0.4;
  const cacheKey = `${requiredRole}${candidateRoles.join("")}`;
  const cached = ROLE_SIM_CACHE.get(cacheKey);
  if (cached !== void 0) return cached;
  const value = computeRoleSimilarity(requiredRole, candidateRoles);
  if (ROLE_SIM_CACHE.size >= 5e3) ROLE_SIM_CACHE.clear();
  ROLE_SIM_CACHE.set(cacheKey, value);
  return value;
}
function computeRoleSimilarity(requiredRole, candidateRoles) {
  const alternatives = requiredRole.split(/\s*(?:[/|]|\bor\b|\band\b)\s*/i).map((part) => part.trim()).filter((part) => part.length >= 3);
  if (alternatives.length > 1) {
    return Math.max(...alternatives.map((alt) => computeRoleSimilarity(alt, candidateRoles)));
  }
  const reqSkillFacts = tokenize(requiredRole).map((t) => canonicalize(t)).filter((x) => !!x);
  let best = 0;
  for (const role of candidateRoles) {
    const j = jaccard([requiredRole], [role]);
    const roleTokens = stemSet(tokenize(role));
    const overlap = tokenOverlap(requiredRole, roleTokens);
    let familyBonus = 0;
    const roleCanonical = tokenize(role).map((t) => canonicalize(t)).filter((x) => !!x);
    if (reqSkillFacts.length > 0 && roleCanonical.length > 0) {
      const shared = reqSkillFacts.filter((r) => roleCanonical.some((c) => c === r || (skillInfo(c)?.ancestors ?? []).includes(r)));
      if (shared.length > 0) familyBonus = 0.35;
    }
    const score2 = clamp013(0.55 * j + 0.3 * overlap + familyBonus);
    if (score2 > best) best = score2;
  }
  return best;
}
function experienceScore(required, actual) {
  if (required == null || required <= 0) return 0.7;
  if (actual == null) return 0.3;
  if (actual >= required) return 1;
  return clamp013(actual / required);
}
function candidateLevel(metadata) {
  const stated = (metadata.seniority ?? "").toLowerCase().trim();
  if (/\b(intern|trainee|graduate|entry|junior|jr)\b/.test(stated)) return "junior";
  if (/\b(lead|staff|principal|architect|head|director|manager|vp|chief)\b/.test(stated)) return "staff";
  if (/\bsenior|sr\b/.test(stated)) return "senior";
  if (/\bmid|intermediate|associate\b/.test(stated)) return "mid";
  const years = metadata.yearsOfExperience;
  if (years == null) return null;
  if (years < 3) return "junior";
  if (years < 5.5) return "mid";
  if (years < 9) return "senior";
  return "staff";
}
function leadershipScore(text) {
  const roleHits = (text.match(LEADERSHIP_ROLE) ?? []).length;
  const verbHits = (text.match(LEADERSHIP_VERB) ?? []).length;
  const scopeHits = (text.match(LEADERSHIP_SCOPE) ?? []).length;
  const weighted = roleHits * 2 + verbHits + scopeHits * 2;
  if (weighted === 0) return 0.15;
  if (weighted <= 2) return 0.45;
  if (weighted <= 5) return 0.7;
  if (weighted <= 10) return 0.85;
  return 1;
}
function jobWantsLeadership(level, text) {
  if (level === "staff") return true;
  return /\b(lead|leading|mentor|architect|architectural|team of|technical leadership|ownership of|roadmap|staff|principal)\b/i.test(text);
}
function levelFitScore(jobLevel2, candidate, years) {
  if (!jobLevel2 || !candidate) return 0.6;
  const base2 = LEVEL_FIT_MATRIX[jobLevel2][candidate];
  const jobIndex = LEVEL_ORDER.indexOf(jobLevel2);
  const candidateIndex = LEVEL_ORDER.indexOf(candidate);
  if (candidateIndex > jobIndex && years != null) {
    const bar4 = { junior: 2, mid: 4, senior: 8, staff: 12 }[jobLevel2];
    if (years >= bar4 * 2) return Math.max(0.05, base2 - 0.2);
  }
  return base2;
}
function levelDistance(jobLevel2, candidate) {
  if (!jobLevel2 || !candidate) return null;
  return Math.abs(LEVEL_ORDER.indexOf(jobLevel2) - LEVEL_ORDER.indexOf(candidate));
}
function textCoverage(needles, textTokens) {
  if (needles.length === 0) return 0.5;
  let sum = 0;
  for (const needle of needles) {
    const o = tokenOverlap(needle, textTokens);
    sum += o >= 0.75 ? 1 : o >= 0.5 ? 0.7 : o;
  }
  return clamp013(sum / needles.length);
}
function deterministicScore(input) {
  const weights = input.weights ?? getRankingWeights();
  const req = input.requirements;
  const meta = input.metadata;
  const textTokens = stemSet(tokenize(input.resumeText));
  const requiredSkills = coverageFromMatches(input.skillMatches);
  const requiredCount = (req.requiredSkills ?? []).length;
  const hardMatched = input.skillMatches.filter((m) => m.score >= 0.6).length;
  const experience = experienceScore(req.minimumExperience, meta.yearsOfExperience);
  const level = candidateLevel(meta);
  const levelFit = levelFitScore(req.level, level, meta.yearsOfExperience);
  const wantsLeadership = jobWantsLeadership(req.level, `${req.role ?? ""} ${input.jobDescription ?? ""} ${(req.responsibilities ?? []).join(" ")}`);
  const leadership = wantsLeadership ? leadershipScore(input.resumeText) : null;
  const role = roleSimilarity(req.role, meta.roles ?? []);
  const responsibilities = textCoverage(req.responsibilities ?? [], textTokens);
  const domain = textCoverage(req.domain ?? [], textTokens);
  const preferred = req.preferredSkills?.length ? clamp013(
    req.preferredSkills.map((p) => {
      const canonical = canonicalize(p) ?? p;
      const hit = availableSkillScore(canonical, meta.skills ?? []);
      return hit;
    }).reduce((a, b) => a + b, 0) / req.preferredSkills.length
  ) : 0.5;
  const breakdown = {
    requiredSkills: round1(requiredSkills * 100),
    experience: round1(experience * 100),
    roleSimilarity: round1(role * 100),
    responsibilities: round1(responsibilities * 100),
    domain: round1(domain * 100),
    preferredSkills: round1(preferred * 100),
    levelFit: round1(levelFit * 100),
    leadership: leadership === null ? null : round1(leadership * 100)
  };
  const totalWeight = weights.requiredSkills + weights.experience + weights.roleSimilarity + weights.responsibilities + weights.domain + weights.preferredSkills + weights.levelFit + (leadership === null ? 0 : weights.leadership);
  const raw = totalWeight === 0 ? 0 : (requiredSkills * weights.requiredSkills + experience * weights.experience + role * weights.roleSimilarity + responsibilities * weights.responsibilities + domain * weights.domain + preferred * weights.preferredSkills + levelFit * weights.levelFit + (leadership === null ? 0 : leadership * weights.leadership)) / totalWeight;
  const mismatchReasons = [];
  if (requiredCount > 0 && requiredSkills < config.ranking.mismatchThreshold) {
    mismatchReasons.push(
      `required-skill coverage ${(requiredSkills * 100).toFixed(0)}% is below the ${(config.ranking.mismatchThreshold * 100).toFixed(0)}% floor (${hardMatched}/${requiredCount} matched)`
    );
  }
  if (requiredCount > 0 && requiredSkills < 0.6 && domain < 0.35) {
    mismatchReasons.push("out-of-domain candidate: neither the skills nor the domain keywords line up");
  }
  if (req.level && level) {
    const distance = Math.abs(LEVEL_ORDER.indexOf(req.level) - LEVEL_ORDER.indexOf(level));
    const over = LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(req.level);
    if (distance >= 3) {
      mismatchReasons.push(
        `seniority mismatch: the posting is ${req.level}, this candidate reads as ${level} (${over ? "far above the level advertised" : "below the level required"})`
      );
    } else if (distance === 2) {
      mismatchReasons.push(
        `level mismatch: the posting is ${req.level}, this candidate reads as ${level} (${over ? "well above the level \u2014 likely to be under-challenged" : "well below the level \u2014 likely to be stretched"})`
      );
    }
  }
  if (req.minimumExperience != null && req.minimumExperience > 0 && meta.yearsOfExperience != null) {
    const ratio = meta.yearsOfExperience / req.minimumExperience;
    if (ratio < 0.5) {
      mismatchReasons.push(
        `experience ${meta.yearsOfExperience} yrs is less than half of the ${req.minimumExperience} yrs required`
      );
    }
  }
  return {
    score: round1(clamp013(raw) * 100),
    breakdown,
    mismatch: mismatchReasons.length > 0,
    mismatchReasons
  };
}
function shouldExclude(input) {
  const distance = input.levelDistance ?? 0;
  const bar4 = input.jobLevel === "junior" ? 2 : 3;
  if (distance >= bar4) {
    const over = LEVEL_ORDER.indexOf(input.candidateLevel ?? "mid") > LEVEL_ORDER.indexOf(input.jobLevel ?? "mid");
    return {
      exclude: true,
      reason: `seniority mismatch: the posting is ${input.jobLevel}, this candidate reads as ${input.candidateLevel} (${over ? `${distance === 2 ? "two" : "three"} bands over \u2014 above the level advertised` : `${distance === 2 ? "two" : "three"} bands under \u2014 below the level required`})`
    };
  }
  if (input.requiredCount === 0) return { exclude: false, reason: "" };
  if (input.requiredCoverage < config.ranking.hardFloor) {
    return {
      exclude: true,
      reason: `matches only ${(input.requiredCoverage * 100).toFixed(0)}% of the required skills (hard floor ${(config.ranking.hardFloor * 100).toFixed(0)}%)`
    };
  }
  if (input.requiredCoverage < 0.3 && input.domainScore < 0.2 && input.roleScore < 0.3) {
    return {
      exclude: true,
      reason: "different field: required skills, domain keywords and role all point elsewhere"
    };
  }
  return { exclude: false, reason: "" };
}
function availableSkillScore(requirement, candidateSkills) {
  const reqLower = requirement.toLowerCase();
  for (const raw of candidateSkills) {
    const cand = canonicalize(raw) ?? raw;
    if (cand.toLowerCase() === reqLower) return 1;
    const info = skillInfo(cand);
    if (info?.ancestors.some((a) => a.toLowerCase() === reqLower)) return 1;
    if (info?.descendants.some((d) => d.toLowerCase() === reqLower)) return config.semantic.descendantCredit;
  }
  return 0;
}
function finalScore(deterministic, ai) {
  const w = config.ranking.deterministicWeight;
  return Math.round((w * deterministic + (1 - w) * ai) * 10) / 10;
}
var DEFAULT_RANKING_WEIGHTS, ROLE_SIM_CACHE, LEVEL_ORDER, LEADERSHIP_ROLE, LEADERSHIP_VERB, LEADERSHIP_SCOPE, LEVEL_FIT_MATRIX;
var init_scoring = __esm({
  "src/ranking/scoring.ts"() {
    "use strict";
    init_config();
    init_ontology();
    init_semantic();
    DEFAULT_RANKING_WEIGHTS = {
      requiredSkills: 30,
      experience: 15,
      roleSimilarity: 13,
      responsibilities: 13,
      domain: 9,
      preferredSkills: 5,
      levelFit: 16,
      leadership: 12
    };
    ROLE_SIM_CACHE = /* @__PURE__ */ new Map();
    LEVEL_ORDER = ["junior", "mid", "senior", "staff"];
    LEADERSHIP_ROLE = /\b(lead|staff|principal|architect|head of|director|manager|chief)\b/gi;
    LEADERSHIP_VERB = /\b(led|leading|mentor(?:ed|ing|s)?|managed|coach(?:ed|ing)?|hired|interview(?:ed|ing)|architect(?:ed|ing)?|owned|drove|established|scaled|set the (?:direction|roadmap)|defined the roadmap|technical leadership|cross[-\s]team)\b/gi;
    LEADERSHIP_SCOPE = /\b(team of \d+|\d+ engineers|org[-\s]wide|company[-\s]wide|multiple teams|hiring|roadmap|tech lead|technical lead)\b/gi;
    LEVEL_FIT_MATRIX = {
      //                  candidate: junior  mid    senior staff
      junior: { junior: 1, mid: 0.85, senior: 0.35, staff: 0.15 },
      mid: { junior: 0.75, mid: 1, senior: 1, staff: 0.8 },
      senior: { junior: 0.25, mid: 0.6, senior: 1, staff: 1 },
      staff: { junior: 0.1, mid: 0.3, senior: 0.75, staff: 1 }
    };
  }
});

// src/ranking/service.ts
var service_exports2 = {};
__export(service_exports2, {
  coverageFromMatches: () => coverageFromMatches,
  fitQuestions: () => fitQuestions,
  fitState: () => fitState,
  getRanking: () => getRanking2,
  listRankings: () => listRankings2,
  rankJob: () => rankJob,
  shortId: () => shortId
});
function candidateSummary(resume, text, skillMatches) {
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
    resume_excerpt: text.slice(0, 1200)
  };
}
function verdictFor(matches, metadata, requirements, fit) {
  const requiredNames = new Set((requirements.requiredSkills ?? []).map((s) => s.toLowerCase()));
  const optionalNames = new Set((requirements.preferredSkills ?? []).map((s) => s.toLowerCase()));
  const required = matches.filter((m) => requiredNames.has(m.requirement.toLowerCase()));
  const optional = matches.filter((m) => optionalNames.has(m.requirement.toLowerCase()));
  const hit = required.filter((m) => m.score > 0).length;
  const total = requirements.requiredSkills?.length ?? 0;
  const parts = [];
  if (total) parts.push(`covers ${hit}/${total} required skills`);
  else if (required.length) parts.push(`${hit} requirement${hit === 1 ? "" : "s"} matched`);
  const platform = required.filter((m) => m.score > 0 && m.via !== "exact" && m.via !== "alias");
  if (platform.length) {
    parts.push(`platform-level: ${platform.slice(0, 3).map((m) => `${m.requirement} via ${m.via}`).join(", ")}`);
  }
  const misses = required.filter((m) => m.score === 0).map((m) => m.requirement);
  if (misses.length) {
    parts.push(`no evidence for ${misses.slice(0, 3).join(", ")}${misses.length > 3 ? ` +${misses.length - 3} more` : ""}`);
  } else if (total) {
    parts.push("nothing missing");
  }
  if (optional.length) {
    const bonus = optional.filter((m) => m.score > 0).length;
    parts.push(`${bonus}/${optional.length} preferred`);
  }
  const years = metadata.yearsOfExperience ?? null;
  const min = requirements.minimumExperience ?? null;
  if (years !== null) parts.push(min ? `${years} yrs vs ${min} required` : `${years} yrs experience`);
  else if (min) parts.push(`experience not stated (${min} required)`);
  if (requirements.level && metadata.seniority) {
    parts.push(`${metadata.seniority} track vs ${requirements.level} posting`);
  } else if (metadata.seniority) {
    parts.push(`${metadata.seniority} track`);
  }
  if (requirements.level && fit.levelDistance !== void 0 && fit.levelDistance !== null && fit.levelDistance >= 2) {
    parts.push(`level mismatch (${fit.levelDistance} bands)`);
  }
  if (metadata.domain && metadata.domain !== "general") parts.push(`${metadata.domain} domain`);
  if (fit.model !== "offline") {
    parts.push(`Jev skills ${fit.skills}% \xB7 experience ${fit.experience}% \xB7 overall ${fit.overall}%`);
  }
  return parts.join(" \u2014 ");
}
function hitCounts(matches, requirements) {
  const required = new Set((requirements.requiredSkills ?? []).map((s) => s.toLowerCase()));
  const preferred = new Set((requirements.preferredSkills ?? []).map((s) => s.toLowerCase()));
  let requiredHits = 0;
  let preferredHits = 0;
  for (const match of matches) {
    const key = match.requirement.toLowerCase();
    if (match.score <= 0) continue;
    if (required.has(key)) requiredHits += 1;
    else if (preferred.has(key)) preferredHits += 1;
  }
  return { requiredHits, preferredHits };
}
function buildAnalysis(required, matches, metadata, deterministic, fit, minimumExperience, mismatch, mismatchReasons) {
  const matched = matches.filter((m) => m.matched);
  const missing = matches.filter((m) => !m.matched);
  const parts = [`Matched ${matched.length} of ${matches.length} required skills.`];
  if (minimumExperience != null && minimumExperience > 0) {
    const have = metadata.yearsOfExperience;
    parts.push(
      have != null ? `Experience ${have} yrs against ${minimumExperience} required.` : `Experience unknown against ${minimumExperience} required.`
    );
  }
  parts.push(`Semantic/deterministic ${deterministic}, Jev fit ${fit}.`);
  if (mismatch) parts.push(`MISMATCH: ${mismatchReasons.join("; ")}.`);
  return {
    score: fit,
    strengths: matched.slice(0, 6).map((m) => m.requirement),
    gaps: missing.slice(0, 6).map((m) => m.requirement),
    matchedRequirements: matched.map((m) => m.requirement),
    missingRequirements: missing.map((m) => m.requirement),
    reasoning: parts.join(" "),
    skillMatches: matches,
    mismatch,
    mismatchReasons
  };
}
function fitState(job, candidates) {
  const req = job.requirements;
  return {
    job: {
      title: job.title,
      description: job.description.slice(0, 4e3),
      required_skills: req.requiredSkills ?? [],
      preferred_skills: req.preferredSkills ?? [],
      minimum_experience: req.minimumExperience ?? null,
      responsibilities: req.responsibilities ?? [],
      domain: req.domain ?? []
    },
    candidates: candidates.map((c) => c.summary)
  };
}
function fitQuestions(candidates) {
  const questions = {};
  candidates.forEach((c, i) => {
    const at = `candidates[${i}]`;
    questions[`fit__${i}__skills`] = noul(
      `Does \`${at}.skills\` (with \`${at}.matched_required_skills\` and \`${at}.missing_required_skills\`) demonstrate \`job.required_skills\`?`,
      {
        true: "the candidate demonstrates the required skills, including via related technologies of the same platform",
        false: "the candidate lacks most of the required skills"
      }
    );
    questions[`fit__${i}__experience`] = noul(
      `Do \`${at}.years_of_experience\` and \`${at}.seniority\` meet \`job.minimum_experience\`?`,
      {
        true: "their seniority and years meet or exceed the requirement",
        false: "clearly below the experience bar"
      }
    );
    questions[`fit__${i}__overall`] = noul(
      `Overall: would \`${at}\` be a credible hire for \`job.title\` given \`job.required_skills\`, \`job.responsibilities\` and \`${at}.resume_excerpt\`?`,
      {
        true: "core requirements align: skills, seniority and domain",
        false: "lacks core requirements or works in a different field"
      }
    );
  });
  return questions;
}
async function fitScores(job, candidates, offline) {
  const neutral = new Map(
    candidates.map((c) => [c.id, { skills: 50, experience: 50, overall: 50, blended: 50, model: "offline" }])
  );
  if (offline || candidates.length === 0 || !config.typesafe.enabled) {
    return { byId: neutral, model: "offline" };
  }
  const questions = fitQuestions(candidates);
  const res = await systemOneSafe(fitState(job, candidates), questions);
  if (!res) return { byId: neutral, model: "offline" };
  const byId = /* @__PURE__ */ new Map();
  candidates.forEach((c, i) => {
    const s = noulPercent(res.answers, `fit__${i}__skills`);
    const e = noulPercent(res.answers, `fit__${i}__experience`);
    const o = noulPercent(res.answers, `fit__${i}__overall`);
    byId.set(c.id, {
      skills: s,
      experience: e,
      overall: o,
      blended: Math.round((0.5 * s + 0.2 * e + 0.3 * o) * 10) / 10,
      model: res.model ?? config.typesafe.model
    });
  });
  return { byId, model: res.model ?? config.typesafe.model };
}
async function refineRequirements(requirements, description, offline) {
  const required = requirements.requiredSkills ?? [];
  if (offline || required.length === 0 || !config.typesafe.enabled || required.length > 40) {
    return requirements;
  }
  const questions = {};
  required.forEach((skill, i) => {
    questions[`req__${i}`] = noul(
      `Does \`job_description\` state "${skill}" (or a specific technology belonging to it) as a required / must-have skill for the role?`,
      {
        true: "required or must-have",
        false: "not required: absent, merely nice-to-have, or mentioned only in passing"
      }
    );
  });
  const res = await systemOneSafe({ job_description: description.slice(0, 8e3) }, questions);
  if (!res) return requirements;
  const keep = config.typesafe.keepThreshold;
  const confirmed = required.filter((_, i) => (pTrue(res.answers, `req__${i}`) ?? 1) >= keep);
  return { ...requirements, requiredSkills: confirmed.length > 0 ? confirmed : required };
}
async function rankJob(options) {
  const offline = options.offline === true;
  const summaries = await listResumes();
  if (summaries.length === 0) {
    throw new AppError("VALIDATION_ERROR", "No resumes stored yet. Add some first: resumerank add <files...>");
  }
  const parsed = analyzeJobDescription(options.title, options.description);
  const requirements = await refineRequirements(parsed, options.description, offline);
  const weights = getRankingWeights();
  const candidateLimit = config.ranking.candidateLimit;
  const finalLimit = options.limit ?? config.ranking.finalLimit;
  const scored = [];
  for (const resume of summaries) {
    const text = await resumeText(resume.id);
    const matches = await matchRequirements(requirements.requiredSkills ?? [], resume.canonicalSkills ?? resume.metadata.skills ?? [], {
      jevAssist: !offline,
      jevState: {
        candidate_skills: resume.canonicalSkills ?? resume.metadata.skills ?? [],
        job_title: parsed.role ?? options.title
      }
    });
    const det = deterministicScore({
      requirements,
      metadata: resume.metadata,
      resumeText: text,
      skillMatches: matches,
      jobDescription: options.description,
      weights
    });
    const candidateBand = candidateLevel(resume.metadata);
    const gate = shouldExclude({
      requiredCount: (requirements.requiredSkills ?? []).length,
      requiredCoverage: det.breakdown.requiredSkills / 100,
      domainScore: det.breakdown.domain / 100,
      roleScore: det.breakdown.roleSimilarity / 100,
      levelDistance: levelDistance(requirements.level, candidateBand),
      jobLevel: requirements.level ?? null,
      candidateLevel: candidateBand
    });
    scored.push({
      resume,
      text,
      matches,
      deterministic: det.score,
      breakdown: det.breakdown,
      mismatch: det.mismatch,
      mismatchReasons: det.mismatchReasons,
      exclude: gate.exclude,
      excludeReason: gate.reason
    });
  }
  const qualified = scored.filter((s) => !s.exclude);
  const hardExcluded = scored.filter((s) => s.exclude);
  const byScore = (a, b) => b.deterministic - a.deterministic;
  let pool = (options.includeMismatches ? scored : qualified).sort(byScore).slice(0, candidateLimit);
  const fellBack = pool.length === 0 && scored.length > 0;
  if (fellBack) pool = scored.sort(byScore).slice(0, candidateLimit);
  const fit = await fitScores(
    { title: parsed.role ?? options.title, description: options.description, requirements },
    pool.map((p) => ({
      id: p.resume.id,
      summary: candidateSummary(p.resume, p.text, p.matches)
    })),
    offline
  );
  const ranked = pool.map((entry) => {
    const fitDetail = fit.byId.get(entry.resume.id) ?? {
      skills: 50,
      experience: 50,
      overall: 50,
      blended: 50,
      model: "offline"
    };
    const ai = fitDetail.blended;
    const metadata = entry.resume.metadata;
    const candidateBand = candidateLevel(metadata);
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
          blended: fitDetail.blended
        },
        components: entry.breakdown,
        matched: entry.matches.filter((m) => m.score > 0).map((m) => ({ requirement: m.requirement, via: m.via, score: m.score })),
        missing: entry.matches.filter((m) => m.score === 0).map((m) => ({ requirement: m.requirement, reason: m.evidence?.trim() || "no evidence found in the resume" })),
        resume: {
          fullName: entry.resume.structured.fullName ?? null,
          seniority: metadata.seniority ?? null,
          yearsOfExperience: metadata.yearsOfExperience ?? null,
          roles: metadata.roles ?? [],
          domain: metadata.domain ?? null,
          skillCount: (metadata.skills ?? []).length
        },
        level: {
          posting: requirements.level ?? null,
          candidate: candidateBand,
          distance: levelDistance(requirements.level, candidateBand),
          leadership: entry.breakdown.leadership
        },
        bar: {
          minimumExperience: requirements.minimumExperience ?? null,
          requiredCount: (requirements.requiredSkills ?? []).length,
          preferredCount: (requirements.preferredSkills ?? []).length,
          requiredHits: hitCounts(entry.matches, requirements).requiredHits,
          preferredHits: hitCounts(entry.matches, requirements).preferredHits
        },
        verdict: verdictFor(entry.matches, metadata, requirements, { ...fitDetail, levelDistance: levelDistance(requirements.level, candidateBand) })
      },
      analysis: buildAnalysis(
        requirements.requiredSkills ?? [],
        entry.matches,
        entry.resume.metadata,
        entry.deterministic,
        ai,
        requirements.minimumExperience,
        entry.mismatch,
        entry.mismatchReasons
      )
    };
  });
  const bandDistance = (item) => {
    const band = candidateLevel({
      ...item.judgement?.resume.seniority ? { seniority: item.judgement.resume.seniority } : {}
    });
    return levelDistance(requirements.level, band) ?? 9;
  };
  ranked.sort(
    (a, b) => b.finalScore - a.finalScore || bandDistance(a) - bandDistance(b) || b.deterministicScore - a.deterministicScore || b.semanticScore - a.semanticScore
  );
  const finalists = ranked.slice(0, finalLimit);
  finalists.forEach((item, index) => {
    item.rank = index + 1;
  });
  const record = {
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
      reason: m.excludeReason
    })),
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (options.saveRanking !== false) await addRanking(record);
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
    mismatches: qualified.filter((m) => m.mismatch).map(
      (m) => buildAnalysis(
        requirements.requiredSkills ?? [],
        m.matches,
        m.resume.metadata,
        m.deterministic,
        0,
        requirements.minimumExperience,
        true,
        m.mismatchReasons
      )
    )
  };
}
async function listRankings2(limit = 30) {
  return listRankings(limit);
}
async function getRanking2(id) {
  const record = await getRanking(id);
  if (!record) throw new AppError("NOT_FOUND", `Ranking "${id}" not found.`);
  return record;
}
var init_service3 = __esm({
  "src/ranking/service.ts"() {
    "use strict";
    init_config();
    init_errors();
    init_jev();
    init_jd();
    init_semantic();
    init_scoring();
    init_local();
  }
});

// src/eval/harness.ts
var harness_exports = {};
__export(harness_exports, {
  normalizeGold: () => normalizeGold,
  runEval: () => runEval
});
import { readdir, readFile as readFile4, rm as rm2 } from "node:fs/promises";
import { basename as basename2, extname, join as join3, resolve as resolve2 } from "node:path";
function norm(value) {
  const c = canonicalize(value);
  return (c ?? value).trim().toLowerCase();
}
function normList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((v) => typeof v === "string").map(norm))].filter(Boolean);
}
function base(value) {
  return basename2(value).toLowerCase();
}
function resolveResumeFile(candidates, known) {
  for (const candidate of candidates) {
    const b = base(candidate);
    const hit = known.find((k) => k.toLowerCase() === b || base(k).replace(extname(k), "") === b.replace(extname(b), ""));
    if (hit) return hit;
  }
  return null;
}
function normalizeGold(raw, resumeFiles) {
  const data = raw ?? {};
  const extraction = {};
  const extractionRaw = data.extraction ?? {};
  for (const [file, value] of Object.entries(extractionRaw)) {
    if (!value || typeof value !== "object") continue;
    extraction[base(file)] = {
      expectedSkills: normList(value.expectedSkills ?? value.skills ?? value.expected ?? value.mustHaveSkills),
      forbiddenSkills: normList(value.forbiddenSkills ?? value.forbidden ?? value.mustNotHaveSkills),
      years: typeof value.years === "number" ? value.years : typeof value.yearsOfExperience === "number" ? value.yearsOfExperience : null
    };
  }
  const resumesRaw = data.resumes ?? {};
  const idToFile = /* @__PURE__ */ new Map();
  for (const [id, value] of Object.entries(resumesRaw)) {
    if (!value || typeof value.file !== "string") continue;
    const file = resolveResumeFile([value.file], resumeFiles) ?? base(value.file);
    idToFile.set(id, file);
    idToFile.set(id.toLowerCase(), file);
    extraction[file] = {
      expectedSkills: normList(value.skills ?? value.expectedSkills),
      forbiddenSkills: normList(value.forbiddenSkills ?? value.forbidden),
      years: typeof value.yearsExperience === "number" ? value.yearsExperience : typeof value.years === "number" ? value.years : null
    };
  }
  const toFiles = (values) => normList(values).map((v) => idToFile.get(v) ?? idToFile.get(v.replace(/\.[a-z]+$/, "")) ?? base(v));
  const jobsRaw = data.jobs ?? data.ranking ?? {};
  const pairs = /* @__PURE__ */ new Map();
  const pairsRaw = data.rankingPairs ?? data.pairs;
  if (Array.isArray(pairsRaw)) {
    for (const pair of pairsRaw) {
      const id = String(pair.job ?? pair.jobId ?? "");
      if (!id) continue;
      pairs.set(id, {
        eligible: normList(pair.eligible ?? pair.mustMatch ?? pair.strong),
        ineligible: normList(pair.ineligible ?? pair.mustNotMatch ?? pair.excluded)
      });
    }
  }
  const jobs = [];
  for (const [id, value] of Object.entries(jobsRaw)) {
    const pair = pairs.get(id);
    const tiers = value.tier ?? value.tiers ?? value.expectations ?? {};
    const tierEligible = Object.entries(tiers).filter(([, t]) => /strong|high|best|good/i.test(String(t))).map(([file]) => base(file));
    const tierIneligible = Object.entries(tiers).filter(([, t]) => /none|no\b|excluded|not/i.test(String(t))).map(([file]) => base(file));
    const eligibleIds = toFiles(value.eligible ?? value.mustMatch);
    const ineligibleIds = toFiles(value.ineligible ?? value.mustNotMatch);
    jobs.push({
      id,
      title: String(value.title ?? value.jobTitle ?? id),
      file: String(value.file ?? `jobs/${id}.md`),
      eligible: dedupe3([...eligibleIds, ...(pair?.eligible ?? []).map((v) => idToFile.get(v) ?? base(v)), ...tierEligible]),
      ineligible: dedupe3([...ineligibleIds, ...(pair?.ineligible ?? []).map((v) => idToFile.get(v) ?? base(v)), ...tierIneligible]),
      requiredSkills: normList(value.requiredSkills ?? value.skills ?? []),
      minimumExperience: typeof value.minYears === "number" ? value.minYears : typeof value.minimumExperience === "number" ? value.minimumExperience : null
    });
  }
  return { extraction, jobs };
}
function dedupe3(items) {
  return [...new Set(items.filter(Boolean))];
}
function mean(xs) {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function prf(tp, fp, fn) {
  const precision = tp + fp === 0 ? fn === 0 ? 1 : 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  return { precision, recall, f1 };
}
async function runEval(options) {
  const corpus = resolve2(options.corpus);
  const resumeDir = join3(corpus, "resumes");
  const jobDir = join3(corpus, "jobs");
  const resumeFiles = (await readdir(resumeDir)).filter((f) => f.toLowerCase().endsWith(".txt")).sort();
  const jobFiles = (await readdir(jobDir)).filter((f) => /\.(md|txt)$/i.test(f)).sort();
  const gold = normalizeGold(JSON.parse(await readFile4(join3(corpus, "gold.json"), "utf8")), resumeFiles);
  const extractionByFile = /* @__PURE__ */ new Map();
  for (const [file, value] of Object.entries(gold.extraction)) {
    extractionByFile.set(base(file), value);
  }
  if (options.reset) await rm2(join3(corpus, ".cache"), { recursive: true, force: true });
  process.env.RESUMERANK_HOME = join3(corpus, ".cache", "eval-home");
  await ensureStore();
  const extraction = [];
  for (const file of resumeFiles) {
    const text = await readFile4(join3(resumeDir, file), "utf8");
    const profile = await extractProfile(text, { jev: !options.offline });
    const extracted = new Set((profile.metadata.skills ?? []).map(norm));
    const goldRow = extractionByFile.get(base(file)) ?? { expectedSkills: [], forbiddenSkills: [], years: null };
    const matched = goldRow.expectedSkills.filter((s) => extracted.has(s));
    const missing = goldRow.expectedSkills.filter((s) => !extracted.has(s));
    const forbiddenHit = goldRow.forbiddenSkills.filter((s) => extracted.has(s));
    const unexpected = [...extracted].filter(
      (s) => !goldRow.expectedSkills.includes(s) && !goldRow.forbiddenSkills.includes(s)
    );
    const selfDeclared = new Set(
      profile.mentions.filter((m) => m.section === "skills" && m.context !== "negated").map((m) => norm(m.canonical))
    );
    const unjustified = unexpected.filter(
      (s) => !selfDeclared.has(s) && !goldRow.expectedSkills.some((e) => relatedSkills(e, s))
    );
    const { precision, recall, f1 } = prf(
      matched.length,
      unjustified.length + forbiddenHit.length,
      missing.length
    );
    const yearsGot = profile.metadata.yearsOfExperience ?? null;
    const yearsOk = goldRow.years === null ? true : yearsGot !== null && Math.abs(yearsGot - goldRow.years) <= 1;
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
      yearsOk
    });
    if (options.verbose) {
      console.log(
        `  ${file.padEnd(34)} P=${precision.toFixed(2)} R=${recall.toFixed(2)} F1=${f1.toFixed(2)} yrs ${yearsGot ?? "-"}/${goldRow.years ?? "-"}${yearsOk ? "" : " MISMATCH"}${missing.length ? `
      missing: ${missing.join(", ")}` : ""}${unexpected.length ? `
      extra:   ${unexpected.slice(0, 12).join(", ")}` : ""}${forbiddenHit.length ? `
      FORBIDDEN: ${forbiddenHit.join(", ")}` : ""}`
      );
    }
  }
  const jd = [];
  const jobById = new Map(gold.jobs.map((j) => [j.id, j]));
  for (const jobFile of jobFiles) {
    const id = basename2(jobFile).replace(extname(jobFile), "");
    const job = jobById.get(id);
    const description = await readFile4(join3(jobDir, jobFile), "utf8");
    if (!job || job.requiredSkills.length === 0) continue;
    const parsed = analyzeJobDescription(job.title, description);
    const got = new Set((parsed.requiredSkills ?? []).map(norm));
    const matched = job.requiredSkills.filter((s) => got.has(s));
    const missing = job.requiredSkills.filter((s) => !got.has(s));
    const extra = [...got].filter((s) => !job.requiredSkills.includes(s));
    const { precision, recall, f1 } = prf(matched.length, extra.length, missing.length);
    jd.push({ job: id, precision, recall, f1, missing, extra });
    if (options.verbose) {
      console.log(
        `  jd ${id.padEnd(4)} P=${precision.toFixed(2)} R=${recall.toFixed(2)}${missing.length ? ` missing=[${missing.join(",")}]` : ""}${extra.length ? ` extra=[${extra.slice(0, 8).join(",")}]` : ""}`
      );
    }
  }
  await rm2(join3(corpus, ".cache", "eval-home"), { recursive: true, force: true }).catch(() => {
  });
  process.env.RESUMERANK_HOME = join3(corpus, ".cache", "eval-home");
  await ensureStore();
  for (const file of resumeFiles) {
    const text = await readFile4(join3(resumeDir, file), "utf8");
    await addResumeFromText(file, text, { jev: false });
  }
  const ranking = [];
  for (const jobFile of jobFiles) {
    const id = basename2(jobFile).replace(extname(jobFile), "");
    const job = jobById.get(id);
    const description = await readFile4(join3(jobDir, jobFile), "utf8");
    const title = job?.title ?? id;
    const result = await rankJob({
      saveRanking: false,
      title,
      description,
      offline: options.offline,
      includeMismatches: false,
      limit: 10
    });
    const produced = result.results.map((r) => base(r.originalFilename));
    const top3 = produced.slice(0, 3);
    const eligible = (job?.eligible ?? []).map(base);
    const ineligible = (job?.ineligible ?? []).map(base);
    const top1Got = produced[0] ?? null;
    const leaked = ineligible.filter((f) => top3.includes(f));
    ranking.push({
      job: id,
      title,
      results: result.results.map((r) => ({
        filename: r.originalFilename,
        score: r.finalScore,
        semantic: r.semanticScore
      })),
      excluded: result.excluded.map((e) => e.originalFilename),
      eligible,
      ineligible,
      top1Got,
      top1Ok: eligible.length === 0 ? true : top1Got !== null && eligible.includes(top1Got),
      eligibleInTop3: eligible.filter((f) => top3.includes(f)).length,
      leaked
    });
    if (options.verbose) {
      const row = ranking[ranking.length - 1];
      console.log(
        `  job ${id.padEnd(4)} top1=${top1Got ?? "-"}${eligible.length ? row.top1Ok ? " OK" : ` expected one of [${eligible.join(",")}]` : ""}${eligible.length ? ` eligible ${row.eligibleInTop3}/${Math.min(3, eligible.length)} in top3` : ""}${leaked.length ? ` LEAKED=[${leaked.join(",")}]` : ""}`
      );
      for (const r of result.results.slice(0, 6)) {
        const name = base(r.originalFilename);
        const tag = eligible.includes(name) ? "ELIGIBLE" : ineligible.includes(name) ? "ineligible" : "";
        console.log(
          `        ${r.finalScore.toFixed(1).padStart(5)}  sem=${r.semanticScore.toFixed(0).padStart(3)}  ${name.padEnd(32)} ${tag}`
        );
      }
      if (result.excluded.length > 0) {
        console.log(
          `        excluded: ${result.excluded.slice(0, 6).map((e) => base(e.originalFilename)).join(", ")}${result.excluded.length > 6 ? ` (+${result.excluded.length - 6})` : ""}`
        );
      }
    }
  }
  const skillPrecision = mean(extraction.map((r) => r.precision));
  const skillRecall = mean(extraction.map((r) => r.recall));
  const skillF1 = mean(extraction.map((r) => r.f1));
  const yearsAccuracy = mean(extraction.map((r) => r.yearsOk ? 1 : 0));
  const jdPrecision = mean(jd.map((r) => r.precision));
  const jdRecall = mean(jd.map((r) => r.recall));
  const jdF1 = mean(jd.map((r) => r.f1));
  const top1Accuracy = mean(ranking.map((r) => r.top1Ok ? 1 : 0));
  const eligibleCoverage = mean(
    ranking.map((r) => r.eligible.length === 0 ? 1 : r.eligibleInTop3 / Math.min(3, r.eligible.length))
  );
  const falseAcceptRate = mean(ranking.map((r) => r.leaked.length > 0 ? 1 : 0));
  const extractionAccuracy = 0.6 * skillF1 + 0.25 * yearsAccuracy + 0.15 * jdF1;
  const rankingAccuracy = (top1Accuracy + eligibleCoverage + (1 - falseAcceptRate)) / 3;
  const composite = 0.45 * extractionAccuracy + 0.55 * rankingAccuracy;
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
      forbiddenLeaks: extraction.filter((r) => r.forbiddenHit.length > 0).map((r) => `${r.file}: ${r.forbiddenHit.join(", ")}`)
    }
  };
}
var init_harness = __esm({
  "src/eval/harness.ts"() {
    "use strict";
    init_service();
    init_ontology();
    init_service3();
    init_jd();
    init_service2();
    init_local();
    init_semantic();
  }
});

// src/cli/format.ts
var format_exports = {};
__export(format_exports, {
  bar: () => bar,
  bold: () => bold,
  cyan: () => cyan,
  dim: () => dim,
  formatDate: () => formatDate,
  green: () => green,
  pct: () => pct,
  printJson: () => printJson,
  red: () => red,
  renderTable: () => renderTable,
  truncate: () => truncate,
  yellow: () => yellow
});
function wrap(code, text) {
  return useColor ? `\x1B[${code}m${text}\x1B[0m` : text;
}
function truncate(s, width) {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= width) return clean;
  return `${clean.slice(0, Math.max(0, width - 1))}\u2026`;
}
function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function renderTable(headers, rows) {
  const widths = headers.map(
    (h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").replace(/\u001b\[\d+m/g, "").length))
  );
  const line = (cells) => cells.map((c, i) => padCell(c, widths[i])).join("  ");
  const out = [bold(line(headers)), dim(widths.map((w) => "-".repeat(w)).join("  "))];
  for (const row of rows) out.push(line(row));
  return out.join("\n");
}
function padCell(cell, width) {
  const visible = cell.replace(/\u001b\[\d+m/g, "").length;
  return cell + " ".repeat(Math.max(0, width - visible));
}
function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
function bar(value0to100, width = 12) {
  const filled = Math.round(Math.min(Math.max(value0to100, 0), 100) / 100 * width);
  return `${"\u2588".repeat(filled)}${"\u2591".repeat(Math.max(0, width - filled))}`;
}
function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}
var useColor, bold, dim, red, green, yellow, cyan;
var init_format = __esm({
  "src/cli/format.ts"() {
    "use strict";
    useColor = process.env.NO_COLOR === void 0 && process.env.RESUMERANK_NO_COLOR === void 0 && process.stdout.isTTY === true;
    bold = (t) => wrap("1", t);
    dim = (t) => wrap("2", t);
    red = (t) => wrap("31", t);
    green = (t) => wrap("32", t);
    yellow = (t) => wrap("33", t);
    cyan = (t) => wrap("36", t);
  }
});

// src/ui/version.ts
var version_exports = {};
__export(version_exports, {
  JEV_VERSION: () => JEV_VERSION
});
var JEV_VERSION;
var init_version = __esm({
  "src/ui/version.ts"() {
    "use strict";
    JEV_VERSION = "1.0.0";
  }
});

// src/ui/terminal.ts
var terminal_exports = {};
__export(terminal_exports, {
  filterCandidates: () => filterCandidates,
  initialDashState: () => initialDashState,
  loadDashData: () => loadDashData,
  renderFrame: () => renderFrame,
  runDashboard: () => runDashboard,
  stripAnsi: () => stripAnsi,
  visibleLength: () => visibleLength
});
function initialDashState(view = "overview") {
  return { view, cursor: 0, scroll: 0, filter: "", filterMode: false, detailOpen: false, message: "" };
}
function visibleLength(s) {
  return stripAnsi(s).length;
}
function stripAnsi(s) {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}
function pad(s, width) {
  const len = visibleLength(s);
  if (len > width) return truncate(stripAnsi(s), width);
  return s + " ".repeat(width - len);
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function thinBar(value, max, width = 14) {
  const filled = max <= 0 ? 0 : Math.round(value / max * width);
  return `${"\u2588".repeat(clamp(filled, 0, width))}${"\u2591".repeat(clamp(width - filled, 0, width))}`;
}
function filterCandidates(candidates, filter) {
  const f = filter.trim().toLowerCase();
  if (!f) return candidates;
  return candidates.filter((c) => [c.name, c.filename, c.role, ...c.skills].join(" ").toLowerCase().includes(f));
}
function renderFrame(data, state, options) {
  const color = options.color !== false;
  const width = clamp(options.width, 60, 400);
  const height = clamp(options.height, 16, 200);
  const bold3 = (t) => color ? bold(t) : t;
  const dim3 = (t) => color ? dim(t) : t;
  const green3 = (t) => color ? green(t) : t;
  const yellow3 = (t) => color ? yellow(t) : t;
  const red3 = (t) => color ? red(t) : t;
  const row = (content) => `\u2502 ${pad(content, width - 4)} \u2502`;
  const inner = width - 4;
  const lines = [];
  const title = ` resumerank ${data.version} `;
  const stats4 = `${data.store.resumes} resumes \xB7 ${data.store.skills} skills \xB7 ${data.store.rankings} rankings`;
  const pill = (() => {
    if (data.jev.enabled) {
      const model = /\(([^)]+)\)/.exec(data.jev.status)?.[1] ?? "typed layer";
      return green3(`\u25CF ${model}`);
    }
    if (/no key/i.test(data.jev.status)) return yellow3("\u25CF offline \xB7 no key");
    if (/offline/i.test(data.jev.status)) return yellow3("\u25CF offline (forced)");
    return yellow3(`\u25CF ${data.jev.status}`);
  })();
  const room = Math.max(10, inner - visibleLength(stats4) - 10);
  const pillFitted = visibleLength(pill) <= room ? pill : yellow3("\u25CF offline");
  const left = `${bold3(title)} ${dim3(truncate(stats4, Math.max(12, inner - visibleLength(pillFitted) - 4)))}`;
  const gap = Math.max(1, inner - visibleLength(left) - visibleLength(pillFitted));
  lines.push(`\u250C${"\u2500".repeat(inner + 2)}\u2510`);
  lines.push(row(`${left}${" ".repeat(gap)}${pillFitted}`));
  const tabs = VIEWS.map((v, i) => {
    const label = `${i + 1} ${VIEW_LABELS[v]}`;
    return v === state.view ? bold3(`[${label}]`) : dim3(` ${label} `);
  }).join(" ");
  const filterLabel = state.filter ? `${dim3("filter:")} ${state.filter}${state.filterMode ? "\u258C" : ""}` : dim3("/ to filter");
  const tabsGap = Math.max(1, inner - visibleLength(tabs) - visibleLength(filterLabel));
  lines.push(row(`${tabs}${" ".repeat(tabsGap)}${filterLabel}`));
  lines.push(`\u251C${"\u2500".repeat(inner + 2)}\u2524`);
  const messageRows = state.message ? 2 : 1;
  const bodyHeight = height - 6 - messageRows;
  const body = [];
  const detailWidth = Math.max(8, inner - 68);
  if (state.view === "overview") {
    body.push(bold3("Store"));
    body.push(`  ${dim3("data dir")}     ${data.store.home}`);
    body.push(
      `  ${dim3("candidates")}   ${data.store.resumes}    ${dim3("skills")} ${data.store.skills}    ${dim3("notes")} ${data.store.notes}    ${dim3("index")} ${bytes(data.store.bytes)}`
    );
    body.push(
      `  ${dim3("typed layer")}  ${data.jev.enabled ? green3(data.jev.status) : yellow3(data.jev.status)}    ${dim3("cached answers")} ${data.jev.cachedAnswers}`
    );
    body.push("");
    body.push(bold3("Top skills in the pool"));
    if (data.skillTop.length === 0) body.push(dim3("  no resumes yet \u2014 resumerank add <files>"));
    const max = data.skillTop[0]?.count ?? 1;
    for (const skill of data.skillTop.slice(0, Math.max(3, bodyHeight - 11))) {
      body.push(`  ${pad(skill.name, 22)} ${thinBar(skill.count, max)} ${skill.count}`);
    }
    body.push("");
    body.push(bold3("Recent rankings"));
    if (data.rankings.length === 0) body.push(dim3("  none yet \u2014 press r to rank the pool"));
    for (const ranking of data.rankings.slice(0, 5)) {
      body.push(
        `  ${dim3(ranking.id.slice(0, 11))} ${pad(truncate(ranking.jobTitle, 34), 36)} ${dim3(`${ranking.candidateCount} scored \xB7 ${ranking.model}`)}`
      );
    }
  }
  if (state.view === "candidates") {
    const filtered = filterCandidates(data.candidates, state.filter);
    if (state.detailOpen && filtered.length > 0) {
      const c = filtered[clamp(state.cursor, 0, filtered.length - 1)];
      body.push(`${bold3(c.name)} ${dim3(c.filename)}`);
      body.push(`  ${dim3("role")}        ${c.role || "\u2014"}${c.seniority ? dim3(` \xB7 ${c.seniority}`) : ""}`);
      body.push(`  ${dim3("experience")}  ${c.years === null ? "unknown" : `${c.years} yrs`}    ${dim3("confidence")} ${c.confidence.toFixed(2)}`);
      body.push(`  ${dim3("skills")}      ${c.skills.slice(0, 20).join(", ") || "\u2014"}`);
      if (c.notes > 0) body.push(`  ${dim3("notes")}       ${c.notes}`);
      if (c.warnings.length > 0) body.push(`  ${yellow3("warnings")}    ${c.warnings.join("; ")}`);
      const available = Math.max(2, bodyHeight - body.length - 2);
      const roles = data.candidates.find((x) => x.id === c.id)?.skills ?? [];
      if (roles.length > 20) body.push(`  ${dim3("more skills")} ${roles.slice(20, 20 + available * 3).join(", ")}`);
      body.push("");
      body.push(dim3("  esc close \xB7 o open in the browser \xB7 j/k next candidate"));
    } else {
      body.push(`  ${pad(dim3("candidate"), 30)} ${pad(dim3("role"), 24)} ${pad(dim3("yrs"), 5)} ${dim3("skills")}`);
      if (filtered.length === 0) body.push(dim3("  no candidates match"));
      const rows = Math.max(3, bodyHeight - 1);
      const start = clamp(state.scroll, 0, Math.max(0, filtered.length - rows));
      for (const [index, c] of filtered.slice(start, start + rows).entries()) {
        const selected = start + index === state.cursor;
        const marker = selected ? color ? "\x1B[7m " : ">" : " ";
        const end = selected && color ? "\x1B[27m" : "";
        const note = c.notes > 0 ? dim3(` \u25CF${c.notes}`) : "";
        body.push(
          `${marker}${pad(truncate(c.name, 28), 30)} ${pad(truncate(c.role || "\u2014", 22), 24)} ${pad(c.years === null ? "?" : String(c.years), 5)} ${truncate(c.skills.slice(0, 6).join(", "), detailWidth)}${note}${end}`
        );
      }
      if (filtered.length > rows) body.push(dim3(`  \u2026 ${filtered.length - rows} more \u2014 narrow with /`));
    }
  }
  if (state.view === "rankings") {
    const rankRows = state.lastRun ? state.lastRun.rows : [];
    if (state.lastRun) {
      body.push(`${bold3(state.lastRun.title)} ${dim3(`${state.lastRun.model} \xB7 ${state.lastRun.elapsedMs} ms`)}`);
      if (state.lastRun.extra) body.push(dim3(`  ${state.lastRun.extra}`));
      body.push("");
      body.push(`  ${pad(dim3("#"), 4)} ${pad(dim3("candidate"), 30)} ${pad(dim3("score"), 8)} ${pad(dim3("matched"), 10)} ${dim3("flags")}`);
      for (const [index, r] of rankRows.entries()) {
        const tone = r.score >= 60 ? green3 : r.score >= 40 ? yellow3 : red3;
        body.push(
          `  ${pad(String(index + 1), 4)} ${pad(truncate(r.filename, 28), 30)} ${pad(tone(r.score.toFixed(1)), 8)} ${pad(`${r.matched}/${r.required}`, 10)} ${dim3(truncate(r.flags, Math.max(6, detailWidth)))}`
        );
      }
      if (rankRows.length === 0) body.push(dim3("  nobody cleared the gates for this job"));
    } else {
      body.push(bold3("Saved rankings"));
      if (data.rankings.length === 0) body.push(dim3("  none yet \u2014 press r to rank the pool against a job description"));
      for (const [index, ranking] of data.rankings.entries()) {
        const selected = index === state.cursor;
        const marker = selected ? color ? "\x1B[7m " : ">" : " ";
        const end = selected && color ? "\x1B[27m" : "";
        body.push(
          `${marker}${dim3(ranking.id.slice(0, 11))} ${pad(truncate(ranking.jobTitle, 30), 32)} ${dim3(`${ranking.candidateCount} scored \xB7 ${ranking.model}`)}${end}`
        );
        if (selected) {
          for (const r of ranking.top.slice(0, 5)) {
            body.push(`    ${pad(truncate(r.filename, 30), 32)} ${r.score.toFixed(1).padStart(5)}  ${dim3(`${r.matched}/${r.required} required`)}`);
          }
          if (ranking.top.length === 0) body.push(dim3("    no eligible candidates"));
        }
      }
    }
  }
  if (state.view === "help") {
    body.push(bold3("Keys"));
    for (const [k, v] of [
      ["1 2 3 4", "switch view (overview, candidates, rankings, help)"],
      ["j / k  \u2191 / \u2193", "move the cursor"],
      ["enter", "open the selected candidate (esc closes)"],
      ["/", "filter candidates (enter applies, esc cancels)"],
      ["r", "rank the pool: type a job description file path"],
      ["o", "open the browser UI on the same store"],
      ["q", "quit"]
    ]) {
      body.push(`  ${pad(k, 14)} ${v}`);
    }
    body.push("");
    body.push(bold3("The same things from the shell"));
    body.push(dim3("  resumerank add ~/resumes/*.pdf"));
    body.push(dim3('  resumerank rank --title "Senior Backend Engineer" --jd jd.md'));
    body.push(dim3("  resumerank explain <id> --jd jd.md     why a candidate scored what it did"));
    body.push(dim3("  resumerank cache                        cached typed answers (stable, free re-runs)"));
    body.push("");
    body.push(dim3("Everything works offline; a TypeSafe key only sharpens the typed answers."));
  }
  const capacity = Math.max(1, bodyHeight);
  for (const line of body.slice(0, capacity)) lines.push(row(line));
  for (let i = Math.min(body.length, capacity); i < capacity; i += 1) lines.push(row(""));
  if (state.message) {
    lines.push(row(green3(state.message)));
    lines.push(row(""));
  } else {
    lines.push(row(""));
  }
  lines.push(`\u251C${"\u2500".repeat(inner + 2)}\u2524`);
  const footer = state.filterMode ? `${dim3("filter:")} ${state.filter}\u258C  ${dim3("enter apply \xB7 esc cancel")}` : dim3("j/k move \xB7 enter open \xB7 / filter \xB7 r rank \xB7 o browser \xB7 q quit");
  lines.push(row(footer));
  lines.push(`\u2514${"\u2500".repeat(inner + 2)}\u2518`);
  return lines;
}
async function loadDashData() {
  const { stats: stats4, listResumes: listResumes3, listRankings: listRankings3, countNotes: countNotes2, getRanking: getRanking3 } = await Promise.resolve().then(() => (init_local(), local_exports));
  const { jevStatus: jevStatus3, answerCacheSize: answerCacheSize3 } = await Promise.resolve().then(() => (init_jev(), jev_exports));
  const { JEV_VERSION: JEV_VERSION2 } = await Promise.resolve().then(() => (init_version(), version_exports));
  const storeStats2 = await stats4();
  const notes = await countNotes2();
  const candidates = (await listResumes3()).map((r) => ({
    id: r.id,
    name: r.structured?.fullName?.trim() || // no name in the CV (a design-element header, or a multi-person sample PDF):
    // fall back to the filename, cleaned up so it reads like a label.
    r.originalFilename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
    filename: r.originalFilename,
    role: r.metadata.roles?.[0] ?? r.structured?.headline ?? r.metadata.seniority ?? "",
    seniority: r.metadata.seniority ?? "",
    years: r.metadata.yearsOfExperience ?? null,
    skills: r.metadata.skills ?? [],
    confidence: r.quality?.extractionConfidence ?? 0,
    notes: notes[r.id] ?? 0,
    warnings: r.quality?.warnings ?? []
  }));
  const rankings = [];
  for (const summary of await listRankings3(20)) {
    const record = await getRanking3(summary.id);
    const ranked = (record?.results ?? []).filter((r) => r.rank > 0).sort((a, b) => a.rank - b.rank);
    rankings.push({
      id: summary.id,
      jobTitle: summary.jobTitle,
      candidateCount: summary.candidateCount,
      model: summary.model,
      createdAt: summary.createdAt,
      top: ranked.slice(0, 5).map((r) => ({
        filename: r.originalFilename,
        score: r.finalScore,
        matched: r.analysis?.matchedRequirements?.length ?? 0,
        required: (r.analysis?.matchedRequirements?.length ?? 0) + (r.analysis?.missingRequirements?.length ?? 0),
        flags: (r.analysis?.mismatchReasons ?? []).join("; ") || (r.analysis?.mismatch ? "flagged" : "")
      }))
    });
  }
  const counts = /* @__PURE__ */ new Map();
  for (const c of candidates) for (const s of c.skills) counts.set(s, (counts.get(s) ?? 0) + 1);
  const skillTop = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 12);
  return {
    store: {
      resumes: storeStats2.resumes,
      skills: storeStats2.skills,
      rankings: storeStats2.rankings,
      notes: Object.values(notes).reduce((a, b) => a + b, 0),
      bytes: storeStats2.bytes ?? 0,
      home: dataHome()
    },
    jev: {
      status: jevStatus3(),
      cachedAnswers: await answerCacheSize3().catch(() => 0),
      enabled: config.typesafe.enabled && !isOffline()
    },
    candidates,
    rankings,
    skillTop,
    version: JEV_VERSION2
  };
}
async function runDashboard(options = {}) {
  const state = initialDashState(options.view ?? "overview");
  let data = await loadDashData();
  const size = () => ({
    width: options.width ?? process.stdout.columns ?? 100,
    height: options.height ?? process.stdout.rows ?? 30
  });
  const draw = () => {
    const { width, height } = size();
    const lines = renderFrame(data, state, { width, height, color: options.color });
    process.stdout.write(`${CLEAR}${lines.join("\n")}
`);
  };
  if (options.snapshot || !process.stdin.isTTY) {
    const lines = renderFrame(data, state, { ...size(), color: options.snapshot ? false : options.color });
    process.stdout.write(`${lines.join("\n")}
`);
    return;
  }
  process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR);
  draw();
  const onResize = () => draw();
  process.stdout.on("resize", onResize);
  const cleanup = () => {
    process.stdout.off("resize", onResize);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF);
  };
  const filtered = () => filterCandidates(data.candidates, state.filter);
  const clampCursor = () => {
    const length = state.view === "candidates" ? filtered().length : data.rankings.length;
    state.cursor = clamp(state.cursor, 0, Math.max(0, length - 1));
    const rows = Math.max(3, size().height - 7);
    if (state.cursor < state.scroll) state.scroll = state.cursor;
    if (state.cursor >= state.scroll + rows) state.scroll = state.cursor - rows + 1;
  };
  const promptLine = (label) => new Promise((resolve5) => {
    process.stdin.setRawMode?.(false);
    process.stdout.write(SHOW_CURSOR + `
${label}`);
    let buffer = "";
    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      for (const ch of text) {
        if (ch === "\x7F") buffer = buffer.slice(0, -1);
        else if (ch === "\r" || ch === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode?.(true);
          process.stdout.write(HIDE_CURSOR);
          resolve5(buffer.trim());
          return;
        } else if (ch >= " ") buffer += ch;
      }
      process.stdout.write(`\r${label}${buffer}   `);
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
  const onKey = async (key) => {
    if (state.filterMode) {
      if (key === "\r") {
        state.filterMode = false;
        clampCursor();
      } else if (key === "\x1B") {
        state.filterMode = false;
        state.filter = "";
        clampCursor();
      } else if (key === "\x7F") {
        state.filter = state.filter.slice(0, -1);
        clampCursor();
      } else if (key >= " ") {
        state.filter += key;
        clampCursor();
      }
      draw();
      return;
    }
    switch (key) {
      case "q":
      case "":
        cleanup();
        process.exit(0);
        return;
      case "1":
        state.view = "overview";
        break;
      case "2":
        state.view = "candidates";
        state.cursor = 0;
        state.detailOpen = false;
        break;
      case "3":
        state.view = "rankings";
        state.cursor = 0;
        break;
      case "4":
        state.view = "help";
        break;
      case "j":
      case "\x1B[B":
        state.cursor += 1;
        break;
      case "k":
      case "\x1B[A":
        state.cursor -= 1;
        break;
      case "g":
        state.cursor = 0;
        break;
      case "G":
        state.cursor = Number.MAX_SAFE_INTEGER;
        break;
      case "/":
        state.view = "candidates";
        state.filterMode = true;
        break;
      case "\x1B":
        if (state.detailOpen) state.detailOpen = false;
        else if (state.filter) {
          state.filter = "";
          state.cursor = 0;
        }
        break;
      case "\r":
        if (state.view === "candidates") {
          state.detailOpen = !state.detailOpen;
        } else if (state.view === "rankings" && !state.lastRun && data.rankings.length > 0) {
          const selected = data.rankings[clamp(state.cursor, 0, data.rankings.length - 1)];
          state.lastRun = {
            title: selected.jobTitle,
            model: selected.model,
            elapsedMs: 0,
            extra: `saved ${selected.createdAt.slice(0, 16).replace("T", " ")} \xB7 showing the stored result`,
            rows: selected.top
          };
        }
        break;
      case "o": {
        if (options.openBrowser) {
          const url = await options.openBrowser();
          state.message = `browser UI: ${url}`;
        }
        break;
      }
      case "r": {
        if (!options.rank) break;
        const path = await promptLine("job description file (e.g. corpus/jobs/j1.md): ");
        if (!path) {
          state.message = "ranking cancelled";
          break;
        }
        state.message = "ranking\u2026";
        draw();
        try {
          const result = await options.rank("", path);
          state.lastRun = result;
          state.view = "rankings";
          state.message = `ranked ${result.rows.length} candidates in ${result.elapsedMs} ms (${result.model})`;
        } catch (err) {
          state.message = `ranking failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        break;
      }
      default:
        break;
    }
    clampCursor();
    draw();
  };
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    void onKey(text === "\x1B[A" || text === "\x1B[B" ? text : text[0] ?? "").then(async () => {
      if (text.length > 1 && text !== "\x1B[A" && text !== "\x1B[B") {
        for (const ch of text.slice(1)) await onKey(ch);
      }
    }).catch(() => {
    });
  });
}
var VIEWS, VIEW_LABELS, ALT_SCREEN_ON, ALT_SCREEN_OFF, HIDE_CURSOR, SHOW_CURSOR, CLEAR;
var init_terminal = __esm({
  "src/ui/terminal.ts"() {
    "use strict";
    init_config();
    init_format();
    VIEWS = ["overview", "candidates", "rankings", "help"];
    VIEW_LABELS = {
      overview: "Overview",
      candidates: "Candidates",
      rankings: "Rankings",
      help: "Help"
    };
    ALT_SCREEN_ON = "\x1B[?1049h";
    ALT_SCREEN_OFF = "\x1B[?1049l";
    HIDE_CURSOR = "\x1B[?25l";
    SHOW_CURSOR = "\x1B[?25h";
    CLEAR = "\x1B[2J\x1B[H";
  }
});

// src/ui/export-html.ts
var export_html_exports = {};
__export(export_html_exports, {
  escapeHtml: () => escapeHtml,
  renderDashboardHtml: () => renderDashboardHtml,
  shortWarning: () => shortWarning,
  writeDashboardHtml: () => writeDashboardHtml
});
import { writeFile as writeFile3 } from "node:fs/promises";
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function scoreTone(score2) {
  if (score2 >= 60) return "ok";
  if (score2 >= 40) return "warn";
  return "bad";
}
function bar2(value, max) {
  const pct3 = max <= 0 ? 0 : Math.min(100, Math.round(value / max * 100));
  return `<span class="bar"><i style="width:${pct3}%"></i></span>`;
}
function skillsList(skills, limit = 8) {
  if (skills.length === 0) return `<span class="muted">no skills read</span>`;
  const shown = skills.slice(0, limit);
  const rest = skills.length - shown.length;
  return shown.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join("") + (rest > 0 ? `<span class="chip more">+${rest}</span>` : "");
}
function shortWarning(warning) {
  if (/duplicate of/i.test(warning)) return "duplicate file";
  if (/no dated roles|no dates/i.test(warning)) return "no dates in CV";
  if (/doubts the derived/i.test(warning)) return "check the years";
  if (/dated roles span/i.test(warning)) return "dates don't add up";
  if (/could not read|no readable text/i.test(warning)) return "could not read this PDF";
  const trimmed = warning.replace(/\s+/g, " ").trim();
  return trimmed.length > 28 ? `${trimmed.slice(0, 26)}\u2026` : trimmed;
}
function candidateRow(candidate) {
  const years = candidate.years === null ? "\u2014" : `${candidate.years}`;
  const warn = candidate.warnings.length > 0 ? `<span class="tag warn" title="${escapeHtml(candidate.warnings.join("; "))}">${escapeHtml(shortWarning(candidate.warnings[0]))}</span>` + (candidate.warnings.length > 1 ? `<span class="tag muted" title="${escapeHtml(candidate.warnings.slice(1).join("; "))}">+${candidate.warnings.length - 1}</span>` : "") : "";
  const notes = candidate.notes > 0 ? `<span class="tag muted">${candidate.notes} note${candidate.notes > 1 ? "s" : ""}</span>` : "";
  return `<tr>
    <td class="name"><strong>${escapeHtml(candidate.name)}</strong><span class="file">${escapeHtml(candidate.filename)}</span></td>
    <td>${escapeHtml(candidate.role || "\u2014")}${candidate.seniority ? `<span class="file">${escapeHtml(candidate.seniority)}</span>` : ""}</td>
    <td class="num">${years}</td>
    <td>${skillsList(candidate.skills)}</td>
    <td class="num">${candidate.confidence.toFixed(2)}</td>
    <td>${warn}${notes}</td>
  </tr>`;
}
function rankingCard(ranking) {
  const rows = ranking.top.map(
    (row, index) => `<tr>
      <td class="num rank">${index + 1}</td>
      <td class="name"><strong>${escapeHtml(row.filename)}</strong></td>
      <td class="num">${row.score.toFixed(1)}</td>
      <td class="num ${scoreTone(row.score)}">${row.matched}/${row.required}</td>
      <td>${row.flags ? `<span class="tag warn">${escapeHtml(row.flags)}</span>` : `<span class="tag muted">clear</span>`}</td>
    </tr>`
  ).join("");
  return `<section class="card">
    <header class="card-head">
      <h3>${escapeHtml(ranking.jobTitle)}</h3>
      <span class="meta">${ranking.candidateCount} scored \xB7 ${escapeHtml(ranking.model)} \xB7 ${escapeHtml(ranking.createdAt.slice(0, 16).replace("T", " "))}</span>
    </header>
    ${ranking.top.length === 0 ? `<p class="muted">No candidate cleared the gates for this job.</p>` : `<table class="table">
      <thead><tr><th class="num">#</th><th>candidate</th><th class="num">score</th><th class="num">required</th><th>flags</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`}
  </section>`;
}
function renderDashboardHtml(data, options = {}) {
  const generated = options.generatedAt ?? /* @__PURE__ */ new Date();
  const pool = Math.max(1, data.store.resumes);
  const scoredFilenames = /* @__PURE__ */ new Set();
  for (const ranking of data.rankings) for (const row of ranking.top) scoredFilenames.add(row.filename);
  const warnings = data.candidates.filter((c) => c.warnings.length > 0).length;
  const skillRows = data.skillTop.map(
    (skill) => `<li>
      <span class="skill-name">${escapeHtml(skill.name)}</span>
      ${bar2(skill.count, pool)}
      <span class="num">${skill.count}/${data.store.resumes}</span>
    </li>`
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>resumerank \u2014 candidate pool</title>
<style>
  :root {
    --paper:#f3f1ec; --surface:#fff; --surface-2:#faf8f5; --sunken:#eeece7;
    --line:#e3dfd6; --ink:#191819; --ink-2:#444249; --muted:#74716a;
    --accent:#b4541f; --accent-soft:rgba(180,84,31,.1); --teal:#0f6f68;
    --ok:#146c43; --ok-soft:rgba(20,108,67,.1); --warn:#8a5a09; --warn-soft:rgba(138,90,9,.12);
    --bad:#a32020; --bad-soft:rgba(163,32,32,.09);
    --radius:12px; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Ubuntu,sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper:#0f1114; --surface:#171a1f; --surface-2:#1c2026; --sunken:#12151a;
      --line:#272c34; --ink:#ebe8e2; --ink-2:#c3bfb8; --muted:#8d8a83;
      --accent:#d4794a; --accent-soft:rgba(212,121,74,.14); --teal:#4fb3a9;
      --ok:#63c08a; --ok-soft:rgba(99,192,138,.14); --warn:#d7a13f; --warn-soft:rgba(215,161,63,.14);
      --bad:#e07b7b; --bad-soft:rgba(224,123,123,.14);
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 24px 64px; background:var(--paper); color:var(--ink); font-family:var(--sans); font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1080px; margin:0 auto; }
  header.top { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding-bottom:20px; border-bottom:1px solid var(--line); }
  .brand { display:flex; align-items:center; gap:12px; }
  .mark { width:38px; height:38px; border-radius:11px; background:var(--ink); color:var(--paper); display:grid; place-items:center; font-weight:700; font-size:19px; }
  h1 { margin:0; font-size:20px; letter-spacing:-.01em; }
  .sub { color:var(--muted); font-size:13px; }
  .stamp { text-align:right; color:var(--muted); font-size:12.5px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:24px 0 8px; }
  .kpi { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px; }
  .kpi b { display:block; font-size:24px; letter-spacing:-.02em; }
  .kpi span { color:var(--muted); font-size:12.5px; }
  section.card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:18px 20px; margin-top:20px; }
  .card-head { display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin-bottom:12px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0; }
  h3 { margin:0; font-size:16px; }
  .meta { color:var(--muted); font-size:12.5px; font-family:var(--mono); }
  ul.skills { list-style:none; margin:0; padding:0; }
  ul.skills li { display:flex; align-items:center; gap:10px; padding:5px 0; font-size:14px; }
  .skill-name { width:190px; flex:none; }
  .bar { display:inline-block; flex:1; height:8px; border-radius:99px; background:var(--sunken); overflow:hidden; }
  .bar i { display:block; height:100%; background:var(--accent); border-radius:99px; }
  .num { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  table.table { width:100%; border-collapse:collapse; }
  table.table th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; padding:6px 8px; border-bottom:1px solid var(--line); }
  table.table td { padding:9px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  table.table tr:last-child td { border-bottom:0; }
  th.num, td.num { text-align:right; }
  td.name strong { display:block; }
  .file { display:block; color:var(--muted); font-size:12px; font-family:var(--mono); }
  .chip { display:inline-block; padding:2px 8px; margin:1px 3px 1px 0; border:1px solid var(--line); border-radius:99px; font-size:12px; color:var(--ink-2); background:var(--surface-2); }
  .chip.more { color:var(--muted); }
  .tag { display:inline-block; padding:1px 7px; border-radius:99px; font-size:11.5px; border:1px solid var(--line); }
  .tag.ok { color:var(--ok); background:var(--ok-soft); border-color:transparent; }
  .tag.warn { color:var(--warn); background:var(--warn-soft); border-color:transparent; }
  .tag.muted { color:var(--muted); }
  .rank { color:var(--accent); font-weight:600; }
  td.ok { color:var(--ok); } td.warn { color:var(--warn); } td.bad { color:var(--bad); }
  .muted { color:var(--muted); }
  .legend { margin:0 0 12px; color:var(--muted); font-size:12.5px; }
  .legend b { color:var(--ink-2); font-weight:600; }
  footer { margin-top:32px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:12.5px; }
  @media print { body { background:#fff; padding:0; } section.card, .kpi { break-inside:avoid; } }
  @media (max-width:720px) { .skill-name { width:120px; } td:nth-child(4) { display:none; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <div class="mark">r</div>
      <div>
        <h1>resumerank</h1>
        <div class="sub">Candidate pool \xB7 ${data.store.resumes} resumes \xB7 ${data.jev.enabled ? "AI-assisted verification on" : "offline \u2014 nothing left this machine"}</div>
      </div>
    </div>
    <div class="stamp">generated ${escapeHtml(generated.toISOString().slice(0, 16).replace("T", " "))}<br>stored on this machine only</div>
  </header>

  <div class="kpis">
    <div class="kpi"><b>${data.store.resumes}</b><span>candidates</span></div>
    <div class="kpi"><b>${data.store.skills}</b><span>distinct skills</span></div>
    <div class="kpi"><b>${data.rankings.length}</b><span>saved rankings</span></div>
    <div class="kpi"><b>${scoredFilenames.size || 0}</b><span>candidates ever ranked</span></div>
    <div class="kpi"><b>${warnings}</b><span>CVs that need a quick look</span></div>
  </div>

  <section class="card">
    <div class="card-head"><h2>Skills across the pool</h2><span class="meta">how many candidates have each skill</span></div>
    ${skillRows ? `<ul class="skills">${skillRows}</ul>` : `<p class="muted">No resumes yet.</p>`}
  </section>

  <section class="card">
    <div class="card-head"><h2>Candidates</h2><span class="meta">${data.candidates.length} in the pool, newest first</span></div>
    <p class="legend"><b>years</b> = experience read from the CV &nbsp;\xB7&nbsp; <b>read</b> = how well the CV could be read, 1.00 meaning every field was found &nbsp;\xB7&nbsp; <b>status</b> = anything to know before shortlisting, e.g. a CV with no dates, dates that do not add up, or the same file added twice</p>
    ${data.candidates.length === 0 ? `<p class="muted">No candidates yet.</p>` : `<table class="table">
      <thead><tr><th>candidate</th><th>role</th><th class="num">years</th><th>skills</th><th class="num">read</th><th>status</th></tr></thead>
      <tbody>${data.candidates.map(candidateRow).join("")}</tbody>
    </table>`}
  </section>

  ${data.rankings.map(rankingCard).join("\n")}

  <footer>
    <strong>Adding resumes or running a new ranking needs the app:</strong> run
    <code>resumerank ui</code> (it opens in your browser) or <code>resumerank dash</code>
    for the terminal. This page is a snapshot \u2014 regenerate it any time with
    <code>resumerank dashboard</code>. Every credited skill carries its provenance and
    nothing leaves this machine.
  </footer>
</div>
</body>
</html>
`;
}
async function writeDashboardHtml(file, data) {
  await writeFile3(file, renderDashboardHtml(data), "utf8");
  return file;
}
var init_export_html = __esm({
  "src/ui/export-html.ts"() {
    "use strict";
  }
});

// src/cli/uninstall.ts
var uninstall_exports = {};
__export(uninstall_exports, {
  INSTALL_MARKER: () => INSTALL_MARKER,
  applyUninstall: () => applyUninstall,
  buildUninstallPlan: () => buildUninstallPlan,
  defaultUninstallPaths: () => defaultUninstallPaths,
  planUninstall: () => planUninstall,
  readInstallMarker: () => readInstallMarker
});
import { readFile as readFile5, rm as rm3, stat as stat2 } from "node:fs/promises";
import { join as join4 } from "node:path";
function planUninstall(input) {
  const candidates = [];
  for (const launcher of input.launchers) {
    const removable = launcher.fromMarker || launcher.exists && launcher.owned;
    candidates.push({
      path: launcher.path,
      kind: "launcher",
      remove: removable,
      detail: removable ? launcher.fromMarker ? "the command on your PATH (named by the install marker)" : "the command on your PATH" : launcher.exists ? "left alone: this file is not a resumerank launcher" : "not present"
    });
  }
  candidates.push({
    path: join4(input.appsDir, "resumerank.desktop"),
    kind: "menu entry",
    remove: true,
    detail: "the applications-menu entry"
  });
  candidates.push({
    path: join4(input.iconsDir, "resumerank.svg"),
    kind: "icon",
    remove: true,
    detail: "the icon image"
  });
  candidates.push({
    path: input.appDir,
    kind: "app directory",
    remove: input.installedApp,
    detail: input.installedApp ? "the installed program files" : `left alone: no ${INSTALL_MARKER} here, so this is a source checkout rather than an installed copy`
  });
  candidates.push({
    path: input.dataDir,
    kind: "data",
    remove: input.purgeData,
    detail: input.purgeData ? "your local store: resumes, texts, rankings, notes, config and the answer cache" : "kept: your resumes, rankings and notes stay on disk"
  });
  return {
    candidates,
    dataDir: input.dataDir,
    willRemove: candidates.filter((c) => c.remove),
    keeping: candidates.filter((c) => !c.remove)
  };
}
async function readInstallMarker(appDir) {
  try {
    return JSON.parse(await readFile5(join4(appDir, INSTALL_MARKER), "utf8"));
  } catch {
    return null;
  }
}
async function inspectLauncher(path) {
  try {
    const info = await stat2(path);
    const body = info.isFile() ? (await readFile5(path, "utf8")).slice(0, 4e3) : "";
    return { path, exists: true, owned: /resumerank/.test(body), fromMarker: false };
  } catch {
    return { path, exists: false, owned: false, fromMarker: false };
  }
}
function defaultUninstallPaths() {
  const home = process.env.HOME ?? "";
  const binDirs = [process.env.RESUMERANK_BIN, join4(home, ".local", "bin")].filter(
    (dir) => typeof dir === "string" && dir.length > 0
  );
  return {
    binDirs: [...new Set(binDirs)],
    appsDir: process.env.RESUMERANK_APPS_DIR ?? join4(home, ".local", "share", "applications"),
    iconsDir: process.env.RESUMERANK_ICONS_DIR ?? join4(home, ".local", "share", "icons")
  };
}
async function buildUninstallPlan(options) {
  const marker = options.marker === void 0 ? await readInstallMarker(options.appDir) : options.marker;
  const markerBin = typeof marker?.bin === "string" ? marker.bin : null;
  const paths3 = new Set(options.binDirs.map((dir) => join4(dir, "resumerank")));
  if (markerBin) paths3.add(markerBin);
  const launchers = [];
  for (const path of paths3) {
    const info = await inspectLauncher(path);
    launchers.push({ ...info, fromMarker: markerBin === path });
  }
  return planUninstall({
    appDir: options.appDir,
    launchers,
    appsDir: options.appsDir,
    iconsDir: options.iconsDir,
    dataDir: dataHome(),
    installedApp: marker !== null,
    purgeData: options.purgeData === true
  });
}
async function applyUninstall(plan) {
  const removed = [];
  const failed = [];
  for (const candidate of plan.willRemove) {
    try {
      await rm3(candidate.path, { recursive: true, force: true });
      removed.push(candidate.path);
    } catch (err) {
      failed.push({ path: candidate.path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  void paths().jevCache;
  return { removed, failed };
}
var INSTALL_MARKER;
var init_uninstall = __esm({
  "src/cli/uninstall.ts"() {
    "use strict";
    init_config();
    INSTALL_MARKER = ".resumerank-install";
  }
});

// src/ui/server.ts
var server_exports = {};
__export(server_exports, {
  keyStatus: () => keyStatus,
  openBrowser: () => openBrowser,
  runtime: () => runtime,
  startUi: () => startUi
});
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile as readFile6, stat as stat3 } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname as extname2, join as join5, resolve as resolve3 } from "node:path";
import { fileURLToPath } from "node:url";
function resolveAppDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  const argv = process.argv[1] ? dirname(resolve3(process.argv[1])) : "";
  const candidates = [
    join5(here, "app"),
    // src/ui/app (source, or a copied bundle)
    join5(here, "ui", "app"),
    // dist/../? keep for odd layouts
    join5(argv, "app"),
    // dist/app if someone copies the assets
    join5(argv, "..", "src", "ui", "app"),
    // repo and installed layout: dist/../src/ui/app
    join5(argv, "..", "..", "src", "ui", "app"),
    join5(process.cwd(), "src", "ui", "app")
    // running from the project root
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(join5(candidate, "index.html"))) return resolve3(candidate);
  }
  return resolve3(candidates[0] ?? ".");
}
function applyRuntimeSettings() {
  if (runtime.offline !== void 0) process.env.RESUMERANK_OFFLINE = runtime.offline ? "1" : "0";
  if (runtime.model) process.env.TYPESAFE_MODEL = runtime.model;
  if (runtime.apiKey !== void 0) process.env.TYPESAFE_API_KEY = runtime.apiKey;
}
function keyStatus() {
  const effective = (process.env.TYPESAFE_API_KEY ?? "").trim();
  if (!effective) return { configured: false, source: "none", hint: "" };
  const fromEnv = (process.env.RESUMERANK_KEY_FROM_ENV ?? "") === "1";
  return {
    configured: true,
    source: fromEnv ? "environment" : "stored",
    hint: effective.length > 4 ? `\u2026${effective.slice(-4)}` : "\u2026"
  };
}
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}
function sendError(res, err) {
  const user = toUserError(err);
  const status = user.code === "NOT_FOUND" ? 404 : user.code === "VALIDATION_ERROR" || user.code === "UNSUPPORTED_FILE" || user.code === "EMPTY_RESUME" ? 400 : 500;
  sendJson(res, status, { error: user.message, code: user.code });
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AppError("VALIDATION_ERROR", "Request body too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be JSON.");
  }
}
function baseName(file) {
  const i = file.lastIndexOf("/");
  return i >= 0 ? file.slice(i + 1) : file;
}
async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" || urlPath === "" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = join5(APP_DIR, rel);
  if (!file.startsWith(APP_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const info = await stat3(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile6(file);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname2(file)] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-cache"
    });
    res.end(body);
  } catch {
    if (rel === "index.html" && !existsSync(join5(APP_DIR, "index.html"))) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(`resumerank could not find its web UI assets (looked in ${APP_DIR}).
Reinstall with install.sh, or run from the project root.
`);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
  }
}
async function apiStatus() {
  const summary = await stats2();
  const notes = await countNotes();
  return {
    version: JEV_VERSION,
    dataDir: dataHome(),
    storage: "local JSON files \xB7 no database",
    resumes: summary.resumes,
    rankings: summary.rankings,
    skills: summary.skills,
    notes: Object.values(notes).reduce((a, b) => a + b, 0),
    indexBytes: summary.bytes,
    textChars: summary.textChars,
    jev: { status: jevStatus(), model: config.typesafe.model, online: config.typesafe.enabled, key: keyStatus() },
    offline: runtime.offline ?? isOffline(),
    thresholds: {
      keep: config.typesafe.keepThreshold,
      skillLevelMin: config.typesafe.skillLevelMin,
      mismatch: config.ranking.mismatchThreshold,
      hardFloor: config.ranking.hardFloor,
      deterministicWeight: config.ranking.deterministicWeight
    },
    files: { resumes: paths().resumes, rankings: paths().rankings }
  };
}
async function apiResumes(query) {
  const search = query.get("search") ?? "";
  const limit = Number(query.get("limit") ?? 500);
  const resumes = search ? await searchResumes(search, limit) : await listResumes();
  const notes = await countNotes();
  return resumes.slice(0, limit).map((r) => ({
    id: r.id,
    shortId: shortId(r.id),
    filename: r.originalFilename,
    skills: r.metadata.skills ?? [],
    skillCount: (r.metadata.skills ?? []).length,
    roles: r.metadata.roles ?? [],
    years: r.metadata.yearsOfExperience ?? null,
    seniority: r.metadata.seniority ?? "",
    domain: r.metadata.domain ?? "",
    confidence: r.quality?.extractionConfidence ?? 0,
    warnings: r.quality?.warnings ?? [],
    notes: notes[r.id] ?? 0,
    chars: r.textChars ?? 0,
    createdAt: r.createdAt
  }));
}
async function apiResume(id) {
  const record = await getResume(id);
  if (!record) throw new AppError("NOT_FOUND", `Resume "${id}" not found.`);
  const notes = await listNotes(record.id);
  return { ...record, extractedText: void 0, textPreview: record.extractedText.slice(0, 2e3), notes };
}
async function startUi(options = {}) {
  await ensureStore();
  const fromEnv = (process.env.TYPESAFE_API_KEY ?? "").trim();
  if (fromEnv) {
    process.env.RESUMERANK_KEY_FROM_ENV = "1";
  } else {
    const stored = await loadConfig();
    if (stored?.typesafeApiKey) {
      runtime.apiKey = stored.typesafeApiKey;
      applyRuntimeSettings();
    }
    if (stored?.typesafeModel && !process.env.TYPESAFE_MODEL) process.env.TYPESAFE_MODEL = stored.typesafeModel;
  }
  const host = options.host ?? "127.0.0.1";
  const port = await findPort(options.port ?? 7777, host);
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  async function handle(req, res) {
    applyRuntimeSettings();
    const url2 = new URL(req.url ?? "/", `http://${host}:${port}`);
    const path = url2.pathname;
    const method = req.method ?? "GET";
    try {
      if (!path.startsWith("/api/")) {
        await serveStatic(res, path);
        return;
      }
      const query = url2.searchParams;
      if (path === "/api/status" && method === "GET") return sendJson(res, 200, await apiStatus());
      if (path === "/api/dashboard.html" && method === "GET") {
        const { loadDashData: loadDashData2 } = await Promise.resolve().then(() => (init_terminal(), terminal_exports));
        const { renderDashboardHtml: renderDashboardHtml2 } = await Promise.resolve().then(() => (init_export_html(), export_html_exports));
        const html = renderDashboardHtml2(await loadDashData2());
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": 'attachment; filename="resumerank-dashboard.html"',
          "Cache-Control": "no-store"
        });
        res.end(html);
        return;
      }
      if (path === "/api/resumes" && method === "GET") return sendJson(res, 200, await apiResumes(query));
      if (path === "/api/resumes/upload" && method === "POST") {
        const body = await readJsonBody(req);
        const files = body.files ?? [];
        if (files.length === 0) throw new AppError("VALIDATION_ERROR", "No files in the request.");
        resetStats();
        const startedAt = Date.now();
        const useJev = body.jev !== false;
        const results = new Array(files.length);
        const lanes = ingestLanes(useJev && config.typesafe.enabled, files.length);
        const queue = files.map((file, index) => ({ file, index }));
        const worker = async () => {
          for (; ; ) {
            const item = queue.shift();
            if (!item) return;
            try {
              const buffer = Buffer.from(item.file.dataBase64, "base64");
              const record = await addResumeFromBuffer(item.file.name, buffer, { jev: useJev });
              results[item.index] = {
                ok: true,
                id: record.id,
                filename: record.originalFilename,
                skills: record.metadata.skills?.length ?? 0,
                years: record.metadata.yearsOfExperience ?? null,
                confidence: record.quality.extractionConfidence,
                warnings: record.quality.warnings,
                // The same resume uploaded twice returns the existing record.
                duplicate: record.quality.warnings.some((w) => w.startsWith("duplicate of"))
              };
            } catch (err) {
              results[item.index] = { ok: false, filename: item.file.name, error: toUserError(err).message };
            }
          }
        };
        await Promise.all(Array.from({ length: lanes }, worker));
        return sendJson(res, 200, { results, jevCalls: stats.calls, elapsedMs: Date.now() - startedAt });
      }
      const resumeMatch = path.match(/^\/api\/resumes\/([^/]+)(\/text|\/file)?$/);
      if (resumeMatch) {
        const id = decodeURIComponent(resumeMatch[1]);
        const sub = resumeMatch[2];
        if (method === "GET" && !sub) return sendJson(res, 200, await apiResume(id));
        if (method === "GET" && sub === "/text") {
          const record = await getResume(id);
          if (!record) throw new AppError("NOT_FOUND", "Resume not found.");
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(record.extractedText);
          return;
        }
        if (method === "GET" && sub === "/file") {
          const record = await getResume(id);
          if (!record) throw new AppError("NOT_FOUND", "Resume not found.");
          const file = await originalFile(record.id);
          if (!file) throw new AppError("NOT_FOUND", "Original file was not stored.");
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${baseName(record.originalFilename)}"`,
            "Content-Length": file.data.length
          }).end(file.data);
          return;
        }
        if (method === "DELETE" && !sub) {
          await removeResume(id);
          return sendJson(res, 200, { ok: true });
        }
      }
      if (path === "/api/notes" && method === "GET") {
        return sendJson(res, 200, await listNotes(query.get("resumeId") ?? void 0));
      }
      if (path === "/api/notes" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body.resumeId || !body.content) throw new AppError("VALIDATION_ERROR", "resumeId and content required.");
        return sendJson(res, 200, await addNote(body.resumeId, body.content));
      }
      const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/);
      if (noteMatch) {
        const noteId = decodeURIComponent(noteMatch[1]);
        if (method === "PATCH" || method === "PUT") {
          const body = await readJsonBody(req);
          const updated = await updateNote(noteId, body.content ?? "");
          if (!updated) throw new AppError("NOT_FOUND", "Note not found.");
          return sendJson(res, 200, updated);
        }
        if (method === "DELETE") {
          const ok = await removeNote(noteId);
          if (!ok) throw new AppError("NOT_FOUND", "Note not found.");
          return sendJson(res, 200, { ok: true });
        }
      }
      if (path === "/api/jd" && method === "POST") {
        const body = await readJsonBody(req);
        const requirements = analyzeJobDescription(body.title ?? "", body.description ?? "");
        return sendJson(res, 200, { requirements });
      }
      if (path === "/api/rank" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body.description?.trim()) throw new AppError("VALIDATION_ERROR", "A job description is required.");
        resetStats();
        const started = Date.now();
        const result = await rankJob({
          title: body.title?.trim() || "Untitled role",
          description: body.description,
          offline: body.offline === true,
          includeMismatches: body.includeMismatches === true,
          limit: body.limit ?? config.ranking.finalLimit
        });
        return sendJson(res, 200, {
          ...result,
          elapsedMs: Date.now() - started,
          jevCalls: stats.calls
        });
      }
      if (path === "/api/rankings" && method === "GET") {
        return sendJson(res, 200, await listRankings(200));
      }
      const rankingMatch = path.match(/^\/api\/rankings\/([^/]+)(\/export)?$/);
      if (rankingMatch) {
        const id = decodeURIComponent(rankingMatch[1]);
        if (method === "GET" && !rankingMatch[2]) {
          const record = await getRanking(id);
          if (!record) throw new AppError("NOT_FOUND", "Ranking not found.");
          return sendJson(res, 200, record);
        }
        if (method === "DELETE" && !rankingMatch[2]) {
          const ok = await removeRanking(id);
          if (!ok) throw new AppError("NOT_FOUND", "Ranking not found.");
          return sendJson(res, 200, { ok: true });
        }
        if (method === "GET" && rankingMatch[2]) {
          const record = await getRanking(id);
          if (!record) throw new AppError("NOT_FOUND", "Ranking not found.");
          const format = query.get("format") ?? "json";
          const stem2 = `ranking-${record.id.slice(0, 11)}`;
          if (format === "csv") {
            const escape = (v) => `"${v.replace(/"/g, '""')}"`;
            const header = "rank,score,semantic,jev,candidate,matched_required,missing_required";
            const rows = record.results.map(
              (r) => [
                r.rank,
                r.finalScore,
                r.semanticScore,
                r.aiScore,
                escape(r.originalFilename),
                escape(r.analysis.matchedRequirements.join("; ")),
                escape(r.analysis.missingRequirements.join("; "))
              ].join(",")
            );
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="${stem2}.csv"`
            }).end(`${[header, ...rows].join("\n")}
`);
            return;
          }
          if (format === "md") {
            const md = [
              `# ${record.jobTitle}`,
              "",
              `_${record.createdAt} \xB7 ${record.candidateCount} candidates \xB7 model ${record.model}_`,
              "",
              `**Required:** ${(record.requirements.requiredSkills ?? []).join(", ") || "-"}`,
              "",
              "| # | Score | Candidate | Matched | Missing |",
              "| --- | --- | --- | --- | --- |",
              ...record.results.map(
                (r) => `| ${r.rank} | ${r.finalScore.toFixed(1)} | ${r.originalFilename} | ${r.analysis.matchedRequirements.join(", ")} | ${r.analysis.missingRequirements.join(", ")} |`
              ),
              "",
              record.excluded.length ? `## Excluded as mismatches

${record.excluded.map((e) => `- ${e.originalFilename}: ${e.reason}`).join("\n")}` : "",
              ""
            ].join("\n");
            res.writeHead(200, {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="${stem2}.md"`
            }).end(md);
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${stem2}.json"`
          }).end(`${JSON.stringify(record, null, 2)}
`);
          return;
        }
      }
      if (path === "/api/skills" && method === "GET") {
        const index = await skillIndex();
        const resumes = await listResumes();
        const nameById = new Map(resumes.map((r) => [r.id, r.originalFilename]));
        return sendJson(
          res,
          200,
          Object.entries(index).map(([skill, ids]) => ({
            skill,
            count: ids.length,
            candidates: ids.map((id) => ({ id, filename: nameById.get(id) ?? id.slice(0, 8) }))
          })).sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
        );
      }
      if (path === "/api/explain" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body.resumeId) throw new AppError("VALIDATION_ERROR", "resumeId is required.");
        const record = await getResume(body.resumeId);
        if (!record) throw new AppError("NOT_FOUND", "Resume not found.");
        const requirements = analyzeJobDescription(body.title ?? "", body.description ?? "");
        const matches = await matchRequirements(
          requirements.requiredSkills ?? [],
          record.canonicalSkills ?? record.metadata.skills ?? [],
          { jevAssist: config.typesafe.enabled, jevState: { candidate_skills: record.canonicalSkills ?? [] } }
        );
        const score2 = deterministicScore({
          requirements,
          metadata: record.metadata,
          resumeText: record.extractedText,
          skillMatches: matches,
          weights: getRankingWeights()
        });
        return sendJson(res, 200, { requirements, matches, ...score2 });
      }
      if (path === "/api/settings" && method === "POST") {
        const body = await readJsonBody(req);
        if (typeof body.offline === "boolean") runtime.offline = body.offline;
        if (typeof body.model === "string" && body.model.trim()) runtime.model = body.model.trim();
        if (typeof body.apiKey === "string" && body.apiKey.trim()) {
          const existing = await loadConfig() ?? {};
          await saveConfig({ ...existing, typesafeApiKey: body.apiKey.trim() });
          runtime.apiKey = body.apiKey.trim();
          delete process.env.RESUMERANK_KEY_FROM_ENV;
        } else if (body.clearKey === true) {
          const existing = await loadConfig() ?? {};
          const { typesafeApiKey: _drop, ...rest } = existing;
          await saveConfig(rest);
          runtime.apiKey = "";
          delete process.env.RESUMERANK_KEY_FROM_ENV;
        }
        applyRuntimeSettings();
        return sendJson(res, 200, await apiStatus());
      }
      if (path === "/api/jev/test" && method === "POST") {
        applyRuntimeSettings();
        if (!config.typesafe.enabled) {
          return sendJson(res, 200, {
            ok: false,
            key: keyStatus(),
            message: runtime.offline ?? isOffline() ? "offline mode is on" : "no key configured"
          });
        }
        try {
          const probe = await systemOne({ sentence: "Does this sentence mention a programming language?" }, {
            ping: noul("Does `sentence` mention a programming language?")
          });
          const p = noulPercent(probe.answers, "ping");
          const model = probe.model ?? config.typesafe.model;
          return sendJson(res, 200, { ok: true, key: keyStatus(), model, ping: p, message: `key works \xB7 model ${model} \xB7 P=${p}%` });
        } catch (err) {
          return sendJson(res, 200, {
            ok: false,
            key: keyStatus(),
            message: `key rejected: ${toUserError(err).message}`
          });
        }
      }
      sendJson(res, 404, { error: `No route for ${method} ${path}` });
    } catch (err) {
      sendError(res, err);
    }
  }
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => done());
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const url = `http://${host}:${actualPort}/`;
  if (options.open !== false) openBrowser(url);
  return {
    url,
    close: () => new Promise((done) => {
      server.close(() => done());
    })
  };
}
async function findPort(start, host) {
  for (let port = start; port < start + 25; port++) {
    const free = await new Promise((done) => {
      const probe = createServer();
      probe.once("error", () => done(false));
      probe.once("listening", () => probe.close(() => done(true)));
      probe.listen(port, host);
    });
    if (free) return port;
  }
  throw new AppError("VALIDATION_ERROR", `No free port between ${start} and ${start + 25}.`);
}
function openBrowser(url) {
  const commands = process.platform === "darwin" ? [["open", [url]]] : process.platform === "win32" ? [["cmd", ["/c", "start", "", url]]] : [
    ["xdg-open", [url]],
    ["gio", ["open", url]],
    ["sensible-browser", [url]],
    ["x-www-browser", [url]]
  ];
  for (const [cmd, args] of commands) {
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => {
      });
      child.unref();
      return;
    } catch {
    }
  }
}
var APP_DIR, runtime, MAX_BODY_BYTES, CONTENT_TYPES;
var init_server = __esm({
  "src/ui/server.ts"() {
    "use strict";
    init_config();
    init_errors();
    init_jev();
    init_local();
    init_service2();
    init_service3();
    init_jd();
    init_semantic();
    init_scoring();
    init_version();
    APP_DIR = resolveAppDir();
    runtime = {};
    MAX_BODY_BYTES = 40 * 1024 * 1024;
    CONTENT_TYPES = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".json": "application/json; charset=utf-8",
      ".woff2": "font/woff2",
      ".png": "image/png"
    };
  }
});

// src/cli/index.ts
import { createRequire } from "node:module";
import { mkdir as mkdir2, readFile as readFile7, rm as rm4, stat as stat4, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename3, join as join6, resolve as resolve4 } from "node:path";
import { Command } from "commander";
var require2 = createRequire(import.meta.url);
var { config: loadDotenv } = require2("dotenv");
loadDotenv();
void (async () => {
  try {
    const home = process.env.RESUMERANK_HOME ?? join6(process.env.HOME ?? "", ".resumerank");
    const text = await readFile7(join6(home, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (process.env[m[1]] === void 0) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
  }
})();
var { config: config2, dataHome: dataHome2, ingestLanes: ingestLanes2, isOffline: isOffline2, paths: paths2 } = await Promise.resolve().then(() => (init_config(), config_exports));
var { AppError: AppError2, toUserError: toUserError2 } = await Promise.resolve().then(() => (init_errors(), errors_exports));
var { jevStatus: jevStatus2, stats: stats3, resetStats: resetStats2, systemOne: systemOne2, noul: noul2, answerCacheSize: answerCacheSize2 } = await Promise.resolve().then(() => (init_jev(), jev_exports));
var { ensureStore: ensureStore2, loadConfig: loadConfig2, saveConfig: saveConfig2, stats: storeStats, skillIndex: skillIndex2, getResume: getResume2, listResumes: listResumes2, shortId: shortId2 } = await Promise.resolve().then(() => (init_local(), local_exports));
var resumeService = await Promise.resolve().then(() => (init_service2(), service_exports));
var rankService = await Promise.resolve().then(() => (init_service3(), service_exports2));
var { analyzeJobDescription: analyzeJobDescription2 } = await Promise.resolve().then(() => (init_jd(), jd_exports));
var { matchRequirements: matchRequirements2 } = await Promise.resolve().then(() => (init_semantic(), semantic_exports));
var { deterministicScore: deterministicScore2, getRankingWeights: getRankingWeights2 } = await Promise.resolve().then(() => (init_scoring(), scoring_exports));
var { runEval: runEval2 } = await Promise.resolve().then(() => (init_harness(), harness_exports));
var { bold: bold2, cyan: cyan2, dim: dim2, formatDate: formatDate2, green: green2, pct: pct2, printJson: printJson2, red: red2, renderTable: renderTable2, truncate: truncate2, yellow: yellow2, bar: bar3 } = await Promise.resolve().then(() => (init_format(), format_exports));
var VERSION = "1.0.0";
var program = new Command();
program.name("resumerank").description(
  "Offline-first resume ranking. Data lives in local JSON files; the TypeSafe Jev layer (typed noul/choice/score answers) is optional and only used when a key is configured."
).version(VERSION, "-v, --version").option("--data-dir <dir>", "data directory (default: ~/.resumerank)").option("--offline", "never touch the network, even if a TypeSafe key is set").option("--verbose", "print progress and the Jev calls being made").showHelpAfterError();
function applyGlobalOptions() {
  const opts = program.opts();
  if (opts.dataDir) process.env.RESUMERANK_HOME = resolve4(opts.dataDir);
  if (opts.offline) process.env.RESUMERANK_OFFLINE = "1";
  if (opts.verbose) process.env.RESUMERANK_VERBOSE = "1";
}
async function bootstrap() {
  applyGlobalOptions();
  await ensureStore2();
  const stored = await loadConfig2();
  if (stored) {
    if (stored.typesafeApiKey && !process.env.TYPESAFE_API_KEY) {
      process.env.TYPESAFE_API_KEY = stored.typesafeApiKey;
    }
    if (stored.typesafeModel && !process.env.TYPESAFE_MODEL) process.env.TYPESAFE_MODEL = stored.typesafeModel;
  }
}
async function run(fn) {
  try {
    await fn();
  } catch (err) {
    const e = toUserError2(err);
    console.error(`${red2("error")}: ${e.message}`);
    process.exitCode = 1;
  }
}
function jevEnabled() {
  return config2.typesafe.enabled;
}
function isVerbose(local) {
  return local === true || program.opts().verbose === true || process.env.RESUMERANK_VERBOSE === "1";
}
program.command("init").description("Create the local data directory and (optionally) store a TypeSafe key").option("--api-key <key>", "TypeSafe API key (enables the Jev layer)").option("--model <model>", "TypeSafe model", "jev-latest").action(async (opts) => {
  await run(async () => {
    applyGlobalOptions();
    await ensureStore2();
    const previous = await loadConfig2() ?? {};
    const file = await saveConfig2({
      typesafeApiKey: opts.apiKey ?? previous.typesafeApiKey,
      typesafeModel: opts.model ?? previous.typesafeModel ?? "jev-latest",
      dataDir: dataHome2(),
      initialisedAt: previous.initialisedAt
    });
    console.log(`${green2("initialised")} ${file}`);
    console.log(`  data dir  ${dataHome2()}`);
    console.log(`  storage   ${paths2().resumes.replace(/resumes\.json$/, "")} (JSON, no database)`);
    console.log(`  Jev       ${jevStatus2()}`);
  });
});
program.command("add", { hidden: true }).description("Add resume files (PDF, DOCX or TXT)").argument("<files...>", "paths to resume files").option("--no-jev", "extract without the Jev layer (pure offline)").option("--json", "output JSON").action(async (files, opts) => {
  await run(async () => {
    await bootstrap();
    resetStats2();
    const records = [];
    const lanes = ingestLanes2(opts.jev && config2.typesafe.enabled, files.length);
    const queue = [...files];
    const worker = async () => {
      for (; ; ) {
        const file = queue.shift();
        if (!file) return;
        try {
          const record = await resumeService.addResumeFile(file, { jev: opts.jev });
          records.push(record);
          if (!opts.json) {
            const isDuplicate = record.quality.warnings.some((w) => w.startsWith("duplicate of"));
            console.log(
              `${isDuplicate ? yellow2("duplicate") : green2("added")} ${dim2(record.id.slice(0, 11))} ${truncate2(record.originalFilename, 40)} ${dim2(`(${record.extractedText.length} chars, ${record.metadata.skills?.length ?? 0} skills, ${record.metadata.yearsOfExperience ?? "?"} yrs, conf ${record.quality.extractionConfidence})`)}`
            );
            for (const warning of record.quality.warnings) console.log(`  ${yellow2("warn")} ${warning}`);
          }
        } catch (err) {
          console.error(`${red2("failed")} ${file}: ${toUserError2(err).message}`);
          process.exitCode = 1;
        }
      }
    };
    await Promise.all(Array.from({ length: lanes }, worker));
    if (opts.json) printJson2(records);
    else if (records.length > 0) console.log(dim2(`Jev: ${jevStatus2()} \xB7 ${stats3.calls} call(s)${stats3.cachedAnswers > 0 ? ` \xB7 ${stats3.cachedAnswers} cached answer(s)` : ""}`));
  });
});
program.command("list", { hidden: true }).description("List stored resumes").argument("[search]", "filter by filename, skill, role or text").option("--limit <n>", "maximum rows", "100").option("--json", "output JSON").action(async (search, opts) => {
  await run(async () => {
    await bootstrap();
    const rows = await resumeService.listResumeRecords(search, Number(opts.limit) || 100);
    if (opts.json) return printJson2(rows);
    if (rows.length === 0) {
      console.log("No resumes stored yet. Add some: resumerank add <file.pdf>");
      return;
    }
    console.log(
      renderTable2(
        ["ID", "FILE", "SKILLS", "YRS", "SENIORITY", "DOMAIN", "CONF", "ADDED"],
        rows.map((r) => [
          dim2(r.id.slice(0, 11)),
          truncate2(r.originalFilename, 34),
          String(r.metadata.skills?.length ?? 0),
          r.metadata.yearsOfExperience == null ? "-" : String(r.metadata.yearsOfExperience),
          truncate2(r.metadata.seniority ?? "-", 8),
          truncate2(r.metadata.domain ?? "-", 10),
          String(r.quality.extractionConfidence),
          dim2(formatDate2(r.createdAt))
        ])
      )
    );
  });
});
program.command("show", { hidden: true }).description("Show one stored resume in detail").argument("<resumeId>", "resume id (or its short prefix)").option("--json", "output JSON").option("--provenance", "show how each skill was accepted").action(async (id, opts) => {
  await run(async () => {
    await bootstrap();
    const record = await resumeService.getResumeRecord(id);
    if (opts.json) return printJson2(record);
    console.log(`${bold2(record.structured.fullName || record.originalFilename)}  ${dim2(record.id)}`);
    const meta = record.metadata;
    console.log(
      dim2(
        `${meta.roles?.slice(0, 3).join(", ") || "no roles"} \xB7 ${meta.yearsOfExperience ?? "?"} yrs \xB7 ${meta.seniority ?? "?"} \xB7 ${meta.domain ?? "?"} \xB7 conf ${record.quality.extractionConfidence}`
      )
    );
    const contact = record.structured.contact;
    if (contact.email || contact.phone || contact.location) {
      console.log(`contact   ${[contact.email, contact.phone, contact.location].filter(Boolean).join(" \xB7 ")}`);
    }
    console.log(`skills    ${(meta.skills ?? []).join(", ") || "-"}`);
    console.log(`education ${(meta.education ?? []).join(" | ") || "-"}`);
    console.log(`certs     ${(meta.certifications ?? []).join(", ") || "-"}`);
    console.log(`projects  ${(meta.projects ?? []).slice(0, 3).join(" | ") || "-"}`);
    if (record.structured.experience.length > 0) {
      console.log("\nexperience");
      for (const entry of record.structured.experience.slice(0, 6)) {
        const range = `${entry.startDate || "?"} \u2013 ${entry.isCurrent ? "present" : entry.endDate || "?"}`;
        console.log(`  ${truncate2(entry.role || "?", 32).padEnd(32)} ${truncate2(entry.company || "?", 28).padEnd(28)} ${dim2(range)}`);
      }
    }
    if (opts.provenance) {
      console.log("\nprovenance");
      for (const [skill, why] of Object.entries(record.provenance)) {
        const rejected = why.startsWith("rejected");
        console.log(`  ${rejected ? red2("\u2717") : green2("\u2713")} ${skill.padEnd(24)} ${dim2(why)}`);
      }
    }
  });
});
program.command("remove", { hidden: true }).description("Delete a stored resume").argument("<resumeId>", "resume id").action(async (id) => {
  await run(async () => {
    await bootstrap();
    const record = await resumeService.getResumeRecord(id);
    await resumeService.deleteResume(id);
    console.log(`${green2("removed")} ${record.originalFilename} ${dim2(record.id)}`);
  });
});
program.command("rank", { hidden: true }).description("Rank stored resumes against a job description").requiredOption("--title <title>", "job title").option("--jd <file>", "path to a job description file").option("--description <text>", "job description inline").option("--limit <n>", "how many finalists to keep", String(config2.ranking.finalLimit)).option("--include-mismatches", "also rank candidates the gate flagged as mismatches").option("--json", "output JSON").action(
  async (opts) => {
    await run(async () => {
      await bootstrap();
      resetStats2();
      const description = opts.jd ? await readFile7(opts.jd, "utf8") : opts.description;
      if (!description) {
        throw new AppError2("VALIDATION_ERROR", "Provide --jd <file> or --description <text>.");
      }
      const started = Date.now();
      const result = await rankService.rankJob({
        title: opts.title,
        description,
        offline: isOffline2(),
        includeMismatches: opts.includeMismatches,
        limit: Number(opts.limit) || config2.ranking.finalLimit
      });
      if (opts.json) return printJson2(result);
      console.log(`${bold2(result.jobTitle)}  ${dim2(result.rankingId)}`);
      console.log(
        dim2(
          `required: ${(result.requirements.requiredSkills ?? []).join(", ") || "-"}
preferred: ${(result.requirements.preferredSkills ?? []).join(", ") || "-"}
min experience: ${result.requirements.minimumExperience ?? "not stated"} \xB7 domain: ${(result.requirements.domain ?? []).join(", ") || "-"} \xB7 model: ${result.model}`
        )
      );
      if (result.fellBack) {
        console.log(
          `
${yellow2("no candidate cleared the mismatch gate")} \u2014 showing the closest instead; every row below is flagged MISMATCH (${dim2("rank --include-mismatches to silence this note")})`
        );
      }
      console.log("");
      console.log(
        renderTable2(
          ["#", "SCORE", "SEM", "JEV", "CANDIDATE", "TOP STRENGTHS"],
          result.results.map((r) => [
            String(r.rank),
            bold2(r.finalScore.toFixed(1)),
            r.semanticScore.toFixed(0),
            r.aiScore.toFixed(0),
            truncate2(r.originalFilename, 30),
            truncate2(r.analysis.strengths.join(", ") || "-", 40)
          ])
        )
      );
      if (result.excluded.length > 0) {
        console.log(`
${yellow2("excluded as mismatches")} (${result.excluded.length})`);
        for (const e of result.excluded) {
          console.log(`  ${truncate2(e.originalFilename, 34)} ${dim2(truncate2(e.reason, 70))}`);
        }
      }
      console.log(
        dim2(
          `
${Date.now() - started}ms \xB7 ${stats3.calls} Jev call(s)${stats3.cachedAnswers > 0 ? ` \xB7 ${stats3.cachedAnswers} cached` : ""} \xB7 ranking saved as ${result.rankingId}`
        )
      );
    });
  }
);
program.command("explain", { hidden: true }).description("Explain why one resume scored what it did for a job description").argument("<resumeId>", "resume id").requiredOption("--title <title>", "job title").option("--jd <file>", "path to a job description file").option("--description <text>", "job description inline").action(async (id, opts) => {
  await run(async () => {
    await bootstrap();
    const record = await resumeService.getResumeRecord(id);
    const description = opts.jd ? await readFile7(opts.jd, "utf8") : opts.description;
    if (!description) throw new AppError2("VALIDATION_ERROR", "Provide --jd <file> or --description <text>.");
    const requirements = analyzeJobDescription2(opts.title, description);
    const matches = await matchRequirements2(
      requirements.requiredSkills ?? [],
      record.canonicalSkills ?? record.metadata.skills ?? [],
      { jevAssist: jevEnabled(), jevState: { candidate_skills: record.canonicalSkills ?? [] } }
    );
    const result = deterministicScore2({
      requirements,
      metadata: record.metadata,
      resumeText: record.extractedText,
      skillMatches: matches,
      weights: getRankingWeights2()
    });
    console.log(`${bold2(record.originalFilename)} vs ${bold2(opts.title)}`);
    console.log(`score ${bold2(result.score.toFixed(1))}${result.mismatch ? red2("  MISMATCH") : ""}`);
    console.log(
      renderTable2(
        ["COMPONENT", "SCORE", ""],
        [
          ["required skills", String(result.breakdown.requiredSkills), bar3(result.breakdown.requiredSkills)],
          ["experience", String(result.breakdown.experience), bar3(result.breakdown.experience)],
          ["role similarity", String(result.breakdown.roleSimilarity), bar3(result.breakdown.roleSimilarity)],
          ["responsibilities", String(result.breakdown.responsibilities), bar3(result.breakdown.responsibilities)],
          ["domain", String(result.breakdown.domain), bar3(result.breakdown.domain)],
          ["preferred skills", String(result.breakdown.preferredSkills), bar3(result.breakdown.preferredSkills)]
        ]
      )
    );
    console.log("\nskill matches");
    for (const m of matches) {
      const icon = m.score >= 1 ? green2("\u2713") : m.score >= 0.6 ? green2("~") : m.score > 0 ? yellow2("\xB7") : red2("\u2717");
      console.log(`  ${icon} ${m.requirement.padEnd(26)} ${dim2(`${m.via} ${m.score.toFixed(2)} ${m.evidence}`)}`);
    }
    for (const reason of result.mismatchReasons) console.log(`  ${red2("mismatch")} ${reason}`);
  });
});
program.command("rankings", { hidden: true }).description("List saved rankings").option("--json", "output JSON").action(async (opts) => {
  await run(async () => {
    await bootstrap();
    const rows = await rankService.listRankings(50);
    if (opts.json) return printJson2(rows);
    if (rows.length === 0) {
      console.log("No rankings yet. Run: resumerank rank --title <title> --jd <file>");
      return;
    }
    console.log(
      renderTable2(
        ["ID", "TITLE", "CANDIDATES", "MODEL", "CREATED"],
        rows.map((r) => [
          dim2(r.id.slice(0, 11)),
          truncate2(r.jobTitle, 34),
          String(r.candidateCount),
          r.model,
          dim2(formatDate2(r.createdAt))
        ])
      )
    );
  });
});
program.command("show-ranking", { hidden: true }).description("Show a saved ranking in detail").argument("<rankingId>", "ranking id").option("--json", "output JSON").action(async (id, opts) => {
  await run(async () => {
    await bootstrap();
    const record = await rankService.getRanking(id);
    if (opts.json) return printJson2(record);
    console.log(
      `${bold2(record.jobTitle)}  ${dim2(record.id)}
` + dim2(`${formatDate2(record.createdAt)} \xB7 model ${record.model} \xB7 ${record.candidateCount} candidates scored`)
    );
    console.log("");
    console.log(
      renderTable2(
        ["#", "SCORE", "SEM", "JEV", "CANDIDATE"],
        record.results.map((r) => [
          String(r.rank),
          r.finalScore.toFixed(1),
          r.semanticScore.toFixed(0),
          r.aiScore.toFixed(0),
          truncate2(r.originalFilename, 34)
        ])
      )
    );
    for (const r of record.results) {
      console.log(`
${bold2(`#${r.rank} ${r.originalFilename}`)}`);
      console.log(`  strengths ${r.analysis.strengths.join(", ") || "-"}`);
      console.log(`  gaps      ${r.analysis.gaps.join(", ") || "-"}`);
      console.log(`  ${dim2(r.analysis.reasoning)}`);
    }
    if (record.excluded.length > 0) {
      console.log(`
${yellow2("excluded as mismatches")}`);
      for (const e of record.excluded) console.log(`  ${truncate2(e.originalFilename, 34)} ${dim2(e.reason)}`);
    }
  });
});
program.command("export", { hidden: true }).description("Export a ranking as JSON + CSV (and optionally Markdown)").argument("<rankingId>", "ranking id").option("--out <dir>", "output directory", ".").option("--md", "also write a Markdown report").action(async (id, opts) => {
  await run(async () => {
    await bootstrap();
    const record = await rankService.getRanking(id);
    const outDir = resolve4(opts.out);
    await mkdir2(outDir, { recursive: true });
    const base2 = join6(outDir, `ranking-${id.slice(0, 11)}`);
    await writeFile4(`${base2}.json`, `${JSON.stringify(record, null, 2)}
`);
    const escape = (v) => `"${v.replace(/"/g, '""')}"`;
    const header = "rank,score,semantic,jev,candidate,matched_required,missing_required";
    const lines = record.results.map(
      (r) => [
        r.rank,
        r.finalScore,
        r.semanticScore,
        r.aiScore,
        escape(r.originalFilename),
        escape(r.analysis.matchedRequirements.join("; ")),
        escape(r.analysis.missingRequirements.join("; "))
      ].join(",")
    );
    await writeFile4(`${base2}.csv`, `${[header, ...lines].join("\n")}
`);
    console.log(`wrote ${base2}.json`);
    console.log(`wrote ${base2}.csv`);
    if (opts.md) {
      const md = [
        `# ${record.jobTitle}`,
        "",
        `_${formatDate2(record.createdAt)} \xB7 ${record.candidateCount} candidates \xB7 model ${record.model}_`,
        "",
        `**Required:** ${(record.requirements.requiredSkills ?? []).join(", ") || "-"}`,
        "",
        "| # | Score | Candidate | Strengths | Gaps |",
        "| --- | --- | --- | --- | --- |",
        ...record.results.map(
          (r) => `| ${r.rank} | ${r.finalScore.toFixed(1)} | ${r.originalFilename} | ${r.analysis.strengths.join(", ")} | ${r.analysis.gaps.join(", ")} |`
        ),
        "",
        record.excluded.length > 0 ? `## Excluded as mismatches

${record.excluded.map((e) => `- ${e.originalFilename}: ${e.reason}`).join("\n")}` : "",
        ""
      ].join("\n");
      await writeFile4(`${base2}.md`, md);
      console.log(`wrote ${base2}.md`);
    }
  });
});
program.command("rm-ranking", { hidden: true }).description("Delete a saved ranking").argument("<rankingId>", "ranking id").action(async (id) => {
  await run(async () => {
    await bootstrap();
    const record = await rankService.getRanking(id);
    const { removeRanking: removeRanking2 } = await Promise.resolve().then(() => (init_local(), local_exports));
    await removeRanking2(record.id);
    console.log(`${green2("removed")} ranking ${record.jobTitle} ${dim2(record.id)}`);
  });
});
program.command("status", { hidden: true }).description("Show local state, storage size and Jev configuration").option("--json", "output JSON").action(async (opts) => {
  await run(async () => {
    await bootstrap();
    const s = await storeStats();
    const skills = await skillIndex2();
    const payload = {
      dataDir: dataHome2(),
      storage: "json-files (no database)",
      resumes: s.resumes,
      rankings: s.rankings,
      indexedSkills: s.skills,
      textChars: s.textChars,
      indexBytes: s.bytes,
      typesafe: { status: jevStatus2(), endpoint: config2.typesafe.endpoint },
      offline: isOffline2()
    };
    if (opts.json) return printJson2(payload);
    console.log(`data dir     ${dataHome2()}`);
    console.log(`storage      json files \xB7 index ${(s.bytes / 1024).toFixed(1)} KB \xB7 no database`);
    console.log(`resumes      ${s.resumes} (${s.textChars} chars of text)`);
    console.log(`rankings     ${s.rankings}`);
    console.log(`skill index  ${Object.keys(skills).length} distinct skills`);
    console.log(`Jev          ${jevStatus2()}`);
    console.log(`offline flag ${isOffline2() ? "on" : "off"}`);
  });
});
program.command("skills", { hidden: true }).description("Show the semantic skill index (canonical skills -> resumes)").option("--json", "output JSON").action(async (opts) => {
  await run(async () => {
    await bootstrap();
    const index = await skillIndex2();
    const rows = Object.entries(index).sort((a, b) => b[1].length - a[1].length);
    if (opts.json) return printJson2(index);
    const resumes = await listResumes2();
    const nameById = new Map(resumes.map((r) => [r.id, r.originalFilename]));
    console.log(
      renderTable2(
        ["SKILL", "#", "RESUMES"],
        rows.slice(0, 80).map(([skill, ids]) => [
          skill,
          String(ids.length),
          truncate2(ids.map((id) => nameById.get(id) ?? id.slice(0, 8)).join(", "), 60)
        ])
      )
    );
  });
});
program.command("cache", { hidden: true }).description("Inspect or clear the cached typed answers (makes re-runs identical and free)").option("--clear", "delete every cached answer").option("--json", "output JSON").action(async (opts) => {
  await run(async () => {
    await bootstrap();
    const file = paths2().jevCache;
    if (opts.clear) {
      await rm4(file, { force: true });
      if (opts.json) console.log(JSON.stringify({ cleared: true, file }));
      else console.log(`${green2("cleared")} ${dim2(file)}`);
      return;
    }
    const size = await answerCacheSize2();
    const info = await stat4(file).catch(() => null);
    if (opts.json) {
      console.log(JSON.stringify({ answers: size, file, bytes: info?.size ?? 0, updatedAt: info?.mtime.toISOString() ?? null }));
      return;
    }
    console.log(`${bold2("typed answer cache")} ${dim2(file)}`);
    console.log(`  answers   ${size}`);
    console.log(`  size      ${info ? `${(info.size / 1024).toFixed(1)} KB` : "empty"}`);
    console.log(`  updated   ${info ? info.mtime.toISOString() : "never"}`);
    console.log(
      dim2(
        "\nAnswers are keyed by (model, pool/JD, question), so re-running the same ranking is identical\nand costs nothing. RESUMERANK_FRESH=1 ignores the cache, RESUMERANK_NO_CACHE=1 disables it.\n"
      )
    );
  });
});
program.command("doctor", { hidden: true }).description("Check the environment: storage, network and the TypeSafe key").option("--json", "output JSON").action(async (opts) => {
  await run(async () => {
    await bootstrap();
    const checks = [];
    checks.push({ name: "data dir", ok: true, detail: dataHome2() });
    checks.push({
      name: "storage",
      ok: true,
      detail: `${(await storeStats()).resumes} resumes in local JSON (no database required)`
    });
    checks.push({ name: "offline mode", ok: true, detail: isOffline2() ? "forced on" : "off (will use Jev if keyed)" });
    if (!config2.typesafe.apiKey) {
      checks.push({ name: "TypeSafe key", ok: false, detail: "not set \u2014 running pure offline" });
    } else {
      try {
        const res = await systemOne2("The candidate built a REST API in Go.", {
          ping: noul2("Does this sentence mention a programming language?")
        });
        const p = res.answers["ping"]?.noul;
        checks.push({ name: "TypeSafe key", ok: true, detail: `valid \xB7 model ${res.model} \xB7 ping P=${p}` });
      } catch (err) {
        checks.push({ name: "TypeSafe key", ok: false, detail: toUserError2(err).message });
      }
    }
    if (opts.json) return printJson2({ checks });
    for (const check of checks) {
      const icon = check.ok === true ? green2("\u2713") : check.ok === false ? yellow2("!") : dim2("\xB7");
      console.log(`${icon} ${check.name.padEnd(14)} ${dim2(check.detail)}`);
    }
  });
});
program.command("eval", { hidden: true }).description("Measure extraction + ranking accuracy against a gold corpus").requiredOption("--corpus <dir>", "corpus directory (resumes/, jobs/, gold.json)").option("--offline", "measure the pure offline pipeline").option("--no-reset", "reuse the harness data directory instead of rebuilding it").option("--verbose", "print per-resume and per-job rows").option("--json", "output the full report as JSON").action(async (opts) => {
  await run(async () => {
    applyGlobalOptions();
    const report = await runEval2({
      corpus: opts.corpus,
      offline: opts.offline === true || isOffline2(),
      reset: opts.reset !== false,
      verbose: isVerbose(opts.verbose)
    });
    if (opts.json) return printJson2(report);
    const m = report.metrics;
    console.log(bold2(`
accuracy report \u2014 ${report.corpus} (${report.mode})`));
    console.log(
      dim2(`${report.resumes} resumes \xB7 ${report.jobs} jobs \xB7 composite target 90\u201395%
`)
    );
    console.log(
      renderTable2(
        ["METRIC", "VALUE", ""],
        [
          ["skill precision", pct2(m.skillPrecision), bar3(m.skillPrecision * 100, 20)],
          ["skill recall", pct2(m.skillRecall), bar3(m.skillRecall * 100, 20)],
          ["skill F1", pct2(m.skillF1), bar3(m.skillF1 * 100, 20)],
          ["years accuracy (\xB11y)", pct2(m.yearsAccuracy), bar3(m.yearsAccuracy * 100, 20)],
          ["JD skill F1", pct2(m.jdF1), bar3(m.jdF1 * 100, 20)],
          ["top-1 eligible", pct2(m.top1Accuracy), bar3(m.top1Accuracy * 100, 20)],
          ["eligible-in-top3", pct2(m.eligibleCoverage), bar3(m.eligibleCoverage * 100, 20)],
          ["false accepts", pct2(m.falseAcceptRate), m.falseAcceptRate === 0 ? green2("clean") : red2("leaks")],
          ["extraction accuracy", pct2(m.extractionAccuracy), bar3(m.extractionAccuracy * 100, 20)],
          ["ranking accuracy", pct2(m.rankingAccuracy), bar3(m.rankingAccuracy * 100, 20)],
          ["COMPOSITE", bold2(pct2(m.composite)), bar3(m.composite * 100, 20)]
        ]
      )
    );
    const forbidden = report.extraction.filter((r) => r.forbiddenHit.length > 0);
    if (forbidden.length > 0) {
      console.log(`
${red2("forbidden-skill leaks")}`);
      for (const row of forbidden) console.log(`  ${row.file}: ${row.forbiddenHit.join(", ")}`);
    }
    const leaked = report.ranking.filter((r) => r.leaked.length > 0);
    if (leaked.length > 0) {
      console.log(`
${red2("mismatched candidates ranked")}`);
      for (const row of leaked) console.log(`  ${row.job}: ${row.leaked.join(", ")}`);
    }
    const wrongTop1 = report.ranking.filter((r) => !r.top1Ok);
    if (wrongTop1.length > 0) {
      console.log(`
${yellow2("top-1 misses")}`);
      for (const row of wrongTop1) {
        console.log(`  ${row.job}: top1=${row.top1Got ?? "-"} expected one of [${row.eligible.join(", ")}]`);
      }
    }
    const weak = report.extraction.filter((r) => r.f1 < 0.85);
    if (weak.length > 0) {
      console.log(`
${yellow2("resumes below 0.85 skill F1")}`);
      for (const row of weak) {
        console.log(
          `  ${row.file.padEnd(34)} F1=${row.f1.toFixed(2)}${row.missing.length ? ` missing=[${row.missing.join(",")}]` : ""}${row.unexpected.length ? ` extra=[${row.unexpected.slice(0, 8).join(",")}]` : ""}`
        );
      }
    }
    console.log(
      m.composite >= 0.9 ? `
${green2("PASS")} composite ${pct2(m.composite)} \u2265 90%` : `
${yellow2("below target")} composite ${pct2(m.composite)} < 90%`
    );
    console.log(dim2(`report: resumerank eval --corpus ${opts.corpus} --json`));
  });
});
program.command("dashboard").alias("report").description("Write a self-contained HTML dashboard (one file, opens by double-click)").option("--out <file>", "where to write it", "resumerank-dashboard.html").option("--open", "open it in your browser when written").option("--json", "print the path as JSON").action(async (opts) => {
  await run(async () => {
    await bootstrap();
    const { loadDashData: loadDashData2 } = await Promise.resolve().then(() => (init_terminal(), terminal_exports));
    const { writeDashboardHtml: writeDashboardHtml2 } = await Promise.resolve().then(() => (init_export_html(), export_html_exports));
    const data = await loadDashData2();
    const file = resolve4(opts.out);
    await writeDashboardHtml2(file, data);
    if (opts.json) {
      console.log(JSON.stringify({ file, candidates: data.candidates.length, rankings: data.rankings.length }));
      return;
    }
    console.log(`${green2("wrote")} ${cyan2(file)}`);
    console.log(
      dim2(
        `  ${data.candidates.length} candidates \xB7 ${data.store.skills} skills \xB7 ${data.rankings.length} saved rankings
  self-contained: no server, no network, opens by double-click`
      )
    );
    if (opts.open) {
      const { spawn: spawn2 } = await import("node:child_process");
      spawn2("xdg-open", [file], { detached: true, stdio: "ignore" }).unref();
    }
  });
});
program.command("uninstall").description("Remove the app, the launcher and the menu entry (your data stays unless --purge)").option("--purge", "also delete the local store: resumes, texts, rankings, notes, config").option("--dry-run", "show what would be removed, change nothing").option("-y, --yes", "do not ask for confirmation").option("--json", "output JSON").action(async (opts) => {
  await run(async () => {
    const { applyUninstall: applyUninstall2, buildUninstallPlan: buildUninstallPlan2, defaultUninstallPaths: defaultUninstallPaths2, readInstallMarker: readInstallMarker2 } = await Promise.resolve().then(() => (init_uninstall(), uninstall_exports));
    const selfPath = process.argv[1] ?? "";
    const appDir = selfPath ? resolve4(selfPath, "..", "..") : process.cwd();
    const plan = await buildUninstallPlan2({ appDir, purgeData: opts.purge, ...defaultUninstallPaths2() });
    if (opts.dryRun || !opts.yes) {
      const marker = await readInstallMarker2(appDir);
      if (!opts.json) {
        console.log(
          `${bold2("resumerank uninstall")}${marker?.version ? dim2(`  (installed ${String(marker.version)})`) : ""}`
        );
        console.log("");
        for (const item of plan.candidates) {
          console.log(`${item.remove ? red2("\u2212") : dim2("\xB7")} ${item.kind.padEnd(14)} ${item.path}`);
          console.log(`  ${dim2(item.detail)}`);
        }
        console.log("");
        console.log(
          dim2(
            `  ${plan.willRemove.length} item(s) to remove \xB7 ${plan.keeping.length} kept
  your data: ${plan.dataDir}${opts.purge ? red2(" (will be deleted)") : " (kept \u2014 use --purge to delete)"}`
          )
        );
      }
    }
    if (opts.dryRun) {
      if (opts.json) console.log(JSON.stringify({ dryRun: true, willRemove: plan.willRemove, keeping: plan.keeping, dataDir: plan.dataDir }, null, 2));
      else console.log(`
${yellow2("dry run")} ${dim2("\u2014 nothing was changed")}`);
      return;
    }
    if (!opts.yes) {
      let go = false;
      if (process.stdin.isTTY && !opts.json) {
        const { createInterface } = await import("node:readline/promises");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(`
Remove ${plan.willRemove.length} item(s)? [y/N] `);
        rl.close();
        go = /^y(es)?$/i.test(answer.trim());
      }
      if (!go) {
        if (opts.json) console.log(JSON.stringify({ cancelled: true }));
        else console.log(dim2("cancelled \u2014 nothing was removed (pass --yes to skip this prompt)"));
        return;
      }
    }
    const { removed, failed } = await applyUninstall2(plan);
    if (opts.json) {
      console.log(JSON.stringify({ removed, failed, dataDir: plan.dataDir }));
      return;
    }
    for (const path of removed) console.log(`${green2("removed")} ${path}`);
    for (const item of failed) console.log(`${red2("failed")}  ${item.path}: ${item.error}`);
    console.log("");
    console.log(
      opts.purge ? `${green2("uninstalled")} ${dim2("\u2014 the app and your data are gone")}` : `${green2("uninstalled")} ${dim2(`\u2014 your data is still at ${plan.dataDir}`)}`
    );
  });
});
program.command("dash").alias("tui").description("Terminal dashboard: pool, rankings and ranking runs without a browser").option("--snapshot", "print one frame as plain text and exit").option("--view <view>", "overview | candidates | rankings | help", "overview").option("--width <n>", "force a frame width (snapshots)").option("--height <n>", "force a frame height (snapshots)").option("--no-color", "disable colour").option("--with-browser", "let `o` start the local web UI on demand").action(
  async (opts) => {
    await run(async () => {
      await bootstrap();
      const { runDashboard: runDashboard2 } = await Promise.resolve().then(() => (init_terminal(), terminal_exports));
      const view = ["overview", "candidates", "rankings", "help"].includes(opts.view ?? "") ? opts.view : "overview";
      const rank = async (_title, jdPath) => {
        const jd = await readFile7(jdPath, "utf8");
        const jobTitle = (jd.split("\n").find((l) => l.trim()) ?? "Role").replace(/^#+\s*/, "").trim();
        const started = Date.now();
        resetStats2();
        const result = await rankService.rankJob({
          title: jobTitle,
          description: jd,
          offline: isOffline2(),
          limit: 12
        });
        const ranked = result.results.filter((r) => r.rank > 0).sort((a, b) => a.rank - b.rank);
        return {
          title: jobTitle,
          model: `${result.model}${stats3.cachedAnswers > 0 ? ` \xB7 ${stats3.cachedAnswers} cached` : ""}`,
          elapsedMs: Date.now() - started,
          extra: `${ranked.length} ranked \xB7 ${result.mismatches.length} flagged or excluded \xB7 saved as ${result.rankingId}`,
          rows: ranked.map((r) => ({
            filename: r.originalFilename,
            score: r.finalScore,
            matched: r.analysis?.matchedRequirements?.length ?? 0,
            required: (r.analysis?.matchedRequirements?.length ?? 0) + (r.analysis?.missingRequirements?.length ?? 0),
            flags: (r.analysis?.mismatchReasons ?? []).join("; ")
          }))
        };
      };
      let browserStop = null;
      await runDashboard2({
        view,
        snapshot: opts.snapshot,
        width: opts.width ? Number(opts.width) : void 0,
        height: opts.height ? Number(opts.height) : void 0,
        color: opts.color !== false && !opts.snapshot,
        rank,
        openBrowser: opts.withBrowser ? async () => {
          const { startUi: startUi2 } = await Promise.resolve().then(() => (init_server(), server_exports));
          if (!browserStop) {
            const started = await startUi2({ port: 7777, host: "127.0.0.1", open: true });
            browserStop = started.close;
          }
          return "http://127.0.0.1:7777";
        } : void 0
      });
      if (browserStop) await browserStop();
    });
  }
);
program.command("ui").alias("web").description("Start the local web UI and open it in your browser").option("--port <n>", "port to listen on", "7777").option("--host <host>", "interface to bind", "127.0.0.1").option("--no-open", "do not launch a browser").action(async (opts) => {
  await run(async () => {
    await bootstrap();
    const { startUi: startUi2 } = await Promise.resolve().then(() => (init_server(), server_exports));
    const { url, close } = await startUi2({
      port: Number(opts.port) || 7777,
      host: opts.host,
      open: opts.open !== false
    });
    console.log(`${bold2("resumerank ui")}  ${cyan2(url)}`);
    console.log(
      dim2(
        `  data dir  ${dataHome2()}
  Jev       ${jevStatus2()}
  press Ctrl+C to stop`
      )
    );
    const stop = async () => {
      await close();
      process.exit(0);
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
  });
});
program.command("notes", { hidden: true }).description("List notes for a candidate").argument("<resumeId>", "resume id").option("--json", "output JSON").action(async (id, opts) => {
  await run(async () => {
    await bootstrap();
    const record = await resumeService.getResumeRecord(id);
    const { listNotes: listNotes2 } = await Promise.resolve().then(() => (init_local(), local_exports));
    const rows = await listNotes2(record.id);
    if (opts.json) return printJson2(rows);
    if (rows.length === 0) console.log(`No notes on ${record.originalFilename}.`);
    for (const note of rows) console.log(`${dim2(shortId2(note.id))}  ${dim2(formatDate2(note.createdAt))}
  ${note.content}`);
  });
});
program.command("note", { hidden: true }).description("Add a note to a candidate").argument("<resumeId>", "resume id").argument("<text...>", "note text").action(async (id, text) => {
  await run(async () => {
    await bootstrap();
    const record = await resumeService.getResumeRecord(id);
    const { addNote: addNote2 } = await Promise.resolve().then(() => (init_local(), local_exports));
    const note = await addNote2(record.id, text.join(" "));
    console.log(`${green2("note added")} ${dim2(shortId2(note.id))} \u2192 ${record.originalFilename}`);
  });
});
program.command("rm-note", { hidden: true }).description("Delete a note").argument("<noteId>", "note id").action(async (noteId) => {
  await run(async () => {
    await bootstrap();
    const { removeNote: removeNote2 } = await Promise.resolve().then(() => (init_local(), local_exports));
    const ok = await removeNote2(noteId);
    if (!ok) throw new AppError2("NOT_FOUND", `Note "${noteId}" not found.`);
    console.log(`${green2("removed")} note ${dim2(noteId)}`);
  });
});
program.command("version", { hidden: true }).description("Print the version").action(() => {
  console.log(VERSION);
});
if (process.argv.slice(2).length === 0) program.help();
program.addHelpText(
  "after",
  `
${dim2("Advanced commands (hidden here, still work):")} ${dim2("add, list, show, remove, rank, explain,\n")}${dim2("rankings, show-ranking, export, rm-ranking, status, skills, cache, doctor, eval, notes,\n")}${dim2("note, rm-note, version.")} ${dim2("They are documented in the README.")}
`
);
await program.parseAsync(process.argv);
