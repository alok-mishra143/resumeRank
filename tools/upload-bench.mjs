#!/usr/bin/env node
// Measures the UI bulk-upload endpoint: POST N PDFs as one request, time it.
const port = process.argv[2] ?? "7781"
const files = process.argv.slice(3)
const { readFile } = await import("node:fs/promises")
const payload = []
for (const f of files) payload.push({ name: f.split("/").pop(), dataBase64: (await readFile(f)).toString("base64") })
const t = Date.now()
const res = await fetch(`http://127.0.0.1:${port}/api/resumes/upload`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` },
  body: JSON.stringify({ files: payload, jev: true }),
})
const body = await res.json()
const ok = body.results.filter((r) => r.ok).length
console.log(`port ${port}: ${files.length} files in ${Date.now() - t} ms — ${ok} ok, ${body.results.length - ok} failed, jevCalls ${body.jevCalls}`)
