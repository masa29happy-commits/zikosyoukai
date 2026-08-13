// Optional: mirror every local save to a host-controlled Google Sheet (via a
// Google Apps Script Web App), so the tool stays "one browser = one person's
// private data" while the host can still see everyone's submissions in one
// place. Off by default (empty webAppUrl below) — the site behaves exactly
// as before until a host deploys the Apps Script and pastes its URL in here.
// See google-apps-script.gs for the script to paste into the Sheet.
const SYNC_CONFIG = {
  webAppUrl: ""
};

// Best-effort only: the local save (localStorage) already happened by the
// time this runs, so a failed/offline/misconfigured send never blocks or
// breaks editing — it just means that update doesn't reach the sheet.
function syncToSheet(key, data) {
  if (!SYNC_CONFIG.webAppUrl) return;
  let type, candidateId;
  if (key.startsWith(RIREKISHO_PREFIX)) {
    type = "rirekisho";
    candidateId = key.slice(RIREKISHO_PREFIX.length);
  } else if (key.startsWith(SHOKUMU_PREFIX)) {
    type = "shokumu";
    candidateId = key.slice(SHOKUMU_PREFIX.length);
  } else {
    return;
  }

  // mode:"no-cors" + Content-Type:"text/plain" keeps this a CORS "simple
  // request" (no preflight), which is what lets a plain Apps Script Web
  // App receive it without any special CORS setup on Google's side.
  fetch(SYNC_CONFIG.webAppUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ type, candidateId, data })
  }).catch(() => {});
}

// Fetches one candidate's data back out of the shared sheet (used when this
// browser has no local copy — e.g. an admin opening a candidate's link on
// their own device). Returns null on any failure so callers can just fall
// back to a blank form instead of breaking.
async function fetchFromSheet(candidateId, type) {
  if (!SYNC_CONFIG.webAppUrl) return null;
  try {
    const url = `${SYNC_CONFIG.webAppUrl}?candidateId=${encodeURIComponent(candidateId)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return (json && json[type]) || null;
  } catch (e) {
    return null;
  }
}

// Fetches the full candidate list from the shared sheet (for the admin list
// view in candidates.html). Returns [] on any failure.
async function fetchCandidateListFromSheet() {
  if (!SYNC_CONFIG.webAppUrl) return [];
  try {
    const res = await fetch(SYNC_CONFIG.webAppUrl);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (e) {
    return [];
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!SYNC_CONFIG.webAppUrl) return;
  const notice = document.createElement("div");
  notice.className = "sync-notice";
  notice.textContent = "入力・保存した内容は管理者のスプレッドシートに自動的に共有されます。";
  const toolbar = document.querySelector(".toolbar");
  if (toolbar) toolbar.insertAdjacentElement("afterend", notice);
});
