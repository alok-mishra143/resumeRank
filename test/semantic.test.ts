import { describe, expect, it } from "vitest"
import { coverageFromMatches, jaccard, matchSkillPair, relatedSkills, tokenOverlap } from "../src/ranking/semantic"
import { roleSimilarity } from "../src/ranking/scoring"
import { stemSet, tokenize } from "../src/ranking/semantic"

describe("semantic skill matching", () => {
  it("gives full credit when the candidate names a concrete service of the requirement", () => {
    const s3 = matchSkillPair("AWS", ["S3"])
    expect(s3.score).toBe(1)
    expect(s3.via).toBe("specific")

    expect(matchSkillPair("Kubernetes", ["EKS"]).score).toBe(1)
    expect(matchSkillPair("SQL", ["MySQL"]).score).toBe(1)
    expect(matchSkillPair("JavaScript", ["TypeScript"]).score).toBe(1)
    expect(matchSkillPair("Data Warehouse", ["Snowflake"]).score).toBe(1)
  })

  it("gives partial credit when the requirement is narrower than the candidate's skill", () => {
    const platform = matchSkillPair("S3", ["AWS"])
    expect(platform.via).toBe("platform")
    expect(platform.score).toBeCloseTo(0.8, 5)
    expect(matchSkillPair("Terraform", ["AWS"]).score).toBe(0)
  })

  it("rejects unrelated skills", () => {
    expect(matchSkillPair("Kubernetes", ["Figma"]).score).toBe(0)
    expect(matchSkillPair("PyTorch", ["Excel"]).score).toBe(0)
    expect(matchSkillPair("Rust", ["Customer Support"]).score).toBe(0)
  })

  it("accepts aliases and casing variants", () => {
    expect(matchSkillPair("Postgres", ["PostgreSQL"]).score).toBe(1)
    expect(matchSkillPair("k8s", ["Kubernetes"]).score).toBe(1)
    expect(matchSkillPair("Node", ["Node.js"]).score).toBe(1)
  })

  it("falls back to lexical similarity for skills outside the ontology", () => {
    const lexical = matchSkillPair("Kubernetes Operations", ["kubernetes operations"])
    expect(lexical.score).toBeGreaterThanOrEqual(0.6)
  })

  it("groups family members for reporting", () => {
    expect(relatedSkills("EKS", "GKE")).toBe(true)
    expect(relatedSkills("XGBoost", "scikit-learn")).toBe(true)
    expect(relatedSkills("Docker", "Kubernetes")).toBe(true)
    expect(relatedSkills("Docker", "Figma")).toBe(false)
  })

  it("scores coverage as the mean graded match", () => {
    const matches = [
      { requirement: "AWS", canonical: "AWS", matched: true, score: 1, via: "specific", evidence: "" },
      { requirement: "S3", canonical: "S3", matched: true, score: 0.8, via: "platform", evidence: "" },
      { requirement: "Go", canonical: "Go", matched: false, score: 0, via: "none", evidence: "" },
    ]
    expect(coverageFromMatches(matches)).toBeCloseTo(0.6, 5)
    expect(coverageFromMatches([])).toBe(0.5)
  })

  it("treats obligations written differently as overlapping text", () => {
    const tokens = stemSet(tokenize("built and maintained REST API services in Python"))
    expect(tokenOverlap("design REST APIs", tokens)).toBeGreaterThan(0.5)
    expect(tokenOverlap("run paid ad campaigns", tokens)).toBeLessThan(0.3)
  })

  it("keeps role families close and unrelated roles apart", () => {
    expect(roleSimilarity("Senior Backend Engineer", ["Backend Engineer"])).toBeGreaterThan(0.6)
    expect(
      roleSimilarity("Senior Backend Engineer", ["React Developer", "Node.js Engineer"]),
    ).toBeGreaterThan(0.2)
    expect(roleSimilarity("Senior Backend Engineer", ["Product Designer"])).toBeLessThan(0.2)
  })

  it("computes jaccard overlap between role strings", () => {
    expect(jaccard(["senior backend engineer"], ["backend engineer"])).toBeGreaterThan(0.4)
    expect(jaccard(["senior backend engineer"], ["qa analyst"])).toBe(0)
  })
})
