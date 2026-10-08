// Guards a regression that is invisible until a user types the command: a new
// command chained after another one's .action() becomes a SUBCOMMAND, so it
// silently disappears from the top level (`resumerank ui` then prints help).
// This runs the real CLI and checks every documented command is registered.
import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const help = execFileSync("npx", ["tsx", "src/cli/index.ts", "--help"], {
  encoding: "utf8",
  timeout: 120_000,
})

/** Command names as commander prints them, aliases included ("dash|tui"). */
function topLevelCommands(output: string): Set<string> {
  const names = new Set<string>()
  for (const line of output.split("\n")) {
    const match = /^ {2}([a-z][a-z-]*(?:\|[a-z][a-z-]*)*)\b/.exec(line)
    if (match) for (const name of match[1].split("|")) names.add(name)
  }
  return names
}

describe("CLI surface", () => {
  const names = topLevelCommands(help)

  it("shows only the handful of commands a user needs", () => {
    // The audience is someone who will use the app, so the list is deliberately
    // short: open the app, two kinds of dashboard, set up, remove.
    // aliases count as names in the help output: report/tui/web
    expect([...names].sort()).toEqual([
      "dash",
      "dashboard",
      "help",
      "init",
      "report",
      "tui",
      "ui",
      "uninstall",
      "web",
    ])
  })

  it("keeps the aliases users may have in scripts", () => {
    for (const alias of ["tui", "web", "report"]) expect(names.has(alias), alias).toBe(true)
  })

  it("keeps the scripting verbs working even though they are hidden", { timeout: 180_000 }, () => {
    for (const command of ["add", "rank", "list", "explain", "export", "eval", "cache", "doctor", "status", "skills"]) {
      const out = execFileSync("npx", ["tsx", "src/cli/index.ts", command, "--help"], { encoding: "utf8", timeout: 120_000 })
      expect(out, `${command} should still resolve`).toContain(`Usage: resumerank ${command}`)
    }
  })

  it("says where the hidden commands went", () => {
    expect(help).toContain("Advanced commands (hidden here, still work)")
    expect(help).toContain("add, list, show, remove, rank")
  })

  it("describes the destructive command honestly", () => {
    const out = execFileSync("npx", ["tsx", "src/cli/index.ts", "uninstall", "--help"], { encoding: "utf8", timeout: 120_000 })
    expect(out).toContain("your data stays unless --purge")
    expect(out).toContain("--dry-run")
  })
})
