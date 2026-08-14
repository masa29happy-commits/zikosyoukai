// Shared localStorage helpers used by both rirekisho.js and shokumu.js
const Storage = {
  save(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      if (typeof syncToSheet === "function") syncToSheet(key, data);
    } catch (e) {
      console.error("保存に失敗しました", e);
    }
  },
  load(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("読み込みに失敗しました", e);
      return null;
    }
  },
  clear(key) {
    localStorage.removeItem(key);
  }
};

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Chrome/Safari/Firefox all suggest the current document.title (sanitized
// for the filesystem) as the default filename when "印刷/PDF保存" is used
// with the "PDFに保存" destination — so setting the title to "氏名_書類名"
// right before printing is what makes the saved file come out named that
// way, with no actual PDF-generation code involved.
function printWithFilename(fullName, docLabel) {
  const original = document.title;
  const safeName = (fullName || "").replace(/[\\/:*?"<>|]/g, "").trim();
  if (safeName) document.title = `${safeName}_${docLabel}`;
  window.print();
  document.title = original;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nl2br(str) {
  return escapeHtml(str).replaceAll("\n", "<br>");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function calcAge(birthDateStr) {
  if (!birthDateStr) return "";
  const b = new Date(birthDateStr);
  if (isNaN(b.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age >= 0 ? age : "";
}

function formatDateJp(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The zipcloud postal-code API returns readings as half-width katakana
// (e.g. "ﾄｳｷｮｳﾄ"); this app's ふりがな fields use hiragana, so convert.
const HALFWIDTH_KATAKANA_MAP = {
  "ｦ": "を", "ｧ": "ぁ", "ｨ": "ぃ", "ｩ": "ぅ", "ｪ": "ぇ", "ｫ": "ぉ", "ｬ": "ゃ", "ｭ": "ゅ", "ｮ": "ょ", "ｯ": "っ",
  "ｰ": "ー", "ｱ": "あ", "ｲ": "い", "ｳ": "う", "ｴ": "え", "ｵ": "お",
  "ｶ": "か", "ｷ": "き", "ｸ": "く", "ｹ": "け", "ｺ": "こ",
  "ｻ": "さ", "ｼ": "し", "ｽ": "す", "ｾ": "せ", "ｿ": "そ",
  "ﾀ": "た", "ﾁ": "ち", "ﾂ": "つ", "ﾃ": "て", "ﾄ": "と",
  "ﾅ": "な", "ﾆ": "に", "ﾇ": "ぬ", "ﾈ": "ね", "ﾉ": "の",
  "ﾊ": "は", "ﾋ": "ひ", "ﾌ": "ふ", "ﾍ": "へ", "ﾎ": "ほ",
  "ﾏ": "ま", "ﾐ": "み", "ﾑ": "む", "ﾒ": "め", "ﾓ": "も",
  "ﾔ": "や", "ﾕ": "ゆ", "ﾖ": "よ",
  "ﾗ": "ら", "ﾘ": "り", "ﾙ": "る", "ﾚ": "れ", "ﾛ": "ろ",
  "ﾜ": "わ", "ﾝ": "ん"
};
const DAKUTEN_MAP = {
  "か": "が", "き": "ぎ", "く": "ぐ", "け": "げ", "こ": "ご",
  "さ": "ざ", "し": "じ", "す": "ず", "せ": "ぜ", "そ": "ぞ",
  "た": "だ", "ち": "ぢ", "つ": "づ", "て": "で", "と": "ど",
  "は": "ば", "ひ": "び", "ふ": "ぶ", "へ": "べ", "ほ": "ぼ",
  "う": "ゔ"
};
const HANDAKUTEN_MAP = { "は": "ぱ", "ひ": "ぴ", "ふ": "ぷ", "へ": "ぺ", "ほ": "ぽ" };

function halfwidthKatakanaToHiragana(str) {
  if (!str) return "";
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const base = HALFWIDTH_KATAKANA_MAP[str[i]];
    const next = str[i + 1];
    if (base && next === "ﾞ" && DAKUTEN_MAP[base]) {
      result += DAKUTEN_MAP[base];
      i++;
    } else if (base && next === "ﾟ" && HANDAKUTEN_MAP[base]) {
      result += HANDAKUTEN_MAP[base];
      i++;
    } else if (base) {
      result += base;
    } else {
      result += str[i];
    }
  }
  return result;
}

function formatDateTimeJp(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Multi-candidate support ----------
// Each candidate's rirekisho/shokumu data is stored under its own localStorage
// key (no separate "candidate list" record) — the list is derived by scanning
// localStorage for keys with these prefixes, so there is only one source of truth.
const RIREKISHO_PREFIX = "rirekisho_data_v3_";
const SHOKUMU_PREFIX = "shokumu_data_v2_";

function getCandidateIdFromUrl() {
  return new URLSearchParams(location.search).get("candidate");
}

function candidateUrl(page, id) {
  return `${page}?candidate=${encodeURIComponent(id)}`;
}

function generateCandidateId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function listCandidates() {
  const ids = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(RIREKISHO_PREFIX)) ids.add(key.slice(RIREKISHO_PREFIX.length));
    else if (key.startsWith(SHOKUMU_PREFIX)) ids.add(key.slice(SHOKUMU_PREFIX.length));
  }
  return Array.from(ids).map(id => {
    const rirekisho = Storage.load(RIREKISHO_PREFIX + id);
    const shokumu = Storage.load(SHOKUMU_PREFIX + id);
    const name = (rirekisho && rirekisho.fullName) || (shokumu && shokumu.fullName) || "";
    const updatedAts = [rirekisho && rirekisho.updatedAt, shokumu && shokumu.updatedAt].filter(Boolean).sort();
    return {
      id,
      name,
      updatedAt: updatedAts.length ? updatedAts[updatedAts.length - 1] : null,
      hasRirekisho: !!rirekisho,
      hasShokumu: !!shokumu
    };
  }).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function deleteCandidateData(id) {
  localStorage.removeItem(RIREKISHO_PREFIX + id);
  localStorage.removeItem(SHOKUMU_PREFIX + id);
}
