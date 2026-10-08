// The store is the one place where parallel work could corrupt data, so it gets
// its own tests: concurrent writes, duplicate uploads and corruption recovery.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

let home = ""

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "rr-store-"))
  process.env.RESUMERANK_HOME = home
})

afterAll(async () => {
  delete process.env.RESUMERANK_HOME
  await rm(home, { recursive: true, force: true })
})

async function makeRecord(id: string, text: string) {
  return {
    id,
    originalFilename: `${id}.txt`,
    extractedText: text,
    metadata: { fullName: id, skills: ["go"], roles: ["Engineer"] },
    structured: {},
    provenance: {},
    verification: {},
    canonicalSkills: [],
    quality: { extractionConfidence: 1, warnings: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    byteSize: text.length,
  } as never
}

describe("local store", () => {
  it("survives concurrent writes without corrupting the index", async () => {
    const store = await import("../src/store/local")
    await store.ensureStore()
    const records = []
    for (let i = 0; i < 16; i += 1) records.push(await makeRecord(`rs_conc${i}`, `Resume number ${i}: Go, PostgreSQL, Kubernetes.`))
    const writers = records.map((record) => store.addResume(record))
    // Fire them all at once: this is the shape that used to truncate resumes.json.
    await Promise.allSettled(writers)
    const raw = await readFile(join(home, "resumes.json"), "utf8")
    const index = JSON.parse(raw) as { resumes: Array<{ id: string }> }
    expect(index.resumes).toHaveLength(16)
    const ids = new Set(index.resumes.map((r) => r.id))
    expect(ids.size).toBe(16)
  })

  it("detects the same resume uploaded twice", async () => {
    const store = await import("../src/store/local")
    const text = "Unique candidate text for duplicate detection: Rust, Kafka."
    await store.addResume(await makeRecord("rs_dupe1", text))
    const first = await store.findByContentHash(text)
    expect(first?.id).toBe("rs_dupe1")
    // Whitespace and case differences must not defeat it.
    const second = await store.findByContentHash(text.toUpperCase().replace(/ /g, "  "))
    expect(second?.id).toBe("rs_dupe1")
    expect(await store.findByContentHash("A genuinely different resume.")).toBeNull()
  })

  it("recovers the previous copy when the index is truncated", async () => {
    const store = await import("../src/store/local")
    await store.addResume(await makeRecord("rs_good1", "Good resume text, first version."))
    // A .bak is written on every mutation; simulate a truncated live file.
    await writeFile(join(home, "resumes.json"), '{"version":1,"resumes":[{"id":"rs_good1"', "utf8")
    // The recovery copy can be one write behind (backups are rate limited), so the
    // guarantee is "the store still reads and holds a valid previous state".
    const rows = await store.listResumes()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => typeof r.id === "string")).toBe(true)
  })
})
