// Debug helper: compare detected experience years against gold labels.
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { experienceText, splitSections } from "../src/extract/text"
import {
  parseDateRanges,
  parseExperience,
  proposeYearsExplicit,
  proposeYearsFromRanges,
} from "../src/extract/deterministic"

const corpus = process.argv[2] ?? "corpus"
const gold = JSON.parse(await readFile(join(corpus, "gold.json"), "utf8")) as {
  resumes: Record<string, { file: string; yearsExperience?: number }>
}
const byFile = new Map(Object.values(gold.resumes).map((r) => [r.file.split("/").pop() as string, r]))

for (const f of (await readdir(join(corpus, "resumes"))).sort()) {
  const text = await readFile(join(corpus, "resumes", f), "utf8")
  const sections = splitSections(text).map((s) => s.key)
  const goldYears = byFile.get(f)?.yearsExperience ?? null
  const sectionText = experienceText(text)
  const ranges = parseDateRanges(sectionText)
  const entries = parseExperience(text)
  console.log(
    f.padEnd(32),
    "gold:", String(goldYears).padEnd(4),
    "ranges:", String(proposeYearsFromRanges(text)).padEnd(5),
    "explicit:", String(proposeYearsExplicit(text)).padEnd(4),
    "sections:", sections.join(",").slice(0, 70),
  )
  console.log("   spans:", JSON.stringify(ranges.slice(0, 5)))
  console.log("   entries:", entries.map((e) => `${e.role || "?"}@${e.company || "?"} ${e.startDate}->${e.endDate}${e.isCurrent ? " now" : ""}`).join(" | ").slice(0, 220))
}
