// Which parsed roles are missing a title?
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { listResumes, resumeText } = await import("../src/store/local")

for (const r of await listResumes()) {
  const roles = r.structured?.experience ?? []
  const bad = roles.filter((e) => !e.role || e.role.length < 3)
  if (!bad.length) continue
  const text = await resumeText(r.id)
  console.log(`\n${r.originalFilename} — ${bad.length}/${roles.length} roles without a title`)
  for (const e of bad) {
    console.log(`   company=${JSON.stringify(e.company)} ${e.startDate}→${e.isCurrent ? "present" : e.endDate} bullets=${e.bullets.length}`)
    const anchor = (e.bullets[0] ?? "").slice(0, 30)
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
    const at = anchor ? lines.findIndex((l) => l.includes(anchor)) : -1
    if (at >= 0) {
      console.log(`   source around the first bullet:`)
      for (let i = Math.max(0, at - 4); i <= at; i += 1) console.log(`      ${JSON.stringify(lines[i].slice(0, 92))}`)
    }
  }
}
