import { readFile } from "node:fs/promises"
import { experienceText, splitSections } from "../src/extract/text"
import { parseDateRanges, proposeYearsExplicit, proposeYearsFromRanges } from "../src/extract/deterministic"

const text = await readFile(process.argv[2]!, "utf8")
console.log("sections:", splitSections(text).map((s) => `${s.key}(${s.body.length})`).join(", "))
const exp = experienceText(text)
console.log("experienceText len:", exp.length)
console.log("spans:", JSON.stringify(parseDateRanges(exp)))
console.log("ranges:", proposeYearsFromRanges(text), "explicit:", proposeYearsExplicit(text))
console.log("--- experience text ---")
console.log(exp.slice(0, 900))
