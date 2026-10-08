// The uninstaller deletes files, so its decisions are pinned here: a source
// checkout must survive, a launcher belonging to something else must survive, and
// the candidate data is only removed when it was explicitly asked for.
import { describe, expect, it } from "vitest"
import { planUninstall, type PlanInput } from "../src/cli/uninstall"

const base: PlanInput = {
  appDir: "/opt/resumerank",
  launchers: [
    { path: "/home/u/.local/bin/resumerank", exists: true, owned: true, fromMarker: true },
    { path: "/usr/local/bin/resumerank", exists: false, owned: false, fromMarker: false },
  ],
  appsDir: "/home/u/.local/share/applications",
  iconsDir: "/home/u/.local/share/icons",
  dataDir: "/home/u/.resumerank",
  installedApp: true,
  purgeData: false,
}

const kinds = (plan: ReturnType<typeof planUninstall>, kind: string): string[] =>
  plan.candidates.filter((c) => c.kind === kind).map((c) => c.path)

describe("uninstall planner", () => {
  it("removes the app, launcher, menu entry and icon of an installed copy", () => {
    const plan = planUninstall(base)
    expect(kinds(plan, "app directory")).toEqual(["/opt/resumerank"])
    expect(kinds(plan, "menu entry")).toEqual(["/home/u/.local/share/applications/resumerank.desktop"])
    expect(kinds(plan, "icon")).toEqual(["/home/u/.local/share/icons/resumerank.svg"])
    expect(plan.willRemove.map((c) => c.path)).toContain("/home/u/.local/bin/resumerank")
  })

  it("never deletes a source checkout", () => {
    const plan = planUninstall({ ...base, installedApp: false })
    const appDir = plan.candidates.find((c) => c.kind === "app directory")
    expect(appDir?.remove).toBe(false)
    expect(appDir?.detail).toContain("source checkout")
    expect(plan.willRemove.map((c) => c.path)).not.toContain("/opt/resumerank")
  })

  it("keeps the candidate data unless --purge was asked for", () => {
    expect(planUninstall(base).candidates.find((c) => c.kind === "data")?.remove).toBe(false)
    const purged = planUninstall({ ...base, purgeData: true })
    expect(purged.candidates.find((c) => c.kind === "data")?.remove).toBe(true)
    expect(purged.willRemove.map((c) => c.path)).toContain("/home/u/.resumerank")
  })

  it("leaves a launcher that belongs to something else, and one that is absent", () => {
    const plan = planUninstall({
      ...base,
      launchers: [
        { path: "/home/u/.local/bin/resumerank", exists: true, owned: true, fromMarker: true },
        { path: "/usr/local/bin/resumerank", exists: true, owned: false, fromMarker: false },
        { path: "/home/u/bin/resumerank", exists: false, owned: false, fromMarker: false },
      ],
    })
    const foreign = plan.candidates.find((c) => c.path === "/usr/local/bin/resumerank")
    const missing = plan.candidates.find((c) => c.path === "/home/u/bin/resumerank")
    expect(foreign?.remove).toBe(false)
    expect(foreign?.detail).toContain("not a resumerank launcher")
    expect(missing?.remove).toBe(false)
    expect(missing?.detail).toBe("not present")
  })

  it("treats a marker-named launcher as ours even if its contents changed", () => {
    const plan = planUninstall({
      ...base,
      launchers: [{ path: "/home/u/.local/bin/resumerank", exists: true, owned: false, fromMarker: true }],
    })
    expect(plan.willRemove.map((c) => c.path)).toContain("/home/u/.local/bin/resumerank")
  })

  it("reports what it is keeping so nothing disappears silently", () => {
    const plan = planUninstall(base)
    expect(plan.keeping.map((c) => c.kind)).toEqual(["launcher", "data"])
    expect(plan.willRemove.length + plan.keeping.length).toBe(plan.candidates.length)
  })
})
