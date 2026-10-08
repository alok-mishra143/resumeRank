# Accuracy report

Measured with `resumerank eval --corpus corpus` on the shipped corpus: **14
resumes, 5 job descriptions**, gold labels in `corpus/gold.json`. Raw harness
output: `docs/accuracy-jev.txt`, `docs/accuracy-offline.txt`.

## Results

| metric | offline (no key / `--offline`) | with TypeSafe Jev |
| --- | --- | --- |
| skill precision | 91.2% | **95.2%** |
| skill recall | 100% | 100% |
| skill F1 | 95.0% | **97.3%** |
| years of experience (±1y) | 100% | 100% |
| JD requirement F1 | 94.3% | 94.3% |
| top-1 candidate eligible | 100% | 100% |
| eligible in top-3 | 93.3% | 93.3% |
| false accepts (gold-ineligible in top-3) | 0% | 0% |
| extraction accuracy | 96.2% | **97.5%** |
| ranking accuracy | 97.8% | 97.8% |
| **composite** | **97.0%** | **97.7%** |

Both modes clear the 90–95% target; the Jev layer buys ~4 points of precision at
identical recall, which is exactly its job here: the deterministic pass proposes
(recall), Jev confirms with typed answers (precision).

## What the corpus actually tests

- **Misleading mentions.** `support-ticket-analyst.txt` contains a pasted job ad
  and a line reading *"Tech stack of the team I supported: React, Node.js,
  PostgreSQL, AWS"*, plus *"Exposure to basic Linux commands only"*. React,
  Node.js, MongoDB, AWS, Docker, Kubernetes and Linux are in its
  `forbiddenSkills`. Neither mode extracted any of them (leaks: 0).
- **Non-engineering fields.** A product designer, a product manager, a business
  analyst, a marketing manager and a support analyst are all in the corpus, with
  JDs for backend/data/devops roles: none of them entered a top-3 where gold says
  they should not.
- **Varied formats.** ALL-CAPS, Title Case and lowercase section headings; dates
  as `Jan 2019 – Mar 2022`, `2019-2022`, `Mar 2021 - Present`; one resume with
  dates on their own line; skills listed at the top in one, at the bottom in
  another; two without a contact block.
- **Semantic matching.** `j1` requires AWS and Kubernetes; `cloud-architect.txt`
  never writes "AWS S3" but lists services, `devops-sre.txt` lists `EKS`. Both are
  matched through the ontology (candidate names a service ⇒ full credit; candidate
  names only the platform ⇒ 0.8).

## How the metrics are defined

- **Skill precision/recall/F1** — per resume against `gold.json`. An extracted
  skill counts as a false positive when it is in the resume's `forbiddenSkills`,
  or when it is unexpected *and* neither (a) in the family of a gold skill per the
  ontology (e.g. `EKS` when gold lists `Kubernetes`) nor (b) declared by the
  resume itself in its skills/technology list. Recall counts gold skills found.
  Reported precision is therefore a strict measure: real skills the gold list
  simply did not enumerate are excused only when the resume declares them.
- **Years** — within ±1 year of the gold figure.
- **JD requirement F1** — the tool's extracted must-have list vs the gold list.
- **Ranking** — top-1 must be in the gold `eligible` set; `eligible in top-3`
  is the fraction of gold-eligible candidates present in the top 3 (capped at 3);
  `false accepts` counts jobs where a gold-ineligible candidate reached the top 3.
- **Composite** — `0.45 × extraction accuracy + 0.55 × ranking accuracy`, where
  extraction = `0.6 × skill F1 + 0.25 × years accuracy + 0.15 × JD F1` and ranking
  = `(top-1 + eligible coverage + (1 − false-accept rate)) / 3`.

## Reproducing

```bash
npx tsx src/cli/index.ts eval --corpus corpus --offline --verbose   # deterministic only
npx tsx src/cli/index.ts eval --corpus corpus --verbose             # with Jev
npx tsx src/cli/index.ts eval --corpus corpus --json > report.json  # machine readable
```

The harness rebuilds its own scratch store under `corpus/.cache/eval-home` on
every run, so it never touches `~/.resumerank` and repeated runs cannot drift.

## Known limits

- `software-engineer-backend.txt` (offline F1 0.83) is the weakest resume: the
  resume mentions Django/Jenkins/EKS as *context for past work* and the offline
  classifier keeps them; Jev's typed depth answers keep the same set, so the
  extras are legitimate mentions the gold list did not enumerate. This is the
  class of disagreement the harness deliberately does not punish as a leak.
- `eligible-in-top3` is 93.3% because for `j2` two gold-eligible candidates exist
  and one sits just outside the top 3 (a data scientist and a data analyst, both
  genuinely plausible for the same role).
- Rankings use no embeddings: matching is ontology + lexical + typed Jev
  judgements. Adding a local embedding model would be the next lever if a corpus
  with paraphrased skills (no shared vocabulary at all) needs to be handled.
