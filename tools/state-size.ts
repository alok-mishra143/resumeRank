// How many characters/tokens does the typed fit battery actually send?
import { config as loadDotenv } from "dotenv"

loadDotenv({ quiet: true })
const { fitState, fitQuestions } = await import("../src/ranking/service")
const { listResumes, resumeText } = await import("../src/store/local")
const { analyzeJobDescription } = await import("../src/ranking/jd")

const jd = `Senior Backend Engineer\n\nRequirements\n- 6+ years of experience\n- Strong Go or Python\n- PostgreSQL, Kubernetes, AWS, Kafka, Redis\n`
const requirements = analyzeJobDescription("Senior Backend Engineer", jd)

for (const excerptChars of [2500, 1200]) {
  const candidates: Array<{ id: string; summary: Record<string, unknown> }> = []
  for (const r of (await listResumes()).slice(0, 7)) {
    const text = await resumeText(r.id)
    candidates.push({
      id: r.id,
      summary: {
        filename: r.originalFilename,
        skills: (r.metadata?.skills ?? []).slice(0, 30),
        years_of_experience: r.metadata?.yearsOfExperience ?? null,
        seniority: r.metadata?.seniority ?? "",
        resume_excerpt: text.slice(0, excerptChars),
      },
    })
  }
  const state = fitState({ title: "Senior Backend Engineer", description: jd, requirements }, candidates)
  const questions = fitQuestions(candidates)
  const chars = JSON.stringify(state).length + JSON.stringify(questions).length
  console.log(`excerpt ${excerptChars}: state+questions ${chars} chars ≈ ${Math.round(chars / 4)} tokens`)
}
