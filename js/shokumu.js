const CANDIDATE_ID = getCandidateIdFromUrl();
if (!CANDIDATE_ID) {
  location.href = "candidates.html";
}
const STORAGE_KEY = SHOKUMU_PREFIX + CANDIDATE_ID;

function emptySkill() {
  return { title: "", duration: "", description: "" };
}

function emptyRole() {
  return { title: "", start: "", end: "", current: false, description: "" };
}

function emptyJob() {
  return { company: "", start: "", end: "", current: false, business: "", roles: [emptyRole()] };
}

const defaultState = {
  createDate: today(),
  fullName: "",
  summary: "",
  skills: [emptySkill()],
  jobs: [emptyJob()],
  selfPr: ""
};

let state = loadState();

function loadState() {
  const saved = Storage.load(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);
  const merged = { ...structuredClone(defaultState), ...saved };
  if (!Array.isArray(merged.skills) || merged.skills.length === 0) merged.skills = [emptySkill()];
  if (!Array.isArray(merged.jobs) || merged.jobs.length === 0) merged.jobs = [emptyJob()];
  merged.jobs.forEach(job => {
    if (!Array.isArray(job.roles) || job.roles.length === 0) job.roles = [emptyRole()];
  });
  return merged;
}

function persist() {
  state.updatedAt = new Date().toISOString();
  Storage.save(STORAGE_KEY, state);
}
const persistDebounced = debounce(persist, 300);

const simpleFieldIds = ["createDate", "fullName", "summary", "selfPr"];

function bindSimpleFieldsOnce() {
  simpleFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      state[id] = el.value;
      persistDebounced();
      renderPreview();
    });
  });
}

function refreshSimpleFields() {
  simpleFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = state[id] ?? "";
  });
}

function formatMonth(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-");
  return `${y}年${Number(m)}月`;
}

function periodLabel(entry) {
  const start = formatMonth(entry.start) || "____年__月";
  const end = entry.current ? "現在" : (formatMonth(entry.end) || "____年__月");
  return `${start} 〜 ${end}`;
}

// ---------- Skill cards ----------
function renderSkillForms() {
  const list = document.getElementById("skillList");
  const template = document.getElementById("skillEntryTemplate");
  list.innerHTML = "";

  state.skills.forEach((skill, idx) => {
    const node = template.content.cloneNode(true);
    const titleEl = node.querySelector(".skill-title");
    const durationEl = node.querySelector(".skill-duration");
    const descEl = node.querySelector(".skill-description");
    const removeBtn = node.querySelector(".skill-remove-btn");

    titleEl.value = skill.title;
    durationEl.value = skill.duration;
    descEl.value = skill.description;

    titleEl.addEventListener("input", () => { skill.title = titleEl.value; persistDebounced(); renderPreview(); });
    durationEl.addEventListener("input", () => { skill.duration = durationEl.value; persistDebounced(); renderPreview(); });
    descEl.addEventListener("input", () => { skill.description = descEl.value; persistDebounced(); renderPreview(); });

    removeBtn.addEventListener("click", () => {
      if (state.skills.length === 1) {
        if (!confirm("最後の1件です。削除すると空欄になります。よろしいですか?")) return;
      }
      state.skills.splice(idx, 1);
      if (state.skills.length === 0) state.skills.push(emptySkill());
      persistDebounced();
      renderSkillForms();
      renderPreview();
    });

    list.appendChild(node);
  });
}

function bindSkillActions() {
  document.getElementById("addSkillBtn").addEventListener("click", () => {
    state.skills.push(emptySkill());
    persistDebounced();
    renderSkillForms();
    renderPreview();
  });
}

// ---------- Role sub-entries (within a job) ----------
function renderRoleForms(job, container) {
  const template = document.getElementById("roleEntryTemplate");
  container.innerHTML = "";

  job.roles.forEach((role, idx) => {
    const node = template.content.cloneNode(true);
    const titleEl = node.querySelector(".role-title");
    const startEl = node.querySelector(".role-start");
    const endEl = node.querySelector(".role-end");
    const currentEl = node.querySelector(".role-current");
    const descEl = node.querySelector(".role-description");
    const removeBtn = node.querySelector(".role-remove-btn");

    titleEl.value = role.title;
    startEl.value = role.start;
    endEl.value = role.end;
    currentEl.checked = role.current;
    endEl.disabled = role.current;
    descEl.value = role.description;

    titleEl.addEventListener("input", () => { role.title = titleEl.value; persistDebounced(); renderPreview(); });
    startEl.addEventListener("input", () => { role.start = startEl.value; persistDebounced(); renderPreview(); });
    endEl.addEventListener("input", () => { role.end = endEl.value; persistDebounced(); renderPreview(); });
    descEl.addEventListener("input", () => { role.description = descEl.value; persistDebounced(); renderPreview(); });
    currentEl.addEventListener("change", () => {
      role.current = currentEl.checked;
      endEl.disabled = role.current;
      persistDebounced();
      renderPreview();
    });

    removeBtn.addEventListener("click", () => {
      if (job.roles.length === 1) {
        if (!confirm("最後の1件です。削除すると空欄になります。よろしいですか?")) return;
      }
      job.roles.splice(idx, 1);
      if (job.roles.length === 0) job.roles.push(emptyRole());
      persistDebounced();
      renderRoleForms(job, container);
      renderPreview();
    });

    container.appendChild(node);
  });
}

// ---------- Job (company) entries ----------
function renderJobForms() {
  const list = document.getElementById("jobList");
  const template = document.getElementById("jobEntryTemplate");
  list.innerHTML = "";

  state.jobs.forEach((job, idx) => {
    const node = template.content.cloneNode(true);

    const companyEl = node.querySelector(".job-company");
    const startEl = node.querySelector(".job-start");
    const endEl = node.querySelector(".job-end");
    const currentEl = node.querySelector(".job-current");
    const businessEl = node.querySelector(".job-business");
    const removeBtn = node.querySelector(".job-remove-btn");
    const roleListEl = node.querySelector(".role-list");
    const roleAddBtn = node.querySelector(".role-add-btn");

    companyEl.value = job.company;
    startEl.value = job.start;
    endEl.value = job.end;
    currentEl.checked = job.current;
    endEl.disabled = job.current;
    businessEl.value = job.business;

    companyEl.addEventListener("input", () => { job.company = companyEl.value; persistDebounced(); renderPreview(); });
    startEl.addEventListener("input", () => { job.start = startEl.value; persistDebounced(); renderPreview(); });
    endEl.addEventListener("input", () => { job.end = endEl.value; persistDebounced(); renderPreview(); });
    businessEl.addEventListener("input", () => { job.business = businessEl.value; persistDebounced(); renderPreview(); });
    currentEl.addEventListener("change", () => {
      job.current = currentEl.checked;
      endEl.disabled = job.current;
      persistDebounced();
      renderPreview();
    });

    removeBtn.addEventListener("click", () => {
      if (state.jobs.length === 1) {
        if (!confirm("最後の1件です。削除すると空欄の職歴のみになります。よろしいですか?")) return;
      }
      state.jobs.splice(idx, 1);
      if (state.jobs.length === 0) state.jobs.push(emptyJob());
      persistDebounced();
      renderJobForms();
      renderPreview();
    });

    roleAddBtn.addEventListener("click", () => {
      job.roles.push(emptyRole());
      persistDebounced();
      renderRoleForms(job, roleListEl);
      renderPreview();
    });

    list.appendChild(node);
    renderRoleForms(job, roleListEl);
  });
}

function bindJobActions() {
  document.getElementById("addJobBtn").addEventListener("click", () => {
    state.jobs.push(emptyJob());
    persistDebounced();
    renderJobForms();
    renderPreview();
  });
}

// ---------- Preview (paginated into A4 pages, same approach as rirekisho) ----------
function skillCardHtml(skill) {
  return `
    <div class="skm-skill-card">
      <div class="skm-skill-title">${escapeHtml(skill.title) || "<span class=\"empty-hint\">スキル名未入力</span>"}${skill.duration ? `<br><span class="skm-skill-duration">${escapeHtml(skill.duration)}</span>` : ""}</div>
      <div class="skm-skill-desc">${nl2br(skill.description) || "<span class=\"empty-hint\">未入力</span>"}</div>
    </div>
  `;
}

function roleHtml(role) {
  return `
    <div class="skm-role">
      <div class="skm-role-title">${escapeHtml(role.title) || "<span class=\"empty-hint\">役職・担当業務未入力</span>"}<span class="skm-role-period">${periodLabel(role)}</span></div>
      <div class="skm-role-desc">${nl2br(role.description) || "<span class=\"empty-hint\">未入力</span>"}</div>
    </div>
  `;
}

function jobCardHtml(job) {
  return `
    <div class="skm-job">
      <div class="skm-job-header">
        <div class="skm-job-company">${escapeHtml(job.company) || "<span class=\"empty-hint\">会社名未入力</span>"}</div>
        <div class="skm-job-period">${periodLabel(job)}</div>
      </div>
      ${job.business ? `<div class="skm-job-business">事業内容：${escapeHtml(job.business)}</div>` : ""}
      <div class="skm-job-achievements-heading">主な実績</div>
      ${job.roles.map(roleHtml).join("")}
    </div>
  `;
}

// Splits the document into atomic, unsplittable chunks for pagination. A
// section heading is bundled with its first card so it's never left orphaned
// alone at the bottom of a page; later cards in the same section are their
// own chunks so they can flow onto a new page independently.
function buildContentBlocks() {
  const blocks = [];

  blocks.push(`
    <h1 class="skm-header-title">職務経歴書</h1>
    <div class="skm-header-meta">
      ${formatDateJp(state.createDate)}<br>
      ${escapeHtml(state.fullName) || "<span class=\"empty-hint\">氏名未入力</span>"}
    </div>
  `);

  blocks.push(`
    <div class="skm-section">
      <div class="skm-section-heading">経歴要約</div>
      <div class="skm-body-text">${nl2br(state.summary) || "<span class=\"empty-hint\">未入力</span>"}</div>
    </div>
  `);

  const skillCards = state.skills.map(skillCardHtml);
  blocks.push(`<div class="skm-section"><div class="skm-section-heading">活かせるスキル・経験</div>${skillCards[0] || ""}</div>`);
  skillCards.slice(1).forEach(card => blocks.push(`<div class="skm-section">${card}</div>`));

  const jobCards = state.jobs.map(jobCardHtml);
  blocks.push(`<div class="skm-section"><div class="skm-section-heading">職歴</div>${jobCards[0] || ""}</div>`);
  jobCards.slice(1).forEach(card => blocks.push(`<div class="skm-section">${card}</div>`));

  blocks.push(`
    <div class="skm-section">
      <div class="skm-section-heading">自己PR</div>
      <div class="skm-body-text">${nl2br(state.selfPr) || "<span class=\"empty-hint\">未入力</span>"}</div>
    </div>
    <div class="footer-note">以上</div>
  `);

  return blocks;
}

// Reads the usable content height (page height minus padding) from a real,
// correctly-styled A4 page element, matching rirekisho's page dimensions exactly.
function computePageContentBudgetPx() {
  const probe = document.createElement("div");
  probe.className = "paper paper-a4-fixed";
  probe.style.visibility = "hidden";
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const budget = probe.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  document.body.removeChild(probe);
  return budget;
}

// A separate measuring element matching the real page's content-box width and
// font metrics exactly, but with its own padding zeroed out so a reading is
// pure content height (no per-block padding overhead to account for). Keeps
// display:flex (inherited from .paper-a4-fixed) to match the real page: flex
// containers never collapse margins between children, but a plain block
// container would — that would under-measure any chunk with more than one
// top-level element (e.g. a heading + its first card).
function createMeasureEl() {
  const el = document.createElement("div");
  el.className = "paper paper-a4-fixed";
  Object.assign(el.style, {
    visibility: "hidden", position: "absolute", left: "-9999px", top: "0",
    height: "auto", minHeight: "0", overflow: "visible",
    padding: "0", width: "190mm"
  });
  document.body.appendChild(el);
  return el;
}

// If a page would otherwise end with more than this fraction of its height
// empty (because the next block doesn't fit), shrink the page's content
// instead of leaving a gap that large — down to MIN_PAGE_ZOOM before giving up.
const MAX_GAP_RATIO = 0.15;
const MIN_PAGE_ZOOM = 0.90;
const ZOOM_STEP = 0.02;

// zoom is a layout-affecting CSS property (unlike transform:scale), so
// getBoundingClientRect reflects the post-zoom rendered size directly.
function measureHeightAtZoom(measureEl, html, zoom) {
  measureEl.style.zoom = zoom;
  measureEl.innerHTML = html;
  return measureEl.getBoundingClientRect().height;
}

// Greedily accumulates blocks (starting at startIdx) that fit within budgetPx
// at the given zoom level. Measures the blocks *combined* (not each block
// isolated, then summed) — reflow/spacing of many stacked blocks doesn't
// exactly equal the sum of each measured alone, so this matches the real
// render exactly instead of drifting off by an accumulating few px per block.
function greedyFit(measureEl, blocks, startIdx, budgetPx, zoom) {
  let combinedHtml = "";
  let count = 0;
  let height = 0;
  for (let j = startIdx; j < blocks.length; j++) {
    const candidateHtml = combinedHtml + blocks[j];
    const h = measureHeightAtZoom(measureEl, candidateHtml, zoom);
    if (count > 0 && h > budgetPx) break;
    combinedHtml = candidateHtml;
    height = h;
    count++;
  }
  return { count, total: height };
}

function paginateBlocks(blocks, budgetPx) {
  const measureEl = createMeasureEl();
  const pages = [];
  let i = 0;

  while (i < blocks.length) {
    let best = greedyFit(measureEl, blocks, i, budgetPx, 1);
    let zoom = 1;
    const consumesAll = (i + best.count) >= blocks.length;
    const gap = budgetPx - best.total;

    if (!consumesAll && best.count > 0 && gap > budgetPx * MAX_GAP_RATIO) {
      for (let z = 1 - ZOOM_STEP; z >= MIN_PAGE_ZOOM - 1e-9; z -= ZOOM_STEP) {
        const attempt = greedyFit(measureEl, blocks, i, budgetPx, z);
        if (attempt.count > best.count) {
          best = attempt;
          zoom = z;
          const stillConsumesAll = (i + best.count) >= blocks.length;
          const newGap = budgetPx - best.total;
          if (stillConsumesAll || newGap <= budgetPx * MAX_GAP_RATIO) break;
        }
      }
    }

    const count = Math.max(best.count, 1); // always make progress, even if one block alone exceeds the budget
    pages.push({ blocks: blocks.slice(i, i + count), zoom });
    i += count;
  }

  document.body.removeChild(measureEl);
  return pages;
}

function renderPreview() {
  const blocks = buildContentBlocks();
  const budget = computePageContentBudgetPx();
  const pages = paginateBlocks(blocks, budget);

  document.getElementById("pagesContainer").innerHTML = pages
    .map(page => `<div class="paper paper-a4-fixed"><div class="skm-zoom-wrap" style="zoom:${page.zoom};">${page.blocks.join("")}</div></div>`)
    .join("");
}

// ---------- Toolbar ----------
function bindToolbar() {
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!confirm("入力内容をすべてクリアします。よろしいですか?")) return;
    Storage.clear(STORAGE_KEY);
    state = structuredClone(defaultState);
    refreshForm();
  });
}

function refreshForm() {
  refreshSimpleFields();
  renderSkillForms();
  renderJobForms();
  renderPreview();
}

async function initPage() {
  bindSimpleFieldsOnce();
  bindSkillActions();
  bindJobActions();
  bindToolbar();

  // This browser has never seen this candidate locally (e.g. an admin opening
  // someone else's link) — try pulling their last-synced data from the shared
  // sheet before rendering, so the same edit form works for admin and
  // candidate alike instead of needing a separate read-only view.
  if (!Storage.load(STORAGE_KEY)) {
    const remote = await fetchFromSheet(CANDIDATE_ID, "shokumu");
    if (remote) {
      state = { ...structuredClone(defaultState), ...remote };
      if (!Array.isArray(state.skills) || state.skills.length === 0) state.skills = [emptySkill()];
      if (!Array.isArray(state.jobs) || state.jobs.length === 0) state.jobs = [emptyJob()];
      state.jobs.forEach(job => {
        if (!Array.isArray(job.roles) || job.roles.length === 0) job.roles = [emptyRole()];
      });
    }
  }

  refreshForm();
  // Ensure this candidate shows up in the list immediately, even before any edits.
  if (!Storage.load(STORAGE_KEY)) persist();

  // Keep the tab-switch links pointed at the same candidate.
  document.getElementById("navRirekisho").href = candidateUrl("rirekisho.html", CANDIDATE_ID);
  document.getElementById("navShokumu").href = candidateUrl("shokumu.html", CANDIDATE_ID);

  // Pagination is based on rendered pixel sizes, so recompute when the
  // viewport (and therefore the paper's on-screen scale) changes.
  window.addEventListener("resize", debounce(renderPreview, 150));
}

if (CANDIDATE_ID) {
  initPage();
}
