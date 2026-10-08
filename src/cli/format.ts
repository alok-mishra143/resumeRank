// Terminal formatting helpers. No color when not a TTY (keeps piping clean).

const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.RESUMERANK_NO_COLOR === undefined &&
  process.stdout.isTTY === true

function wrap(code: string, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text
}

export const bold = (t: string): string => wrap("1", t)
export const dim = (t: string): string => wrap("2", t)
export const red = (t: string): string => wrap("31", t)
export const green = (t: string): string => wrap("32", t)
export const yellow = (t: string): string => wrap("33", t)
export const cyan = (t: string): string => wrap("36", t)

export function truncate(s: string, width: number): string {
  const clean = (s ?? "").replace(/\s+/g, " ").trim()
  if (clean.length <= width) return clean
  return `${clean.slice(0, Math.max(0, width - 1))}…`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "-"
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").replace(/\u001b\[\d+m/g, "").length)),
  )
  const line = (cells: string[]): string =>
    cells.map((c, i) => padCell(c, widths[i])).join("  ")
  const out = [bold(line(headers)), dim(widths.map((w) => "-".repeat(w)).join("  "))]
  for (const row of rows) out.push(line(row))
  return out.join("\n")
}

function padCell(cell: string, width: number): string {
  const visible = cell.replace(/\u001b\[\d+m/g, "").length
  return cell + " ".repeat(Math.max(0, width - visible))
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

export function bar(value0to100: number, width = 12): string {
  const filled = Math.round((Math.min(Math.max(value0to100, 0), 100) / 100) * width)
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}
