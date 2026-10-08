import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// The API is exercised for real: a scratch data dir, a real server on a free
// port, real HTTP calls, and the Jev layer switched off so the suite is offline.

const home = mkdtempSync(join(tmpdir(), "resumerank-ui-"))
process.env.RESUMERANK_HOME = home
process.env.RESUMERANK_OFFLINE = "1"
delete process.env.TYPESAFE_API_KEY

let base = ""
let closeServer: () => Promise<void> = async () => {}

const RESUME = `MAYA OKONKWO
Backend Engineer
maya@example.com | +1 415 555 0134 | Austin, TX

SUMMARY
Backend engineer with 6 years of experience building payment services.

EXPERIENCE
Senior Backend Engineer — Cedar Pay
Jan 2020 – Present
- Built a ledger service in Go and PostgreSQL handling 4k rps.
- Ran the Kubernetes migration for 12 services on AWS.

SKILLS
Go, PostgreSQL, Kubernetes, AWS, Docker, Kafka, Redis, Python

EDUCATION
M.Sc. Computer Science - Technical University of Munich - 2017
`

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* keep the raw text (CSV / Markdown / plain text responses) */
  }
  return { status: res.status, body }
}

beforeAll(async () => {
  const { startUi } = await import("../src/ui/server")
  const started = await startUi({ port: 0, open: false })
  base = started.url.replace(/\/$/, "")
  closeServer = started.close
})

afterAll(async () => {
  await closeServer()
})

describe("local UI server", () => {
  it("serves the app shell", async () => {
    const res = await fetch(`${base}/`)
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain("resumerank")
    expect(html).toContain("/app.js")
    expect((await fetch(`${base}/app.css`)).status).toBe(200)
    expect((await fetch(`${base}/app.js`)).status).toBe(200)
  })

  it("reports status", async () => {
    const { status, body } = await api("/api/status")
    expect(status).toBe(200)
    expect(body.storage).toContain("JSON")
    expect(body.offline).toBe(true)
    expect(body.jev.online).toBe(false)
  })

  it("uploads a resume as base64 and lists it", async () => {
    const upload = await api("/api/resumes/upload", {
      method: "POST",
      body: JSON.stringify({
        files: [{ name: "maya.txt", dataBase64: Buffer.from(RESUME, "utf8").toString("base64") }],
        jev: false,
      }),
    })
    expect(upload.status).toBe(200)
    expect(upload.body.results[0].ok).toBe(true)

    const list = await api("/api/resumes")
    expect(list.body).toHaveLength(1)
    const row = list.body[0]
    expect(row.filename).toBe("maya.txt")
    expect(row.skills).toEqual(expect.arrayContaining(["Go", "Kubernetes", "AWS"]))
    expect(row.years).toBe(6)
  })

  it("rejects an unsupported file with a readable error", async () => {
    const bad = await api("/api/resumes/upload", {
      method: "POST",
      body: JSON.stringify({ files: [{ name: "photo.png", dataBase64: Buffer.from("nope").toString("base64") }] }),
    })
    expect(bad.status).toBe(200)
    expect(bad.body.results[0].ok).toBe(false)
    expect(bad.body.results[0].error).toMatch(/Unsupported file type/)
  })

  it("adds, edits and deletes a candidate note", async () => {
    const list = await api("/api/resumes")
    const id = list.body[0].id

    const created = await api("/api/notes", { method: "POST", body: JSON.stringify({ resumeId: id, content: "Great Go depth." }) })
    expect(created.status).toBe(200)
    expect(created.body.content).toBe("Great Go depth.")

    const forResume = await api(`/api/notes?resumeId=${id}`)
    expect(forResume.body).toHaveLength(1)

    const edited = await api(`/api/notes/${created.body.id}`, { method: "PATCH", body: JSON.stringify({ content: "Great Go depth, wants remote." }) })
    expect(edited.body.content).toContain("remote")

    const detail = await api(`/api/resumes/${id}`)
    expect(detail.body.notes).toHaveLength(1)
    expect(detail.body.notes[0].content).toContain("remote")

    const removed = await api(`/api/notes/${created.body.id}`, { method: "DELETE" })
    expect(removed.status).toBe(200)
    expect((await api(`/api/notes?resumeId=${id}`)).body).toHaveLength(0)
  })

  it("parses job requirements without spending a Jev call", async () => {
    const { status, body } = await api("/api/jd", {
      method: "POST",
      body: JSON.stringify({
        title: "Senior Backend Engineer",
        description: "## Requirements\n- 5+ years of backend experience\n- Strong Go or Python\n- Kubernetes and AWS\n\n## Nice to have\n- Terraform",
      }),
    })
    expect(status).toBe(200)
    expect(body.requirements.requiredSkills).toEqual(expect.arrayContaining(["Go", "Kubernetes", "AWS"]))
    expect(body.requirements.minimumExperience).toBe(5)
  })

  it("ranks offline, saves the run and exports it", async () => {
    const ranked = await api("/api/rank", {
      method: "POST",
      body: JSON.stringify({
        title: "Senior Backend Engineer",
        description: "Requirements: Go, PostgreSQL, Kubernetes, AWS, Kafka. 5+ years.",
        offline: true,
      }),
    })
    expect(ranked.status).toBe(200)
    expect(ranked.body.results.length).toBeGreaterThan(0)
    expect(ranked.body.model).toBe("offline")
    expect(typeof ranked.body.candidateCount).toBe("number")
    const rankingId = ranked.body.rankingId

    const saved = await api("/api/rankings")
    expect(saved.body.some((r: { id: string }) => r.id === rankingId)).toBe(true)

    const csv = await fetch(`${base}/api/rankings/${rankingId}/export?format=csv`)
    expect(csv.headers.get("content-type")).toContain("text/csv")
    expect((await csv.text()).split("\n")[0]).toContain("rank,score")

    const md = await fetch(`${base}/api/rankings/${rankingId}/export?format=md`)
    expect((await md.text())).toContain("Senior Backend Engineer")
  })

  it("explains one candidate against a requirement list", async () => {
    const list = await api("/api/resumes")
    const { status, body } = await api("/api/explain", {
      method: "POST",
      body: JSON.stringify({
        resumeId: list.body[0].id,
        title: "Backend Engineer",
        description: "Requirements: Go, Kubernetes, AWS, Terraform.",
      }),
    })
    expect(status).toBe(200)
    expect(body.breakdown.requiredSkills).toBeGreaterThan(50)
    const byReq = new Map(body.matches.map((m: { requirement: string; via: string }) => [m.requirement, m.via]))
    expect(byReq.get("Go")).toBe("exact")
    expect(byReq.get("Terraform")).toBe("none")
  })

  it("exposes the inverted skill index", async () => {
    const { body } = await api("/api/skills")
    const go = body.find((s: { skill: string }) => s.skill === "Go")
    expect(go.count).toBe(1)
    expect(go.candidates[0].filename).toBe("maya.txt")
  })

  it("stores a TypeSafe key from Settings without ever echoing it back", async () => {
    const secret = "ts_live_0123456789abcdefKEY9"
    const before = await api("/api/status")
    expect(before.body.jev.key.configured).toBe(false)

    const saved = await api("/api/settings", { method: "POST", body: JSON.stringify({ apiKey: secret }) })
    expect(saved.status).toBe(200)
    expect(saved.body.jev.key.configured).toBe(true)
    expect(saved.body.jev.key.source).toBe("stored")
    expect(saved.body.jev.key.hint).toBe("…KEY9")
    // The key itself must not appear anywhere in the response.
    expect(JSON.stringify(saved.body)).not.toContain(secret)
    expect(await fetch(`${base}/api/status`).then((r) => r.text()).then((t) => t.includes(secret))).toBe(false)

    // It is on disk with 0600, and the CLI would pick it up from there.
    const { loadConfig } = await import("../src/store/local")
    const stored = await loadConfig()
    expect(stored?.typesafeApiKey).toBe(secret)
    const { statSync, existsSync } = await import("node:fs")
    const { join } = await import("node:path")
    const file = join(home, "config.json")
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).mode & 0o777).toBe(0o600)

    // Removing it drops the key from the file and from the runtime.
    const cleared = await api("/api/settings", { method: "POST", body: JSON.stringify({ clearKey: true }) })
    expect(cleared.body.jev.key.configured).toBe(false)
    expect((await loadConfig())?.typesafeApiKey).toBeUndefined()
  })

  it("reports a missing key instead of failing when asked to test the connection", async () => {
    const res = await api("/api/jev/test", { method: "POST" })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.message).toMatch(/no key configured|offline mode/)
  })

  it("toggles offline mode and the model at runtime", async () => {
    const off = await api("/api/settings", { method: "POST", body: JSON.stringify({ offline: true, model: "jev-preview" }) })
    expect(off.body.offline).toBe(true)
    expect(off.body.jev.model).toBe("jev-preview")
  })

  it("deletes a candidate and its notes", async () => {
    const list = await api("/api/resumes")
    const id = list.body[0].id
    await api("/api/notes", { method: "POST", body: JSON.stringify({ resumeId: id, content: "to be removed" }) })
    const del = await api(`/api/resumes/${id}`, { method: "DELETE" })
    expect(del.status).toBe(200)
    expect((await api("/api/resumes")).body).toHaveLength(0)
    expect((await api("/api/notes")).body).toHaveLength(0)
  })

  it("returns 404 JSON for unknown routes and records", async () => {
    const route = await api("/api/nope")
    expect(route.status).toBe(404)
    expect(route.body.error).toContain("/api/nope")

    const record = await api("/api/resumes/rs_missing")
    expect(record.status).toBe(404)
  })
})
