// Optional: mirror every local save to a host-controlled Google Sheet (via a
// Google Apps Script Web App), so the tool stays "one browser = one person's
// private data" while the host can still see everyone's submissions in one
// place. Off by default (empty webAppUrl below) — the site behaves exactly
// as before until a host deploys the Apps Script and pastes its URL in here.
// See google-apps-script.gs for the script to paste into the Sheet.
const SYNC_CONFIG = {
  webAppUrl: ""
};

// Site-wide (not per-candidate) staff login, shared by every page via
// localStorage. Only staff/host actions (browsing the candidate list,
// opening someone else's link) need this — a job-seeker saving their own
// resume never logs in, so it's never required for that to work.
const STAFF_AUTH_KEY = "staff_auth_v1";

function getStaffAuth() {
  try {
    const raw = localStorage.getItem(STAFF_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setStaffAuth(name, password) {
  localStorage.setItem(STAFF_AUTH_KEY, JSON.stringify({ name, password }));
}

function clearStaffAuth() {
  localStorage.removeItem(STAFF_AUTH_KEY);
}

// Best-effort only: the local save (localStorage) already happened by the
// time this runs, so a failed/offline/misconfigured send never blocks or
// breaks editing — it just means that update doesn't reach the sheet.
// Never requires a staff login (see google-apps-script.gs's access model
// note) — if one exists in this browser it's included so a new candidate
// created by a logged-in staff member gets auto-assigned to them.
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
  const auth = getStaffAuth();

  // mode:"no-cors" + Content-Type:"text/plain" keeps this a CORS "simple
  // request" (no preflight), which is what lets a plain Apps Script Web
  // App receive it without any special CORS setup on Google's side.
  fetch(SYNC_CONFIG.webAppUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      type, candidateId, data,
      staffName: auth ? auth.name : undefined,
      staffPassword: auth ? auth.password : undefined
    })
  }).catch(() => {});
}

// Fetches one candidate's data back out of the shared sheet (used when this
// browser has no local copy — e.g. staff opening a candidate's link on their
// own device). Requires a staff login stored in this browser; without one
// (e.g. a job-seeker's own first visit, before they've saved anything) this
// just returns null, same as "not found" — callers already fall back to a
// blank form in that case, so nothing breaks for job-seekers.
async function fetchFromSheet(candidateId, type) {
  if (!SYNC_CONFIG.webAppUrl) return null;
  const auth = getStaffAuth();
  if (!auth) return null;
  try {
    const url = `${SYNC_CONFIG.webAppUrl}?candidateId=${encodeURIComponent(candidateId)}` +
      `&staffName=${encodeURIComponent(auth.name)}&staffPassword=${encodeURIComponent(auth.password)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.error) return null;
    return json[type] || null;
  } catch (e) {
    return null;
  }
}

// Fetches the candidate list from the shared sheet, filtered server-side to
// this staff member's own 担当 (or everyone, if their role is "host") — for
// the admin list view in candidates.html. Returns {ok:false} if not logged
// in or the login is invalid, {ok:true, list:[...]} otherwise.
async function fetchCandidateListFromSheet(name, password) {
  if (!SYNC_CONFIG.webAppUrl) return { ok: true, list: [] };
  try {
    const url = `${SYNC_CONFIG.webAppUrl}?staffName=${encodeURIComponent(name)}&staffPassword=${encodeURIComponent(password)}`;
    const res = await fetch(url);
    if (!res.ok) return { ok: false };
    const json = await res.json();
    if (!Array.isArray(json)) return { ok: false };
    return { ok: true, list: json };
  } catch (e) {
    return { ok: false };
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
