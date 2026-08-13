const CANDIDATE_ID = getCandidateIdFromUrl();
if (!CANDIDATE_ID) {
  location.href = "candidates.html";
}
const STORAGE_KEY = RIREKISHO_PREFIX + CANDIDATE_ID;

// Preview/print always shows this many ruled lines (matches the source template).
const HISTORY_ROWS_PAGE1 = 14;
const HISTORY_ROWS_PAGE2 = 6;
const HISTORY_ROWS_MAX = HISTORY_ROWS_PAGE1 + HISTORY_ROWS_PAGE2;
const LICENSE_ROWS_MAX = 6;

// Fixed lines the preview always adds around the entries: "学歴" heading, a blank
// spacer, "職歴" heading, a blank spacer, "以上" footer.
const HISTORY_FIXED_LINES = 5;
// Combined cap on education + work-history entries so everything still fits
// within HISTORY_ROWS_MAX once the fixed lines above are added.
const HISTORY_ENTRIES_MAX = HISTORY_ROWS_MAX - HISTORY_FIXED_LINES;

// The form starts with just a few entry rows; "+行を追加" grows them up to the max above.
const EDUCATION_ROWS_DEFAULT = 2;
const WORK_HISTORY_ROWS_DEFAULT = 3;
const LICENSE_ROWS_DEFAULT = 2;

function emptyHistoryRows(n) {
  return Array.from({ length: n }, () => ({ year: "", month: "", text: "" }));
}

const defaultState = {
  createDate: today(),
  photoDataUrl: "",
  furigana: "",
  fullName: "",
  birthDate: "",
  gender: "",
  zipCurrent: "",
  addressCurrentFurigana: "",
  addressCurrent: "",
  phoneCurrent: "",
  emailCurrent: "",
  zipContact: "",
  addressContactFurigana: "",
  addressContact: "",
  phoneContact: "",
  emailContact: "",
  education: emptyHistoryRows(EDUCATION_ROWS_DEFAULT),
  workHistory: emptyHistoryRows(WORK_HISTORY_ROWS_DEFAULT),
  licenses: emptyHistoryRows(LICENSE_ROWS_DEFAULT),
  motivation: "",
  requests: "貴社の規定に従います"
};

let state = loadState();

function loadState() {
  const saved = Storage.load(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);
  const merged = { ...structuredClone(defaultState), ...saved };
  merged.education = normalizeRows(merged.education, HISTORY_ENTRIES_MAX);
  merged.workHistory = normalizeRows(merged.workHistory, HISTORY_ENTRIES_MAX);
  merged.licenses = normalizeRows(merged.licenses, LICENSE_ROWS_MAX);
  return merged;
}

// Keeps whatever rows were saved (no forced padding) but caps at the print maximum.
function normalizeRows(rows, max) {
  const arr = Array.isArray(rows) && rows.length > 0 ? rows.slice(0, max) : [{ year: "", month: "", text: "" }];
  return arr;
}

// Pads a copy of `rows` with blanks up to `count` for preview/print, without mutating form state.
function padRowsForPreview(rows, count) {
  const arr = rows.slice(0, count).map(r => ({ ...r }));
  while (arr.length < count) arr.push({ year: "", month: "", text: "" });
  return arr;
}

function persist() {
  state.updatedAt = new Date().toISOString();
  Storage.save(STORAGE_KEY, state);
}
const persistDebounced = debounce(persist, 300);

const simpleFieldIds = [
  "createDate", "furigana", "fullName", "birthDate", "gender",
  "zipCurrent", "addressCurrentFurigana", "addressCurrent", "phoneCurrent", "emailCurrent",
  "zipContact", "addressContactFurigana", "addressContact", "phoneContact", "emailContact",
  "motivation", "requests"
];

// Japan's school-year cohort cutoff: a child born Apr 2 (year Y) through
// Apr 1 (year Y+1) is one cohort, entering elementary school in April of
// (Y+6). Someone born Jan 1 - Apr 1 therefore belongs to the PREVIOUS
// calendar year's cohort.
function schoolCohortYear(birthDateStr) {
  const d = new Date(birthDateStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return (m < 4 || (m === 4 && day === 1)) ? y - 1 : y;
}

// Fills the high school entrance/graduation year+month (age 15 -> April,
// age 18 -> March) into the first two 学歴 rows, but only if those rows are
// still completely blank — never overwrites anything the user already typed.
function fillHighSchoolDatesFromBirthdate() {
  const cohort = schoolCohortYear(state.birthDate);
  if (cohort === null) return;
  const isBlank = row => row && !row.year && !row.month && !row.text;
  if (isBlank(state.education[0])) {
    state.education[0].year = String(cohort + 15);
    state.education[0].month = "4";
  }
  if (isBlank(state.education[1])) {
    state.education[1].year = String(cohort + 18);
    state.education[1].month = "3";
  }
}

// Bound once at startup; only wires up "input" listeners.
function bindSimpleFieldsOnce() {
  simpleFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      state[id] = el.value;
      if (id === "birthDate") {
        fillHighSchoolDatesFromBirthdate();
        bindEducationTable();
      }
      persistDebounced();
      renderPreview();
    });
  });
}

// Called on load and after clearing, to push state values back into the form.
function refreshSimpleFields() {
  simpleFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = state[id] ?? "";
  });
}

// ---------- Postal code -> address + furigana auto-fill (zipcloud public API) ----------
async function lookupZipAndFillAddress(zipInputId, addressInputId, furiganaInputId) {
  const zipEl = document.getElementById(zipInputId);
  const addressEl = document.getElementById(addressInputId);
  const furiganaEl = document.getElementById(furiganaInputId);
  const digits = zipEl.value.replace(/[^0-9]/g, "");
  if (digits.length !== 7) return;
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`);
    const data = await res.json();
    if (data.status === 200 && data.results && data.results.length > 0) {
      const r = data.results[0];
      addressEl.value = `${r.address1}${r.address2}${r.address3}`;
      addressEl.dispatchEvent(new Event("input", { bubbles: true }));

      if (furiganaEl) {
        // zipcloud returns readings as half-width katakana; ふりがな fields use hiragana.
        furiganaEl.value = halfwidthKatakanaToHiragana(`${r.kana1}${r.kana2}${r.kana3}`);
        furiganaEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
      addressEl.focus();
    }
  } catch (e) {
    // Offline or the lookup API is unreachable — fail silently, user can type the address manually.
  }
}

function bindZipLookupOnce() {
  document.getElementById("zipCurrent").addEventListener("input", () => lookupZipAndFillAddress("zipCurrent", "addressCurrent", "addressCurrentFurigana"));
  document.getElementById("zipContact").addEventListener("input", () => lookupZipAndFillAddress("zipContact", "addressContact", "addressContactFurigana"));
}

// ---------- Photo ----------
function renderPhotoBox() {
  const box = document.getElementById("photoPreviewBox");
  if (state.photoDataUrl) {
    box.innerHTML = `<img src="${state.photoDataUrl}" alt="photo">`;
  } else {
    box.textContent = "未設定";
  }
}

function refreshPhoto() {
  document.getElementById("photoInput").value = "";
  renderPhotoBox();
}

function bindPhotoOnce() {
  const input = document.getElementById("photoInput");
  const removeBtn = document.getElementById("photoRemoveBtn");

  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert("画像サイズが大きすぎます(3MB以下にしてください)");
      input.value = "";
      return;
    }
    state.photoDataUrl = await fileToDataUrl(file);
    renderPhotoBox();
    persistDebounced();
    renderPreview();
  });

  removeBtn.addEventListener("click", () => {
    state.photoDataUrl = "";
    input.value = "";
    renderPhotoBox();
    persistDebounced();
    renderPreview();
  });
}

// ---------- Fixed-grid repeat tables (history / licenses) ----------
function renderFixedTable(bodyEl, rows, textPlaceholder) {
  bodyEl.innerHTML = "";
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");

    const yearTd = document.createElement("td");
    const yearInput = document.createElement("input");
    yearInput.type = "text";
    yearInput.value = row.year;
    yearInput.placeholder = "西暦";
    yearInput.addEventListener("input", () => { row.year = yearInput.value; persistDebounced(); renderPreview(); });
    yearTd.appendChild(yearInput);

    const monthTd = document.createElement("td");
    const monthInput = document.createElement("input");
    monthInput.type = "text";
    monthInput.value = row.month;
    monthInput.placeholder = "月";
    monthInput.addEventListener("input", () => { row.month = monthInput.value; persistDebounced(); renderPreview(); });
    monthTd.appendChild(monthInput);

    const textTd = document.createElement("td");
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = row.text;
    textInput.placeholder = idx === 0 ? textPlaceholder : "";
    textInput.addEventListener("input", () => { row.text = textInput.value; persistDebounced(); renderPreview(); });
    textTd.appendChild(textInput);

    tr.appendChild(yearTd);
    tr.appendChild(monthTd);
    tr.appendChild(textTd);
    bodyEl.appendChild(tr);
  });
}

function updateAddButtonState(buttonEl, currentLength, max, label) {
  buttonEl.disabled = currentLength >= max;
  buttonEl.textContent = currentLength >= max ? `行を追加(${label}上限${max}行)` : "+ 行を追加";
}

function bindEducationTable() {
  renderFixedTable(document.getElementById("educationBody"), state.education, "〇〇高等学校 卒業");
  const total = state.education.length + state.workHistory.length;
  updateAddButtonState(document.getElementById("addEducationRowBtn"), total, HISTORY_ENTRIES_MAX, "学歴+職歴で");
}

function bindWorkHistoryTable() {
  renderFixedTable(document.getElementById("workHistoryBody"), state.workHistory, "株式会社〇〇 入社");
  const total = state.education.length + state.workHistory.length;
  updateAddButtonState(document.getElementById("addWorkHistoryRowBtn"), total, HISTORY_ENTRIES_MAX, "学歴+職歴で");
}

function bindLicenseTable() {
  renderFixedTable(document.getElementById("licenseBody"), state.licenses, "免許・資格");
  const addBtn = document.getElementById("addLicenseRowBtn");
  updateAddButtonState(addBtn, state.licenses.length, LICENSE_ROWS_MAX, "");
}

function bindAddRowButtonsOnce() {
  document.getElementById("addEducationRowBtn").addEventListener("click", () => {
    if (state.education.length + state.workHistory.length >= HISTORY_ENTRIES_MAX) return;
    state.education.push({ year: "", month: "", text: "" });
    persistDebounced();
    bindEducationTable();
    bindWorkHistoryTable();
    renderPreview();
  });
  document.getElementById("addWorkHistoryRowBtn").addEventListener("click", () => {
    if (state.education.length + state.workHistory.length >= HISTORY_ENTRIES_MAX) return;
    state.workHistory.push({ year: "", month: "", text: "" });
    persistDebounced();
    bindEducationTable();
    bindWorkHistoryTable();
    renderPreview();
  });
  document.getElementById("addLicenseRowBtn").addEventListener("click", () => {
    if (state.licenses.length >= LICENSE_ROWS_MAX) return;
    state.licenses.push({ year: "", month: "", text: "" });
    persistDebounced();
    bindLicenseTable();
    renderPreview();
  });
}

// ---------- Import from an existing resume file (PDF/image, no AI) ----------
// Fills blank rows first, then appends new ones, without exceeding the given cap.
function mergeRows(targetArray, newRows, cap) {
  newRows.forEach(row => {
    if (targetArray.length >= cap) return;
    const blankIdx = targetArray.findIndex(r => !r.year && !r.month && !r.text);
    if (blankIdx >= 0) targetArray[blankIdx] = row;
    else targetArray.push(row);
  });
}

function applyParsedFields(parsed) {
  ["fullName", "furigana", "birthDate", "zipCurrent", "addressCurrent", "addressCurrentFurigana", "phoneCurrent", "emailCurrent"].forEach(key => {
    if (parsed[key] && !state[key]) state[key] = parsed[key];
  });
  // Only guess entrance/graduation dates when the source didn't already give
  // us real education rows to use instead.
  if (parsed.birthDate && parsed.educationRows.length === 0) {
    fillHighSchoolDatesFromBirthdate();
  }
  const historyRoomLeft = () => Math.max(0, HISTORY_ENTRIES_MAX - state.education.length - state.workHistory.length);
  mergeRows(state.education, parsed.educationRows.slice(0, historyRoomLeft()), state.education.length + historyRoomLeft());
  mergeRows(state.workHistory, parsed.workHistoryRows.slice(0, historyRoomLeft()), state.workHistory.length + historyRoomLeft());
  mergeRows(state.licenses, parsed.licenseRows, LICENSE_ROWS_MAX);
  persistDebounced();
  refreshForm();
}

function bindImportOnce() {
  document.getElementById("importFileBtn").addEventListener("click", async () => {
    const input = document.getElementById("importFileInput");
    const statusEl = document.getElementById("importStatus");
    const file = input.files[0];
    if (!file) {
      statusEl.textContent = "ファイルを選択してください。";
      return;
    }

    statusEl.textContent = "解析中…";
    try {
      let text;
      if (file.type === "application/pdf") {
        text = await extractTextFromPdfFile(file);
      } else if (file.type.startsWith("image/")) {
        text = await extractTextFromImageFile(file, (status, progress) => {
          statusEl.textContent = `OCR実行中: ${status}(${Math.round(progress * 100)}%) ※初回はデータのダウンロードで時間がかかります`;
        });
      } else {
        statusEl.textContent = "PDFまたは画像ファイルを選択してください。";
        return;
      }

      const parsed = parseResumeText(text);
      const foundAny = parsed.fullName || parsed.addressCurrent || parsed.emailCurrent || parsed.phoneCurrent ||
        parsed.educationRows.length || parsed.workHistoryRows.length || parsed.licenseRows.length;
      if (!foundAny) {
        statusEl.textContent = "項目を検出できませんでした。手入力をお願いします。";
        return;
      }
      applyParsedFields(parsed);
      statusEl.textContent = "自動入力しました。誤読の可能性があるので、内容を必ず確認してください。";
    } catch (e) {
      console.error(e);
      statusEl.textContent = "読み込みに失敗しました: " + e.message;
    }
  });
}

// ---------- Preview rendering ----------
function historyRowsHtml(rows) {
  return rows.map(row => {
    if (row.kind === "heading") {
      return `<tr><td class="col-year-p"></td><td class="col-month-p"></td><td class="history-row-center">${escapeHtml(row.text)}</td></tr>`;
    }
    if (row.kind === "end") {
      return `<tr><td class="col-year-p"></td><td class="col-month-p"></td><td class="history-row-end">${escapeHtml(row.text)}</td></tr>`;
    }
    return `<tr><td class="col-year-p">${escapeHtml(row.year)}</td><td class="col-month-p">${escapeHtml(row.month)}</td><td>${escapeHtml(row.text)}</td></tr>`;
  }).join("");
}

// Combines the education and work-history entries into one ruled list with
// auto-inserted "学歴"/"職歴" headings and a trailing "以上", matching the
// source template's layout.
function buildHistoryPreviewRows() {
  const rows = [];
  rows.push({ kind: "heading", text: "学歴" });
  state.education.forEach(r => rows.push(r));
  rows.push({ year: "", month: "", text: "" });
  rows.push({ kind: "heading", text: "職歴" });
  state.workHistory.forEach(r => rows.push(r));
  rows.push({ year: "", month: "", text: "" });
  rows.push({ kind: "end", text: "以上" });
  return rows;
}

// Browsers don't reliably split a height:100% table's leftover space evenly
// across rows (one row can absorb it all). Compute and pin each data row's
// height explicitly instead of trusting auto layout.
function equalizeFillTables(root) {
  root.querySelectorAll(".paper-fill-table").forEach(wrap => {
    const table = wrap.querySelector("table");
    if (!table || table.rows.length < 2) return;
    Array.from(table.rows).forEach(r => { r.style.height = ""; });
    const headerRow = table.rows[0];
    const dataRows = Array.from(table.rows).slice(1);
    const available = wrap.clientHeight;
    const headerHeight = headerRow.getBoundingClientRect().height;
    const perRow = Math.max(0, (available - headerHeight) / dataRows.length);
    dataRows.forEach(r => { r.style.height = perRow + "px"; });
  });
}

// Shrinks an element's font-size (down to a floor) until its content no longer
// overflows its own box. Boxes here all have a fixed height/width (set via CSS),
// so this never changes the frame itself — only how big the text renders inside it.
function shrinkToFit(el, minFontPx = 7, step = 0.5, measureEl = el) {
  if (!el) return;
  el.style.fontSize = "";
  let fontSize = parseFloat(getComputedStyle(el).fontSize);
  let guard = 0;
  while (
    (measureEl.scrollHeight > measureEl.clientHeight + 1 || measureEl.scrollWidth > measureEl.clientWidth + 1) &&
    fontSize > minFontPx &&
    guard < 60
  ) {
    fontSize -= step;
    el.style.fontSize = fontSize + "px";
    guard++;
  }
}

const SHRINK_TO_FIT_SELECTORS = [
  ".name-value", ".furigana-value", ".birth-date-text",
  ".addr-box td:not(.addr-main-row)",
  ".history-table td", ".license-table td",
  ".section-body"
].join(",");

function applyShrinkToFit(root) {
  root.querySelectorAll(SHRINK_TO_FIT_SELECTORS).forEach(el => shrinkToFit(el));
  // Address value shrinks on its own (measured against its fixed-height cell) so the
  // "現住所〒..." label stays at its normal size and the phone/email cell next to it
  // (a separate <td>) is never affected by how long the address text is.
  root.querySelectorAll(".addr-main-row .addr-value").forEach(el => shrinkToFit(el, 7, 0.5, el.closest(".addr-main-inner")));
}

// Matches the paper convention of circling whichever option applies.
function genderHtml(gender) {
  const male = gender === "男" ? `<span class="gender-selected">男</span>` : "男";
  const female = gender === "女" ? `<span class="gender-selected">女</span>` : "女";
  return `<span class="gender-value">${male}　・　${female}</span>`;
}

function renderPreview() {
  const paper1 = document.getElementById("paper1");
  const paper2 = document.getElementById("paper2");
  const age = calcAge(state.birthDate);

  const historyPadded = padRowsForPreview(buildHistoryPreviewRows(), HISTORY_ROWS_MAX);
  const historyPage1 = historyPadded.slice(0, HISTORY_ROWS_PAGE1);
  const historyPage2 = historyPadded.slice(HISTORY_ROWS_PAGE1);
  const licensesPadded = padRowsForPreview(state.licenses, LICENSE_ROWS_MAX);

  // ---- Page 1 ----
  paper1.innerHTML = `
    <div class="page-title-row">
      <h2 class="paper-title">履　歴　書</h2>
      <div class="paper-date">${formatDateJp(state.createDate)}　現在</div>
    </div>

    <table class="basic-info">
      <tr>
        <td class="furigana-cell"><span class="field-label-inline">ふりがな</span><span class="furigana-value">${escapeHtml(state.furigana)}</span></td>
        <td class="photo-cell" rowspan="3">
          <div class="photo-frame">
            ${state.photoDataUrl ? `<img src="${state.photoDataUrl}" alt="photo">` : "証明写真<br>縦36mm〜40mm<br>横24mm〜30mm<br>本人単身胸から上<br>裏面のりづけ"}
          </div>
        </td>
      </tr>
      <tr>
        <td class="name-cell"><span class="field-label-inline">氏名</span><span class="name-value">${escapeHtml(state.fullName)}</span></td>
      </tr>
      <tr>
        <td class="birth-cell">
          <div class="birth-cell-row">
            <span class="birth-date-text">${formatDateJp(state.birthDate) || "____年__月__日"}生　（満${age !== "" ? age : "　　"}歳）</span>
            ${genderHtml(state.gender)}
          </div>
        </td>
      </tr>
    </table>

    <table class="addr-box">
      <tr>
        <td class="addr-furigana-row addr-left">ふりがな　${escapeHtml(state.addressCurrentFurigana)}</td>
        <td class="addr-right" rowspan="2">電話<br>${escapeHtml(state.phoneCurrent)}<br><br>Email<br>${escapeHtml(state.emailCurrent)}</td>
      </tr>
      <tr>
        <td class="addr-main-row addr-left">
          <div class="addr-main-inner">
            現住所　〒${escapeHtml(state.zipCurrent)}<br>
            <span class="addr-value">${escapeHtml(state.addressCurrent)}</span>
          </div>
        </td>
      </tr>
    </table>

    <table class="addr-box">
      <tr>
        <td class="addr-furigana-row addr-left">ふりがな　${escapeHtml(state.addressContactFurigana)}</td>
        <td class="addr-right" rowspan="2">電話<br>${escapeHtml(state.phoneContact)}<br><br>Email<br>${escapeHtml(state.emailContact)}</td>
      </tr>
      <tr>
        <td class="addr-main-row addr-left">
          <div class="addr-main-inner">
            連絡先　〒${escapeHtml(state.zipContact)}<span class="addr-note">(現住所以外に連絡を希望する場合のみ入力)</span><br>
            <span class="addr-value">${escapeHtml(state.addressContact)}</span>
          </div>
        </td>
      </tr>
    </table>

    <div class="paper-fill-table">
      <table class="history-table">
        <tr><th class="col-year-p">年</th><th class="col-month-p">月</th><th>学歴・職歴</th></tr>
        ${historyRowsHtml(historyPage1)}
      </table>
    </div>
  `;

  // ---- Page 2 ----
  paper2.innerHTML = `
    <div class="paper-fill-table">
      <table class="history-table">
        <tr><th class="col-year-p">年</th><th class="col-month-p">月</th><th>学歴・職歴</th></tr>
        ${historyRowsHtml(historyPage2)}
      </table>
    </div>

    <div class="paper-fill-table">
      <table class="license-table">
        <tr><th class="col-year-p">年</th><th class="col-month-p">月</th><th>免許・資格</th></tr>
        ${historyRowsHtml(licensesPadded)}
      </table>
    </div>

    <div class="section-block flex-fill">
      <div class="section-heading">志望動機・特技・アピールポイントなど</div>
      <div class="section-body">${nl2br(state.motivation) || "<span class=\"empty-hint\">未入力</span>"}</div>
    </div>

    <div class="section-block flex-fill">
      <div class="section-heading">本人希望記入欄（特に給料・職種・勤務時間・勤務地・その他について希望があれば記入）</div>
      <div class="section-body">${nl2br(state.requests) || "<span class=\"empty-hint\">未入力</span>"}</div>
    </div>
  `;

  equalizeFillTables(paper1);
  equalizeFillTables(paper2);
  applyShrinkToFit(paper1);
  applyShrinkToFit(paper2);
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

// Called once at startup: wires up all event listeners.
function bindFormOnce() {
  bindSimpleFieldsOnce();
  bindZipLookupOnce();
  bindPhotoOnce();
  bindAddRowButtonsOnce();
  bindImportOnce();
  bindToolbar();
}

// Called at startup and after clearing: pushes state into the DOM (no listener rebinding).
function refreshForm() {
  refreshSimpleFields();
  refreshPhoto();
  bindEducationTable();
  bindWorkHistoryTable();
  bindLicenseTable();
  renderPreview();
}

async function initPage() {
  bindFormOnce();

  // This browser has never seen this candidate locally (e.g. an admin opening
  // someone else's link) — try pulling their last-synced data from the shared
  // sheet before rendering, so the same edit form works for admin and
  // candidate alike instead of needing a separate read-only view.
  if (!Storage.load(STORAGE_KEY)) {
    const remote = await fetchFromSheet(CANDIDATE_ID, "rirekisho");
    if (remote) {
      state = { ...structuredClone(defaultState), ...remote };
      state.education = normalizeRows(state.education, HISTORY_ENTRIES_MAX);
      state.workHistory = normalizeRows(state.workHistory, HISTORY_ENTRIES_MAX);
      state.licenses = normalizeRows(state.licenses, LICENSE_ROWS_MAX);
    }
  }

  refreshForm();
  // Ensure this candidate shows up in the list immediately, even before any edits.
  if (!Storage.load(STORAGE_KEY)) persist();

  // Keep the tab-switch links pointed at the same candidate.
  document.getElementById("navRirekisho").href = candidateUrl("rirekisho.html", CANDIDATE_ID);
  document.getElementById("navShokumu").href = candidateUrl("shokumu.html", CANDIDATE_ID);

  // Row heights are computed from the rendered container size, so they need to be
  // recomputed whenever the viewport (and therefore the paper's scale) changes.
  window.addEventListener("resize", debounce(renderPreview, 150));
}

if (CANDIDATE_ID) {
  initPage();
}
