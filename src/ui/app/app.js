/* resumerank local UI — vanilla SPA over the local JSON store. No build step. */
(() => {
  "use strict"

  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
  const initials = (name) => {
    // Drop the extension, quotes and punctuation: `ALEXANDRA "ALEX" MERCER` must
    // render "AM", not `A"`.
    const clean = String(name || "?")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/["'“”‘’]/g, " ")
      .replace(/[_-]+/g, " ")
      .replace(/[^\p{L}\s.'-]/gu, " ")
      .trim()
    const words = clean.split(/\s+/).filter((w) => /[\p{L}]/u.test(w))
    return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase()
  }
  const AV = ["", "b", "c", "d"]
  const avClass = (s) => AV[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length]
  const date = (iso) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  }
  const pct = (n) => `${Math.round(Number(n) * 100)}%`

  /** Turn raw provenance strings into something a recruiter can read. */
  const SECTIONS = {
    skills: "skills list",
    experience: "work experience",
    projects: "projects",
    certifications: "certifications",
    education: "education",
    summary: "summary",
    other: "body text",
  }
  function provenanceLabel(why) {
    const raw = String(why || "")
    if (!raw) return { text: "—", kind: "muted" }
    if (/^rejected/.test(raw)) {
      const p = (raw.match(/P=([\d.]+)/) || [])[1]
      const d = (raw.match(/depth=([\d.]+)/) || [])[1]
      return { text: `Rejected by Jev${p ? ` · P ${p}` : ""}${d ? ` · depth ${d}/4` : ""}`, kind: "bad" }
    }
    const jev = raw.match(/jev:P=([\d.]+) depth=([\d.]+)/)
    const offline = raw.match(/offline:(\w+)@(\w+)\s*\(([\d.]+)\)/)
    const prop = raw.match(/\((?:proposal: )?(\w+)@(\w+)\)/)
    if (jev) {
      const where = prop ? ` · seen in ${SECTIONS[prop[2]] ?? prop[2]}` : ""
      return { text: `Jev confirmed · P ${jev[1]} · depth ${jev[2]}/4${where}`, kind: "ok", raw }
    }
    if (offline) {
      return { text: `Context match · ${SECTIONS[offline[2]] ?? offline[2]} (${offline[3]})`, kind: "info", raw }
    }
    return { text: raw, kind: "muted", raw }
  }

  // ---------- api ----------
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const text = await res.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { error: text }
    }
    if (!res.ok) throw new Error((payload && payload.error) || `HTTP ${res.status}`)
    return payload
  }

  // ---------- app state ----------
  const state = {
    status: null,
    resumes: [],
    rankings: [],
    skills: [],
    search: "",
    busy: false,
    selection: new Set(),
    rank: { title: "", description: "", requirements: null, result: null, offline: false, includeMismatches: false },
  }

  function toast(message, kind = "ok", ms = 3600) {
    const el = document.createElement("div")
    el.className = `toast ${kind}`
    el.innerHTML = esc(message)
    $("#toasts").appendChild(el)
    setTimeout(() => el.remove(), ms)
  }

  function openSheet(html, wire) {
    $("#sheetCard").innerHTML = html
    $("#sheet").hidden = false
    $("#scrim").hidden = false
    if (wire) wire($("#sheetCard"))
  }
  function closeSheet() {
    $("#sheet").hidden = true
    $("#scrim").hidden = true
  }
  $("#scrim").onclick = closeSheet
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet()
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault()
      $("#globalSearch").focus()
    }
  })

  // ---------- data loading ----------
  async function refresh() {
    const [status, resumes, rankings, skills] = await Promise.all([
      api("/api/status"),
      api(`/api/resumes${state.search ? `?search=${encodeURIComponent(state.search)}` : ""}`),
      api("/api/rankings"),
      api("/api/skills"),
    ])
    state.status = status
    state.resumes = resumes
    state.rankings = rankings
    state.skills = skills
    paintChrome()
  }

  function paintChrome() {
    const s = state.status
    if (!s) return
    $("#navCandidates").textContent = s.resumes || ""
    $("#navRankings").textContent = s.rankings || ""
    const pill = $("#jevPill")
    pill.classList.toggle("on", !!s.jev.online)
    pill.classList.toggle("off", !s.jev.online)
    const keyState = s.jev?.key || {}
    $("#jevText").textContent = s.jev.online
      ? `Jev · ${s.jev.model}`
      : keyState.configured
        ? "offline mode"
        : "no key · offline"
    $("#railMeta").innerHTML = `${esc(s.dataDir)}<br />${(s.indexBytes / 1024).toFixed(1)} KB index · ${s.skills} skills`
    $("#brandSub").textContent = `v${s.version} · local JSON`
  }

  // ---------- views ----------
  const views = {}

  views.dashboard = () => {
    const s = state.status || {}
    const topSkills = state.skills.slice(0, 8)
    const recent = state.rankings.slice(0, 5)
    const domainCounts = {}
    state.resumes.forEach((r) => {
      const d = r.domain || "other"
      domainCounts[d] = (domainCounts[d] || 0) + 1
    })
    const maxDomain = Math.max(1, ...Object.values(domainCounts))
    return `
      <div class="grid stats">
        ${stat("Candidates", s.resumes ?? 0, `${s.textChars ? (s.textChars / 1000).toFixed(0) + "k chars indexed" : "no resumes yet"}`)}
        ${stat("Notes", s.notes ?? 0, "recruiter notes on candidates")}
        ${stat("Rankings", s.rankings ?? 0, "saved job runs")}
        ${stat("Skills indexed", s.skills ?? 0, "canonical skills in the local index")}
      </div>
      <div class="grid two">
        <div class="card">
          <div class="card-head"><h2>Top skills in the pool</h2><div class="right"><button class="btn sm ghost" data-goto="#/skills">Skill index</button><a class="btn sm ghost" href="/api/dashboard.html" download="resumerank-dashboard.html" title="Save a standalone HTML report you can email or print"><svg><use href="#i-dl"/></svg>HTML report</a></div></div>
          <div class="card-body tight">
            ${
              topSkills.length
                ? `<table class="tbl"><tbody>${topSkills
                    .map(
                      (s) => `<tr class="clickable" data-skill="${esc(s.skill)}">
                        <td style="width:34%"><b>${esc(s.skill)}</b></td>
                        <td style="width:48%"><div class="bar"><i style="width:${(s.count / topSkills[0].count) * 100}%"></i></div></td>
                        <td class="num" style="text-align:right;color:var(--muted)">${s.count}</td>
                      </tr>`,
                    )
                    .join("")}</tbody></table>`
                : `<div class="empty"><div class="big">No skills indexed yet</div><p>Add resumes and the semantic skill index builds itself.</p><button class="btn primary" data-add>Add resumes</button></div>`
            }
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Pool by domain</h2></div>
          <div class="card-body">
            ${
              Object.keys(domainCounts).length
                ? Object.entries(domainCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(
                      ([d, n]) => `<div style="margin-bottom:12px">
                        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span style="color:var(--ink-2)">${esc(d)}</span><span style="color:var(--ink);font-weight:560">${n}</span></div>
                        <div class="bar"><i style="width:${(n / maxDomain) * 100}%"></i></div>
                      </div>`,
                    )
                    .join("")
                : `<div class="hint">Nothing to chart yet.</div>`
            }
            <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:16px">
              <dl class="kv">
                <dt>Storage</dt><dd>${esc(s.storage || "")}</dd>
                <dt>Data dir</dt><dd class="mono">${esc(s.dataDir || "")}</dd>
                <dt>Jev</dt><dd>${esc(s.jev?.status || "")}</dd>
                <dt>Thresholds</dt><dd>keep ${s.thresholds?.keep} · depth ${s.thresholds?.skillLevelMin} · mismatch ${s.thresholds?.mismatch}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent rankings</h2><div class="right"><button class="btn sm" data-goto="#/rank">New ranking</button></div></div>
        <div class="card-body tight">${rankingsTable(recent, false)}</div>
      </div>`
  }

  const stat = (k, v, d) => `<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${esc(d)}</div></div>`

  function rankingsTable(rows, clickable = true) {
    if (!rows.length) {
      return `<div class="empty"><div class="icon"><svg><use href="#i-trophy"/></svg></div><div class="big">No rankings yet</div><p>Paste a job description and rank the whole pool in one click.</p><button class="btn primary" data-goto="#/rank">Rank candidates</button></div>`
    }
    return `<table class="tbl"><thead><tr><th>Role</th><th class="num">Candidates</th><th>Model</th><th>Created</th><th></th></tr></thead><tbody>
      ${rows
        .map(
          (r) => `<tr class="${clickable ? "clickable" : ""}" data-ranking="${esc(r.id)}">
            <td><b>${esc(r.jobTitle)}</b></td>
            <td class="num">${r.candidateCount}</td>
            <td><span class="tag ${r.model === "offline" ? "muted" : "ok"}">${esc(r.model)}</span></td>
            <td style="color:var(--muted-2)">${date(r.createdAt)}</td>
            <td style="text-align:right"><svg style="color:var(--muted-2)"><use href="#i-chev"/></svg></td>
          </tr>`,
        )
        .join("")}
    </tbody></table>`
  }

  views.candidates = () => {
    const rows = state.resumes
    const sel = state.selection
    return `
      <div class="card">
        <div class="card-head">
          <h2>${rows.length} candidate${rows.length === 1 ? "" : "s"}</h2>
          <div class="sub">${state.search ? `filtered by “${esc(state.search)}”` : "newest first · click a row to open the profile"}</div>
          <div class="right">
            ${sel.size ? `<button class="btn sm danger" data-bulk-delete>Delete ${sel.size} selected</button>` : ""}
          </div>
        </div>
        <div class="card-body tight scroll-y">
          ${
            rows.length
              ? `<table class="tbl"><thead><tr>
                  <th style="width:34px"><input type="checkbox" id="selAll" ${sel.size === rows.length && rows.length ? "checked" : ""} /></th>
                  <th>Candidate</th><th>Role</th><th>Skills</th><th class="num">Years</th><th>Seniority</th><th>Domain</th>
                  <th class="num">Notes</th><th title="extraction confidence: share of fields Jev confirmed">Confidence</th><th></th></tr></thead><tbody>
                ${rows
                  .map(
                    (r) => `<tr class="clickable" data-candidate="${esc(r.id)}">
                      <td><input type="checkbox" data-select="${esc(r.id)}" ${sel.has(r.id) ? "checked" : ""} /></td>
                      <td><div class="name"><div class="avatar ${avClass(r.id)}">${esc(initials(r.filename))}</div>
                        <div class="t"><b>${esc(r.filename.replace(/\.[a-z0-9]+$/i, ""))}</b><span>${esc(r.shortId)} · ${r.chars} chars</span></div></div></td>
                      <td style="color:var(--muted)"><span class="cell-clip" title="${esc((r.roles || []).join(", "))}">${esc((r.roles || [])[0] || "—")}</span></td>
                      <td><div class="chips nowrap">${(r.skills || []).slice(0, 3).map((s) => `<span class="tag skill">${esc(s)}</span>`).join("")}
                        ${(r.skills || []).length > 3 ? `<span class="tag muted more" title="${esc((r.skills || []).join(", "))}">+${r.skills.length - 3}</span>` : ""}</div></td>
                      <td class="num">${r.years ?? "—"}</td>
                      <td><span class="tag">${esc(r.seniority || "—")}</span></td>
                      <td><span class="tag">${esc(r.domain || "—")}</span></td>
                      <td class="num">${r.notes ? `<span class="tag warn">${r.notes}</span>` : `<span style="color:var(--muted-2)">—</span>`}</td>
                      <td class="num"><span class="tag ${r.confidence >= 0.85 ? "ok" : r.confidence >= 0.7 ? "warn" : "bad"}">${pct(r.confidence)}</span></td>
                      <td style="text-align:right;white-space:nowrap">
                        <button class="btn sm ghost" data-delete="${esc(r.id)}" title="Delete"><svg><use href="#i-trash"/></svg></button>
                      </td>
                    </tr>`,
                  )
                  .join("")}
              </tbody></table>`
              : `<div class="empty"><div class="icon"><svg><use href="#i-users"/></svg></div><div class="big">No candidates yet</div><p>Drop a folder of resumes in — PDF, DOCX or TXT, as many as you like.</p><button class="btn primary" data-add>Add resumes</button></div>`
          }
        </div>
      </div>`
  }

  views.candidate = async (id) => {
    const r = await api(`/api/resumes/${encodeURIComponent(id)}`)
    const meta = r.metadata || {}
    const timeline = (r.structured?.experience || [])
      .map(
        (e) => `<div class="tl-item"><div><div class="tl-dot"></div><div class="tl-line"></div></div>
          <div class="tl-body"><b>${esc(e.role || "Role")}</b> <span style="color:var(--muted-2)">· ${esc(e.company || "—")}</span>
          <div class="m">${esc(e.startDate || "?")} → ${e.isCurrent ? "present" : esc(e.endDate || "?")}</div>
          ${(e.bullets || []).length ? `<ul>${e.bullets.slice(0, 5).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
        </div></div>`,
      )
      .join("")
    const prov = r.provenance || {}
    const skills = (meta.skills || [])
      .map((s) => {
        const label = provenanceLabel(prov[s])
        const raw = prov[s] || ""
        const depth = Number((raw.match(/depth=([\d.]+)/) || [])[1] || 0)
        const p = Number((raw.match(/P=([\d.]+)/) || [])[1] || 0)
        const kind = label.kind
        return `<div class="skill-card" title="${esc(raw)}">
          <div class="top"><b>${esc(s)}</b>
            <span class="tag ${kind === "ok" ? "ok" : kind === "bad" ? "bad" : "muted"}">${
              kind === "ok" ? `P ${p.toFixed(2)}` : kind === "bad" ? "rejected" : "offline"
            }</span></div>
          <div class="bar" style="margin-top:8px"><i style="width:${Math.max(8, Math.round((depth / 4) * 100))}%"></i></div>
          <div class="why">${esc(kind === "ok" ? `depth ${depth}/4 · seen in ${(raw.match(/@(\w+)\)/) || [])[1] ? SECTIONS[(raw.match(/@(\w+)\)/) || [])[1]] ?? "" : "the resume"}` : label.text)}</div>
        </div>`
      })
      .join("")
    const rejected = Object.entries(prov)
      .filter(([, v]) => /^rejected/.test(v))
      .map(([k, v]) => {
        const label = provenanceLabel(v)
        return `<div class="skill-card" title="${esc(v)}"><div class="top"><b>${esc(k)}</b><span class="tag bad">rejected</span></div><div class="why">${esc(label.text)}</div></div>`
      })
      .join("")

    return `
      <div class="card">
        <div class="card-head">
          <div class="name"><div class="avatar ${avClass(r.id)}" style="width:40px;height:40px;font-size:14px">${esc(initials(r.structured?.fullName || r.originalFilename))}</div>
            <div class="t"><b style="font-size:16px">${esc(r.structured?.fullName || r.originalFilename.replace(/\.[a-z0-9]+$/i, ""))}</b>
            <span>${esc((meta.roles || []).slice(0, 2).join(" · ") || "no role detected")}${r.structured?.contact?.location ? ` · ${esc(r.structured.contact.location)}` : ""}</span></div></div>
          <div class="right">
            <a class="btn sm" href="/api/resumes/${encodeURIComponent(r.id)}/file" title="Download the file that was uploaded"><svg><use href="#i-dl"/></svg>Original file</a>
            <button class="btn sm" data-raw="${esc(r.id)}">Raw text</button>
            <button class="btn sm danger" data-delete="${esc(r.id)}"><svg><use href="#i-trash"/></svg>Delete</button>
          </div>
        </div>
        <div class="card-body">
          <dl class="kv">
            <dt>Years</dt><dd>${meta.yearsOfExperience ?? "unknown"}${r.structured?.totalYearsExperience !== null && r.structured?.totalYearsExperience !== undefined && r.structured.totalYearsExperience !== meta.yearsOfExperience ? ` <span class="hint">(stated ${r.structured.totalYearsExperience})</span>` : ""}</dd>
            <dt>Seniority</dt><dd>${esc(meta.seniority || "—")}</dd>
            <dt>Domain</dt><dd>${esc(meta.domain || "—")}</dd>
            <dt>Contact</dt><dd>${esc([r.structured?.contact?.email, r.structured?.contact?.phone, r.structured?.contact?.location].filter(Boolean).join(" · ") || "—")}</dd>
            <dt>Education</dt><dd>${
              (r.structured?.education || []).length
                ? (r.structured.education || [])
                    .map((e) =>
                      [
                        [e.degree, e.field].filter(Boolean).join(" "),
                        e.school ? `— ${e.school}` : "",
                        e.startYear || e.endYear ? `(${e.startYear && e.endYear && e.startYear !== e.endYear ? `${e.startYear}–${e.endYear}` : e.endYear || e.startYear})` : "",
                      ]
                        .filter(Boolean)
                        .join(" "),
                    )
                    .join("<br />")
                : esc((meta.education || []).join(" | ") || "—")
            }</dd>
            <dt>Certifications</dt><dd>${esc((meta.certifications || []).join(", ") || "—")}</dd>
            <dt>Extraction</dt><dd>confidence ${pct(r.quality?.extractionConfidence ?? 0)}</dd>
            <dt>Added</dt><dd>${date(r.createdAt)}</dd>
          </dl>
          ${(r.quality?.warnings || []).map((w) => `<div class="callout" style="margin-top:14px"><span>⚠</span><span>${esc(w)}</span></div>`).join("")}
        </div>
      </div>

      ${timeline ? `<div class="card"><div class="card-head"><h2>Experience</h2><div class="sub">${(r.structured?.experience || []).length} role${(r.structured?.experience || []).length === 1 ? "" : "s"} parsed from the resume</div></div><div class="card-body"><div class="timeline">${timeline}</div></div></div>` : ""}

      <div class="grid two">
        <div class="card">
          <div class="card-head"><h2>Skills</h2><div class="sub">${(meta.skills || []).length} accepted${Object.values(prov).filter((v) => /^rejected/.test(v)).length ? ` · ${Object.values(prov).filter((v) => /^rejected/.test(v)).length} rejected` : ""}</div></div>
          <div class="card-body"><div class="skills-grid">${skills || `<div class="hint">No skills extracted.</div>`}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Notes</h2><div class="sub">${r.notes.length ? `${r.notes.length} note${r.notes.length === 1 ? "" : "s"}` : "private to this machine"}</div></div>
          <div class="card-body">
            <textarea id="noteInput" rows="2" placeholder="Interview feedback, salary expectation, referral…"></textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn primary sm" data-note-add="${esc(r.id)}" disabled>Add note</button></div>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
              ${
                r.notes.length
                  ? r.notes
                      .map(
                        (n) => `<div class="note" data-note="${esc(n.id)}">
                        <div class="head"><span>${date(n.createdAt)}</span>
                          <div class="right">
                            <button class="btn sm ghost" data-note-edit="${esc(n.id)}">Edit</button>
                            <button class="btn sm ghost" data-note-del="${esc(n.id)}">Delete</button>
                          </div></div>
                        <p>${esc(n.content)}</p></div>`,
                      )
                      .join("")
                  : `<div class="hint">Nothing yet. Notes stay in <span class="mono">notes.json</span> next to the other local data.</div>`
              }
            </div>
          </div>
        </div>
      </div>

      ${
        (meta.projects || []).length
          ? `<div class="card"><div class="card-head"><h2>Projects</h2></div><div class="card-body"><div class="chips" style="flex-direction:column;align-items:flex-start">${meta.projects
              .map((p) => `<div style="font-size:13px;color:var(--muted)">${esc(p)}</div>`)
              .join("")}</div></div></div>`
          : ""
      }

      ${
        rejected
          ? `<div class="card"><div class="card-head"><h2>Rejected mentions</h2><div class="sub">Jev or the context classifier said no — kept for audit</div></div>
             <div class="card-body"><div class="skills-grid">${rejected}</div></div></div>`
          : ""
      }

      <div class="card">
        <div class="card-head"><h2>Match this candidate against a job description</h2></div>
        <div class="card-body">
          <div class="row">
            <label class="field"><span>Role title</span><input type="text" id="expTitle" placeholder="Senior Backend Engineer" /></label>
          </div>
          <textarea id="expJd" rows="5" placeholder="Paste the job description here…"></textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn primary sm" data-explain="${esc(r.id)}">Explain match</button></div>
          <div id="expOut" style="margin-top:16px"></div>
        </div>
      </div>`
  }

  views.rank = () => {
    const st = state.rank
    const req = st.requirements
    return `
      <div class="grid two">
        <div class="card">
          <div class="card-head"><h2>Job description</h2><div class="sub">requirements are parsed locally, then confirmed by Jev</div></div>
          <div class="card-body">
            <div class="row">
              <label class="field"><span>Role title</span><input type="text" id="rankTitle" value="${esc(st.title)}" placeholder="Senior Backend Engineer" /></label>
              <label class="field" style="flex:0 0 190px"><span>Finalists</span><input type="number" id="rankLimit" value="20" min="1" max="100" /></label>
            </div>
            <label class="field"><span>Description</span>
              <textarea id="rankJd" rows="12" placeholder="Paste the JD, or drop a .md / .txt file here…">${esc(st.description)}</textarea>
            </label>
            <div class="row" style="align-items:center">
              <label class="check"><input type="checkbox" id="rankOffline" ${st.offline ? "checked" : ""}/> Offline only (no Jev calls)</label>
              <label class="check"><input type="checkbox" id="rankMismatch" ${st.includeMismatches ? "checked" : ""}/> Include mismatched candidates</label>
              <div style="flex:0 0 auto;display:flex;gap:8px">
                <button class="btn" data-analyze>Preview requirements</button>
                <button class="btn primary" data-run-rank><svg><use href="#i-bolt"/></svg>Run ranking</button>
              </div>
            </div>
            <div id="reqPreview" style="margin-top:16px">${req ? requirementsCard(req) : ""}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>How this works</h2></div>
          <div class="card-body">
            <div class="hint" style="line-height:1.75">
              <p style="margin:0 0 12px"><b style="color:var(--text)">1. Requirements</b> — ontology scan + section parsing, then a typed Jev question per skill: “is this a must-have in the JD?”</p>
              <p style="margin:0 0 12px"><b style="color:var(--text)">2. Semantic matching</b> — <span class="mono">S3 ⇒ AWS</span> scores 1.00, a platform-only match (<span class="mono">AWS</span> vs an <span class="mono">S3</span> requirement) scores 0.80, and a prerequisite never counts (<span class="mono">Python</span> does not satisfy <span class="mono">TensorFlow</span>).</p>
              <p style="margin:0 0 12px"><b style="color:var(--text)">3. Scoring</b> — weights 35 skills / 20 experience / 15 role / 15 responsibilities / 10 domain / 5 preferred.</p>
              <p style="margin:0 0 12px"><b style="color:var(--text)">4. Gate</b> — under ${pct(state.status?.thresholds?.hardFloor ?? 0.15)} coverage a candidate is dropped; under ${pct(state.status?.thresholds?.mismatch ?? 0.4)} it is kept but flagged.</p>
              <p style="margin:0"><b style="color:var(--text)">5. Jev fit</b> — three typed questions per finalist (skills / experience / overall), blended at ${state.status?.thresholds?.deterministicWeight ?? 0.7} deterministic weight.</p>
            </div>
          </div>
        </div>
      </div>
      <div id="rankOut">${st.result ? rankingResults(st.result) : ""}</div>`
  }

  function requirementsCard(req) {
    return `<div style="border:1px solid var(--line);border-radius:12px;padding:14px;background:rgba(124,92,255,.05)">
      <div style="font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted-2);margin-bottom:9px">Parsed requirements</div>
      <div style="margin-bottom:10px"><div class="hint" style="margin-bottom:6px">Required</div><div class="chips">${
        (req.requiredSkills || []).map((s) => `<span class="tag skill">${esc(s)}</span>`).join("") || `<span class="hint">none detected</span>`
      }</div></div>
      <div style="margin-bottom:10px"><div class="hint" style="margin-bottom:6px">Preferred</div><div class="chips">${
        (req.preferredSkills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join("") || `<span class="hint">none</span>`
      }</div></div>
      <dl class="kv" style="margin-top:12px">
        <dt>Minimum years</dt><dd>${req.minimumExperience ?? "not stated"}</dd>
        <dt>Domain</dt><dd>${esc((req.domain || []).join(", ") || "—")}</dd>
        <dt>Responsibilities</dt><dd>${esc((req.responsibilities || []).join(" · ") || "—")}</dd>
      </dl></div>`
  }

  // ---- per-candidate judgement helpers -------------------------------------

  function candName(r) {
    const fromJudgement = r.judgement?.resume?.fullName
    if (fromJudgement) return fromJudgement
    const fromState = state.resumes.find((x) => x.id === r.resumeId)
    if (fromState?.name) return fromState.name
    return String(r.originalFilename || "").replace(/\.[a-z0-9]+$/i, "")
  }

  function candMeta(r) {
    const j = r.judgement
    if (!j) return (r.analysis.strengths || []).slice(0, 2).join(", ") || r.originalFilename
    const bits = []
    if (j.resume.roles?.[0]) bits.push(j.resume.roles[0])
    if (j.resume.seniority && !String(j.resume.roles?.[0] || "").toLowerCase().includes(j.resume.seniority)) {
      bits.push(j.resume.seniority)
    }
    if (j.resume.domain && j.resume.domain !== "general") bits.push(j.resume.domain)
    return bits.join(" · ") || String(r.originalFilename || "")
  }

  function expCell(r) {
    const j = r.judgement
    if (!j) return `<span class="hint">—</span>`
    const years = j.resume.yearsOfExperience
    const min = j.bar.minimumExperience
    if (years === null || years === undefined) {
      return `<span class="hint">${min ? `not stated` : "—"}</span>`
    }
    const short = min !== null && years < min
    return `<div class="chips" style="flex-direction:column;gap:3px;align-items:flex-start">
      <span style="font-weight:560">${years} yrs</span>
      ${min !== null ? `<span class="tag ${short ? "warn" : "ok"}">min ${min}</span>` : `<span class="hint">no bar</span>`}
    </div>`
  }

  function skillsCell(r) {
    const j = r.judgement
    if (!j) return `<span class="hint">—</span>`
    const { requiredHits, requiredCount } = j.bar
    if (!requiredCount) return `<span class="hint">—</span>`
    const cls = requiredHits === requiredCount ? "ok" : requiredHits / requiredCount >= 0.6 ? "" : "bad"
    return `<div class="chips" style="flex-direction:column;gap:3px;align-items:flex-start">
      <span style="font-weight:560">${requiredHits}/${requiredCount}</span>
      <span class="tag ${cls}">${Math.round((requiredHits / requiredCount) * 100)}%</span>
    </div>`
  }

  /** The "why this rank" panel: the numbers the scorer used, then the evidence. */
  function judgePanel(r, detWeight) {
    const j = r.judgement
    const evidence = r.analysis.skillMatches || []
    const evidenceTable = evidence.length
      ? `<table class="ev-table"><thead><tr><th>Requirement</th><th style="width:82px">Verdict</th><th style="width:56px" class="num">Score</th><th style="width:96px">How</th><th>Evidence</th></tr></thead><tbody>
          ${evidence
            .map(
              (m) => `<tr><td class="req">${esc(m.requirement)}</td>
              <td>${m.matched ? `<span class="tag ok">met</span>` : `<span class="tag bad">missing</span>`}</td>
              <td class="num">${Number(m.score).toFixed(2)}</td>
              <td><span class="tag">${esc(m.via)}</span></td>
              <td class="mono" style="color:var(--muted)">${esc(m.evidence || "—")}</td></tr>`,
            )
            .join("")}
        </tbody></table>`
      : `<div class="hint">No per-requirement evidence stored for this run.</div>`

    if (!j) {
      return `<div class="hint" style="margin-bottom:12px">${esc(r.analysis.reasoning || "")}</div>${evidenceTable}`
    }

    const bar = (value, cls = "") => `<div class="bar ${cls}"><i style="width:${Math.max(2, Math.min(100, value))}%"></i></div>`
    const metric = (label, value, pct, cls = "") =>
      `<div class="metric"><span>${label}</span><span class="v">${esc(String(value))}</span>${pct === undefined ? "" : bar(pct, cls)}</div>`

    const years = j.resume.yearsOfExperience
    const min = j.bar.minimumExperience
    const expLabel = years === null || years === undefined ? "not stated" : `${years} yrs`
    const jev = j.jev
    const online = j.model && j.model !== "offline"
    // A zero has no meaningful bar; show the fact instead of an empty track.
    const pct = (value) => (value > 0 ? value : undefined)

    const metrics = [
      metric("Required coverage", `${j.bar.requiredHits}/${j.bar.requiredCount}`, j.components.requiredSkills, "hot"),
      metric("Preferred skills", j.bar.preferredCount ? `${j.bar.preferredHits}/${j.bar.preferredCount}` : "—", pct(j.components.preferredSkills), j.bar.preferredHits ? "" : "warn"),
      metric("Experience", min !== null ? `${expLabel} vs ${min}` : expLabel, pct(j.components.experience)),
      j.level?.posting
        ? metric(
            "Level fit",
            `${j.level.posting} → ${j.level.candidate ?? "unknown"}${j.level.distance === 0 ? " (exact)" : j.level.distance === 1 ? "" : ` (${j.level.distance} bands)`}`,
            pct(j.components.levelFit),
            (j.level.distance ?? 0) >= 2 ? "warn" : "",
          )
        : "",
      j.level?.leadership !== null && j.level?.leadership !== undefined
        ? metric("Leadership / scope", `${j.level.leadership}%`, pct(j.level.leadership))
        : "", 
      metric("Role similarity", `${Math.round(j.components.roleSimilarity)}%`, pct(j.components.roleSimilarity)),
      metric("Responsibilities", `${Math.round(j.components.responsibilities)}%`, pct(j.components.responsibilities)),
      metric("Domain match", `${Math.round(j.components.domain)}%`, pct(j.components.domain)),
      online ? metric("Jev · skills", `${jev.skills}%`, jev.skills, "hot") : "",
      online ? metric("Jev · experience", `${jev.experience}%`, jev.experience) : "",
      online ? metric("Jev · overall hire", `${jev.overall}%`, jev.overall) : "",
    ]
      .filter(Boolean)
      .join("")

    const snapshot = [
      j.resume.roles?.length ? `Roles: ${esc(j.resume.roles.slice(0, 3).join(", "))}` : "",
      j.resume.skillCount ? `${j.resume.skillCount} skills extracted` : "",
      j.resume.domain ? `domain: ${esc(j.resume.domain)}` : "",
      `typed by ${esc(j.model)}`,
    ]
      .filter(Boolean)
      .join(" · ")

    return `
      <div class="judge">
        <div>
          <div class="verdict">${esc(j.verdict)}</div>
          ${
            (j.level?.distance ?? 0) >= 2 && j.level?.posting
              ? `<div class="callout" style="margin-top:12px"><span>⚠</span><span>Level mismatch: this posting is <b>${esc(j.level.posting)}</b> and the candidate reads as <b>${esc(j.level.candidate ?? "unknown")}</b> — ${
                  (j.level.distance ?? 0) >= 3 ? "far" : "well"
                } apart, which the rank already penalises.</span></div>`
              : ""
          }
          ${r.analysis.mismatch ? `<div class="callout" style="margin-top:12px"><div><b>Mismatch flag</b><ul>${(r.analysis.mismatchReasons || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>` : ""}
          <div class="hint snapshot" style="margin:12px 0 8px">${snapshot}</div>
          ${evidenceTable}
        </div>
        <div class="metrics">
        <div class="hint" style="margin-bottom:2px">How the ${r.finalScore.toFixed(1)} was built</div>
        ${metrics}
        <div class="hint snapshot" style="margin-top:6px;border-top:1px solid var(--line);padding-top:8px">
          Final = ${Math.round(detWeight * 100)}% deterministic (${r.deterministicScore.toFixed(1)}) + ${Math.round((1 - detWeight) * 100)}% typed fit (${r.aiScore.toFixed(1)})
        </div>
        </div>
      </div>`
  }

  function rankingResults(result) {
    const rows = result.results || []
    return `
      <div class="card">
        <div class="card-head">
          <h2>${esc(result.jobTitle)}</h2>
          <div class="sub">${rows.length} finalist${rows.length === 1 ? "" : "s"} · ${result.candidateCount ?? "?"} cleared the gate${
            (result.excluded || []).length ? ` · ${result.excluded.length} excluded` : ""
          } · model ${esc(result.model)}${result.elapsedMs ? ` · ${result.elapsedMs} ms` : ""}${
            result.jevCalls ? ` · ${result.jevCalls} Jev call${result.jevCalls === 1 ? "" : "s"}` : ""
          }</div>
          <div class="right">
            <a class="btn sm" href="/api/rankings/${encodeURIComponent(result.rankingId)}/export?format=csv" title="Download CSV"><svg><use href="#i-dl"/></svg>CSV</a>
            <a class="btn sm" href="/api/rankings/${encodeURIComponent(result.rankingId)}/export?format=md" title="Download Markdown report"><svg><use href="#i-dl"/></svg>Markdown</a>
            <a class="btn sm" href="#/rankings/${encodeURIComponent(result.rankingId)}" title="Open the saved run">Open saved run</a>
          </div>
        </div>
        <div class="card-body tight">
          ${
            rows.length
              ? `<table class="tbl"><thead><tr><th style="width:42px">#</th><th>Candidate</th><th style="width:150px">Score</th><th style="width:104px">Experience</th><th style="width:78px">Skills</th><th>Gaps</th><th style="width:34px"></th></tr></thead><tbody>
                ${rows
                  .map(
                    (r) => `<tr class="clickable" data-expand="${esc(r.resumeId)}">
                      <td><div class="rank-badge ${r.rank <= 3 ? "g" + r.rank : ""}">${r.rank}</div></td>
                      <td><div class="name"><div class="avatar ${avClass(r.resumeId)}">${esc(initials(candName(r)))}</div>
                        <div class="t"><b>${esc(candName(r))}</b>
                        <span>${r.analysis.mismatch ? `<span class="tag warn">mismatch</span> ` : ""}${esc(candMeta(r))}</span></div></div></td>
                      <td><div class="score"><span class="n">${r.finalScore.toFixed(1)}</span><div class="bar ${r.finalScore >= 70 ? "" : "warn"}"><i style="width:${r.finalScore}%"></i></div></div></td>
                      <td>${expCell(r)}</td>
                      <td>${skillsCell(r)}</td>
                      <td style="min-width:132px"><div class="chips">${(r.analysis.missingRequirements || []).slice(0, 2).map((s) => `<span class="tag bad">${esc(s)}</span>`).join("") || `<span class="tag ok">none</span>`}
                        ${(r.analysis.missingRequirements || []).length > 2 ? `<span class="tag muted more" title="${esc((r.analysis.missingRequirements || []).slice(2).join(", "))}">+${r.analysis.missingRequirements.length - 2}</span>` : ""}</div></td>
                      <td><svg style="color:var(--muted-2)"><use href="#i-chev"/></svg></td>
                    </tr>
                    <tr hidden data-detail="${esc(r.resumeId)}"><td></td><td colspan="6">${judgePanel(r, result.deterministicWeight ?? 0.6)}</td></tr>`,
                  )
                  .join("")}
              </tbody></table>`
              : `<div class="empty"><div class="big">No candidate cleared the gate</div><p>Everyone was excluded as a mismatch. Re-run with “Include mismatched candidates” to see the closest ones.</p></div>`
          }
        </div>
        ${
          (result.excluded || []).length
            ? `<div class="card-body" style="border-top:1px solid var(--line)">
                <div class="hint" style="margin-bottom:10px"><b style="color:var(--text)">${result.excluded.length} excluded as mismatches</b></div>
                <div class="chips" style="flex-direction:column;align-items:flex-start;gap:7px">
                  ${result.excluded.map((e) => `<div style="font-size:12.5px;color:var(--muted)"><b>${esc(e.originalFilename)}</b> — ${esc(e.reason)}</div>`).join("")}
                </div></div>`
            : ""
        }
      </div>`
  }

  views.rankings = () => `
    <div class="card">
      <div class="card-head"><h2>Saved rankings</h2><div class="sub">${state.rankings.length} run${state.rankings.length === 1 ? "" : "s"}</div>
        <div class="right"><button class="btn sm" data-goto="#/rank">New ranking</button></div></div>
      <div class="card-body tight">${rankingsTable(state.rankings)}</div>
    </div>`

  views.ranking = async (id) => {
    const r = await api(`/api/rankings/${encodeURIComponent(id)}`)
    return rankingResults({ ...r, rankingId: r.id })
  }

  views.skills = () => `
    <div class="card">
      <div class="card-head"><h2>Skill index</h2><div class="sub">canonical skills → candidates, built from every resume</div>
        <div class="right"><input type="text" id="skillFilter" placeholder="Filter skills…" style="width:220px" /></div></div>
      <div class="card-body tight" id="skillBody">${skillsTable(state.skills)}</div>
    </div>`

  function skillsTable(skills) {
    if (!skills.length) return `<div class="empty"><div class="big">Index is empty</div><p>Add resumes to populate the semantic skill index.</p></div>`
    return `<table class="tbl"><thead><tr><th>Skill</th><th>Candidates</th><th>Who</th></tr></thead><tbody>
      ${skills
        .map(
          (s) => `<tr><td><b>${esc(s.skill)}</b></td><td class="num">${s.count}</td>
          <td><div class="chips">${s.candidates.slice(0, 6).map((c) => `<a class="tag skill" href="#/candidate/${esc(c.id)}">${esc(c.filename.replace(/\.[a-z0-9]+$/i, ""))}</a>`).join("")}
            ${s.candidates.length > 6 ? `<span class="tag muted more">+${s.candidates.length - 6}</span>` : ""}</div></td></tr>`,
        )
        .join("")}
    </tbody></table>`
  }

  // ---------- router ----------
  let currentRoute = ""
  async function render() {
    const hash = location.hash || "#/"
    const match = hash.match(/^#\/([^/]*)\/?(.*)$/) || []
    const rawView = match[1] || "dashboard"
    const param = match[2] || ""
    // `#/rankings/<id>` is one saved run; `#/rankings` is the list.
    const view = rawView === "rankings" && param ? "ranking" : rawView
    currentRoute = hash
    const titles = {
      dashboard: ["Dashboard", "Local candidate intelligence"],
      candidates: ["Candidates", "Every resume in the local store"],
      candidate: ["Candidate", "Profile, provenance and notes"],
      rank: ["Rank", "Score the whole pool against one job description"],
      rankings: ["Rankings", "Saved runs you can export"],
      ranking: ["Saved ranking", "Read-only view of an earlier run"],
      skills: ["Skill index", "Canonical skills → candidates"],
    }
    $("#viewTitle").textContent = (titles[view] || titles.dashboard)[0]
    $("#viewSub").textContent = (titles[view] || titles.dashboard)[1]
    $$("#nav .nav-item").forEach((a) => a.classList.toggle("active", a.dataset.view === view || (view === "ranking" && a.dataset.view === "rankings") || (view === "candidate" && a.dataset.view === "candidates")))

    const host = $("#view")
    host.innerHTML = `<div class="card"><div class="card-body"><div class="skeleton" style="width:40%;margin-bottom:10px"></div><div class="skeleton" style="width:70%"></div></div></div>`
    try {
      if (!state.status) await refresh()
      const html = await views[view]?.(param)
      host.innerHTML = html ?? `<div class="card"><div class="card-body">Unknown view.</div></div>`
      wire(host, view, param)
    } catch (err) {
      host.innerHTML = `<div class="card"><div class="card-body"><div class="empty"><div class="big">Something went wrong</div><p>${esc(err.message)}</p></div></div></div>`
    }
  }

  // ---------- wiring ----------
  function wire(root, view, param) {
    $$("[data-goto]", root).forEach((el) => (el.onclick = () => (location.hash = el.dataset.goto)))
    $$("[data-add]", root).forEach((el) => (el.onclick = () => $("#filePicker").click()))
    $$("[data-candidate]", root).forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target.closest("input,button,a")) return
        location.hash = `#/candidate/${tr.dataset.candidate}`
      }
    })
    $$("[data-ranking]", root).forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target.closest("button,a")) return
        location.hash = `#/rankings/${tr.dataset.ranking}`
      }
    })
    $$("[data-delete]", root).forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation()
        const id = btn.dataset.delete
        const rec = state.resumes.find((r) => r.id === id)
        if (!confirm(`Delete ${rec ? rec.filename : id}? Notes and the stored file go with it.`)) return
        try {
          await api(`/api/resumes/${encodeURIComponent(id)}`, { method: "DELETE" })
          toast("Candidate deleted")
          state.selection.delete(id)
          if (view === "candidate") location.hash = "#/candidates"
          await refresh()
          render()
        } catch (err) {
          toast(err.message, "bad")
        }
      }
    })
    // selection
    const selAll = $("#selAll", root)
    if (selAll)
      selAll.onchange = () => {
        if (selAll.checked) state.resumes.forEach((r) => state.selection.add(r.id))
        else state.selection.clear()
        render()
      }
    $$("[data-select]", root).forEach((cb) => {
      cb.onclick = (e) => {
        e.stopPropagation()
        const id = cb.dataset.select
        state.selection.has(id) ? state.selection.delete(id) : state.selection.add(id)
        render()
      }
    })
    const bulk = $("[data-bulk-delete]", root)
    if (bulk)
      bulk.onclick = async () => {
        const ids = [...state.selection]
        if (!ids.length) return
        if (!confirm(`Delete ${ids.length} candidates? Notes and stored files go with them.`)) return
        for (const id of ids) await api(`/api/resumes/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {})
        toast(`${ids.length} candidates deleted`)
        state.selection.clear()
        await refresh()
        render()
      }
    // notes
    const addNoteBtn = $("[data-note-add]", root)
    if (addNoteBtn) {
      const noteInput = $("#noteInput", root)
      const syncBtn = () => (addNoteBtn.disabled = noteInput.value.trim().length === 0)
      noteInput.oninput = syncBtn
      syncBtn()
      addNoteBtn.onclick = async () => {
        const content = noteInput.value
        if (!content.trim()) return toast("Write something first", "bad")
        try {
          await api("/api/notes", { method: "POST", body: { resumeId: addNoteBtn.dataset.noteAdd, content } })
          toast("Note added")
          render()
        } catch (err) {
          toast(err.message, "bad")
        }
      }
    }
    $$("[data-note-del]", root).forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Delete this note?")) return
        await api(`/api/notes/${encodeURIComponent(btn.dataset.noteDel)}`, { method: "DELETE" })
        toast("Note deleted")
        render()
      }
    })
    $$("[data-note-edit]", root).forEach((btn) => {
      btn.onclick = () => {
        const card = btn.closest("[data-note]")
        const text = $("p", card).textContent
        openSheet(
          `<h3>Edit note</h3><div class="sub">${date(new Date().toISOString())}</div>
           <textarea id="editNote" rows="6">${esc(text)}</textarea>
           <div class="sheet-foot"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Save</button></div>`,
          (card2) => {
            $("[data-cancel]", card2).onclick = closeSheet
            $("[data-save]", card2).onclick = async () => {
              await api(`/api/notes/${encodeURIComponent(btn.dataset.noteEdit)}`, {
                method: "PATCH",
                body: { content: $("#editNote", card2).value },
              })
              closeSheet()
              toast("Note updated")
              render()
            }
          },
        )
      }
    })
    // raw text
    const rawBtn = $("[data-raw]", root)
    if (rawBtn)
      rawBtn.onclick = async () => {
        const text = await (await fetch(`/api/resumes/${encodeURIComponent(rawBtn.dataset.raw)}/text`)).text()
        openSheet(
          `<h3>Extracted text</h3><div class="sub">what the pipeline actually read</div>
           <pre class="mono" style="white-space:pre-wrap;max-height:60vh;overflow:auto;background:rgba(255,255,255,.03);padding:14px;border-radius:12px;border:1px solid var(--line)">${esc(text)}</pre>
           <div class="sheet-foot"><button class="btn" data-cancel>Close</button></div>`,
          (c) => ($("[data-cancel]", c).onclick = closeSheet),
        )
      }
    // explain
    const explainBtn = $("[data-explain]", root)
    if (explainBtn)
      explainBtn.onclick = async () => {
        const out = $("#expOut", root)
        out.innerHTML = `<div class="skeleton" style="width:50%"></div>`
        try {
          const res = await api("/api/explain", {
            method: "POST",
            body: { resumeId: explainBtn.dataset.explain, title: $("#expTitle", root).value, description: $("#expJd", root).value },
          })
          out.innerHTML = `<div style="margin-bottom:12px"><span class="tag ${res.mismatch ? "warn" : "ok"}">score ${res.score.toFixed(1)}${res.mismatch ? " · mismatch" : ""}</span></div>
            <table class="tbl" style="font-size:12px"><thead><tr><th>Component</th><th>Score</th><th></th></tr></thead><tbody>
              ${Object.entries(res.breakdown)
                .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td><div class="bar"><i style="width:${v}%"></i></div></td></tr>`)
                .join("")}
            </tbody></table>
            <table class="tbl" style="font-size:12px;margin-top:14px"><thead><tr><th>Requirement</th><th>Result</th><th>Score</th><th>How</th><th>Evidence</th></tr></thead><tbody>
              ${(res.matches || [])
                .map(
                  (m) => `<tr><td>${esc(m.requirement)}</td><td>${m.matched ? `<span class="tag ok">match</span>` : `<span class="tag bad">missing</span>`}</td>
                  <td class="num">${m.score.toFixed(2)}</td><td><span class="tag">${esc(m.via)}</span></td><td class="mono" style="color:var(--muted-2)">${esc(m.evidence || "—")}</td></tr>`,
                )
                .join("")}
            </tbody></table>`
        } catch (err) {
          out.innerHTML = `<div class="hint">${esc(err.message)}</div>`
        }
      }
    // rank view
    if (view === "rank") wireRank(root)
    // expandable ranking rows
    $$("[data-expand]", root).forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target.closest("a,button")) return
        const detail = $(`[data-detail="${tr.dataset.expand}"]`, root)
        if (detail) {
          detail.hidden = !detail.hidden
          tr.classList.toggle("open", !detail.hidden)
        }
      }
    })
    // A saved run opens on its top candidate's reasoning — that is the thing
    // you came back to read. `#/rankings/<id>?collapsed` keeps it all closed.
    if (view === "ranking" && !currentRoute.includes("collapsed")) {
      const first = $("[data-expand]", root)
      const detail = first && $(`[data-detail="${first.dataset.expand}"]`, root)
      if (detail) {
        detail.hidden = false
        first.classList.add("open")
      }
    }
    // dashboard skill shortcut
    $$("[data-skill]", root).forEach((tr) => {
      tr.onclick = () => {
        location.hash = "#/skills"
        setTimeout(() => {
          const input = $("#skillFilter")
          if (input) {
            input.value = tr.dataset.skill
            input.dispatchEvent(new Event("input"))
          }
        }, 200)
      }
    })
    // skills filter
    const filter = $("#skillFilter", root)
    if (filter) {
      filter.oninput = () => {
        const q = filter.value.toLowerCase()
        $("#skillBody", host) && ($("#skillBody").innerHTML = skillsTable(state.skills.filter((s) => s.skill.toLowerCase().includes(q))) )
      }
    }
  }

  function wireRank(root) {
    const st = state.rank
    const titleEl = $("#rankTitle", root)
    const jdEl = $("#rankJd", root)
    const limitEl = $("#rankLimit", root)
    const offlineEl = $("#rankOffline", root)
    const mismatchEl = $("#rankMismatch", root)
    const sync = () => {
      st.title = titleEl.value
      st.description = jdEl.value
      st.offline = offlineEl.checked
      st.includeMismatches = mismatchEl.checked
    }
    ;[titleEl, jdEl, offlineEl, mismatchEl].forEach((el) => (el.oninput = sync))

    $("[data-analyze]", root).onclick = async () => {
      sync()
      const box = $("#reqPreview", root)
      box.innerHTML = `<div class="skeleton" style="width:60%"></div>`
      try {
        const res = await api("/api/jd", { method: "POST", body: { title: st.title, description: st.description } })
        st.requirements = res.requirements
        box.innerHTML = requirementsCard(res.requirements)
      } catch (err) {
        box.innerHTML = `<div class="hint">${esc(err.message)}</div>`
      }
    }

    $("[data-run-rank]", root).onclick = async () => {
      sync()
      if (!st.description.trim()) return toast("Paste a job description first", "bad")
      const btn = $("[data-run-rank]", root)
      btn.innerHTML = `<span class="spin"></span>Ranking…`
      btn.disabled = true
      try {
        const result = await api("/api/rank", {
          method: "POST",
          body: {
            title: st.title,
            description: st.description,
            offline: st.offline,
            includeMismatches: st.includeMismatches,
            limit: Number(limitEl.value) || 20,
          },
        })
        st.result = result
        if (!st.requirements) {
          const req = await api("/api/jd", { method: "POST", body: { title: st.title, description: st.description } })
          st.requirements = req.requirements
          $("#reqPreview", root).innerHTML = requirementsCard(req.requirements)
        }
        $("#rankOut", root).innerHTML = rankingResults(result)
        wire($("#rankOut", root), "rank")
        await refresh()
        paintChrome()
        toast(`Ranked ${result.candidateCount} candidates — saved as ${result.rankingId.slice(0, 11)}`)
      } catch (err) {
        toast(err.message, "bad")
      } finally {
        btn.innerHTML = `<svg><use href="#i-bolt"/></svg>Run ranking`
        btn.disabled = false
      }
    }
  }

  // ---------- uploads ----------
  function openUploadSheet(files) {
    openSheet(
      `<h3>Add resumes</h3><div class="sub">PDF, DOCX or TXT · drop as many as you like · everything stays on this machine</div>
       <div class="drop" id="dropZone"><b>Drop files here</b><div class="hint">or <button class="btn sm" id="pickBtn" style="margin-left:4px">choose files</button></div></div>
       <div class="row" style="margin-top:14px">
         <label class="check"><input type="checkbox" id="upJev" checked/> Use Jev for typed confirmation (uncheck for pure offline extraction)</label>
       </div>
       <div class="progress-list" id="progressList"></div>
       <div class="sheet-foot"><button class="btn" id="upClose">Done</button><button class="btn primary" id="upStart" disabled>Upload</button></div>`,
      (card) => {
        const list = $("#progressList", card)
        let queue = files ? Array.from(files) : []
        const renderQueue = () => {
          list.innerHTML = queue
            .map((f, i) => `<div class="pl-item"><div><b>${esc(f.name)}</b><div class="m">${(f.size / 1024).toFixed(0)} KB</div></div><div class="m" data-state="${i}">queued</div></div>`)
            .join("")
          $("#upStart", card).disabled = queue.length === 0
        }
        renderQueue()
        const addFiles = (fl) => {
          queue = queue.concat(Array.from(fl))
          renderQueue()
        }
        const zone = $("#dropZone", card)
        zone.ondragover = (e) => {
          e.preventDefault()
          zone.classList.add("hot")
        }
        zone.ondragleave = () => zone.classList.remove("hot")
        zone.ondrop = (e) => {
          e.preventDefault()
          zone.classList.remove("hot")
          addFiles(e.dataTransfer.files)
        }
        $("#pickBtn", card).onclick = () => {
          const picker = $("#filePicker")
          picker.onchange = () => addFiles(picker.files)
          picker.click()
        }
        $("#upClose", card).onclick = async () => {
          closeSheet()
          await refresh()
          render()
        }
        $("#upStart", card).onclick = async () => {
          const useJev = $("#upJev", card).checked
          const start = $("#upStart", card)
          start.disabled = true
          let ok = 0
          let failed = 0
          // the server extracts several files at once, so send a bigger batch
          const batchSize = 8
          for (let i = 0; i < queue.length; i += batchSize) {
            const batch = queue.slice(i, i + batchSize)
            const payload = []
            for (let j = 0; j < batch.length; j++) {
              const idx = i + j
              $(`[data-state="${idx}"]`, card).textContent = "reading…"
              const dataBase64 = await new Promise((res, rej) => {
                const fr = new FileReader()
                fr.onload = () => res(String(fr.result).split(",")[1] || "")
                fr.onerror = () => rej(new Error("read failed"))
                fr.readAsDataURL(batch[j])
              }).catch(() => "")
              payload.push({ name: batch[j].name, dataBase64 })
            }
            batch.forEach((_, j) => ($(`[data-state="${i + j}"]`, card).textContent = "extracting…"))
            try {
              const res = await api("/api/resumes/upload", { method: "POST", body: { files: payload, jev: useJev } })
              res.results.forEach((r, j) => {
                const el = $(`[data-state="${i + j}"]`, card)
                if (r.ok) {
                  ok++
                  el.innerHTML = r.duplicate
                    ? `<span class="tag warn">already in the library</span>`
                    : `<span class="tag ok">${r.skills} skills</span>`
                } else {
                  failed++
                  el.innerHTML = `<span class="tag bad">${esc(r.error)}</span>`
                }
              })
            } catch (err) {
              batch.forEach((_, j) => {
                failed++
                const el = $(`[data-state="${i + j}"]`, card)
                if (el) el.innerHTML = `<span class="tag bad">${esc(err.message)}</span>`
              })
            }
          }
          toast(`${ok} added${failed ? `, ${failed} failed` : ""}`, failed ? "bad" : "ok")
          await refresh()
          paintChrome()
          start.disabled = false
          start.textContent = "Upload more"
        }
      },
    )
  }

  $("#addBtn").onclick = () => openUploadSheet()
  $("#filePicker").onchange = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) openUploadSheet(files)
    e.target.value = ""
  }
  // page-level drag & drop
  ;["dragenter", "dragover"].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return
      e.preventDefault()
    }),
  )
  document.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return
    e.preventDefault()
    if (!$("#sheet").hidden) return
    openUploadSheet(e.dataTransfer.files)
  })

  // theme toggle (persisted on deliberate choice; the head script applies it pre-paint)
  const applyTheme = (theme, persist = false) => {
    document.documentElement.dataset.theme = theme
    const label = $("#themeLabel")
    if (label) label.textContent = theme === "dark" ? "Dark" : "Light"
    if (!persist) return
    try {
      localStorage.setItem("rr-theme", theme)
    } catch {}
  }
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light")
  $("#themeBtn").onclick = () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true)
  }

  // settings sheet
  $("#settingsBtn").onclick = () => {
    const s = state.status || {}
    const key = s.jev?.key || { configured: false, source: "none", hint: "" }
    const keyLine = key.configured
      ? `<span class="tag ok">configured</span> <span class="hint">${esc(key.source)}${key.hint ? ` · key ${esc(key.hint)}` : ""}</span>`
      : `<span class="tag warn">not set</span> <span class="hint">offline extraction still works</span>`

    openSheet(
      `<h3>Settings</h3><div class="sub">Your TypeSafe (Jev) key is stored on this machine in <span class="mono">config.json</span> with 0600 permissions. It never leaves your machine except to call TypeSafe, and it is never shown back to this page.</div>

       <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>TypeSafe Jev key</h2><div class="right">${keyLine}</div></div>
        <div class="card-body">
          <label class="field"><span>API key</span>
            <input type="password" id="setKey" placeholder="${key.configured ? "•••••••• (leave empty to keep)" : "paste your TypeSafe API key"}" autocomplete="off" spellcheck="false" />
          </label>
          <label class="field"><span>Model</span><input type="text" id="setModel" value="${esc(s.jev?.model || "jev-latest")}" /></label>
          <div class="row" style="gap:8px">
            <button class="btn primary sm" data-key-save>Save key</button>
            <button class="btn sm" data-key-test>Test connection</button>
            ${key.configured ? `<button class="btn sm danger" data-key-clear>Remove key</button>` : ""}
          </div>
          <div id="keyResult" style="margin-top:12px"></div>
          <div class="hint" style="margin-top:10px">Get a key at <a href="https://typesafe.ai" target="_blank" rel="noreferrer" style="text-decoration:underline">typesafe.ai</a>. Without one the app runs fully offline: deterministic + semantic extraction, no network calls.</div>
        </div>
      </div>

       <label class="check" style="margin-bottom:14px"><input type="checkbox" id="setOffline" ${s.offline ? "checked" : ""}/> Offline mode — never call Jev, deterministic + semantic only</label>

       <dl class="kv" style="margin-top:10px">
         <dt>Data dir</dt><dd class="mono">${esc(s.dataDir || "")}</dd>
         <dt>Storage</dt><dd>${esc(s.storage || "")}</dd>
         <dt>Endpoint</dt><dd class="mono">${esc(s.jev?.status || "")}</dd>
         <dt>Index size</dt><dd>${(s.indexBytes / 1024).toFixed(1)} KB</dd>
       </dl>
       <div class="sheet-foot"><button class="btn" data-cancel>Close</button><button class="btn primary" data-save>Apply</button></div>`,
      (card) => {
        const setResult = (html) => {
          const box = $("#keyResult", card)
          if (box) box.innerHTML = html
        }
        $("[data-cancel]", card).onclick = closeSheet
        $("[data-save]", card).onclick = async () => {
          try {
            await api("/api/settings", {
              method: "POST",
              body: { offline: $("#setOffline", card).checked, model: $("#setModel", card).value },
            })
            toast("Settings applied")
            closeSheet()
            await refresh()
            render()
          } catch (err) {
            toast(err.message, "bad")
          }
        }

        $("[data-key-save]", card).onclick = async () => {
          const value = $("#setKey", card).value.trim()
          const model = $("#setModel", card).value.trim()
          if (!value && !model) return toast("Paste a key first", "bad")
          try {
            await api("/api/settings", { method: "POST", body: { ...(value ? { apiKey: value } : {}), model } })
            $("#setKey", card).value = ""
            await refresh()
            const k = state.status?.jev?.key
            setResult(`<div class="callout ok"><span>✓</span><span>Key saved${k?.hint ? ` (${esc(k.hint)})` : ""}. Press <b>Test connection</b> to confirm it works.</span></div>`)
            toast("Key saved")
          } catch (err) {
            setResult(`<div class="callout bad"><span>✕</span><span>${esc(err.message)}</span></div>`)
          }
        }

        $("[data-key-clear]", card).onclick = async () => {
          await api("/api/settings", { method: "POST", body: { clearKey: true } })
          $("#setKey", card).value = ""
          await refresh()
          setResult(`<div class="callout"><span>⚠</span><span>Key removed. The app is offline-only until you add another one.</span></div>`)
          toast("Key removed")
        }

        $("[data-key-test]", card).onclick = async () => {
          setResult(`<div class="hint"><span class="spin" style="display:inline-block;vertical-align:-1px"></span> contacting TypeSafe…</div>`)
          try {
            const r = await api("/api/jev/test", { method: "POST" })
            setResult(
              r.ok
                ? `<div class="callout ok"><span>✓</span><span>${esc(r.message)}</span></div>`
                : `<div class="callout bad"><span>✕</span><span>${esc(r.message)}</span></div>`,
            )
            await refresh()
          } catch (err) {
            setResult(`<div class="callout bad"><span>✕</span><span>${esc(err.message)}</span></div>`)
          }
        }
      },
    )
  }

  let searchTimer = null
  $("#globalSearch").oninput = (e) => {
    state.search = e.target.value.trim()
    clearTimeout(searchTimer)
    searchTimer = setTimeout(async () => {
      await refresh()
      if (!location.hash.startsWith("#/candidates")) location.hash = "#/candidates"
      else render()
    }, 220)
  }

  window.addEventListener("hashchange", render)
  render()
})()
