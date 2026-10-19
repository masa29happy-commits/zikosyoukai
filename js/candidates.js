// One-time migration: earlier versions of this tool stored a single person's
// data under a plain (non-prefixed) key. Fold that into the new per-candidate
// scheme instead of losing it.
function migrateLegacyData() {
  const legacyRirekisho = Storage.load("rirekisho_data_v3");
  const legacyShokumu = Storage.load("shokumu_data_v2");
  if (!legacyRirekisho && !legacyShokumu) return;
  const id = generateCandidateId();
  if (legacyRirekisho) {
    Storage.save(RIREKISHO_PREFIX + id, legacyRirekisho);
    localStorage.removeItem("rirekisho_data_v3");
  }
  if (legacyShokumu) {
    Storage.save(SHOKUMU_PREFIX + id, legacyShokumu);
    localStorage.removeItem("shokumu_data_v2");
  }
}

// When login is active, the set of candidates shown is driven entirely by
// the server's 担当-filtered list (or everyone, for "host") — NOT by
// whatever happens to be cached in this browser's localStorage, since that
// cache has no idea who's logged in and would otherwise leak whatever an
// earlier login (or an earlier, pre-login version of this tool) left behind.
// Local copies are only used to fill in fresher-looking data for entries the
// server already confirmed belong to this login.
async function loadAllCandidates(auth) {
  if (!SYNC_CONFIG.webAppUrl) return listCandidates();
  if (!auth) return [];

  const result = await fetchCandidateListFromSheet(auth.name, auth.password);
  if (!result.ok) return [];
  const localById = new Map(listCandidates().map(c => [c.id, c]));
  return result.list
    .filter(r => r.candidateId)
    .map(r => {
      const local = localById.get(r.candidateId);
      return local
        ? { ...local, assignedTo: r.assignedTo || "", agency: r.agency || "" }
        : {
          id: r.candidateId,
          name: r.fullName || "",
          updatedAt: r.updatedAt || null,
          hasRirekisho: !!r.hasRirekisho,
          hasShokumu: !!r.hasShokumu,
          assignedTo: r.assignedTo || "",
          agency: r.agency || "",
          remoteOnly: true
        };
    })
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

// Ignores spaces and case so "鈴木 慎太郎" matches a search for "鈴木慎太郎".
function normalizeForSearch(s) {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}

// "削除" never touches the shared sheet — it only ever affects this one
// browser's own view. For a candidate with a local copy it also clears
// that copy; for a shared-spreadsheet-only entry there's nothing local to
// clear, so this list is what makes 削除 still remove the row from THIS
// browser's list either way, instead of silently doing nothing.
const HIDDEN_CANDIDATES_KEY = "hidden_candidates_v1";

// Hiding is a deliberate action, so it stays hidden indefinitely — the only
// way back is the "元に戻す" button (see renderHiddenList/unhideCandidateLocally).
function getHiddenCandidateIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_CANDIDATES_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function hideCandidateLocally(id) {
  const ids = getHiddenCandidateIds();
  if (!ids.includes(id)) {
    ids.push(id);
    localStorage.setItem(HIDDEN_CANDIDATES_KEY, JSON.stringify(ids));
  }
}

function unhideCandidateLocally(id) {
  const ids = getHiddenCandidateIds().filter(x => x !== id);
  localStorage.setItem(HIDDEN_CANDIDATES_KEY, JSON.stringify(ids));
}

// Shows whichever of the hidden ids are still in allCandidates (always the
// full, unfiltered set) with a button to unhide each one.
function renderHiddenList() {
  const hiddenIds = getHiddenCandidateIds();
  const toggleBtn = document.getElementById("toggleHiddenBtn");
  toggleBtn.textContent = hiddenIds.length
    ? `非表示にした候補者を見る (${hiddenIds.length}件)`
    : "非表示にした候補者を見る";

  const hiddenList = document.getElementById("hiddenList");
  if (hiddenList.style.display === "none") return;

  hiddenList.innerHTML = "";
  if (hiddenIds.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "font-size:13px;color:#888;margin:0;";
    empty.textContent = "非表示にした候補者はいません。";
    hiddenList.appendChild(empty);
    return;
  }

  const byId = new Map(allCandidates.map(c => [c.id, c]));
  hiddenIds.forEach(id => {
    const c = byId.get(id);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border);";

    const label = document.createElement("span");
    label.textContent = c ? (c.name || "(名前未入力)") : "(詳細不明)";
    row.appendChild(label);

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn btn-small";
    restoreBtn.textContent = "元に戻す";
    restoreBtn.addEventListener("click", () => {
      unhideCandidateLocally(id);
      applyNameFilter();
    });
    row.appendChild(restoreBtn);

    hiddenList.appendChild(row);
  });
}

function bindHiddenToggleOnce() {
  document.getElementById("toggleHiddenBtn").addEventListener("click", () => {
    const hiddenList = document.getElementById("hiddenList");
    hiddenList.style.display = hiddenList.style.display === "none" ? "block" : "none";
    renderHiddenList();
  });
}

let allCandidates = []; // the full set — kept unfiltered so the hidden-candidates list can still look up names
let isHostView = false; // host or agency-host: both see 会社 and 担当 columns

function applyNameFilter() {
  const hiddenIds = getHiddenCandidateIds();
  const visible = allCandidates.filter(c => !hiddenIds.includes(c.id));
  const q = normalizeForSearch(document.getElementById("candidateSearchInput").value);
  const filtered = q ? visible.filter(c =>
    normalizeForSearch(c.name).includes(q) ||
    normalizeForSearch(c.agency).includes(q) ||
    normalizeForSearch(c.assignedTo).includes(q)
  ) : visible;
  renderCandidatesList(filtered, q && visible.length > 0);
  renderHiddenList();
}

function renderCandidatesList(candidates, isFilteredEmpty) {
  const table = document.getElementById("candidatesTable");
  const emptyState = document.getElementById("emptyState");
  const body = document.getElementById("candidatesBody");

  if (candidates.length === 0) {
    table.style.display = "none";
    emptyState.style.display = "block";
    emptyState.textContent = isFilteredEmpty
      ? "一致する求職者が見つかりませんでした。"
      : "まだ求職者が登録されていません。「+ 新しい求職者を追加」から始めてください。";
    return;
  }
  table.style.display = "table";
  emptyState.style.display = "none";
  document.getElementById("assignedToHeader").style.display = isHostView ? "" : "none";
  document.getElementById("agencyHeader").style.display = isHostView ? "" : "none";

  body.innerHTML = "";
  candidates.forEach(c => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = c.name || "(名前未入力)";
    if (!c.name) nameTd.className = "empty-hint";
    tr.appendChild(nameTd);

    if (isHostView) {
      const agencyTd = document.createElement("td");
      agencyTd.textContent = c.agency || "(未設定)";
      if (!c.agency) agencyTd.className = "empty-hint";
      tr.appendChild(agencyTd);

      const assignedTd = document.createElement("td");
      assignedTd.textContent = c.assignedTo || "(未設定)";
      if (!c.assignedTo) assignedTd.className = "empty-hint";
      tr.appendChild(assignedTd);
    }

    const updatedTd = document.createElement("td");
    updatedTd.textContent = formatDateTimeJp(c.updatedAt);
    updatedTd.className = "candidates-updated";

    const actionsTd = document.createElement("td");
    actionsTd.className = "candidates-actions";

    const rirekishoLink = document.createElement("a");
    rirekishoLink.className = "btn btn-small";
    rirekishoLink.href = candidateUrl("rirekisho.html", c.id);
    rirekishoLink.textContent = "履歴書を編集";

    const shokumuLink = document.createElement("a");
    shokumuLink.className = "btn btn-small";
    shokumuLink.href = candidateUrl("shokumu.html", c.id);
    shokumuLink.textContent = "職務経歴書を編集";

    actionsTd.appendChild(rirekishoLink);
    actionsTd.appendChild(shokumuLink);

    // Always shown and always works the same way, whether or not this
    // candidate happens to have a local copy in this browser: it clears any
    // local copy AND hides the row from this browser's list going forward.
    // Never touches the shared spreadsheet.
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-small btn-danger";
    deleteBtn.textContent = "削除";
    deleteBtn.addEventListener("click", () => {
      const label = c.name || "(名前未入力)";
      if (!confirm(`「${label}」さんをこの一覧から削除します(共有スプレッドシート側のデータは残ります)。よろしいですか?`)) return;
      deleteCandidateData(c.id);
      hideCandidateLocally(c.id);
      refreshCandidatesList();
    });
    actionsTd.appendChild(deleteBtn);

    tr.appendChild(updatedTd);
    tr.appendChild(actionsTd);
    body.appendChild(tr);
  });
}

async function refreshCandidatesList() {
  // No login system active: same instant local-only render as before.
  if (!SYNC_CONFIG.webAppUrl) {
    allCandidates = listCandidates();
    applyNameFilter();
    return;
  }
  // With login active, don't flash the unfiltered local list first — it may
  // contain candidates left over from a different login on this browser.
  allCandidates = await loadAllCandidates(getStaffAuth());
  applyNameFilter();
}

function showLoginGate(errorMessage) {
  document.getElementById("candidatesMain").style.display = "none";
  document.getElementById("loginGate").style.display = "flex";
  document.getElementById("loginError").textContent = errorMessage || "";
}

function showMain(auth) {
  document.getElementById("loginGate").style.display = "none";
  document.getElementById("candidatesMain").style.display = "block";
  document.getElementById("loggedInAs").textContent = auth ? `ログイン中: ${auth.name}` : "";
  isHostView = !!(auth && (auth.role === "host" || auth.role === "agency-host"));
  refreshCandidatesList();
}

async function attemptLogin() {
  const name = document.getElementById("loginName").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!name || !password) {
    showLoginGate("スタッフ名とパスワードを入力してください。");
    return;
  }
  document.getElementById("loginError").textContent = "確認中...";
  const result = await fetchCandidateListFromSheet(name, password);
  if (!result.ok) {
    showLoginGate("ログインできませんでした。スタッフ名・パスワードを確認してください。");
    return;
  }
  setStaffAuth(name, password, result.role);
  showMain({ name, password, role: result.role });
}

function bindLoginGateOnce() {
  document.getElementById("loginBtn").addEventListener("click", attemptLogin);
  document.getElementById("loginPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") attemptLogin();
  });
  document.getElementById("logoutBtn").addEventListener("click", () => {
    clearStaffAuth();
    showLoginGate();
  });
}

async function initCandidatesPage() {
  migrateLegacyData();
  bindLoginGateOnce();
  bindHiddenToggleOnce();
  document.getElementById("candidateSearchInput").addEventListener("input", applyNameFilter);
  document.getElementById("addCandidateBtn").addEventListener("click", () => {
    const id = generateCandidateId();
    location.href = candidateUrl("rirekisho.html", id);
  });

  // Sync not configured: this is just a personal/local list, same as
  // before login support existed — no staff account needed.
  if (!SYNC_CONFIG.webAppUrl) {
    showMain(null);
    return;
  }

  const auth = getStaffAuth();
  if (!auth) {
    showLoginGate();
    return;
  }
  const result = await fetchCandidateListFromSheet(auth.name, auth.password);
  if (!result.ok) {
    clearStaffAuth();
    showLoginGate("ログインの有効期限が切れました。もう一度ログインしてください。");
    return;
  }
  setStaffAuth(auth.name, auth.password, result.role);
  showMain({ ...auth, role: result.role });
}

initCandidatesPage();
