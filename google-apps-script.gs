// Setup (one-time, in the Google account that will host the collected data):
//
// 1. Create a new Google Sheet (any name, e.g. "求職者データ").
// 2. Menu: 拡張機能(Extensions) > Apps Script.
// 3. Delete the placeholder code and paste this whole file in.
// 4. デプロイ(Deploy) > 新しいデプロイ(New deployment) > 種類の選択(Select type) > ウェブアプリ(Web app).
//    - 実行するユーザー(Execute as): 自分(Me)
//    - アクセスできるユーザー(Who has access): 全員(Anyone)
// 5. デプロイ(Deploy) → copy the resulting Web app URL.
// 6. Paste that URL into SYNC_CONFIG.webAppUrl in js/sync.js on the site.
// 7. Once the site itself has a public URL (e.g. GitHub Pages), paste it into
//    SITE_BASE_URL below (no trailing slash) so the "リンク" column can link
//    straight to each candidate's page on the site.
// 8. Add a second sheet tab named exactly "スタッフ" with these headers in
//    row 1: スタッフ名 | パスワード | 権限
//    Add one row per staff/agency login you want to hand out. 権限 should be
//    either "host" (sees everyone) or "staff" (sees only their own 担当).
//    You decide the passwords yourself and hand them out — there's no
//    self-signup.
// 9. In the main data sheet, add a "担当" header in the column right after
//    "リンク" (column L) if it isn't there already. New candidates a staff
//    member creates get auto-assigned to that staff member; ones a
//    job-seeker creates directly (no login) start unassigned — assign them
//    by typing a name into that column yourself.
//
// Every save on the site (rirekisho or shokumu) sends one row's worth of
// data here; this upserts by candidateId so re-saving updates the same row
// instead of piling up duplicates. The row itself only exists so the sheet
// has something to search/filter on and a link to click — the site (not the
// sheet) is where the actual resume/shokumu content gets viewed and edited.
//
// Access model: saving (doPost) never requires login — a job-seeker filling
// in their own resume for the first time has no staff account, and that must
// keep working. Only *reading the list* and *reading one candidate's data
// back* (used when a browser has no local copy yet, e.g. staff opening
// someone else's link) require a valid staff login, and are filtered to that
// staff's own 担当 unless they're "host".

const SITE_BASE_URL = ""; // e.g. "https://your-username.github.io/resume-site"

const HEADERS = ["更新日時", "CandidateId", "氏名", "ふりがな", "生年月日", "電話", "Email", "現住所", "履歴書JSON", "職務経歴書JSON", "リンク", "担当"];

// Returns {name, role} if staffName/staffPassword match a row in the "スタッフ"
// tab, otherwise null. role is whatever's in the 権限 column ("host" or "staff").
function authenticateStaff(name, password) {
  if (!name || !password) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("スタッフ");
  if (!sheet) return null;
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === name && String(values[i][1]) === password) {
      return { name: String(values[i][0]), role: String(values[i][2] || "staff") };
    }
  }
  return null;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Two GET modes:
//   ?candidateId=XXXX      -> that one candidate's rirekisho/shokumu data
//   (no params)            -> the full candidate list, for the admin page
// Both require ?staffName=...&staffPassword=... and are filtered to that
// staff's own 担当 unless their role is "host".
function doGet(e) {
  const auth = authenticateStaff(e.parameter.staffName, e.parameter.staffPassword);
  if (!auth) return jsonResponse({ error: "unauthorized" });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getValues();
  const candidateId = e.parameter.candidateId;

  if (candidateId) {
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][1]) === candidateId) {
        const assignedTo = values[i][11];
        if (auth.role !== "host" && assignedTo !== auth.name) return jsonResponse({ error: "forbidden" });
        const rirekishoJson = values[i][8];
        const shokumuJson = values[i][9];
        return jsonResponse({
          candidateId: candidateId,
          fullName: values[i][2],
          rirekisho: rirekishoJson ? JSON.parse(rirekishoJson) : null,
          shokumu: shokumuJson ? JSON.parse(shokumuJson) : null
        });
      }
    }
    return jsonResponse({ error: "not found" });
  }

  const list = [];
  for (let i = 1; i < values.length; i++) {
    if (auth.role !== "host" && values[i][11] !== auth.name) continue;
    list.push({
      candidateId: values[i][1],
      fullName: values[i][2],
      updatedAt: values[i][0],
      hasRirekisho: !!values[i][8],
      hasShokumu: !!values[i][9],
      assignedTo: values[i][11] || ""
    });
  }
  return jsonResponse(list);
}

// Saving never requires login (see access model note above). If a logged-in
// staff member's credentials are included, a brand-new candidate gets
// auto-assigned to them; a candidate created with no credentials (e.g. a
// job-seeker's own first save) starts unassigned.
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

    const body = JSON.parse(e.postData.contents);
    const type = body.type; // "rirekisho" | "shokumu"
    const candidateId = body.candidateId;
    const data = body.data || {};
    const auth = authenticateStaff(body.staffName, body.staffPassword);

    const values = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][1]) === candidateId) { rowIndex = i + 1; break; }
    }

    // A logged-in staff member may only touch their own candidates (host can
    // touch any). A request with no credentials at all (a job-seeker saving
    // their own resume) is always allowed — see access model note above.
    if (rowIndex > 0 && auth && auth.role !== "host") {
      const assignedTo = values[rowIndex - 1][11];
      if (assignedTo && assignedTo !== auth.name) return jsonResponse({ ok: false, error: "forbidden" });
    }

    const row = rowIndex > 0 ? values[rowIndex - 1] : ["", candidateId, "", "", "", "", "", "", "", "", "", ""];

    row[0] = new Date();
    if (type === "rirekisho") {
      row[2] = data.fullName || row[2];
      row[3] = data.furigana || row[3];
      row[4] = data.birthDate || row[4];
      row[5] = data.phoneCurrent || row[5];
      row[6] = data.emailCurrent || row[6];
      row[7] = data.addressCurrent || row[7];
      row[8] = JSON.stringify(data);
    } else if (type === "shokumu") {
      row[2] = row[2] || data.fullName || "";
      row[9] = JSON.stringify(data);
    }
    if (SITE_BASE_URL) {
      const url = SITE_BASE_URL + "/rirekisho.html?candidate=" + encodeURIComponent(candidateId);
      row[10] = '=HYPERLINK("' + url + '","開く")';
    }
    if (rowIndex < 0 && auth && auth.role !== "host") {
      row[11] = auth.name;
    }

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
