// Debug helper: JD parse + match + score for one text pair.
import { analyzeJobDescription } from "../src/ranking/jd"
import { matchRequirements } from "../src/ranking/semantic"
import { deterministicScore } from "../src/ranking/scoring"

const title = process.argv[2] ?? "Backend Engineer"
const description = process.argv[3] ?? "Requirements: Go, Kubernetes, AWS, Terraform."
const skills = (process.argv[4] ?? "Go,PostgreSQL,Kubernetes,AWS,Docker,Kafka,Redis,Python").split(",")

const requirements = analyzeJobDescription(title, description)
console.log("requirements:", JSON.stringify(requirements, null, 1))
const matches = await matchRequirements(requirements.requiredSkills ?? [], skills, { jevAssist: false })
console.log("matches:", matches.map((m) => `${m.requirement}=${m.score.toFixed(2)}/${m.via}`).join("  "))
const scored = deterministicScore({
  requirements,
  metadata: { skills, roles: ["Backend Engineer"], yearsOfExperience: 6 },
  resumeText: skills.join(" "),
  skillMatches: matches,
})
console.log("breakdown:", JSON.stringify(scored.breakdown), "score:", scored.score)
