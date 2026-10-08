import { describe, expect, it } from "vitest"
import { fitQuestions, fitState } from "../src/ranking/service"
import type { JobRequirements } from "../src/types"

// Regression guard for a bug that cost the precision layer ~45 points: the fit
// questions referenced `candidate.skills` while the state passes an array
// (`candidates[0]`), so Jev hedged at ~55% for every candidate regardless of
// fit. A question may only point at a path that exists in the state.

const requirements: JobRequirements = {
  role: "Senior Backend Engineer",
  requiredSkills: ["Go", "Kubernetes"],
  preferredSkills: ["Terraform"],
  minimumExperience: 5,
  responsibilities: ["own services"],
  domain: ["backend"],
}

const job = { title: "Senior Backend Engineer", description: "Go, Kubernetes. 5+ years.", requirements }

const candidates = [
  {
    id: "rs_a",
    summary: {
      filename: "a.txt",
      skills: ["Go", "Kubernetes"],
      matched_required_skills: ["Go", "Kubernetes"],
      missing_required_skills: [],
      years_of_experience: 8,
      seniority: "senior",
      resume_excerpt: "…",
    },
  },
  {
    id: "rs_b",
    summary: {
      filename: "b.txt",
      skills: [],
      matched_required_skills: [],
      missing_required_skills: ["Go", "Kubernetes"],
      years_of_experience: null,
      seniority: "",
      resume_excerpt: "…",
    },
  },
]

describe("fit battery contract", () => {
  it("addresses candidates by array index, not as a singular object", () => {
    const questions = fitQuestions(candidates)
    expect(Object.keys(questions)).toEqual([
      "fit__0__skills",
      "fit__0__experience",
      "fit__0__overall",
      "fit__1__skills",
      "fit__1__experience",
      "fit__1__overall",
    ])
    const text = JSON.stringify(questions)
    expect(text).not.toMatch(/`candidate\./)
    expect(text).toContain("candidates[0]")
    expect(text).toContain("candidates[1]")
  })

  it("every path a question references exists in the state", () => {
    const state = fitState(job, candidates) as Record<string, unknown>
    const questions = fitQuestions(candidates)

    // Every backticked token in a question, e.g. `candidates[0].skills`.
    const referenced = new Set<string>()
    for (const question of Object.values(questions)) {
      const instructions = (question as { instructions: string }).instructions
      for (const match of instructions.matchAll(/`([A-Za-z_][A-Za-z0-9_.[\]]*)`/g)) {
        referenced.add(match[1])
      }
    }
    expect(referenced.size).toBeGreaterThan(0)

    for (const path of referenced) {
      const [head, ...rest] = path.split(".")
      const arrayMatch = head.match(/^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/)
      const root = arrayMatch ? arrayMatch[1] : head
      expect(state, `question references unknown state key "${root}"`).toHaveProperty(root)

      // If the head addresses an array element, that element must be an object.
      if (arrayMatch) {
        const list = state[root] as unknown[]
        expect(Array.isArray(list), `"${root}" should be an array in the state`).toBe(true)
        const index = Number(arrayMatch[2])
        expect(index).toBeLessThan(list.length)
        const element = list[index] as Record<string, unknown>
        const field = rest[0]?.split(/[[.]/)[0]
        if (field && !field.includes("[")) {
          expect(Object.keys(element), `"${path}" missing from the candidate summary`).toContain(field)
        }
      }
    }
  })

  it("keeps the required/preferred split out of the question text", () => {
    const text = JSON.stringify(fitQuestions(candidates))
    expect(text).toMatch(/required skills/i)
    expect(text).not.toMatch(/undefined|null/)
  })
})
