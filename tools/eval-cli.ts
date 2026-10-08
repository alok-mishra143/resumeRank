// Thin runner used while iterating on accuracy (same code path as `resumerank eval`).
// Loads .env first so the Jev layer is active exactly like in the CLI.
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })

const { runEval } = await import("../src/eval/harness")

const args = process.argv.slice(2)
const get = (flag: string, fallback?: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}
const report = await runEval({
  corpus: get("--corpus", "corpus")!,
  offline: args.includes("--offline"),
  reset: !args.includes("--no-reset"),
  verbose: args.includes("--verbose"),
})
console.log(JSON.stringify(report.metrics, null, 1))
