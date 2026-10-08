import { createRequire } from "node:module"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { Command } from "commander"

// ---------------------------------------------------------------------------
// resumerank — offline-first resume ranking CLI.
// Every command works with zero network access; the TypeSafe Jev layer adds
// typed extraction/verification when a key is present.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)
const { config: loadDotenv } = require("dotenv") as { config: (o?: unknown) => unknown }

// Load .env from the CWD, then the data directory (CWD wins).
loadDotenv()
void (async () => {
  try {
    const home = process.env.RESUMERANK_HOME ?? join(process.env.HOME ?? "", ".resumerank")
    const text = await readFile(join(home, ".env"), "utf8")
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    /* no data-dir env file: fine */
  }
})()

const { config, dataHome, ingestLanes, isOffline, paths } = await import("../config")
const { AppError, toUserError } = await import("../errors")
const { jevStatus, stats, resetStats, systemOne, noul, answerCacheSize } = await import("../ai/jev")
const { ensureStore, loadConfig, saveConfig, stats: storeStats, skillIndex, getResume, listResumes, shortId } =
  await import("../store/local")
const resumeService = await import("../resumes/service")
const rankService = await import("../ranking/service")
const { analyzeJobDescription } = await import("../ranking/jd")
const { matchRequirements } = await import("../ranking/semantic")
const { deterministicScore, getRankingWeights } = await import("../ranking/scoring")
const { runEval } = await import("../eval/harness")
const { bold, cyan, dim, formatDate, green, pct, printJson, red, renderTable, truncate, yellow, bar } =
  await import("./format")

const VERSION = "1.0.0"

const program = new Command()
program
  .name("resumerank")
  .description(
    "Offline-first resume ranking. Data lives in local JSON files; the TypeSafe Jev layer " +
      "(typed noul/choice/score answers) is optional and only used when a key is configured.",
  )
  .version(VERSION, "-v, --version")
  .option("--data-dir <dir>", "data directory (default: ~/.resumerank)")
  .option("--offline", "never touch the network, even if a TypeSafe key is set")
  .option("--verbose", "print progress and the Jev calls being made")
  .showHelpAfterError()

function applyGlobalOptions(): void {
  const opts = program.opts<{ dataDir?: string; offline?: boolean; verbose?: boolean }>()
  if (opts.dataDir) process.env.RESUMERANK_HOME = resolve(opts.dataDir)
  if (opts.offline) process.env.RESUMERANK_OFFLINE = "1"
  if (opts.verbose) process.env.RESUMERANK_VERBOSE = "1"
}

async function bootstrap(): Promise<void> {
  applyGlobalOptions()
  await ensureStore()
  const stored = await loadConfig()
  if (stored) {
    if (stored.typesafeApiKey && !process.env.TYPESAFE_API_KEY) {
      process.env.TYPESAFE_API_KEY = stored.typesafeApiKey
    }
    if (stored.typesafeModel && !process.env.TYPESAFE_MODEL) process.env.TYPESAFE_MODEL = stored.typesafeModel
  }
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const e = toUserError(err)
    console.error(`${red("error")}: ${e.message}`)
    process.exitCode = 1
  }
}

function jevEnabled(): boolean {
  return config.typesafe.enabled
}

/** `--verbose` may arrive on the subcommand or the program (both declare it). */
function isVerbose(local?: boolean): boolean {
  return local === true || program.opts().verbose === true || process.env.RESUMERANK_VERBOSE === "1"
}

// --- init ------------------------------------------------------------------

program
  .command("init")
  .description("Create the local data directory and (optionally) store a TypeSafe key")
  .option("--api-key <key>", "TypeSafe API key (enables the Jev layer)")
  .option("--model <model>", "TypeSafe model", "jev-latest")
  .action(async (opts: { apiKey?: string; model?: string }) => {
    await run(async () => {
      applyGlobalOptions()
      await ensureStore()
      const previous = (await loadConfig()) ?? {}
      const file = await saveConfig({
        typesafeApiKey: opts.apiKey ?? previous.typesafeApiKey,
        typesafeModel: opts.model ?? previous.typesafeModel ?? "jev-latest",
        dataDir: dataHome(),
        initialisedAt: previous.initialisedAt,
      })
      console.log(`${green("initialised")} ${file}`)
      console.log(`  data dir  ${dataHome()}`)
      console.log(`  storage   ${paths().resumes.replace(/resumes\.json$/, "")} (JSON, no database)`)
      console.log(`  Jev       ${jevStatus()}`)
    })
  })

// --- add -------------------------------------------------------------------

program
  .command("add", { hidden: true })
  .description("Add resume files (PDF, DOCX or TXT)")
  .argument("<files...>", "paths to resume files")
  .option("--no-jev", "extract without the Jev layer (pure offline)")
  .option("--json", "output JSON")
  .action(async (files: string[], opts: { jev: boolean; json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      resetStats()
      const records: Awaited<ReturnType<typeof resumeService.addResumeFile>>[] = []
      // Extraction is network-bound when the typed layer is on (3-4 calls per
      // resume), so files are processed in parallel lanes. Offline it is pure CPU
      // in one thread, where extra lanes would only add contention.
      const lanes = ingestLanes(opts.jev && config.typesafe.enabled, files.length)
      const queue = [...files]
      const worker = async (): Promise<void> => {
        for (;;) {
          const file = queue.shift()
          if (!file) return
          try {
            const record = await resumeService.addResumeFile(file, { jev: opts.jev })
            records.push(record)
            if (!opts.json) {
              const isDuplicate = record.quality.warnings.some((w) => w.startsWith("duplicate of"))
              console.log(
                `${isDuplicate ? yellow("duplicate") : green("added")} ${dim(record.id.slice(0, 11))} ${truncate(record.originalFilename, 40)} ` +
                  `${dim(`(${record.extractedText.length} chars, ${record.metadata.skills?.length ?? 0} skills, ` +
                    `${record.metadata.yearsOfExperience ?? "?"} yrs, conf ${record.quality.extractionConfidence})`)}`,
              )
              for (const warning of record.quality.warnings) console.log(`  ${yellow("warn")} ${warning}`)
            }
          } catch (err) {
            console.error(`${red("failed")} ${file}: ${toUserError(err).message}`)
            process.exitCode = 1
          }
        }
      }
      await Promise.all(Array.from({ length: lanes }, worker))
      if (opts.json) printJson(records)
      else if (records.length > 0) console.log(dim(`Jev: ${jevStatus()} · ${stats.calls} call(s)${stats.cachedAnswers > 0 ? ` · ${stats.cachedAnswers} cached answer(s)` : ""}`))
    })
  })

// --- list / show -----------------------------------------------------------

program
  .command("list", { hidden: true })
  .description("List stored resumes")
  .argument("[search]", "filter by filename, skill, role or text")
  .option("--limit <n>", "maximum rows", "100")
  .option("--json", "output JSON")
  .action(async (search: string | undefined, opts: { limit: string; json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const rows = await resumeService.listResumeRecords(search, Number(opts.limit) || 100)
      if (opts.json) return printJson(rows)
      if (rows.length === 0) {
        console.log("No resumes stored yet. Add some: resumerank add <file.pdf>")
        return
      }
      console.log(
        renderTable(
          ["ID", "FILE", "SKILLS", "YRS", "SENIORITY", "DOMAIN", "CONF", "ADDED"],
          rows.map((r) => [
            dim(r.id.slice(0, 11)),
            truncate(r.originalFilename, 34),
            String(r.metadata.skills?.length ?? 0),
            r.metadata.yearsOfExperience == null ? "-" : String(r.metadata.yearsOfExperience),
            truncate(r.metadata.seniority ?? "-", 8),
            truncate(r.metadata.domain ?? "-", 10),
            String(r.quality.extractionConfidence),
            dim(formatDate(r.createdAt)),
          ]),
        ),
      )
    })
  })

program
  .command("show", { hidden: true })
  .description("Show one stored resume in detail")
  .argument("<resumeId>", "resume id (or its short prefix)")
  .option("--json", "output JSON")
  .option("--provenance", "show how each skill was accepted")
  .action(async (id: string, opts: { json?: boolean; provenance?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const record = await resumeService.getResumeRecord(id)
      if (opts.json) return printJson(record)
      console.log(`${bold(record.structured.fullName || record.originalFilename)}  ${dim(record.id)}`)
      const meta = record.metadata
      console.log(
        dim(
          `${meta.roles?.slice(0, 3).join(", ") || "no roles"} · ${meta.yearsOfExperience ?? "?"} yrs · ` +
            `${meta.seniority ?? "?"} · ${meta.domain ?? "?"} · conf ${record.quality.extractionConfidence}`,
        ),
      )
      const contact = record.structured.contact
      if (contact.email || contact.phone || contact.location) {
        console.log(`contact   ${[contact.email, contact.phone, contact.location].filter(Boolean).join(" · ")}`)
      }
      console.log(`skills    ${(meta.skills ?? []).join(", ") || "-"}`)
      console.log(`education ${(meta.education ?? []).join(" | ") || "-"}`)
      console.log(`certs     ${(meta.certifications ?? []).join(", ") || "-"}`)
      console.log(`projects  ${(meta.projects ?? []).slice(0, 3).join(" | ") || "-"}`)
      if (record.structured.experience.length > 0) {
        console.log("\nexperience")
        for (const entry of record.structured.experience.slice(0, 6)) {
          const range = `${entry.startDate || "?"} – ${entry.isCurrent ? "present" : entry.endDate || "?"}`
          console.log(`  ${truncate(entry.role || "?", 32).padEnd(32)} ${truncate(entry.company || "?", 28).padEnd(28)} ${dim(range)}`)
        }
      }
      if (opts.provenance) {
        console.log("\nprovenance")
        for (const [skill, why] of Object.entries(record.provenance)) {
          const rejected = why.startsWith("rejected")
          console.log(`  ${rejected ? red("✗") : green("✓")} ${skill.padEnd(24)} ${dim(why)}`)
        }
      }
    })
  })

program
  .command("remove", { hidden: true })
  .description("Delete a stored resume")
  .argument("<resumeId>", "resume id")
  .action(async (id: string) => {
    await run(async () => {
      await bootstrap()
      const record = await resumeService.getResumeRecord(id)
      await resumeService.deleteResume(id)
      console.log(`${green("removed")} ${record.originalFilename} ${dim(record.id)}`)
    })
  })

// --- rank ------------------------------------------------------------------

program
  .command("rank", { hidden: true })
  .description("Rank stored resumes against a job description")
  .requiredOption("--title <title>", "job title")
  .option("--jd <file>", "path to a job description file")
  .option("--description <text>", "job description inline")
  .option("--limit <n>", "how many finalists to keep", String(config.ranking.finalLimit))
  .option("--include-mismatches", "also rank candidates the gate flagged as mismatches")
  .option("--json", "output JSON")
  .action(
    async (opts: {
      title: string
      jd?: string
      description?: string
      limit: string
      includeMismatches?: boolean
      json?: boolean
    }) => {
      await run(async () => {
        await bootstrap()
        resetStats()
        const description = opts.jd ? await readFile(opts.jd, "utf8") : opts.description
        if (!description) {
          throw new AppError("VALIDATION_ERROR", "Provide --jd <file> or --description <text>.")
        }
        const started = Date.now()
        const result = await rankService.rankJob({
          title: opts.title,
          description,
          offline: isOffline(),
          includeMismatches: opts.includeMismatches,
          limit: Number(opts.limit) || config.ranking.finalLimit,
        })
        if (opts.json) return printJson(result)

        console.log(`${bold(result.jobTitle)}  ${dim(result.rankingId)}`)
        console.log(
          dim(
            `required: ${(result.requirements.requiredSkills ?? []).join(", ") || "-"}\n` +
              `preferred: ${(result.requirements.preferredSkills ?? []).join(", ") || "-"}\n` +
              `min experience: ${result.requirements.minimumExperience ?? "not stated"} · ` +
              `domain: ${(result.requirements.domain ?? []).join(", ") || "-"} · model: ${result.model}`,
          ),
        )
        if (result.fellBack) {
          console.log(
            `\n${yellow("no candidate cleared the mismatch gate")} — showing the closest instead; ` +
              `every row below is flagged MISMATCH (${dim("rank --include-mismatches to silence this note")})`,
          )
        }
        console.log("")
        console.log(
          renderTable(
            ["#", "SCORE", "SEM", "JEV", "CANDIDATE", "TOP STRENGTHS"],
            result.results.map((r) => [
              String(r.rank),
              bold(r.finalScore.toFixed(1)),
              r.semanticScore.toFixed(0),
              r.aiScore.toFixed(0),
              truncate(r.originalFilename, 30),
              truncate(r.analysis.strengths.join(", ") || "-", 40),
            ]),
          ),
        )
        if (result.excluded.length > 0) {
          console.log(`\n${yellow("excluded as mismatches")} (${result.excluded.length})`)
          for (const e of result.excluded) {
            console.log(`  ${truncate(e.originalFilename, 34)} ${dim(truncate(e.reason, 70))}`)
          }
        }
        console.log(
          dim(
            `\n${Date.now() - started}ms · ${stats.calls} Jev call(s)${stats.cachedAnswers > 0 ? ` · ${stats.cachedAnswers} cached` : ""} · ranking saved as ${result.rankingId}`,
          ),
        )
      })
    },
  )

program
  .command("explain", { hidden: true })
  .description("Explain why one resume scored what it did for a job description")
  .argument("<resumeId>", "resume id")
  .requiredOption("--title <title>", "job title")
  .option("--jd <file>", "path to a job description file")
  .option("--description <text>", "job description inline")
  .action(async (id: string, opts: { title: string; jd?: string; description?: string }) => {
    await run(async () => {
      await bootstrap()
      const record = await resumeService.getResumeRecord(id)
      const description = opts.jd ? await readFile(opts.jd, "utf8") : opts.description
      if (!description) throw new AppError("VALIDATION_ERROR", "Provide --jd <file> or --description <text>.")
      const requirements = analyzeJobDescription(opts.title, description)
      const matches = await matchRequirements(
        requirements.requiredSkills ?? [],
        record.canonicalSkills ?? record.metadata.skills ?? [],
        { jevAssist: jevEnabled(), jevState: { candidate_skills: record.canonicalSkills ?? [] } },
      )
      const result = deterministicScore({
        requirements,
        metadata: record.metadata,
        resumeText: record.extractedText,
        skillMatches: matches,
        weights: getRankingWeights(),
      })
      console.log(`${bold(record.originalFilename)} vs ${bold(opts.title)}`)
      console.log(`score ${bold(result.score.toFixed(1))}${result.mismatch ? red("  MISMATCH") : ""}`)
      console.log(
        renderTable(
          ["COMPONENT", "SCORE", ""],
          [
            ["required skills", String(result.breakdown.requiredSkills), bar(result.breakdown.requiredSkills)],
            ["experience", String(result.breakdown.experience), bar(result.breakdown.experience)],
            ["role similarity", String(result.breakdown.roleSimilarity), bar(result.breakdown.roleSimilarity)],
            ["responsibilities", String(result.breakdown.responsibilities), bar(result.breakdown.responsibilities)],
            ["domain", String(result.breakdown.domain), bar(result.breakdown.domain)],
            ["preferred skills", String(result.breakdown.preferredSkills), bar(result.breakdown.preferredSkills)],
          ],
        ),
      )
      console.log("\nskill matches")
      for (const m of matches) {
        const icon = m.score >= 1 ? green("✓") : m.score >= 0.6 ? green("~") : m.score > 0 ? yellow("·") : red("✗")
        console.log(`  ${icon} ${m.requirement.padEnd(26)} ${dim(`${m.via} ${m.score.toFixed(2)} ${m.evidence}`)}`)
      }
      for (const reason of result.mismatchReasons) console.log(`  ${red("mismatch")} ${reason}`)
    })
  })

// --- rankings --------------------------------------------------------------

program
  .command("rankings", { hidden: true })
  .description("List saved rankings")
  .option("--json", "output JSON")
  .action(async (opts: { json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const rows = await rankService.listRankings(50)
      if (opts.json) return printJson(rows)
      if (rows.length === 0) {
        console.log("No rankings yet. Run: resumerank rank --title <title> --jd <file>")
        return
      }
      console.log(
        renderTable(
          ["ID", "TITLE", "CANDIDATES", "MODEL", "CREATED"],
          rows.map((r) => [
            dim(r.id.slice(0, 11)),
            truncate(r.jobTitle, 34),
            String(r.candidateCount),
            r.model,
            dim(formatDate(r.createdAt)),
          ]),
        ),
      )
    })
  })

program
  .command("show-ranking", { hidden: true })
  .description("Show a saved ranking in detail")
  .argument("<rankingId>", "ranking id")
  .option("--json", "output JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const record = await rankService.getRanking(id)
      if (opts.json) return printJson(record)
      console.log(
        `${bold(record.jobTitle)}  ${dim(record.id)}\n` +
          dim(`${formatDate(record.createdAt)} · model ${record.model} · ${record.candidateCount} candidates scored`),
      )
      console.log("")
      console.log(
        renderTable(
          ["#", "SCORE", "SEM", "JEV", "CANDIDATE"],
          record.results.map((r) => [
            String(r.rank),
            r.finalScore.toFixed(1),
            r.semanticScore.toFixed(0),
            r.aiScore.toFixed(0),
            truncate(r.originalFilename, 34),
          ]),
        ),
      )
      for (const r of record.results) {
        console.log(`\n${bold(`#${r.rank} ${r.originalFilename}`)}`)
        console.log(`  strengths ${r.analysis.strengths.join(", ") || "-"}`)
        console.log(`  gaps      ${r.analysis.gaps.join(", ") || "-"}`)
        console.log(`  ${dim(r.analysis.reasoning)}`)
      }
      if (record.excluded.length > 0) {
        console.log(`\n${yellow("excluded as mismatches")}`)
        for (const e of record.excluded) console.log(`  ${truncate(e.originalFilename, 34)} ${dim(e.reason)}`)
      }
    })
  })

program
  .command("export", { hidden: true })
  .description("Export a ranking as JSON + CSV (and optionally Markdown)")
  .argument("<rankingId>", "ranking id")
  .option("--out <dir>", "output directory", ".")
  .option("--md", "also write a Markdown report")
  .action(async (id: string, opts: { out: string; md?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const record = await rankService.getRanking(id)
      const outDir = resolve(opts.out)
      await mkdir(outDir, { recursive: true })
      const base = join(outDir, `ranking-${id.slice(0, 11)}`)
      await writeFile(`${base}.json`, `${JSON.stringify(record, null, 2)}\n`)
      const escape = (v: string): string => `"${v.replace(/"/g, '""')}"`
      const header = "rank,score,semantic,jev,candidate,matched_required,missing_required"
      const lines = record.results.map((r) =>
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
      await writeFile(`${base}.csv`, `${[header, ...lines].join("\n")}\n`)
      console.log(`wrote ${base}.json`)
      console.log(`wrote ${base}.csv`)
      if (opts.md) {
        const md = [
          `# ${record.jobTitle}`,
          "",
          `_${formatDate(record.createdAt)} · ${record.candidateCount} candidates · model ${record.model}_`,
          "",
          `**Required:** ${(record.requirements.requiredSkills ?? []).join(", ") || "-"}`,
          "",
          "| # | Score | Candidate | Strengths | Gaps |",
          "| --- | --- | --- | --- | --- |",
          ...record.results.map(
            (r) =>
              `| ${r.rank} | ${r.finalScore.toFixed(1)} | ${r.originalFilename} | ${r.analysis.strengths.join(", ")} | ${r.analysis.gaps.join(", ")} |`,
          ),
          "",
          record.excluded.length > 0
            ? `## Excluded as mismatches\n\n${record.excluded.map((e) => `- ${e.originalFilename}: ${e.reason}`).join("\n")}`
            : "",
          "",
        ].join("\n")
        await writeFile(`${base}.md`, md)
        console.log(`wrote ${base}.md`)
      }
    })
  })

program
  .command("rm-ranking", { hidden: true })
  .description("Delete a saved ranking")
  .argument("<rankingId>", "ranking id")
  .action(async (id: string) => {
    await run(async () => {
      await bootstrap()
      const record = await rankService.getRanking(id)
      const { removeRanking } = await import("../store/local")
      await removeRanking(record.id)
      console.log(`${green("removed")} ranking ${record.jobTitle} ${dim(record.id)}`)
    })
  })

// --- status / skills -------------------------------------------------------

program
  .command("status", { hidden: true })
  .description("Show local state, storage size and Jev configuration")
  .option("--json", "output JSON")
  .action(async (opts: { json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const s = await storeStats()
      const skills = await skillIndex()
      const payload = {
        dataDir: dataHome(),
        storage: "json-files (no database)",
        resumes: s.resumes,
        rankings: s.rankings,
        indexedSkills: s.skills,
        textChars: s.textChars,
        indexBytes: s.bytes,
        typesafe: { status: jevStatus(), endpoint: config.typesafe.endpoint },
        offline: isOffline(),
      }
      if (opts.json) return printJson(payload)
      console.log(`data dir     ${dataHome()}`)
      console.log(`storage      json files · index ${(s.bytes / 1024).toFixed(1)} KB · no database`)
      console.log(`resumes      ${s.resumes} (${s.textChars} chars of text)`)
      console.log(`rankings     ${s.rankings}`)
      console.log(`skill index  ${Object.keys(skills).length} distinct skills`)
      console.log(`Jev          ${jevStatus()}`)
      console.log(`offline flag ${isOffline() ? "on" : "off"}`)
    })
  })

program
  .command("skills", { hidden: true })
  .description("Show the semantic skill index (canonical skills -> resumes)")
  .option("--json", "output JSON")
  .action(async (opts: { json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const index = await skillIndex()
      const rows = Object.entries(index).sort((a, b) => b[1].length - a[1].length)
      if (opts.json) return printJson(index)
      const resumes = await listResumes()
      const nameById = new Map(resumes.map((r) => [r.id, r.originalFilename]))
      console.log(
        renderTable(
          ["SKILL", "#", "RESUMES"],
          rows.slice(0, 80).map(([skill, ids]) => [
            skill,
            String(ids.length),
            truncate(ids.map((id) => nameById.get(id) ?? id.slice(0, 8)).join(", "), 60),
          ]),
        ),
      )
    })
  })

program
  .command("cache", { hidden: true })
  .description("Inspect or clear the cached typed answers (makes re-runs identical and free)")
  .option("--clear", "delete every cached answer")
  .option("--json", "output JSON")
  .action(async (opts: { clear?: boolean; json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const file = paths().jevCache
      if (opts.clear) {
        await rm(file, { force: true })
        if (opts.json) console.log(JSON.stringify({ cleared: true, file }))
        else console.log(`${green("cleared")} ${dim(file)}`)
        return
      }
      const size = await answerCacheSize()
      const info = await stat(file).catch(() => null)
      if (opts.json) {
        console.log(JSON.stringify({ answers: size, file, bytes: info?.size ?? 0, updatedAt: info?.mtime.toISOString() ?? null }))
        return
      }
      console.log(`${bold("typed answer cache")} ${dim(file)}`)
      console.log(`  answers   ${size}`)
      console.log(`  size      ${info ? `${(info.size / 1024).toFixed(1)} KB` : "empty"}`)
      console.log(`  updated   ${info ? info.mtime.toISOString() : "never"}`)
      console.log(
        dim(
          "\nAnswers are keyed by (model, pool/JD, question), so re-running the same ranking is identical\n" +
            "and costs nothing. RESUMERANK_FRESH=1 ignores the cache, RESUMERANK_NO_CACHE=1 disables it.\n",
        ),
      )
    })
  })

program
  .command("doctor", { hidden: true })
  .description("Check the environment: storage, network and the TypeSafe key")
  .option("--json", "output JSON")
  .action(async (opts: { json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const checks: Array<{ name: string; ok: boolean | null; detail: string }> = []
      checks.push({ name: "data dir", ok: true, detail: dataHome() })
      checks.push({
        name: "storage",
        ok: true,
        detail: `${(await storeStats()).resumes} resumes in local JSON (no database required)`,
      })
      checks.push({ name: "offline mode", ok: true, detail: isOffline() ? "forced on" : "off (will use Jev if keyed)" })

      if (!config.typesafe.apiKey) {
        checks.push({ name: "TypeSafe key", ok: false, detail: "not set — running pure offline" })
      } else {
        try {
          const res = await systemOne("The candidate built a REST API in Go.", {
            ping: noul("Does this sentence mention a programming language?"),
          })
          const p = (res.answers["ping"] as { noul?: number } | undefined)?.noul
          checks.push({ name: "TypeSafe key", ok: true, detail: `valid · model ${res.model} · ping P=${p}` })
        } catch (err) {
          checks.push({ name: "TypeSafe key", ok: false, detail: toUserError(err).message })
        }
      }

      if (opts.json) return printJson({ checks })
      for (const check of checks) {
        const icon = check.ok === true ? green("✓") : check.ok === false ? yellow("!") : dim("·")
        console.log(`${icon} ${check.name.padEnd(14)} ${dim(check.detail)}`)
      }
    })
  })

// --- eval ------------------------------------------------------------------

program
  .command("eval", { hidden: true })
  .description("Measure extraction + ranking accuracy against a gold corpus")
  .requiredOption("--corpus <dir>", "corpus directory (resumes/, jobs/, gold.json)")
  .option("--offline", "measure the pure offline pipeline")
  .option("--no-reset", "reuse the harness data directory instead of rebuilding it")
  .option("--verbose", "print per-resume and per-job rows")
  .option("--json", "output the full report as JSON")
  .action(async (opts: { corpus: string; offline?: boolean; reset: boolean; verbose?: boolean; json?: boolean }) => {
    await run(async () => {
      applyGlobalOptions()
      const report = await runEval({
        corpus: opts.corpus,
        offline: opts.offline === true || isOffline(),
        reset: opts.reset !== false,
        verbose: isVerbose(opts.verbose),
      })
      if (opts.json) return printJson(report)

      const m = report.metrics
      console.log(bold(`\naccuracy report — ${report.corpus} (${report.mode})`))
      console.log(
        dim(`${report.resumes} resumes · ${report.jobs} jobs · composite target 90–95%\n`),
      )
      console.log(
        renderTable(
          ["METRIC", "VALUE", ""],
          [
            ["skill precision", pct(m.skillPrecision), bar(m.skillPrecision * 100, 20)],
            ["skill recall", pct(m.skillRecall), bar(m.skillRecall * 100, 20)],
            ["skill F1", pct(m.skillF1), bar(m.skillF1 * 100, 20)],
            ["years accuracy (±1y)", pct(m.yearsAccuracy), bar(m.yearsAccuracy * 100, 20)],
            ["JD skill F1", pct(m.jdF1), bar(m.jdF1 * 100, 20)],
            ["top-1 eligible", pct(m.top1Accuracy), bar(m.top1Accuracy * 100, 20)],
            ["eligible-in-top3", pct(m.eligibleCoverage), bar(m.eligibleCoverage * 100, 20)],
            ["false accepts", pct(m.falseAcceptRate), m.falseAcceptRate === 0 ? green("clean") : red("leaks")],
            ["extraction accuracy", pct(m.extractionAccuracy), bar(m.extractionAccuracy * 100, 20)],
            ["ranking accuracy", pct(m.rankingAccuracy), bar(m.rankingAccuracy * 100, 20)],
            ["COMPOSITE", bold(pct(m.composite)), bar(m.composite * 100, 20)],
          ],
        ),
      )
      const forbidden = report.extraction.filter((r) => r.forbiddenHit.length > 0)
      if (forbidden.length > 0) {
        console.log(`\n${red("forbidden-skill leaks")}`)
        for (const row of forbidden) console.log(`  ${row.file}: ${row.forbiddenHit.join(", ")}`)
      }
      const leaked = report.ranking.filter((r) => r.leaked.length > 0)
      if (leaked.length > 0) {
        console.log(`\n${red("mismatched candidates ranked")}`)
        for (const row of leaked) console.log(`  ${row.job}: ${row.leaked.join(", ")}`)
      }
      const wrongTop1 = report.ranking.filter((r) => !r.top1Ok)
      if (wrongTop1.length > 0) {
        console.log(`\n${yellow("top-1 misses")}`)
        for (const row of wrongTop1) {
          console.log(`  ${row.job}: top1=${row.top1Got ?? "-"} expected one of [${row.eligible.join(", ")}]`)
        }
      }
      const weak = report.extraction.filter((r) => r.f1 < 0.85)
      if (weak.length > 0) {
        console.log(`\n${yellow("resumes below 0.85 skill F1")}`)
        for (const row of weak) {
          console.log(
            `  ${row.file.padEnd(34)} F1=${row.f1.toFixed(2)}` +
              `${row.missing.length ? ` missing=[${row.missing.join(",")}]` : ""}` +
              `${row.unexpected.length ? ` extra=[${row.unexpected.slice(0, 8).join(",")}]` : ""}`,
          )
        }
      }
      console.log(
        m.composite >= 0.9
          ? `\n${green("PASS")} composite ${pct(m.composite)} ≥ 90%`
          : `\n${yellow("below target")} composite ${pct(m.composite)} < 90%`,
      )
      console.log(dim(`report: resumerank eval --corpus ${opts.corpus} --json`))
    })
  })

// --- dashboards and ui -----------------------------------------------------

program
  .command("dashboard")
  .alias("report")
  .description("Write a self-contained HTML dashboard (one file, opens by double-click)")
  .option("--out <file>", "where to write it", "resumerank-dashboard.html")
  .option("--open", "open it in your browser when written")
  .option("--json", "print the path as JSON")
  .action(async (opts: { out: string; open?: boolean; json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const { loadDashData } = await import("../ui/terminal")
      const { writeDashboardHtml } = await import("../ui/export-html")
      const data = await loadDashData()
      const file = resolve(opts.out)
      await writeDashboardHtml(file, data)
      if (opts.json) {
        console.log(JSON.stringify({ file, candidates: data.candidates.length, rankings: data.rankings.length }))
        return
      }
      console.log(`${green("wrote")} ${cyan(file)}`)
      console.log(
        dim(
          `  ${data.candidates.length} candidates · ${data.store.skills} skills · ${data.rankings.length} saved rankings\n` +
            `  self-contained: no server, no network, opens by double-click`,
        ),
      )
      if (opts.open) {
        const { spawn } = await import("node:child_process")
        spawn("xdg-open", [file], { detached: true, stdio: "ignore" }).unref()
      }
    })
  })

program
  .command("uninstall")
  .description("Remove the app, the launcher and the menu entry (your data stays unless --purge)")
  .option("--purge", "also delete the local store: resumes, texts, rankings, notes, config")
  .option("--dry-run", "show what would be removed, change nothing")
  .option("-y, --yes", "do not ask for confirmation")
  .option("--json", "output JSON")
  .action(async (opts: { purge?: boolean; dryRun?: boolean; yes?: boolean; json?: boolean }) => {
    await run(async () => {
      const { applyUninstall, buildUninstallPlan, defaultUninstallPaths, readInstallMarker } = await import("./uninstall")

      // This bundle lives at <appDir>/dist/resumerank.js
      const selfPath = process.argv[1] ?? ""
      const appDir = selfPath ? resolve(selfPath, "..", "..") : process.cwd()
      const plan = await buildUninstallPlan({ appDir, purgeData: opts.purge, ...defaultUninstallPaths() })

      if (opts.dryRun || !opts.yes) {
        const marker = await readInstallMarker(appDir)
        if (!opts.json) {
          console.log(
            `${bold("resumerank uninstall")}${marker?.version ? dim(`  (installed ${String(marker.version)})`) : ""}`,
          )
          console.log("")
          for (const item of plan.candidates) {
            console.log(`${item.remove ? red("−") : dim("·")} ${item.kind.padEnd(14)} ${item.path}`)
            console.log(`  ${dim(item.detail)}`)
          }
          console.log("")
          console.log(
            dim(
              `  ${plan.willRemove.length} item(s) to remove · ${plan.keeping.length} kept\n` +
                `  your data: ${plan.dataDir}${opts.purge ? red(" (will be deleted)") : " (kept — use --purge to delete)"}`,
            ),
          )
        }
      }

      if (opts.dryRun) {
        if (opts.json) console.log(JSON.stringify({ dryRun: true, willRemove: plan.willRemove, keeping: plan.keeping, dataDir: plan.dataDir }, null, 2))
        else console.log(`\n${yellow("dry run")} ${dim("— nothing was changed")}`)
        return
      }

      if (!opts.yes) {
        let go = false
        if (process.stdin.isTTY && !opts.json) {
          const { createInterface } = await import("node:readline/promises")
          const rl = createInterface({ input: process.stdin, output: process.stdout })
          const answer = await rl.question(`\nRemove ${plan.willRemove.length} item(s)? [y/N] `)
          rl.close()
          go = /^y(es)?$/i.test(answer.trim())
        }
        if (!go) {
          if (opts.json) console.log(JSON.stringify({ cancelled: true }))
          else console.log(dim("cancelled — nothing was removed (pass --yes to skip this prompt)"))
          return
        }
      }

      const { removed, failed } = await applyUninstall(plan)
      if (opts.json) {
        console.log(JSON.stringify({ removed, failed, dataDir: plan.dataDir }))
        return
      }
      for (const path of removed) console.log(`${green("removed")} ${path}`)
      for (const item of failed) console.log(`${red("failed")}  ${item.path}: ${item.error}`)
      console.log("")
      console.log(
        opts.purge
          ? `${green("uninstalled")} ${dim("— the app and your data are gone")}`
          : `${green("uninstalled")} ${dim(`— your data is still at ${plan.dataDir}`)}`,
      )
    })
  })

program
  .command("dash")
  .alias("tui")
  .description("Terminal dashboard: pool, rankings and ranking runs without a browser")
  .option("--snapshot", "print one frame as plain text and exit")
  .option("--view <view>", "overview | candidates | rankings | help", "overview")
  .option("--width <n>", "force a frame width (snapshots)")
  .option("--height <n>", "force a frame height (snapshots)")
  .option("--no-color", "disable colour")
  .option("--with-browser", "let `o` start the local web UI on demand")
  .action(
    async (opts: {
      snapshot?: boolean
      view?: string
      width?: string
      height?: string
      color: boolean
      withBrowser?: boolean
    }) => {
      await run(async () => {
        await bootstrap()
        const { runDashboard } = await import("../ui/terminal")
        const view = ["overview", "candidates", "rankings", "help"].includes(opts.view ?? "")
          ? (opts.view as "overview" | "candidates" | "rankings" | "help")
          : "overview"

        const rank = async (
          _title: string,
          jdPath: string,
        ): Promise<{
          title: string
          model: string
          elapsedMs: number
          extra: string
          rows: Array<{ filename: string; score: number; matched: number; required: number; flags: string }>
        }> => {
          const jd = await readFile(jdPath, "utf8")
          const jobTitle = (jd.split("\n").find((l) => l.trim()) ?? "Role").replace(/^#+\s*/, "").trim()
          const started = Date.now()
          resetStats()
          const result = await rankService.rankJob({
            title: jobTitle,
            description: jd,
            offline: isOffline(),
            limit: 12,
          })
          const ranked = result.results.filter((r) => r.rank > 0).sort((a, b) => a.rank - b.rank)
          return {
            title: jobTitle,
            model: `${result.model}${stats.cachedAnswers > 0 ? ` · ${stats.cachedAnswers} cached` : ""}`,
            elapsedMs: Date.now() - started,
            extra: `${ranked.length} ranked · ${result.mismatches.length} flagged or excluded · saved as ${result.rankingId}`,
            rows: ranked.map((r) => ({
              filename: r.originalFilename,
              score: r.finalScore,
              matched: r.analysis?.matchedRequirements?.length ?? 0,
              required:
                (r.analysis?.matchedRequirements?.length ?? 0) + (r.analysis?.missingRequirements?.length ?? 0),
              flags: (r.analysis?.mismatchReasons ?? []).join("; "),
            })),
          }
        }

        let browserStop: (() => Promise<void>) | null = null
        await runDashboard({
          view,
          snapshot: opts.snapshot,
          width: opts.width ? Number(opts.width) : undefined,
          height: opts.height ? Number(opts.height) : undefined,
          color: opts.color !== false && !opts.snapshot,
          rank,
          openBrowser: opts.withBrowser
            ? async () => {
                const { startUi } = await import("../ui/server")
                if (!browserStop) {
                  const started = await startUi({ port: 7777, host: "127.0.0.1", open: true })
                  browserStop = started.close
                }
                return "http://127.0.0.1:7777"
              }
            : undefined,
        })
        if (browserStop) await (browserStop as () => Promise<void>)()
      })
    },
  )

program
  .command("ui")
  .alias("web")
  .description("Start the local web UI and open it in your browser")
  .option("--port <n>", "port to listen on", "7777")
  .option("--host <host>", "interface to bind", "127.0.0.1")
  .option("--no-open", "do not launch a browser")
  .action(async (opts: { port: string; host: string; open: boolean }) => {
    await run(async () => {
      await bootstrap()
      const { startUi } = await import("../ui/server")
      const { url, close } = await startUi({
        port: Number(opts.port) || 7777,
        host: opts.host,
        open: opts.open !== false,
      })
      console.log(`${bold("resumerank ui")}  ${cyan(url)}`)
      console.log(
        dim(
          `  data dir  ${dataHome()}\n` +
            `  Jev       ${jevStatus()}\n` +
            `  press Ctrl+C to stop`,
        ),
      )
      const stop = async (): Promise<void> => {
        await close()
        process.exit(0)
      }
      process.on("SIGINT", () => void stop())
      process.on("SIGTERM", () => void stop())
    })
  })

// --- notes ----------------------------------------------------------------

program
  .command("notes", { hidden: true })
  .description("List notes for a candidate")
  .argument("<resumeId>", "resume id")
  .option("--json", "output JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    await run(async () => {
      await bootstrap()
      const record = await resumeService.getResumeRecord(id)
      const { listNotes } = await import("../store/local")
      const rows = await listNotes(record.id)
      if (opts.json) return printJson(rows)
      if (rows.length === 0) console.log(`No notes on ${record.originalFilename}.`)
      for (const note of rows) console.log(`${dim(shortId(note.id))}  ${dim(formatDate(note.createdAt))}\n  ${note.content}`)
    })
  })

program
  .command("note", { hidden: true })
  .description("Add a note to a candidate")
  .argument("<resumeId>", "resume id")
  .argument("<text...>", "note text")
  .action(async (id: string, text: string[]) => {
    await run(async () => {
      await bootstrap()
      const record = await resumeService.getResumeRecord(id)
      const { addNote } = await import("../store/local")
      const note = await addNote(record.id, text.join(" "))
      console.log(`${green("note added")} ${dim(shortId(note.id))} → ${record.originalFilename}`)
    })
  })

program
  .command("rm-note", { hidden: true })
  .description("Delete a note")
  .argument("<noteId>", "note id")
  .action(async (noteId: string) => {
    await run(async () => {
      await bootstrap()
      const { removeNote } = await import("../store/local")
      const ok = await removeNote(noteId)
      if (!ok) throw new AppError("NOT_FOUND", `Note "${noteId}" not found.`)
      console.log(`${green("removed")} note ${dim(noteId)}`)
    })
  })

// --- misc ------------------------------------------------------------------

program
  .command("version", { hidden: true })
  .description("Print the version")
  .action(() => {
    console.log(VERSION)
  })

if (process.argv.slice(2).length === 0) program.help()

// The help list is deliberately short: this is a tool for people who will use the
// app, so the scripting verbs are hidden but still fully functional. Say so, or
// someone will conclude they were deleted.
program.addHelpText(
  "after",
  `\n${dim("Advanced commands (hidden here, still work):")} ${dim("add, list, show, remove, rank, explain,\n")}${dim("rankings, show-ranking, export, rm-ranking, status, skills, cache, doctor, eval, notes,\n")}${dim("note, rm-note, version.")} ${dim("They are documented in the README.")}\n`,
)

await program.parseAsync(process.argv)

// Keep the process quiet if something still holds a handle.
void cyan
void basename
