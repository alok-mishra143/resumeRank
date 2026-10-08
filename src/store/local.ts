import { chmod, copyFile, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { paths } from "../config"
import { AppError } from "../errors"
import type { RankingRecord, RankingSummary, ResumeRecord } from "../types"

// ---------------------------------------------------------------------------
// Local JSON store. No database, no server: a handful of files under
// ~/.resumerank, written atomically, with an in-memory cache and an inverted
// skill index so retrieval stays O(matches) instead of O(all resumes).
//
// Every mutation takes a lock (in-process queue + a lock file, so a CLI run and
// the running UI cannot interleave). Concurrent extraction lanes are the reason
// this exists: without it two lanes doing read-modify-write on resumes.json
// clobber each other and the file ends up truncated.
//
//   ~/.resumerank/resumes.json   index of resume metadata (small, fast)
//   ~/.resumerank/text/<id>.txt  extracted resume text (loaded on demand)
//   ~/.resumerank/files/<id>.*   the original uploaded file
//   ~/.resumerank/rankings.json  saved rankings (results inline)
//   ~/.resumerank/skills.json    inverted index: canonical skill -> resume ids
//   ~/.resumerank/config.json    configuration written by `resumerank init`
// ---------------------------------------------------------------------------

export type ResumeSummary = Omit<ResumeRecord, "extractedText"> & { textChars: number }

interface CacheEntry<T> {
  mtimeMs: number
  value: T
}

const cache = new Map<string, CacheEntry<unknown>>()
const textCache = new Map<string, string>()

let tempCounter = 0
let writeQueue: Promise<unknown> = Promise.resolve()

/** Serialises store mutations inside this process. */
function inProcessLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn)
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Serialises store mutations across processes (the CLI and the UI can overlap). */
async function acquireFileLock(lockPath: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      const handle = await open(lockPath, "wx")
      await handle.writeFile(String(process.pid), "utf8")
      await handle.close()
      return async () => {
        await unlink(lockPath).catch(() => {})
      }
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err
      // Steal a lock left behind by a crashed process.
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > 15_000) {
          await unlink(lockPath).catch(() => {})
          continue
        }
      } catch {
        continue
      }
      if (Date.now() > deadline) {
        await unlink(lockPath).catch(() => {})
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 25))
    }
  }
}

/** Run a read-modify-write against the store with mutual exclusion. */
export async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  return inProcessLock(async () => {
    await ensureStore()
    const release = await acquireFileLock(join(paths().home, ".store.lock"))
    try {
      return await fn()
    } finally {
      await release()
    }
  })
}

export async function ensureStore(): Promise<void> {
  const p = paths()
  await mkdir(p.home, { recursive: true })
  await mkdir(p.files, { recursive: true })
  await mkdir(join(p.home, "text"), { recursive: true })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  let st
  try {
    st = await stat(file)
  } catch {
    return fallback
  }
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.value as T
  try {
    const raw = await readFile(file, "utf8")
    const value = JSON.parse(raw) as T
    cache.set(file, { mtimeMs: st.mtimeMs, value })
    return value
  } catch (err) {
    // Fall back to the last known-good copy rather than losing the whole store.
    const backup = await readFile(`${file}.bak`, "utf8").catch(() => null)
    if (backup) {
      try {
        const value = JSON.parse(backup) as T
        cache.set(file, { mtimeMs: st.mtimeMs, value })
        console.warn(`warn ${file} was unreadable; recovered the previous copy (${err instanceof Error ? err.message : String(err)})`)
        return value
      } catch {
        /* the backup is unusable too */
      }
    }
    throw new AppError("STORE_ERROR", `Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Backups are the recovery net for a truncated store, but copying on every write
// is expensive once a file grows (the ranking history). One copy per file per
// window is still a usable net and keeps writes cheap.
const BACKUP_INTERVAL_MS = 10_000
const lastBackupAt = new Map<string, number>()

async function maybeBackup(file: string, payload: string): Promise<void> {
  const now = Date.now()
  const last = lastBackupAt.get(file) ?? 0
  const hasBackup = await stat(`${file}.bak`).then(
    () => true,
    () => false,
  )
  // Always keep at least one recovery copy; refresh it at most every window after.
  if (hasBackup && now - last < BACKUP_INTERVAL_MS) return
  lastBackupAt.set(file, now)
  const info = await stat(file).catch(() => null)
  // First ever write: the store has no previous state, so the new content is the
  // only thing a recovery could fall back to.
  if (!info) {
    await writeFile(`${file}.bak`, payload, "utf8").catch(() => {})
    return
  }
  await copyFile(file, `${file}.bak`).catch(() => {})
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const payload = `${JSON.stringify(value, null, 0)}\n`
  // Never replace a good store with an unserialisable one. Re-parsing a large
  // payload costs more than it protects (JSON.stringify already succeeded), so
  // the check is limited to the small, frequently written files.
  if (payload.length <= 262_144) JSON.parse(payload)
  tempCounter += 1
  // Unique per write: two writers sharing one temp name is how a store gets
  // truncated (the first rename wins and the second rename fails).
  const tmp = `${file}.${process.pid}.${tempCounter}.tmp`
  await writeFile(tmp, payload, "utf8")
  await maybeBackup(file, payload)
  await rename(tmp, file)
  cache.delete(file)
}

/** Stable fingerprint of a resume's text (whitespace-insensitive). */
export function contentHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 32)
}

export function newId(prefix: string): string {
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${now}${rand}`
}

export function shortId(id: string): string {
  const i = id.indexOf("_")
  return i >= 0 ? id.slice(i + 1, i + 9) : id.slice(0, 8)
}

interface ResumeIndex {
  version: number
  updatedAt: string
  resumes: ResumeSummary[]
}

interface RankingIndex {
  version: number
  updatedAt: string
  rankings: RankingRecord[]
}

interface SkillIndex {
  version: number
  updatedAt: string
  skills: Record<string, string[]>
}

const EMPTY_RESUMES: ResumeIndex = { version: 1, updatedAt: "", resumes: [] }
const EMPTY_RANKINGS: RankingIndex = { version: 1, updatedAt: "", rankings: [] }

async function loadResumeIndex(): Promise<ResumeIndex> {
  return readJson<ResumeIndex>(paths().resumes, EMPTY_RESUMES)
}

async function saveResumeIndex(index: ResumeIndex): Promise<void> {
  index.updatedAt = new Date().toISOString()
  await writeJsonAtomic(paths().resumes, index)
}

async function loadRankingIndex(): Promise<RankingIndex> {
  return readJson<RankingIndex>(paths().rankings, EMPTY_RANKINGS)
}

async function rebuildSkillIndex(resumes: ResumeSummary[]): Promise<void> {
  const skills: Record<string, string[]> = {}
  for (const resume of resumes) {
    for (const skill of resume.canonicalSkills ?? []) {
      const bucket = skills[skill] ?? (skills[skill] = [])
      bucket.push(resume.id)
    }
  }
  await writeJsonAtomic(paths().home ? join(paths().home, "skills.json") : "skills.json", {
    version: 1,
    updatedAt: new Date().toISOString(),
    skills,
  } satisfies SkillIndex)
}

export async function skillIndex(): Promise<Record<string, string[]>> {
  const idx = await readJson<SkillIndex>(join(paths().home, "skills.json"), {
    version: 1,
    updatedAt: "",
    skills: {},
  })
  return idx.skills
}

// --- resumes ---------------------------------------------------------------

export async function listResumes(): Promise<ResumeSummary[]> {
  const index = await loadResumeIndex()
  return [...index.resumes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function matchesId(candidate: string, query: string): boolean {
  const q = query.trim()
  if (!q) return false
  if (candidate === q) return true
  if (shortId(candidate) === q) return true
  if (candidate.startsWith(q) || shortId(candidate).startsWith(q)) return true
  return false
}

export async function getResume(id: string): Promise<ResumeRecord | null> {
  const index = await loadResumeIndex()
  const summary = index.resumes.find((r) => matchesId(r.id, id))
  if (!summary) return null
  const text = await resumeText(summary.id)
  const { textChars: _textChars, ...rest } = summary
  return { ...rest, extractedText: text }
}

export async function resumeText(id: string): Promise<string> {
  const cached = textCache.get(id)
  if (cached !== undefined) return cached
  try {
    const text = await readFile(join(paths().home, "text", `${id}.txt`), "utf8")
    textCache.set(id, text)
    return text
  } catch {
    return ""
  }
}

export async function addResume(record: ResumeRecord): Promise<void> {
  await withStoreLock(async () => {
    const index = await loadResumeIndex()
    index.resumes = index.resumes.filter((r) => r.id !== record.id)
    const { extractedText, ...rest } = record
    index.resumes.push({ ...rest, textChars: extractedText.length })
    await saveResumeIndex(index)
    await writeFile(join(paths().home, "text", `${record.id}.txt`), extractedText, "utf8")
    textCache.set(record.id, extractedText)
    await rebuildSkillIndex(index.resumes)
  })
}

/**
 * Find an existing resume whose extracted text matches, so re-uploading the same
 * file does not silently double the candidate pool. Records written before this
 * existed have no stored hash, so their text is hashed on demand (bounded by the
 * store size) and the result is kept in memory for the rest of the run.
 */
export async function findByContentHash(text: string): Promise<ResumeSummary | null> {
  const hash = contentHash(text)
  const index = await loadResumeIndex()
  for (const row of index.resumes) {
    if (row.contentHash) {
      if (row.contentHash === hash) return row
      continue
    }
    const existing = await resumeText(row.id)
    if (existing && contentHash(existing) === hash) {
      row.contentHash = hash
      return row
    }
  }
  return null
}

export async function saveOriginalFile(id: string, filename: string, data: Buffer): Promise<void> {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : ""
  await writeFile(join(paths().files, `${id}${ext}`), data)
}

export async function originalFile(id: string): Promise<{ path: string; data: Buffer } | null> {
  const { readdir } = await import("node:fs/promises")
  const entries = await readdir(paths().files).catch(() => [] as string[])
  const match = entries.find((f) => f.startsWith(`${id}.`))
  if (!match) return null
  const full = join(paths().files, match)
  return { path: full, data: await readFile(full) }
}

export async function removeResume(id: string): Promise<boolean> {
  return withStoreLock(async () => {
    const index = await loadResumeIndex()
    const target = index.resumes.find((r) => matchesId(r.id, id))
    if (!target) return false
    index.resumes = index.resumes.filter((r) => r.id !== target.id)
    await saveResumeIndex(index)
    await rm(join(paths().home, "text", `${target.id}.txt`), { force: true })
    const original = await originalFile(target.id)
    if (original) await rm(original.path, { force: true })
    textCache.delete(target.id)
    // Notes belong to the candidate: drop them with the record.
    const notes = await readJson<NoteIndex>(notesFile(), EMPTY_NOTES)
    if (notes.notes.some((n) => n.resumeId === target.id)) {
      notes.notes = notes.notes.filter((n) => n.resumeId !== target.id)
      notes.updatedAt = new Date().toISOString()
      await writeJsonAtomic(notesFile(), notes)
    }
    await rebuildSkillIndex(index.resumes)
    return true
  })
}

/** Substring search across filename, skills, roles and (on demand) full text. */
export async function searchResumes(query: string, limit = 50): Promise<ResumeSummary[]> {
  const all = await listResumes()
  const q = query.trim().toLowerCase()
  if (!q) return all.slice(0, limit)
  const tokens = q.split(/\s+/).filter(Boolean)
  const scored: Array<{ resume: ResumeSummary; hits: number }> = []
  for (const resume of all) {
    const meta = [
      resume.originalFilename,
      ...(resume.metadata.skills ?? []),
      ...(resume.metadata.roles ?? []),
      ...(resume.metadata.education ?? []),
      ...(resume.metadata.projects ?? []),
      ...(resume.metadata.certifications ?? []),
    ]
      .join(" ")
      .toLowerCase()
    let hits = tokens.filter((t) => meta.includes(t)).length
    if (hits === 0) {
      const text = await resumeText(resume.id)
      hits = tokens.filter((t) => text.toLowerCase().includes(t)).length
    }
    if (hits > 0) scored.push({ resume, hits })
  }
  scored.sort((a, b) => b.hits - a.hits || b.resume.createdAt.localeCompare(a.resume.createdAt))
  return scored.slice(0, limit).map((s) => s.resume)
}

// --- rankings --------------------------------------------------------------

export async function listRankings(limit = 30): Promise<RankingSummary[]> {
  const index = await loadRankingIndex()
  return index.rankings
    .map((r) => ({
      id: r.id,
      jobTitle: r.jobTitle,
      candidateCount: r.candidateCount,
      model: r.model,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

export async function getRanking(id: string): Promise<RankingRecord | null> {
  const index = await loadRankingIndex()
  return index.rankings.find((r) => matchesId(r.id, id)) ?? null
}

export async function addRanking(record: RankingRecord): Promise<void> {
  await withStoreLock(async () => {
    const index = await loadRankingIndex()
    index.rankings = index.rankings.filter((r) => r.id !== record.id)
    index.rankings.push(record)
    // Results are stored inline, so the history is bounded to keep reads, writes
    // and the UI list fast; the UI shows 30 anyway.
    const MAX_RANKINGS = 50
    if (index.rankings.length > MAX_RANKINGS) {
      index.rankings = index.rankings
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_RANKINGS)
    }
    index.updatedAt = new Date().toISOString()
    await writeJsonAtomic(paths().rankings, index)
  })
}

export async function removeRanking(id: string): Promise<boolean> {
  return withStoreLock(async () => {
    const index = await loadRankingIndex()
    const target = index.rankings.find((r) => matchesId(r.id, id))
    if (!target) return false
    index.rankings = index.rankings.filter((r) => r.id !== target.id)
    index.updatedAt = new Date().toISOString()
    await writeJsonAtomic(paths().rankings, index)
    return true
  })
}

// --- notes -----------------------------------------------------------------

export interface CandidateNote {
  id: string
  resumeId: string
  content: string
  createdAt: string
  updatedAt: string
}

interface NoteIndex {
  version: number
  updatedAt: string
  notes: CandidateNote[]
}

const EMPTY_NOTES: NoteIndex = { version: 1, updatedAt: "", notes: [] }

function notesFile(): string {
  return join(paths().home, "notes.json")
}

export async function listNotes(resumeId?: string): Promise<CandidateNote[]> {
  const index = await readJson<NoteIndex>(notesFile(), EMPTY_NOTES)
  const notes = resumeId ? index.notes.filter((n) => n.resumeId === resumeId) : index.notes
  return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function countNotes(): Promise<Record<string, number>> {
  const index = await readJson<NoteIndex>(notesFile(), EMPTY_NOTES)
  const counts: Record<string, number> = {}
  for (const note of index.notes) counts[note.resumeId] = (counts[note.resumeId] ?? 0) + 1
  return counts
}

export async function addNote(resumeId: string, content: string): Promise<CandidateNote> {
  const trimmed = content.trim()
  if (!trimmed) throw new AppError("VALIDATION_ERROR", "A note cannot be empty.")
  return withStoreLock(async () => {
    const index = await readJson<NoteIndex>(notesFile(), EMPTY_NOTES)
    const now = new Date().toISOString()
    const note: CandidateNote = { id: newId("nt"), resumeId, content: trimmed.slice(0, 4000), createdAt: now, updatedAt: now }
    index.notes.push(note)
    index.updatedAt = now
    await writeJsonAtomic(notesFile(), index)
    return note
  })
}

export async function updateNote(noteId: string, content: string): Promise<CandidateNote | null> {
  const trimmed = content.trim()
  if (!trimmed) throw new AppError("VALIDATION_ERROR", "A note cannot be empty.")
  return withStoreLock(async () => {
    const index = await readJson<NoteIndex>(notesFile(), EMPTY_NOTES)
    const note = index.notes.find((n) => n.id === noteId || n.id.endsWith(noteId))
    if (!note) return null
    note.content = trimmed.slice(0, 4000)
    note.updatedAt = new Date().toISOString()
    index.updatedAt = note.updatedAt
    await writeJsonAtomic(notesFile(), index)
    return note
  })
}

export async function removeNote(noteId: string): Promise<boolean> {
  return withStoreLock(async () => {
    const index = await readJson<NoteIndex>(notesFile(), EMPTY_NOTES)
    const before = index.notes.length
    index.notes = index.notes.filter((n) => n.id !== noteId && !n.id.endsWith(noteId))
    if (index.notes.length === before) return false
    index.updatedAt = new Date().toISOString()
    await writeJsonAtomic(notesFile(), index)
    return true
  })
}

// --- config ----------------------------------------------------------------

export interface StoredConfig {
  typesafeApiKey?: string
  typesafeModel?: string
  dataDir?: string
  initialisedAt?: string
}

export async function loadConfig(): Promise<StoredConfig | null> {
  try {
    return JSON.parse(await readFile(paths().config, "utf8")) as StoredConfig
  } catch {
    return null
  }
}

export async function saveConfig(config: StoredConfig): Promise<string> {
  const file = paths().config
  await withStoreLock(async () => {
    await writeJsonAtomic(file, { ...config, initialisedAt: config.initialisedAt ?? new Date().toISOString() })
  })
  // config.json can hold a TypeSafe API key: keep it readable by this user only.
  try {
    await chmod(file, 0o600)
  } catch {
    /* best effort — a filesystem without POSIX modes still works */
  }
  return file
}

export interface StoreStats {
  resumes: number
  rankings: number
  skills: number
  textChars: number
  bytes: number
  home: string
}

export async function stats(): Promise<StoreStats> {
  const resumes = await listResumes()
  const rankings = await listRankings(1000)
  const skills = await skillIndex()
  let bytes = 0
  for (const file of [paths().resumes, paths().rankings, join(paths().home, "skills.json")]) {
    try {
      bytes += (await stat(file)).size
    } catch {
      /* missing file counts as 0 */
    }
  }
  return {
    resumes: resumes.length,
    rankings: rankings.length,
    skills: Object.keys(skills).length,
    textChars: resumes.reduce((n, r) => n + (r.textChars ?? 0), 0),
    bytes,
    home: paths().home,
  }
}
