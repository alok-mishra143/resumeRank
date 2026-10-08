import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { AppError } from "../errors"
import type { ResumeRecord } from "../types"
import { extractTextFromBuffer } from "../extract/text"
import { extractProfile } from "../extract/service"
import {
  addResume as storeAddResume,
  contentHash,
  findByContentHash,
  getResume,
  listResumes,
  removeResume as storeRemoveResume,
  resumeText,
  saveOriginalFile,
  searchResumes,
  newId,
  shortId,
  type ResumeSummary,
} from "../store/local"

export interface AddResumeOptions {
  /** false disables the Jev layer for this ingest (pure offline extraction). */
  jev?: boolean
}

export async function addResumeFile(
  file: string,
  options: AddResumeOptions = {},
): Promise<ResumeRecord> {
  let data: Buffer
  try {
    data = await readFile(file)
  } catch {
    throw new AppError("VALIDATION_ERROR", `Cannot read file "${file}".`)
  }
  return addResumeFromBuffer(basename(file), data, options)
}

export async function addResumeFromBuffer(
  filename: string,
  data: Buffer,
  options: AddResumeOptions = {},
): Promise<ResumeRecord> {
  const text = await extractTextFromBuffer(filename, data)
  // Same file again (or the same resume saved under a new name): keep the
  // candidate pool clean instead of adding a second copy of the same person.
  const duplicate = await findByContentHash(text)
  if (duplicate) {
    const existing = await getResume(duplicate.id)
    if (existing) {
      existing.quality.warnings = [
        ...existing.quality.warnings.filter((w) => !w.startsWith("duplicate of")),
        `duplicate of ${existing.originalFilename} — this file was already in the library`,
      ]
      return existing
    }
  }
  const profile = await extractProfile(text, { jev: options.jev })
  const now = new Date().toISOString()
  const id = newId("rs")
  const record: ResumeRecord = {
    id,
    originalFilename: filename,
    extractedText: text,
    metadata: profile.metadata,
    structured: profile.structured,
    provenance: profile.provenance,
    verification: profile.verification,
    canonicalSkills: profile.canonicalSkills,
    quality: profile.quality,
    createdAt: now,
    updatedAt: now,
    byteSize: data.length,
    contentHash: contentHash(text),
  }
  await storeAddResume(record)
  await saveOriginalFile(id, filename, data).catch(() => {})
  return record
}

export async function addResumeFromText(
  filename: string,
  text: string,
  options: AddResumeOptions = {},
): Promise<ResumeRecord> {
  return addResumeFromBuffer(filename, Buffer.from(text, "utf8"), options)
}

export async function listResumeRecords(search?: string, limit = 100): Promise<ResumeSummary[]> {
  const rows = search ? await searchResumes(search, limit) : await listResumes()
  return rows.slice(0, limit)
}

export async function getResumeRecord(id: string): Promise<ResumeRecord> {
  const record = await getResume(id)
  if (!record) throw new AppError("NOT_FOUND", `Resume "${id}" not found.`)
  return record
}

export async function deleteResume(id: string): Promise<void> {
  const ok = await storeRemoveResume(id)
  if (!ok) throw new AppError("NOT_FOUND", `Resume "${id}" not found.`)
}

export { resumeText, shortId }
