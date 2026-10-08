# TypeSafe Jev (System One) — research notes

What was verified about the model this CLI uses, and how the tool uses it.

## What Jev is

Jev is TypeSafe AI's first **System One model** (released 2026-09-15): a model that
returns *typed decisions* instead of generated text. You send a `state` (the case
file) plus a map of typed `questions`, and you get one typed `answer` per question
in a single pass (their docs quote 70–500 ms; a batch of 13 questions costs about
1/11th of 13 separate calls).

Pricing per the docs: **$0.042 per million input tokens, output free**; context
budget ~32k tokens shared by state *and* questions; model ids `jev-latest`
(resolves to `jev-1.13.0` right now) or a pinned `jev-1.13.0`.

## Endpoint contract (verified against the live API)

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json

{ "model": "jev-latest", "state": <string|object|array>, "questions": { "<your id>": <question> } }
```

Question types:

| type | fields | answer |
| --- | --- | --- |
| `noul` | `instructions`, optional `criteria {true,false}` | `{ type, noul }` — P(true) in 0..1, **no confidence field** |
| `choice` | `instructions`, `criteria` = map option → description (`null` allowed) | `{ type, choice, probabilities, confidence }` |
| `score` | `instructions`, `criteria` = ordered array of **2–10** level descriptions | `{ type, score, legend, probabilities, confidence }` — `score` can land between levels |

Notes that matter in code:

- Question **ids are never sent to the model** — they are your keys only, so the
  full question must be in `instructions`.
- Questions in one request are evaluated **independently** and in parallel; an
  answer cannot depend on another answer in the same call (use a second call).
- One judgment per question. Multi-factor judgments are meant to be split into
  several questions and combined with **your own weights in code**.
- Reference parts of a structured state by path inside backticks, e.g.
  `` `candidate.skills` ``, `` `resume_text` ``.
- Errors: `401` bad key, `422` malformed question/body, `429` rate limit, `529`
  overloaded → back off and retry (the client here retries 429/529 + network
  errors three times with exponential backoff, honouring `Retry-After`).
- Keep state lean: docs are explicit that "state is a case file, not a prompt",
  and irrelevant detail measurably degrades accuracy — filter in code first.

## How resumerank uses it

Extraction (`src/extract/service.ts`) — deterministic proposers run first (dictionary
+ regex + context classifier, fully offline); Jev then answers **typed** questions:

- `skill_present__<i>` — `noul`: "does the resume show the candidate personally
  using X, or does X only appear in someone else's stack / a pasted job ad /
  an aspiration?" → keep when P(true) ≥ `TYPESAFE_KEEP_THRESHOLD` (0.5).
- `skill_depth__<i>` — `score` over five ordered levels
  (`none → incidental → coursework/personal → professional → expert`) → keep when
  the weighted level ≥ `TYPESAFE_SKILL_LEVEL_MIN` (1.5). This is what separates
  "listed Kubernetes on a resume we all know was a tutorial" from production use.
- `role__<i>`, `education__<i>`, `cert__<i>` — `noul`: did they *hold* the title /
  *earn* the degree / *hold* the certification.
- `seniority`, `domain` — `choice`, written into the record.
- Verification battery — `noul` per derived field (education/projects/
  certifications list, and a *contradiction* question for the aggregate years
  figure): fields with P(wrong) > `TYPESAFE_FIRE_THRESHOLD` (0.7) are cleared.

Ranking (`src/ranking/service.ts`):

- `req__<i>` — `noul` per proposed JD requirement: "does the job description state
  this as a must-have?" → drops skills that only appear in nice-to-have prose.
- `fit__<i>__skills|experience|overall` — three `noul` per shortlisted candidate,
  one HTTP call for the whole shortlist, blended 50/20/30 into the Jev fit score.
- `sem__<i>` — `noul` fallback for required skills the ontology could not relate
  to anything the candidate listed (capped, only for known skills).

Every call is **fail-open**: a missing key, an offline machine, a 422 or a 429
after retries returns `null` and the deterministic/ontology path carries on. The
CLI never requires the network.

## Reproduce the API research

```bash
curl -sS https://api.typesafe.ai/v1/systemone \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -d '{"state":"The candidate resume mentions AWS S3 and Lambda.","model":"jev-latest",
       "questions":{"has_aws":{"type":"noul","instructions":"Does the state mention AWS experience?"}}}'
# -> {"model":"jev-1.13.0","answers":{"has_aws":{"type":"noul","noul":0.78}},"usage":{...}}
```

`resumerank doctor` performs the same round trip and reports the resolved model.

## Question paths must exist in the state (found the hard way)

A question that references a field the state does not contain does not error — it
comes back **hedged near 50%** for every candidate, which silently turns the
precision layer into noise. The fit battery asked about `` `candidate.skills` ``
while the state passed an array under `candidates`, so all 6 candidates in a run
scored 55–59% regardless of fit; ranking still worked because the deterministic
layer dominates the blend, but the typed read was worthless.

After switching to `` `candidates[i].skills` `` (same state, same call count) the
same run separates cleanly: `98%` for the engineer who covers 7/7 requirements,
`23–26%` for the ones who cover 2–3/7. A cheap probe (`tools/probe-fit.ts`)
comparing question shapes against a known-strong and known-weak candidate is the
way to calibrate this: explicit structured fields scored 99% vs 4%, so the model
was never the problem — the path was.

Rules that follow from this:

- always address array elements by index (`candidates[0].field`);
- verify each backticked path exists in the state object you send;
- `test/fit-questions.test.ts` enforces this for the ranking battery.

## Extraction on real PDFs (18 public resumes)

Testing against real resumes (GitHub CVs + university sample resumes) found bugs
the synthetic corpus never did. All fixed, all covered by `test/real-layouts.test.ts`:

- **Date separators.** One CV used U+2011 (non-breaking hyphen) in
  "Jan. 2022 ‑ Present". `RANGE_SEP` now covers U+2010–U+2015 and U+2212; that one
  change took that resume from 0 parsed roles to 10.
- **Experience layouts.** Four shapes are now handled: `Role - Company Month YYYY
  – Month YYYY`, `Role, Company (dates)`, `Company — Role dates`, `Role | Company
  | dates`, and title-on-one-line/company+city-on-the-next. Separators must
  survive date-stripping (they were being erased before the split), a prose line
  that lost its bullet marker must never become a job title, and a trailing city
  is dropped from the company unless it is a legal suffix ("Acme, Inc.").
- **Education.** The old code put the whole line in `degree`, copied it into
  `field`, and left `school` empty. `parseEducationEntry` now finds the
  institution by keyword with word-bounded expansion (stopping at field words
  like "Software"/"Engineering" and at degree tokens), then splits level from
  field, and drops duplicate entries.
- **Names with credentials.** "SAMMY SPARTAN, RN, BSN" → "SAMMY SPARTAN";
  "Jane Doe | Engineer" → "Jane Doe".
- **Locations: precision beats recall.** First attempt scanned every early
  "X, Y"-looking segment and produced "Nina Nursing, R.N." (the name), "VNIT,
  NAGPUR" (a college) and "City State, Zip" (template text). A wrong location is
  worse than a missing one, so a candidate is now only accepted from a line that
  carries a *real* email/URL/phone, an explicit "Location" label, or is a
  standalone "City, State, Country" line — with an acronym guard and a
  not-a-location word list. `Engineer @ Company, City` shapes are rejected
  because "@" alone is not an email signal. Prose fallback handles
  "…a software engineer from Berlin".
- Field coverage on the public set (18 PDFs, 13 individual resumes), final
  measurement: skills 100%, education 94%, email 89%, years 83%, name 78%,
  phone 78%, experience timeline 72% (4.5 roles on average where roles exist,
  max 12), location 33% with zero false positives — the misses are resumes that
  genuinely carry no personal location in their header, plus 5 files that are
  multi-person guides rather than individual resumes.

## Ranking across seniority (the level model)

The engine scored "more years and more skills is better", so a **junior** posting
put an 8-year senior at #1 and a **staff** posting could not prefer the staff
candidate. Three fixes, all verifiable:

1. **The posting's band** (`jobLevel`) comes from the title first ("Staff",
   "Principal", "Lead", "Junior", "Graduate"…), then from the minimum-years bar
   (≤2 junior, ≤4 mid, ≤8 senior, else staff), then from prose signals.
2. **The candidate's band** (`candidateLevel`) comes from their stated seniority
   (`lead`/`staff`/`architect` → staff, `senior` → senior, …), then from years.
3. **The fit** is an explicit 4×4 matrix, not a distance formula, because the two
   directions are not symmetric. Under-qualification is always penalised. Over-
   qualification is penalised only where it hurts — a staff engineer answering a
   *senior* req is a good hire (1.0), an 8-year senior answering a *junior* req is
   a retention risk (0.35, and lower still when the years gap is extreme). An
   entry-level posting is the one place where over-qualification is the
   disqualifier, so it excludes two bands above while senior/staff postings keep
   such a candidate ranked with a flag instead of hiding them.

Leadership/scope is a separate signal (`leadershipScore`) built from weighted
counts: role titles ×2, verbs (led/mentored/architected/owned/drove) ×1, scope
phrases (team of N, org-wide, roadmap) ×2. It is **only weighted when the posting
asks for it** — and the posting, never the candidate's own prose, decides that
(passing the resume text there was the bug that made every senior req look like a
leadership req).

Verified two ways: `test/seniority.test.ts` uses four profiles that are identical
except for years and band (junior=#1 for a junior req, senior=#1 for a senior req,
staff=#1 for a staff req, and the staff candidate excluded from the junior req),
and the same four-level probe (`tools/probe-levels.ts`) runs against the
heterogeneous pool.

Also found while measuring: `roleSimilarity` scored a Solutions Architect at 18%
against "Staff Backend Engineer / Architect" because the whole title was matched
as one string. Titles are now split into alternatives (`/`, `or`, `and`) and the
best match wins — that alone moved the architect from 18% to 58% on role fit.

## Typed answers are cached (and why that matters)

The model is the only non-reproducible input in a ranking: the same job description
against the same pool produced a different ordering on 4 of 5 runs (measured by
`tools/trust-probe.ts --jev`; the offline path was identical 5/5). Answers are now
cached in `~/.resumerank/jev-cache.json`, keyed by (model, state, question), so:

- re-running the same ranking is **identical** and costs **0 calls** (6.1 s → 98 ms);
- adding a candidate asks only about the pool it belongs to;
- re-ingesting a resume already in the library costs 0 typed calls;
- `resumerank cache` shows the size, `--clear` (or `RESUMERANK_FRESH=1`) resets it,
  `RESUMERANK_NO_CACHE=1` disables it.

Credit also only flows downward along real platform→service families now: AWS
covers S3/Lambda/Glue and Kubernetes covers EKS, but SQL does not cover PostgreSQL,
"Deep Learning" does not cover TensorFlow, "Containers" does not cover Docker and
React does not cover Next.js. Those requirements need the product named (or a typed
answer with its probability shown).
