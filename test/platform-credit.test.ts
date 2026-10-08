import { describe, expect, it } from "vitest"
import { matchSkillPair } from "../src/ranking/semantic"

/**
 * Credit direction, in one place.
 *
 * Downward credit (the candidate names a broader thing than the requirement) is
 * reserved for platform <-> service families, where knowing the platform implies
 * you work in its ecosystem: AWS covers S3, Kubernetes covers EKS.
 *
 * A standard, a concept, a library or a language is NOT a platform: knowing SQL
 * does not mean knowing PostgreSQL, "Deep Learning" does not mean TensorFlow
 * (the candidate may use PyTorch), and React does not mean Next.js. Those
 * requirements credit only when the candidate names the product, or when the
 * typed layer confirms it — a resume screen that accepted SQL as PostgreSQL put
 * unqualified candidates in the shortlist.
 */
describe("platform credit is not prerequisite credit", () => {
  it("refuses credit for language prerequisites", () => {
    for (const [req, cand] of [
      ["TensorFlow", "Python"],
      ["PyTorch", "Python"],
      ["Django", "Python"],
      ["Spring Boot", "Java"],
      ["Laravel", "PHP"],
      ["Ruby on Rails", "Ruby"],
      ["ASP.NET", "C#"],
      ["Next.js", "JavaScript"],
      ["Jest", "JavaScript"],
    ] as const) {
      expect(matchSkillPair(req, [cand]).score, `${req} vs ${cand}`).toBe(0)
    }
  })

  it("refuses downward credit for standards, concepts and libraries", () => {
    for (const [req, cand] of [
      ["PostgreSQL", "SQL"],
      ["PostgreSQL", "Databases"],
      ["MySQL", "SQL"],
      ["Docker", "Containers"],
      ["AWS", "Cloud"],
      ["TensorFlow", "Deep Learning"],
      ["PyTorch", "Machine Learning"],
      ["Next.js", "React"],
      ["Spark", "Big Data"],
    ] as const) {
      expect(matchSkillPair(req, [cand]).score, `${req} vs ${cand}`).toBe(0)
    }
  })

  it("still credits platform relations in both directions", () => {
    expect(matchSkillPair("S3", ["AWS"]).score).toBe(0.8)
    expect(matchSkillPair("EKS", ["Kubernetes"]).score).toBe(0.8)
    expect(matchSkillPair("Glue", ["AWS"]).score).toBe(0.8)
    expect(matchSkillPair("Lambda", ["AWS"]).score).toBe(0.8)
  })

  it("still gives full credit when the candidate names the specific thing", () => {
    expect(matchSkillPair("Python", ["TensorFlow"]).score).toBe(1)
    expect(matchSkillPair("AWS", ["S3"]).score).toBe(1)
    expect(matchSkillPair("Kubernetes", ["EKS"]).score).toBe(1)
    expect(matchSkillPair("SQL", ["MySQL"]).score).toBe(1)
    expect(matchSkillPair("PostgreSQL", ["PostgreSQL"]).score).toBe(1)
  })
})
