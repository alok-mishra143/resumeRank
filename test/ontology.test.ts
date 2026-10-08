import { describe, expect, it } from "vitest"
import {
  ancestorsOfSkill,
  canonicalize,
  descendantsOfSkill,
  isAbstractSkill,
  knownSkills,
} from "../src/extract/ontology"

describe("skill ontology", () => {
  it("canonicalizes aliases to a single name", () => {
    expect(canonicalize("React.js")).toBe("React")
    expect(canonicalize("reactjs")).toBe("React")
    expect(canonicalize("postgres")).toBe("PostgreSQL")
    expect(canonicalize("k8s")).toBe("Kubernetes")
    expect(canonicalize("TS")).toBe("TypeScript")
    expect(canonicalize("node")).toBe("Node.js")
    expect(canonicalize("amazon web services")).toBe("AWS")
  })

  it("returns null for unknown labels", () => {
    expect(canonicalize("underwater basket weaving")).toBeNull()
  })

  it("knows that a concrete service implies its platform (S3 => AWS)", () => {
    expect(ancestorsOfSkill("S3")).toContain("AWS")
    expect(ancestorsOfSkill("EKS")).toEqual(expect.arrayContaining(["AWS", "Kubernetes"]))
    expect(ancestorsOfSkill("Redshift")).toEqual(expect.arrayContaining(["AWS", "Data Warehouse", "SQL"]))
    expect(ancestorsOfSkill("Next.js")).toEqual(expect.arrayContaining(["React", "Frontend"]))
  })

  it("knows the reverse direction too (AWS => S3 among its services)", () => {
    expect(descendantsOfSkill("AWS")).toEqual(expect.arrayContaining(["S3", "Lambda", "EKS", "DynamoDB"]))
    expect(descendantsOfSkill("Kubernetes")).toEqual(expect.arrayContaining(["EKS", "GKE", "Helm"]))
  })

  it("marks umbrella skills as abstract so they are never emitted", () => {
    expect(isAbstractSkill("Backend")).toBe(true)
    expect(isAbstractSkill("Mobile")).toBe(true)
    expect(isAbstractSkill("React")).toBe(false)
    expect(isAbstractSkill("CI/CD")).toBe(false)
  })

  it("has a broad but bounded dictionary", () => {
    const size = knownSkills().length
    expect(size).toBeGreaterThan(250)
    expect(size).toBeLessThan(600)
  })
})
