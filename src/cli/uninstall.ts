// ---------------------------------------------------------------------------
// `resumerank uninstall` — undo install.sh.
//
// Two things an uninstaller must not get wrong:
//   1. a source checkout looks like an installed copy from the inside, so the app
//      directory is only removable when the installer's marker is there;
//   2. a launcher on the PATH may belong to ANOTHER install (or to the user's own
//      script), so each candidate is verified before it is proposed for removal.
// The plan is computed by a pure function so all of that is testable.
// ---------------------------------------------------------------------------

import { readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { dataHome, paths } from "../config"

export const INSTALL_MARKER = ".resumerank-install"

export interface LauncherInfo {
  path: string
  exists: boolean
  /** Its contents point at a resumerank bundle rather than something else. */
  owned: boolean
  /** Recorded by the installer marker, so it is definitely ours. */
  fromMarker: boolean
}

export interface UninstallCandidate {
  path: string
  kind: "launcher" | "menu entry" | "icon" | "app directory" | "data"
  remove: boolean
  detail: string
}

export interface UninstallPlan {
  candidates: UninstallCandidate[]
  dataDir: string
  willRemove: UninstallCandidate[]
  keeping: UninstallCandidate[]
}

export interface PlanInput {
  appDir: string
  launchers: LauncherInfo[]
  appsDir: string
  iconsDir: string
  dataDir: string
  /** The installer's marker is present in appDir. */
  installedApp: boolean
  /** Only true when the user asked for --purge. */
  purgeData: boolean
}

export function planUninstall(input: PlanInput): UninstallPlan {
  const candidates: UninstallCandidate[] = []

  for (const launcher of input.launchers) {
    const removable = launcher.fromMarker || (launcher.exists && launcher.owned)
    candidates.push({
      path: launcher.path,
      kind: "launcher",
      remove: removable,
      detail: removable
        ? launcher.fromMarker
          ? "the command on your PATH (named by the install marker)"
          : "the command on your PATH"
        : launcher.exists
          ? "left alone: this file is not a resumerank launcher"
          : "not present",
    })
  }

  candidates.push({
    path: join(input.appsDir, "resumerank.desktop"),
    kind: "menu entry",
    remove: true,
    detail: "the applications-menu entry",
  })
  candidates.push({
    path: join(input.iconsDir, "resumerank.svg"),
    kind: "icon",
    remove: true,
    detail: "the icon image",
  })
  candidates.push({
    path: input.appDir,
    kind: "app directory",
    remove: input.installedApp,
    detail: input.installedApp
      ? "the installed program files"
      : `left alone: no ${INSTALL_MARKER} here, so this is a source checkout rather than an installed copy`,
  })
  candidates.push({
    path: input.dataDir,
    kind: "data",
    remove: input.purgeData,
    detail: input.purgeData
      ? "your local store: resumes, texts, rankings, notes, config and the answer cache"
      : "kept: your resumes, rankings and notes stay on disk",
  })

  return {
    candidates,
    dataDir: input.dataDir,
    willRemove: candidates.filter((c) => c.remove),
    keeping: candidates.filter((c) => !c.remove),
  }
}

export async function readInstallMarker(appDir: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(appDir, INSTALL_MARKER), "utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

async function inspectLauncher(path: string): Promise<LauncherInfo> {
  try {
    const info = await stat(path)
    const body = info.isFile() ? (await readFile(path, "utf8")).slice(0, 4000) : ""
    return { path, exists: true, owned: /resumerank/.test(body), fromMarker: false }
  } catch {
    return { path, exists: false, owned: false, fromMarker: false }
  }
}

/** Where the launcher and menu entry normally live, honouring the installer's env. */
export function defaultUninstallPaths(): { binDirs: string[]; appsDir: string; iconsDir: string } {
  const home = process.env.HOME ?? ""
  const binDirs = [process.env.RESUMERANK_BIN, join(home, ".local", "bin")].filter(
    (dir): dir is string => typeof dir === "string" && dir.length > 0,
  )
  return {
    binDirs: [...new Set(binDirs)],
    appsDir: process.env.RESUMERANK_APPS_DIR ?? join(home, ".local", "share", "applications"),
    iconsDir: process.env.RESUMERANK_ICONS_DIR ?? join(home, ".local", "share", "icons"),
  }
}

export interface UninstallOptions {
  appDir: string
  binDirs: string[]
  appsDir: string
  iconsDir: string
  purgeData?: boolean
  /** Overrides the marker lookup (tests). */
  marker?: Record<string, unknown> | null
}

export async function buildUninstallPlan(options: UninstallOptions): Promise<UninstallPlan> {
  const marker = options.marker === undefined ? await readInstallMarker(options.appDir) : options.marker
  const markerBin = typeof marker?.bin === "string" ? marker.bin : null

  const paths = new Set<string>(options.binDirs.map((dir) => join(dir, "resumerank")))
  if (markerBin) paths.add(markerBin)

  const launchers: LauncherInfo[] = []
  for (const path of paths) {
    const info = await inspectLauncher(path)
    launchers.push({ ...info, fromMarker: markerBin === path })
  }

  return planUninstall({
    appDir: options.appDir,
    launchers,
    appsDir: options.appsDir,
    iconsDir: options.iconsDir,
    dataDir: dataHome(),
    installedApp: marker !== null,
    purgeData: options.purgeData === true,
  })
}

/** Execute a plan. A missing file is fine; anything else is reported. */
export async function applyUninstall(
  plan: UninstallPlan,
): Promise<{ removed: string[]; failed: Array<{ path: string; error: string }> }> {
  const removed: string[] = []
  const failed: Array<{ path: string; error: string }> = []
  for (const candidate of plan.willRemove) {
    try {
      await rm(candidate.path, { recursive: true, force: true })
      removed.push(candidate.path)
    } catch (err) {
      failed.push({ path: candidate.path, error: err instanceof Error ? err.message : String(err) })
    }
  }
  void paths().jevCache // the cache lives in the data dir, so --purge covers it
  return { removed, failed }
}
