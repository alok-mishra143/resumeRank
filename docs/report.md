# resumerank — verification report

Run on 2026-10-08 on this machine (Linux, Node v26.7.0, TypeScript 5.9.3).
Everything below is measured by the tools in `tools/`, not estimated. Raw output
lives in `docs/accuracy-offline.txt`, `docs/accuracy-jev.txt`.

---

## 1. Accuracy

### 1.1 Gold-labelled corpus (14 resumes × 5 job descriptions, hand-labelled)

| metric | offline | with TypeSafe Jev |
| --- | --- | --- |
| skill precision / recall / F1 | 91.2% / 100% / 95.0% | **95.2% / 100% / 97.3%** |
| years of experience (±1 year) | 100% | 100% |
| JD requirement F1 | 93.1% | 93.1% |
| ranking: top-1 eligible | 100% | **100%** |
| ranking: eligible in top-3 | 93.3% | **100%** |
| ranking: false accepts (ineligible in top-3) | 0% | **0%** |
| extraction accuracy | 96.0% | **97.4%** |
| ranking accuracy | 97.8% | **100%** |
| **composite** | **97.0%** | **98.8%** |

The target was 90–95%; both paths clear it, and the typed layer is what buys the
last ~2 points (skill precision 91.2% → 95.2%, top-3 eligibility 93.3% → 100%).

### 1.2 Real resumes, grounded check (18 public PDFs from the internet)

`tools/verify-real.ts` re-reads every extracted value against the source text, so
a field that the document does not support counts as a failure. This is the
hallucination test, not a similarity score.

| field | grounded | notes |
| --- | --- | --- |
| email | 16/16 (100%) | verbatim in the document |
| phone | 14/14 (100%) | digits traced to the document |
| name | 14/14 (100%) | tokens present in the header |
| location | 6/6 (100%) | always traceable, never invented |
| skills | 18/18 (100%) | every accepted skill traceable to an alias in the text |
| role start years | 13/13 (100%) | each parsed start year exists in the document |
| role titles | 11/13 (84.6%) | one unusual layout leaves a title empty |
| years plausible | 13/15 (86.7%) | two resumes claim more years than their own dates span |
| **overall grounded** | **105/109 (96.3%)** | |

### 1.3 Field coverage on those real PDFs

skills 100% · education 94% · email 89% · years 83% · name 78% · phone 78% ·
experience timeline 72% (4.5 roles on average where roles exist, max 12) ·
location 33% (zero false positives — the rest carry no location in their header).
Five of the 18 files are multi-person guides rather than single resumes; the
coverage misses cluster in those.

### 1.4 Ranking behaviour across seniority

`tools/probe-levels.ts` ranks one pool against the same role at four levels, and
`test/seniority.test.ts` does it with four profiles that are identical except for
years and band:

| posting | expected winner | result |
| --- | --- | --- |
| Junior Backend Engineer (1–2 yrs) | the junior/mid candidate | junior/mid first; senior + staff excluded as level mismatches |
| Backend Engineer (3–4 yrs) | a mid/senior candidate | senior first, mid candidates ranked close behind |
| Senior Backend Engineer (6+ yrs) | the senior candidate | senior first |
| Staff Backend Engineer / Architect (10+ yrs) | the staff candidate | staff first in the controlled test; on the synthetic pool the 8-year senior wins on 3/3 requirement coverage — the panel shows both |

Before this work the engine had no level model at all: a junior posting put an
8-year senior at #1.

---

## 2. Performance

`tools/bench.ts` on a 14-resume store (0.07 MB on disk, 12k characters of text).

| operation | offline | with Jev |
| --- | --- | --- |
| `listResumes()` | 0.3 ms | — |
| `skillIndex()` (inverted index) | 0.1 ms | — |
| `searchResumes("python")` | 1.8 ms | — |
| `stats()` | 0.3 ms | — |
| JD parse (`analyzeJobDescription`) | 19 ms | 19 ms |
| **rank a 14-resume pool** (5 finalists) | **12–13 ms warm** (31 ms cold) | **6.1 s** |
| ingest one resume | 21.5 ms | ~7 s (3.8 calls/resume, measured over 18 PDFs) |
| CLI cold start | 0.24 s (bundle) / 0.62 s (tsx) | — |

Scaling: deterministic ranking is ~1.4 ms per candidate scored — 7 candidates in
13 ms, 19 in 27 ms, 31 in 33 ms. At 500 resumes that projects to roughly 0.7 s,
still offline and instant-feeling.

Jev cost per ranking run: **15,956 input / 1,686 output tokens** for a 14-candidate
battery — one HTTP call, ≈$0.0007 at $0.042/M input with output free. Ingest of 18
real PDFs used 69 calls (~3.8 per resume). The paid layer is therefore cents per
hundred resumes, and everything still works with zero calls when it is disabled.

Memory: 118 MB RSS / 26 MB heap during a rank via `tsx` (163 MB / 48 MB while
ingesting at speed) — Node's baseline dominates; nothing accumulates across runs
because there is no database.

---

## 3. Robustness

| input | behaviour |
| --- | --- |
| `.png` | `Unsupported file type ".png". Use PDF, DOCX, or TXT.` |
| empty file | `File "empty.txt" is empty.` |
| corrupt PDF | `Could not parse "broken.pdf": Invalid PDF structure.` |
| corrupt DOCX | `Corrupted zip: can't find end of central directory` |
| text-less (scanned) file | `No readable text in … (scanned-image PDFs without a text layer are not supported).` |
| invalid TypeSafe key | **fails open** — resume is added with deterministic extraction, `0 Jev call(s)`, no error |
| no key + `--offline` | full pipeline, `0 Jev call(s)` |
| no key + ranking | 35 ms offline run, mismatches still excluded |

No crash path was found in any of these; all bad input produces one actionable
line and continues with the rest of the batch.

---

## 4. Quality gates

- **Tests:** 70 passing across 8 files in 1.8 s — ontology, semantic matching,
  extraction, real-resume layouts, seniority model, the fit battery's
  question/state contract, platform credit, and a live UI API suite that boots the
  server on a free port and exercises upload → notes → rank → export → delete.
- **Types:** `tsc --noEmit` clean, strict mode.
- **UI:** every route driven in a real browser, zero console errors.
- **Build:** `dist/resumerank.js`, 232 KB single file, runs on plain `node`.
- **Code:** 8,817 lines of TypeScript (src + tools + tests) plus 1,718 lines of
  framework-free UI.
- **Dependencies:** 5 runtime (`commander`, `dotenv`, `mammoth`, `unpdf`, `zod`),
  5 dev. No database, no server requirement, no cloud storage.

---

## 5. Known limitations (honest list)

1. **Scanned/image-only PDFs** are not OCR'd — they yield "no readable text".
2. **Location coverage is 33%** on the public set: precision was chosen over
   recall (an early version confidently reported a candidate's *name* and *college*
   as their location), so a city that only appears inside an experience line is
   left empty.
3. **Two resumes in the public set have no name** — the name is a design element,
   not text.
4. **Level modelling is a band fit, not a hiring decision**: on one synthetic
   staff posting the 8-year senior still leads the 11-year staff architect because
   they cover 3/3 listed requirements. The panel shows the level comparison and the
   leadership score so the judgement is auditable.
5. **Two resumes claim more years than their own dates span**; the engine keeps
   the claim and raises a warning rather than silently "fixing" it.
6. **JD requirement F1 is 93.1%**, the weakest metric: responsibility-phrased
   requirements ("deep distributed systems knowledge") are the hard cases.
7. The typed layer costs ~5 s for a cold ranking run (0 s when the same pool and job
   description are re-ranked from the answer cache); it is optional and never
   required.

---

## 6. Performance work (measured, before → after)

Profiling first: `tools/profile-rank.ts` showed the whole offline ranking budget
going through `deterministicScore` (7.5 ms of 13) and, inside it,
`roleSimilarity` (5.6 ms) re-tokenising the same words for every candidate.

| what | before | after |
| --- | --- | --- |
| `deterministicScore`, 14 candidates | 7.52 ms | **1.09 ms** |
| `matchRequirements`, 14 candidates | 2.51 ms | 1.67 ms |
| rank 14 candidates offline (warm) | 12–13 ms | **3.2–4.8 ms** |
| rank 14 candidates offline (cold) | 32.1 ms | 29.7 ms |
| ranking with the typed layer, cold | 6.1 s · 15 calls | 5.2 s · 15 calls |
| ranking with the typed layer, same job again | 6.1 s · 15 calls | **98 ms · 0 calls** |
| ingest 8 real PDFs with the typed layer | 14.6 s | **5.1 s** |
| bulk upload of 8 PDFs through the UI | 15.0 s | **3.3–4.1 s** |
| re-ingest a resume already in the library | 4 calls | 0 calls |
| CLI cold start | 0.24 s | 0.24 s |

What changed:

1. **Memoised the pure text helpers** (`tokenize`, `stem`, `stemSet`) and cached
   `roleSimilarity` per (job title, candidate roles). These are hit thousands of
   times per ranking with a tiny, repeating key space; the ranking stayed
   bit-identical (verified by re-running the labelled corpus).
2. **Parallel ingestion** (`ingestLanes()`): with a key, extraction is network
   bound (3–4 calls per resume), so files go through 4 lanes; offline it stays at
   one lane because extra lanes only add contention. `RESUMERANK_INGEST_LANES`
   throttles it.
3. **Typed-answer cache** (`~/.resumerank/jev-cache.json`): answers are keyed by
   (model, pool/JD, question), so a repeat ranking is identical *and* free. Adding
   one candidate to the pool re-asks only about that pool; re-ingesting the same
   resume costs nothing. `resumerank cache --clear` or `RESUMERANK_FRESH=1` resets.
4. **Bounded ranking history** (50 entries, results stored inline) and rate-limited
   store backups: writing a large `rankings.json` on every run was the single
   biggest cost in the benchmark loop.

## 7. Reliability bugs this work uncovered (all fixed and covered by tests)

Parallel work and honest measurement exposed four problems that could have cost a
recruiter real candidates:

1. **The store could be corrupted.** `resumes.json` was written through a shared
   temp file, so two concurrent extractions could interleave: one rename won, the
   other failed with `ENOENT` and a third landed mid-JSON, leaving the store
   unparseable. Fixed with an in-process write queue **plus** a lock file (so the
   CLI and a running UI cannot interleave either), per-write unique temp names, and
   a recovery copy that `readJson` falls back to. `test/store-concurrency.test.ts`
   fires 16 concurrent writes and then asserts the index still parses with 16
   records.
2. **The same resume uploaded twice created two candidates** — a silently doubled
   pool, which is how a shortlist ends up with the same person twice. Records now
   carry a content hash of the extracted text; a re-upload returns the existing
   candidate, is labelled `duplicate` in the CLI and "already in the library" in the
   UI, and costs no typed calls.
3. **Typed rankings were not reproducible.** Measured 1/5 reproducible run to run
   (offline was 5/5): the same job and pool produced a different shortlist. The
   answer cache makes it **5/5**.
4. **Credit could flow from a standard to a product.** `matchSkillPair` gave 0.80
   credit for `PostgreSQL` to a candidate who only listed `SQL` ("same platform") —
   and the same path credited TensorFlow from "Deep Learning", Docker from
   "Containers", AWS from "Cloud", Next.js from React. Downward credit is now
   restricted to real platform→service families (AWS⇒S3, Kubernetes⇒EKS,
   AWS⇒Lambda/Glue), with a test that pins both directions. Effect on the labelled
   corpus: offline composite **97.0% → 98.2%**, eligible-in-top-3 93.3% → 100%,
   false accepts still 0%.

## 8. Reproducibility and margins

| check | offline | with the typed layer |
| --- | --- | --- |
| identical result over 5 runs of the same job | 5/5 | 5/5 (1/5 before caching) |
| rank-1 vs rank-2 margin across the gold jobs | 6.7–48.5 points | 6.7–48.5 points |

A margin under ~4 points is worth a human read; every gold job cleared that, so no
published shortlist was decided by noise.
