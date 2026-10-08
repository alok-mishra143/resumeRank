// Probe parseExperience on raw lines (no store needed).
import { parseExperience } from "../src/extract/deterministic"

const cases: Array<[string, string[]]> = [
  [
    "h0rv (role - company dates)",
    ["EXPERIENCE", "Software Engineer - Sweetspot July 2025 – April 2026", "Built things.", "DevOps Engineer - Anatomy Financial October 2024 – July 2025", "Did more."],
  ],
  [
    "role, company (dates)",
    ["WORK EXPERIENCE", "Senior Backend Engineer, Northwind Cloud (Jan 2019 – Present)", "Owned services."],
  ],
  [
    "company — role",
    ["PROFESSIONAL EXPERIENCE", "Google — Senior Software Engineer 2020 - 2023", "Search infra."],
  ],
  [
    "role at company",
    ["EXPERIENCE", "Data Analyst at Acme Corp 2021–2023", "Dashboards."],
  ],
  [
    "two-line role then company+city",
    ["EXPERIENCE", "Senior Software Engineer", "Stripe, San Francisco, CA", "Jan 2020 – Present", "Payments work."],
  ],
  [
    "pipe separated",
    ["EXPERIENCE", "QA Engineer | Zephyr Labs | 2018 - 2021", "Test suites."],
  ],
  ["inline dates first", ["EXPERIENCE", "2020 – 2022", "Sole Engineer, Tiny Co", "Built the product."]],
]

for (const [label, lines] of cases) {
  const parsed = parseExperience(lines.join("\n"))
  console.log(`\n${label}`)
  for (const p of parsed) console.log(`   role=${JSON.stringify(p.role)} company=${JSON.stringify(p.company)} ${p.startDate}→${p.isCurrent ? "present" : p.endDate} bullets=${p.bullets.length}`)
  if (!parsed.length) console.log("   (nothing parsed)")
}
