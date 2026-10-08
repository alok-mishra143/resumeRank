// Probe: which Jev question shape actually discriminates strong vs weak fits?
// Usage: npx tsx tools/probe-fit.ts
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })

const { systemOneSafe, noul, score, choice, noulPercent, isScoreAnswer, isChoiceAnswer } = await import("../src/ai/jev")

const job = {
  title: "Senior Backend Engineer",
  required_skills: ["Go", "PostgreSQL", "Kubernetes", "Python", "Redis", "AWS", "Kafka"],
  minimum_experience: 5,
}

const strong = {
  filename: "software-engineer-backend.txt",
  years_of_experience: 8,
  seniority: "senior",
  skills: ["Go", "PostgreSQL", "Kubernetes", "AWS", "Kafka", "Redis", "Docker", "Python", "gRPC", "Terraform"],
  matched_required_skills: ["Go", "PostgreSQL", "Kubernetes", "Python", "Redis", "AWS", "Kafka"],
  missing_required_skills: [],
}

const weak = {
  filename: "support-ticket-analyst.txt",
  years_of_experience: 4,
  seniority: "mid",
  skills: ["SQL", "Zendesk", "Jira", "Excel", "Python"],
  matched_required_skills: ["PostgreSQL", "Python"],
  missing_required_skills: ["Go", "Kubernetes", "Redis", "AWS", "Kafka"],
}

const questions = {
  strong_noul: noul("Does `candidates[0]` demonstrate `job.required_skills`?", {
    true: "the candidate demonstrates the required skills, including via related technologies of the same platform",
    false: "the candidate lacks most of the required skills",
  }),
  weak_noul: noul("Does `candidates[1]` demonstrate `job.required_skills`?", {
    true: "the candidate demonstrates the required skills, including via related technologies of the same platform",
    false: "the candidate lacks most of the required skills",
  }),
  strong_score: score(
    "How much of `job.required_skills` does `candidates[0]` demonstrably cover, counting platform-level equivalents (AWS↔S3, Kubernetes↔EKS)?",
    [
      "no overlap",
      "about a quarter",
      "about half",
      "most — at most one gap",
      "essentially all, shown in production",
    ],
  ),
  weak_score: score(
    "How much of `job.required_skills` does `candidates[1]` demonstrably cover, counting platform-level equivalents (AWS↔S3, Kubernetes↔EKS)?",
    [
      "no overlap",
      "about a quarter",
      "about half",
      "most — at most one gap",
      "essentially all, shown in production",
    ],
  ),
  strongest: choice("Which candidate is the strongest fit for `job`, on skills and experience?", {
    strong: "candidates[0] — the backend engineer",
    weak: "candidates[1] — the support analyst",
    neither: "neither is a credible fit",
  }),
}

const res = await systemOneSafe({ job, candidates: [strong, weak] }, questions)
if (!res) {
  console.log("no response", config.typesafe.enabled)
  process.exit(1)
}
for (const [id, answer] of Object.entries(res.answers)) {
  if (isScoreAnswer(answer)) console.log(`${id.padEnd(14)} score=${answer.score} probs=${JSON.stringify(answer.probabilities)}`)
  else if (isChoiceAnswer(answer)) console.log(`${id.padEnd(14)} choice=${answer.choice} conf=${answer.confidence}`)
  else console.log(`${id.padEnd(14)} noul=${noulPercent(res.answers, id)}%`)
}
console.log("model:", res.model)
