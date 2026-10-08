// Core data shapes. No database anywhere: these are the JSON records the local
// store reads and writes under ~/.resumerank.

/** Flat metadata the ranking engine actually reads. */
export interface ResumeMetadata {
  skills?: string[]
  roles?: string[]
  yearsOfExperience?: number | null
  education?: string[]
  projects?: string[]
  certifications?: string[]
  /** Choice answer from Jev (or deterministic guess offline). */
  seniority?: string
  /** Choice answer from Jev (or deterministic guess offline). */
  domain?: string
}

/** One work-experience entry from structured extraction. */
export interface ExperienceEntry {
  company: string
  role: string
  startDate: string
  endDate: string
  isCurrent: boolean
  bullets: string[]
  skills: string[]
}

export interface EducationEntry {
  school: string
  degree: string
  field: string
  startYear: string
  endYear: string
}

/** Full structured profile of a resume. */
export interface ResumeStructured {
  fullName: string
  headline: string
  summary: string
  contact: { email: string; phone: string; location: string; links: string[] }
  skills: Array<{ name: string; level: string; years: number | null }>
  experience: ExperienceEntry[]
  education: EducationEntry[]
  projects: Array<{ name: string; description: string; skills: string[]; url: string }>
  certifications: Array<{ name: string; issuer: string; year: string }>
  languages: Array<{ name: string; proficiency: string }>
  totalYearsExperience: number | null
}

/** A stored resume record (one JSON object per candidate in the local store). */
export interface ResumeRecord {
  id: string
  originalFilename: string
  extractedText: string
  metadata: ResumeMetadata
  structured: ResumeStructured
  /** Per-skill provenance: how each skill was accepted. */
  provenance: Record<string, string>
  /** Typed Jev evidence gathered during extraction (empty when offline). */
  verification?: {
    model: string
    scores: Record<string, number>
    answers?: Record<string, unknown>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  /** Canonical skill set after semantic normalization (fast matching index). */
  canonicalSkills: string[]
  quality: { extractionConfidence: number; warnings: string[] }
  createdAt: string
  updatedAt: string
  byteSize: number
  /** sha256 of the extracted text: used to detect re-uploads. */
  contentHash?: string
}

/** Seniority bands used to compare a job posting with a candidate. */
export type SeniorityLevel = "junior" | "mid" | "senior" | "staff"

export interface JobRequirements {
  role?: string
  requiredSkills?: string[]
  preferredSkills?: string[]
  minimumExperience?: number | null
  responsibilities?: string[]
  domain?: string[]
  /** The band the posting is hiring for, inferred from the title and the years bar. */
  level?: SeniorityLevel | null
}

export interface RankingWeights {
  requiredSkills: number
  experience: number
  roleSimilarity: number
  responsibilities: number
  domain: number
  preferredSkills: number
  /** How much the candidate's seniority band matching the posting's matters. */
  levelFit: number
  /** Leadership/scope evidence — only weighted when the posting asks for it. */
  leadership: number
}

export interface SkillMatch {
  requirement: string
  canonical: string
  matched: boolean
  score: number
  /** How the match was made: exact | alias | specific | platform | lexical | jev | none */
  via: string
  evidence: string
}

export interface CandidateAnalysis {
  score: number
  strengths: string[]
  gaps: string[]
  matchedRequirements: string[]
  missingRequirements: string[]
  reasoning: string
  skillMatches: SkillMatch[]
  mismatch: boolean
  mismatchReasons: string[]
}

export interface RankedItem {
  resumeId: string
  originalFilename: string
  rank: number
  finalScore: number
  deterministicScore: number
  semanticScore: number
  aiScore: number
  analysis: CandidateAnalysis
  /** Everything behind the rank, so the UI can show its work instead of a number. */
  judgement?: Judgement
}

export interface Judgement {
  model: string
  /** The typed Jev answers (percentages). Offline runs report a neutral 50. */
  jev: { skills: number; experience: number; overall: number; blended: number }
  components: ScoreBreakdown
  matched: Array<{ requirement: string; via: string; score: number }>
  missing: Array<{ requirement: string; reason: string }>
  resume: {
    fullName: string | null
    seniority: string | null
    yearsOfExperience: number | null
    roles: string[]
    domain: string | null
    skillCount: number
  }
  /** Seniority band comparison, so the UI can show why a level mismatch happened. */
  level: {
    posting: SeniorityLevel | null
    candidate: SeniorityLevel | null
    distance: number | null
    leadership: number | null
  }
  bar: {
    minimumExperience: number | null
    requiredCount: number
    preferredCount: number
    requiredHits: number
    preferredHits: number
  }
  /** One line a human can audit: what convinced the engine, what it doubts. */
  verdict: string
}

export interface RankingRecord {
  id: string
  jobTitle: string
  jobDescription: string
  requirements: JobRequirements
  provider: string
  model: string
  candidateCount: number
  weights: RankingWeights
  /** Share of the final score that came from deterministic scoring (0–1). */
  deterministicWeight: number
  results: RankedItem[]
  excluded: Array<{ resumeId: string; originalFilename: string; reason: string }>
  createdAt: string
}

export interface RankingSummary {
  id: string
  jobTitle: string
  candidateCount: number
  model: string
  createdAt: string
}

export interface ScoreBreakdown {
  requiredSkills: number
  experience: number
  roleSimilarity: number
  responsibilities: number
  domain: number
  preferredSkills: number
  levelFit: number
  /** null when the posting does not ask for leadership, so it is not weighted. */
  leadership: number | null
}
