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

// Merges this browser's own (localStorage) candidates with the shared-sheet
// list — filtered server-side to the logged-in staff member's own 担当
// (or everyone, if their role is "host") — so one staff browser sees their
// own candidates plus whatever they've already cached locally. Local
// entries win on conflict since they're the freshest copy this browser
// actually has.
async function loadAllCandidates(auth) {
  const local = listCandidates();
  const localIds = new Set(local.map(c => c.id));
  if (!SYNC_CONFIG.webAppUrl || !auth) return local;

  const result = await fetchCandidateListFromSheet(auth.name, auth.password);
  if (!result.ok) return local;
  const remoteOnly = result.list
    .filter(r => r.candidateId && !localIds.has(r.candidateId))
    .map(r => ({
      id: r.candidateId,
      name: r.fullName || "",
      updatedAt: r.updatedAt || null,
      hasRirekisho: !!r.hasRirekisho,
      hasShokumu: !!r.hasShokumu,
      remoteOnly: true
    }));
  return [...local, ...remoteOnly].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function renderCandidatesList(candidates) {
  const table = document.getElementById("candidatesTable");
  const emptyState = document.getElementById("emptyState");
  const body = document.getElementById("candidatesBody");

  if (candidates.length === 0) {
    table.style.display = "none";
    emptyState.style.display = "block";
    return;
  }
  table.style.display = "table";
  emptyState.style.display = "none";

  body.innerHTML = "";
  candidates.forEach(c => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = c.name || "(名前未入力)";
    if (!c.name) nameTd.className = "empty-hint";
    if (c.remoteOnly) {
      const badge = document.createElement("span");
      badge.className = "remote-badge";
      badge.textContent = "共有";
      badge.title = "このブラウザではなく、共有スプレッドシート側にあるデータです";
      nameTd.appendChild(document.createTextNode(" "));
      nameTd.appendChild(badge);
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

    // A remote-only row has nothing in this browser's localStorage yet, so
    // there's nothing here for "削除" to actually remove — hide it rather
    // than show a button that looks like it deletes data but doesn't.
    if (!c.remoteOnly) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-small btn-danger";
      deleteBtn.textContent = "削除";
      deleteBtn.addEventListener("click", () => {
        const label = c.name || "(名前未入力)";
        if (!confirm(`「${label}」さんの履歴書・職務経歴書データを削除します。よろしいですか?`)) return;
        deleteCandidateData(c.id);
        refreshCandidatesList();
      });
      actionsTd.appendChild(deleteBtn);
    }

    tr.appendChild(nameTd);
    tr.appendChild(updatedTd);
    tr.appendChild(actionsTd);
    body.appendChild(tr);
  });
}

async function refreshCandidatesList() {
  const auth = SYNC_CONFIG.webAppUrl ? getStaffAuth() : null;
  renderCandidatesList(listCandidates());
  const all = await loadAllCandidates(auth);
  renderCandidatesList(all);
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
  setStaffAuth(name, password);
  showMain({ name, password });
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
  showMain(auth);
}

initCandidatesPage();
