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
//
// Every save on the site (rirekisho or shokumu) sends one row's worth of
// data here; this upserts by candidateId so re-saving updates the same row
// instead of piling up duplicates. The row itself only exists so the sheet
// has something to search/filter on and a link to click — the site (not the
// sheet) is where the actual resume/shokumu content gets viewed and edited.

const SITE_BASE_URL = ""; // e.g. "https://your-username.github.io/resume-site"

const HEADERS = ["更新日時", "CandidateId", "氏名", "ふりがな", "生年月日", "電話", "Email", "現住所", "履歴書JSON", "職務経歴書JSON", "リンク"];

// Two GET modes:
//   ?candidateId=XXXX      -> that one candidate's rirekisho/shokumu data
//   (no params)            -> the full candidate list, for the admin page
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getValues();
  const candidateId = e.parameter.candidateId;

  if (candidateId) {
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][1]) === candidateId) {
        const rirekishoJson = values[i][8];
        const shokumuJson = values[i][9];
        const result = {
          candidateId: candidateId,
          fullName: values[i][2],
          rirekisho: rirekishoJson ? JSON.parse(rirekishoJson) : null,
          shokumu: shokumuJson ? JSON.parse(shokumuJson) : null
        };
        return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ error: "not found" })).setMimeType(ContentService.MimeType.JSON);
  }

  const list = [];
  for (let i = 1; i < values.length; i++) {
    list.push({
      candidateId: values[i][1],
      fullName: values[i][2],
      updatedAt: values[i][0],
      hasRirekisho: !!values[i][8],
      hasShokumu: !!values[i][9]
    });
  }
  return ContentService.createTextOutput(JSON.stringify(list)).setMimeType(ContentService.MimeType.JSON);
}

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

    const values = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][1]) === candidateId) { rowIndex = i + 1; break; }
    }
    const row = rowIndex > 0 ? values[rowIndex - 1] : ["", candidateId, "", "", "", "", "", "", "", "", ""];

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

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
