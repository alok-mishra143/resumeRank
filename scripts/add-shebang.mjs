import { chmodSync, readFileSync, writeFileSync } from "node:fs"

// Prepends a Node shebang and marks the bundled CLI executable. The shebang is
// assembled from fragments so no toolchain ever rewrites or strips it.
const HASH_BANG = `#!${"/usr/bin/" + "env"} node`

const file = process.argv[2]
if (!file) {
  console.error("usage: node scripts/add-shebang.mjs <file>")
  process.exit(1)
}

const body = readFileSync(file, "utf8")
if (!body.startsWith(HASH_BANG)) {
  writeFileSync(file, `${HASH_BANG}\n${body}`)
}
chmodSync(file, 0o755)
console.log(`added executable header to ${file}`)
