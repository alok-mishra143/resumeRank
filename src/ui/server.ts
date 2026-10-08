import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { spawn } from "node:child_process"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config, dataHome, ingestLanes, isOffline, paths } from "../config"
import { AppError, toUserError } from "../errors"
import { jevStatus, noul, noulPercent, resetStats, stats, systemOne } from "../ai/jev"
import {
  addNote,
  countNotes,
  ensureStore,
  getRanking,
  getResume,
  listNotes,
  listRankings,
  listResumes,
  loadConfig,
  originalFile,
  removeNote,
  removeRanking,
  removeResume,
  resumeText,
  saveConfig,
  searchResumes,
  shortId,
  skillIndex,
  stats as storeStats,
  updateNote,
} from "../store/local"
import { addResumeFromBuffer } from "../resumes/service"
import { rankJob } from "../ranking/service"
import { analyzeJobDescription } from "../ranking/jd"
import { matchRequirements } from "../ranking/semantic"
import { deterministicScore, getRankingWeights } from "../ranking/scoring"
import { JEV_VERSION } from "./version"

// ---------------------------------------------------------------------------
// Local web UI server. Node's http module only — no framework, no bundler, no
// build step. Serves one static single-page app plus a small JSON API that is a
// thin wrapper over the same services the CLI uses (so both stay in sync).
// ---------------------------------------------------------------------------

/**
 * Where the single-page app lives.
 *
 * From source (`tsx src/cli/index.ts ui`) it sits next to this file. From the
 * **bundled** `dist/resumerank.js` — which is what the installer ships — this
 * file has been inlined, so `./app` would point at `dist/app` and every request
 * would 404. Try each layout in turn and fail loudly instead of silently.
 */
function resolveAppDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const argv = process.argv[1] ? dirname(resolve(process.argv[1])) : ""
  const candidates = [
    join(here, "app"), // src/ui/app (source, or a copied bundle)
    join(here, "ui", "app"), // dist/../? keep for odd layouts
    join(argv, "app"), // dist/app if someone copies the assets
    join(argv, "..", "src", "ui", "app"), // repo and installed layout: dist/../src/ui/app
    join(argv, "..", "..", "src", "ui", "app"),
    join(process.cwd(), "src", "ui", "app"), // running from the project root
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return resolve(candidate)
  }
  return resolve(candidates[0] ?? ".")
}

const APP_DIR = resolveAppDir()

/** Runtime overrides toggled from the UI (they win over .env for this process). */
export const runtime: { offline?: boolean; model?: string; apiKey?: string } = {}

function applyRuntimeSettings(): void {
  if (runtime.offline !== undefined) process.env.RESUMERANK_OFFLINE = runtime.offline ? "1" : "0"
  if (runtime.model) process.env.TYPESAFE_MODEL = runtime.model
  if (runtime.apiKey !== undefined) process.env.TYPESAFE_API_KEY = runtime.apiKey
}

/**
 * Where the TypeSafe credential comes from, and a tail hint so a user can tell
 * which key is in use. The key itself is never sent to the browser.
 */
export function keyStatus(): { configured: boolean; source: "stored" | "environment" | "none"; hint: string } {
  const effective = (process.env.TYPESAFE_API_KEY ?? "").trim()
  if (!effective) return { configured: false, source: "none", hint: "" }
  const fromEnv = (process.env.RESUMERANK_KEY_FROM_ENV ?? "") === "1"
  return {
    configured: true,
    source: fromEnv ? "environment" : "stored",
    hint: effective.length > 4 ? `…${effective.slice(-4)}` : "…",
  }
}

const MAX_BODY_BYTES = 40 * 1024 * 1024
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  })
  res.end(body)
}

function sendError(res: ServerResponse, err: unknown): void {
  const user = toUserError(err)
  const status =
    user.code === "NOT_FOUND"
      ? 404
      : user.code === "VALIDATION_ERROR" || user.code === "UNSUPPORTED_FILE" || user.code === "EMPTY_RESUME"
        ? 400
        : 500
  sendJson(res, status, { error: user.message, code: user.code })
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new AppError("VALIDATION_ERROR", "Request body too large.")
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req)
  if (!raw.trim()) return {} as T
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be JSON.")
  }
}

function baseName(file: string): string {
  const i = file.lastIndexOf("/")
  return i >= 0 ? file.slice(i + 1) : file
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === "/" || urlPath === "" ? "index.html" : urlPath.replace(/^\/+/, "")
  const file = join(APP_DIR, rel)
  if (!file.startsWith(APP_DIR)) {
    res.writeHead(403).end("forbidden")
    return
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error("not a file")
    const body = await readFile(file)
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
    })
    res.end(body)
  } catch {
    // A missing shell is a broken install, not a missing page: say so.
    if (rel === "index.html" && !existsSync(join(APP_DIR, "index.html"))) {
      res
        .writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
        .end(`resumerank could not find its web UI assets (looked in ${APP_DIR}).\nReinstall with install.sh, or run from the project root.\n`)
      return
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found")
  }
}

// --- route handlers --------------------------------------------------------

async function apiStatus(): Promise<unknown> {
  const summary = await storeStats()
  const notes = await countNotes()
  return {
    version: JEV_VERSION,
    dataDir: dataHome(),
    storage: "local JSON files · no database",
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
      deterministicWeight: config.ranking.deterministicWeight,
    },
    files: { resumes: paths().resumes, rankings: paths().rankings },
  }
}

async function apiResumes(query: URLSearchParams): Promise<unknown> {
  const search = query.get("search") ?? ""
  const limit = Number(query.get("limit") ?? 500)
  const resumes = search ? await searchResumes(search, limit) : await listResumes()
  const notes = await countNotes()
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
    createdAt: r.createdAt,
  }))
}

async function apiResume(id: string): Promise<unknown> {
  const record = await getResume(id)
  if (!record) throw new AppError("NOT_FOUND", `Resume "${id}" not found.`)
  const notes = await listNotes(record.id)
  return { ...record, extractedText: undefined, textPreview: record.extractedText.slice(0, 2000), notes }
}

export interface UiOptions {
  port?: number
  open?: boolean
  host?: string
}

/** Start the local UI server; resolves once it is listening. */
export async function startUi(options: UiOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  await ensureStore()

  // A key already in the environment wins and is reported as such; otherwise the
  // stored key (set from Settings) is used, so the CLI and the UI agree.
  const fromEnv = (process.env.TYPESAFE_API_KEY ?? "").trim()
  if (fromEnv) {
    process.env.RESUMERANK_KEY_FROM_ENV = "1"
  } else {
    const stored = await loadConfig()
    if (stored?.typesafeApiKey) {
      runtime.apiKey = stored.typesafeApiKey
      applyRuntimeSettings()
    }
    if (stored?.typesafeModel && !process.env.TYPESAFE_MODEL) process.env.TYPESAFE_MODEL = stored.typesafeModel
  }

  const host = options.host ?? "127.0.0.1"
  const port = await findPort(options.port ?? 7777, host)

  const server = createServer((req, res) => {
    void handle(req, res)
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyRuntimeSettings()
    const url = new URL(req.url ?? "/", `http://${host}:${port}`)
    const path = url.pathname
    const method = req.method ?? "GET"
    try {
      if (!path.startsWith("/api/")) {
        await serveStatic(res, path)
        return
      }
      const query = url.searchParams

      if (path === "/api/status" && method === "GET") return sendJson(res, 200, await apiStatus())

      // The same self-contained HTML dashboard the CLI writes, so a non-technical
      // user can save or email a report straight from the app.
      if (path === "/api/dashboard.html" && method === "GET") {
        const { loadDashData } = await import("./terminal")
        const { renderDashboardHtml } = await import("./export-html")
        const html = renderDashboardHtml(await loadDashData())
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": 'attachment; filename="resumerank-dashboard.html"',
          "Cache-Control": "no-store",
        })
        res.end(html)
        return
      }

      if (path === "/api/resumes" && method === "GET") return sendJson(res, 200, await apiResumes(query))

      if (path === "/api/resumes/upload" && method === "POST") {
        const body = await readJsonBody<{ files?: Array<{ name: string; dataBase64: string }>; jev?: boolean }>(req)
        const files = body.files ?? []
        if (files.length === 0) throw new AppError("VALIDATION_ERROR", "No files in the request.")
        resetStats()
        const startedAt = Date.now()
        const useJev = body.jev !== false
        const results: Array<Record<string, unknown>> = new Array(files.length)
        // A bulk upload is the headline UI feature and each file costs 3-4 typed
        // calls, so files go through parallel lanes; order is preserved because
        // every result is written to its own slot.
        const lanes = ingestLanes(useJev && config.typesafe.enabled, files.length)
        const queue = files.map((file, index) => ({ file, index }))
        const worker = async (): Promise<void> => {
          for (;;) {
            const item = queue.shift()
            if (!item) return
            try {
              const buffer = Buffer.from(item.file.dataBase64, "base64")
              const record = await addResumeFromBuffer(item.file.name, buffer, { jev: useJev })
              results[item.index] = {
                ok: true,
                id: record.id,
                filename: record.originalFilename,
                skills: record.metadata.skills?.length ?? 0,
                years: record.metadata.yearsOfExperience ?? null,
                confidence: record.quality.extractionConfidence,
                warnings: record.quality.warnings,
                // The same resume uploaded twice returns the existing record.
                duplicate: record.quality.warnings.some((w) => w.startsWith("duplicate of")),
              }
            } catch (err) {
              results[item.index] = { ok: false, filename: item.file.name, error: toUserError(err).message }
            }
          }
        }
        await Promise.all(Array.from({ length: lanes }, worker))
        return sendJson(res, 200, { results, jevCalls: stats.calls, elapsedMs: Date.now() - startedAt })
      }

      const resumeMatch = path.match(/^\/api\/resumes\/([^/]+)(\/text|\/file)?$/)
      if (resumeMatch) {
        const id = decodeURIComponent(resumeMatch[1])
        const sub = resumeMatch[2]
        if (method === "GET" && !sub) return sendJson(res, 200, await apiResume(id))
        if (method === "GET" && sub === "/text") {
          const record = await getResume(id)
          if (!record) throw new AppError("NOT_FOUND", "Resume not found.")
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(record.extractedText)
          return
        }
        if (method === "GET" && sub === "/file") {
          const record = await getResume(id)
          if (!record) throw new AppError("NOT_FOUND", "Resume not found.")
          const file = await originalFile(record.id)
          if (!file) throw new AppError("NOT_FOUND", "Original file was not stored.")
          res
            .writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="${baseName(record.originalFilename)}"`,
              "Content-Length": file.data.length,
            })
            .end(file.data)
          return
        }
        if (method === "DELETE" && !sub) {
          await removeResume(id)
          return sendJson(res, 200, { ok: true })
        }
      }

      if (path === "/api/notes" && method === "GET") {
        return sendJson(res, 200, await listNotes(query.get("resumeId") ?? undefined))
      }
      if (path === "/api/notes" && method === "POST") {
        const body = await readJsonBody<{ resumeId?: string; content?: string }>(req)
        if (!body.resumeId || !body.content) throw new AppError("VALIDATION_ERROR", "resumeId and content required.")
        return sendJson(res, 200, await addNote(body.resumeId, body.content))
      }
      const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/)
      if (noteMatch) {
        const noteId = decodeURIComponent(noteMatch[1])
        if (method === "PATCH" || method === "PUT") {
          const body = await readJsonBody<{ content?: string }>(req)
          const updated = await updateNote(noteId, body.content ?? "")
          if (!updated) throw new AppError("NOT_FOUND", "Note not found.")
          return sendJson(res, 200, updated)
        }
        if (method === "DELETE") {
          const ok = await removeNote(noteId)
          if (!ok) throw new AppError("NOT_FOUND", "Note not found.")
          return sendJson(res, 200, { ok: true })
        }
      }

      if (path === "/api/jd" && method === "POST") {
        const body = await readJsonBody<{ title?: string; description?: string }>(req)
        const requirements = analyzeJobDescription(body.title ?? "", body.description ?? "")
        return sendJson(res, 200, { requirements })
      }

      if (path === "/api/rank" && method === "POST") {
        const body = await readJsonBody<{
          title?: string
          description?: string
          offline?: boolean
          includeMismatches?: boolean
          limit?: number
        }>(req)
        if (!body.description?.trim()) throw new AppError("VALIDATION_ERROR", "A job description is required.")
        resetStats()
        const started = Date.now()
        const result = await rankJob({
          title: body.title?.trim() || "Untitled role",
          description: body.description,
          offline: body.offline === true,
          includeMismatches: body.includeMismatches === true,
          limit: body.limit ?? config.ranking.finalLimit,
        })
        return sendJson(res, 200, {
          ...result,
          elapsedMs: Date.now() - started,
          jevCalls: stats.calls,
        })
      }

      if (path === "/api/rankings" && method === "GET") {
        return sendJson(res, 200, await listRankings(200))
      }
      const rankingMatch = path.match(/^\/api\/rankings\/([^/]+)(\/export)?$/)
      if (rankingMatch) {
        const id = decodeURIComponent(rankingMatch[1])
        if (method === "GET" && !rankingMatch[2]) {
          const record = await getRanking(id)
          if (!record) throw new AppError("NOT_FOUND", "Ranking not found.")
          return sendJson(res, 200, record)
        }
        if (method === "DELETE" && !rankingMatch[2]) {
          const ok = await removeRanking(id)
          if (!ok) throw new AppError("NOT_FOUND", "Ranking not found.")
          return sendJson(res, 200, { ok: true })
        }
        if (method === "GET" && rankingMatch[2]) {
          const record = await getRanking(id)
          if (!record) throw new AppError("NOT_FOUND", "Ranking not found.")
          const format = query.get("format") ?? "json"
          const stem = `ranking-${record.id.slice(0, 11)}`
          if (format === "csv") {
            const escape = (v: string): string => `"${v.replace(/"/g, '""')}"`
            const header = "rank,score,semantic,jev,candidate,matched_required,missing_required"
            const rows = record.results.map((r) =>
              [
                r.rank,
                r.finalScore,
                r.semanticScore,
                r.aiScore,
                escape(r.originalFilename),
                escape(r.analysis.matchedRequirements.join("; ")),
                escape(r.analysis.missingRequirements.join("; ")),
              ].join(","),
            )
            res
              .writeHead(200, {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${stem}.csv"`,
              })
              .end(`${[header, ...rows].join("\n")}\n`)
            return
          }
          if (format === "md") {
            const md = [
              `# ${record.jobTitle}`,
              "",
              `_${record.createdAt} · ${record.candidateCount} candidates · model ${record.model}_`,
              "",
              `**Required:** ${(record.requirements.requiredSkills ?? []).join(", ") || "-"}`,
              "",
              "| # | Score | Candidate | Matched | Missing |",
              "| --- | --- | --- | --- | --- |",
              ...record.results.map(
                (r) =>
                  `| ${r.rank} | ${r.finalScore.toFixed(1)} | ${r.originalFilename} | ${r.analysis.matchedRequirements.join(", ")} | ${r.analysis.missingRequirements.join(", ")} |`,
              ),
              "",
              record.excluded.length
                ? `## Excluded as mismatches\n\n${record.excluded.map((e) => `- ${e.originalFilename}: ${e.reason}`).join("\n")}`
                : "",
              "",
            ].join("\n")
            res
              .writeHead(200, {
                "Content-Type": "text/markdown; charset=utf-8",
                "Content-Disposition": `attachment; filename="${stem}.md"`,
              })
              .end(md)
            return
          }
          res
            .writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Content-Disposition": `attachment; filename="${stem}.json"`,
            })
            .end(`${JSON.stringify(record, null, 2)}\n`)
          return
        }
      }

      if (path === "/api/skills" && method === "GET") {
        const index = await skillIndex()
        const resumes = await listResumes()
        const nameById = new Map(resumes.map((r) => [r.id, r.originalFilename]))
        return sendJson(
          res,
          200,
          Object.entries(index)
            .map(([skill, ids]) => ({
              skill,
              count: ids.length,
              candidates: ids.map((id) => ({ id, filename: nameById.get(id) ?? id.slice(0, 8) })),
            }))
            .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill)),
        )
      }

      if (path === "/api/explain" && method === "POST") {
        const body = await readJsonBody<{ resumeId?: string; title?: string; description?: string }>(req)
        if (!body.resumeId) throw new AppError("VALIDATION_ERROR", "resumeId is required.")
        const record = await getResume(body.resumeId)
        if (!record) throw new AppError("NOT_FOUND", "Resume not found.")
        const requirements = analyzeJobDescription(body.title ?? "", body.description ?? "")
        const matches = await matchRequirements(
          requirements.requiredSkills ?? [],
          record.canonicalSkills ?? record.metadata.skills ?? [],
          { jevAssist: config.typesafe.enabled, jevState: { candidate_skills: record.canonicalSkills ?? [] } },
        )
        const score = deterministicScore({
          requirements,
          metadata: record.metadata,
          resumeText: record.extractedText,
          skillMatches: matches,
          weights: getRankingWeights(),
        })
        return sendJson(res, 200, { requirements, matches, ...score })
      }

      if (path === "/api/settings" && method === "POST") {
        const body = await readJsonBody<{ offline?: boolean; model?: string; apiKey?: string; clearKey?: boolean }>(req)
        if (typeof body.offline === "boolean") runtime.offline = body.offline
        if (typeof body.model === "string" && body.model.trim()) runtime.model = body.model.trim()

        // A key typed into Settings is stored in the data dir (mode 0600) and
        // applied immediately; it is never returned to the browser afterwards.
        if (typeof body.apiKey === "string" && body.apiKey.trim()) {
          const existing = (await loadConfig()) ?? {}
          await saveConfig({ ...existing, typesafeApiKey: body.apiKey.trim() })
          runtime.apiKey = body.apiKey.trim()
          delete process.env.RESUMERANK_KEY_FROM_ENV
        } else if (body.clearKey === true) {
          const existing = (await loadConfig()) ?? {}
          const { typesafeApiKey: _drop, ...rest } = existing
          await saveConfig(rest)
          runtime.apiKey = ""
          delete process.env.RESUMERANK_KEY_FROM_ENV
        }
        applyRuntimeSettings()
        return sendJson(res, 200, await apiStatus())
      }

      // Live check of the configured credential: one tiny typed question.
      if (path === "/api/jev/test" && method === "POST") {
        applyRuntimeSettings()
        if (!config.typesafe.enabled) {
          return sendJson(res, 200, {
            ok: false,
            key: keyStatus(),
            message: runtime.offline ?? isOffline() ? "offline mode is on" : "no key configured",
          })
        }
        try {
          const probe = await systemOne({ sentence: "Does this sentence mention a programming language?" }, {
            ping: noul("Does `sentence` mention a programming language?"),
          })
          const p = noulPercent(probe.answers, "ping")
          const model = probe.model ?? config.typesafe.model
          return sendJson(res, 200, { ok: true, key: keyStatus(), model, ping: p, message: `key works · model ${model} · P=${p}%` })
        } catch (err) {
          return sendJson(res, 200, {
            ok: false,
            key: keyStatus(),
            message: `key rejected: ${toUserError(err).message}`,
          })
        }
      }

      sendJson(res, 404, { error: `No route for ${method} ${path}` })
    } catch (err) {
      sendError(res, err)
    }
  }

  await new Promise<void>((done, fail) => {
    server.once("error", fail)
    server.listen(port, host, () => done())
  })

  // With --port 0 the OS picks a free port; report what we actually got.
  const address = server.address()
  const actualPort = typeof address === "object" && address !== null ? address.port : port
  const url = `http://${host}:${actualPort}/`
  if (options.open !== false) openBrowser(url)

  return {
    url,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done())
      }),
  }
}

async function findPort(start: number, host: string): Promise<number> {
  for (let port = start; port < start + 25; port++) {
    const free = await new Promise<boolean>((done) => {
      const probe = createServer()
      probe.once("error", () => done(false))
      probe.once("listening", () => probe.close(() => done(true)))
      probe.listen(port, host)
    })
    if (free) return port
  }
  throw new AppError("VALIDATION_ERROR", `No free port between ${start} and ${start + 25}.`)
}

/** Open the default browser, tolerating every desktop quirk. */
export function openBrowser(url: string): void {
  const commands: Array<[string, string[]]> =
    process.platform === "darwin"
      ? [["open", [url]]]
      : process.platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [
            ["xdg-open", [url]],
            ["gio", ["open", url]],
            ["sensible-browser", [url]],
            ["x-www-browser", [url]],
          ]
  for (const [cmd, args] of commands) {
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true })
      child.on("error", () => {})
      child.unref()
      return
    } catch {
      /* try the next opener */
    }
  }
}
