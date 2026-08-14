// Best-effort "read an existing resume file and pre-fill the form" helper.
// No AI/API involved: PDF text is extracted with pdf.js, image text with
// Tesseract.js OCR (both free, run entirely in the browser), then a handful of
// regex/keyword heuristics guess which text is the name, address, history rows,
// etc. This is inherently approximate — the caller must let the user review
// and correct the result, especially for scanned/handwritten sources.

// Older Safari/iOS (and older Chrome) don't have Promise.withResolvers, which
// the current pdf.js build relies on internally — without this, loading a PDF
// throws "undefined is not a function" on those browsers. Must run before
// pdf.min.mjs is imported below. (The same polyfill is also prepended to
// vendor/pdf.worker.min.mjs, since the worker has its own separate global
// scope this doesn't reach.)
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

// Same reasoning as above, for the newer Uint8Array<->hex/base64 methods
// pdf.js also relies on internally (e.g. to compute a document fingerprint).
// Baseline-2025 features, so plenty of still-current browsers lack them.
if (typeof Uint8Array.prototype.toHex !== "function") {
  Uint8Array.prototype.toHex = function () {
    let hex = "";
    for (let i = 0; i < this.length; i++) hex += this[i].toString(16).padStart(2, "0");
    return hex;
  };
}
if (typeof Uint8Array.fromHex !== "function") {
  Uint8Array.fromHex = function (hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  };
}
if (typeof Uint8Array.prototype.setFromHex !== "function") {
  Uint8Array.prototype.setFromHex = function (hex) {
    const bytes = Uint8Array.fromHex(hex);
    this.set(bytes);
    return { read: hex.length, written: bytes.length };
  };
}
if (typeof Uint8Array.prototype.toBase64 !== "function") {
  Uint8Array.prototype.toBase64 = function () {
    let binary = "";
    for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
    return btoa(binary);
  };
}
if (typeof Uint8Array.fromBase64 !== "function") {
  Uint8Array.fromBase64 = function (base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
}
if (typeof Uint8Array.prototype.setFromBase64 !== "function") {
  Uint8Array.prototype.setFromBase64 = function (base64) {
    const bytes = Uint8Array.fromBase64(base64);
    this.set(bytes);
    return { read: base64.length, written: bytes.length };
  };
}

// ---------- PDF text extraction (pdf.js) ----------
let pdfjsLibPromise = null;
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("./vendor/pdf.min.mjs").then(lib => {
      lib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfjsLibPromise;
}

// A page much wider than a single A4/Letter sheet (e.g. 1191pt-wide A3
// landscape, exactly two A4 sheets side by side — a common way to export a
// normal 2-page rirekisho as one printable sheet) needs its left and right
// halves treated as two independent pages. Otherwise the row-reconstruction
// below (which groups text into lines by shared Y-position) merges an item
// from the left sheet with an unrelated item from the right sheet just
// because they happen to sit at the same height, scrambling both halves.
const WIDE_PAGE_THRESHOLD = 1000;

async function extractTextItemsFromPdf(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const items = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const isWide = viewport.width > WIDE_PAGE_THRESHOLD;
    const midX = viewport.width / 2;
    content.items.forEach(item => {
      if (!item.str || !item.str.trim()) return;
      const fontSize = Math.hypot(item.transform[0], item.transform[1]) || 0;
      const x = item.transform[4];
      items.push({
        // Some PDF generators pad digits with literal space characters within
        // a single text run for visual justification (e.g. "1 9 9 9" instead
        // of "1999"). Since this happens inside ONE run (pdf.js already
        // grouped it as one item), collapsing spaces between digits here is
        // safe — it can't accidentally bridge two genuinely separate fields,
        // which always arrive as separate items.
        text: item.str.replace(/(\d)\s+(?=\d)/g, "$1"),
        x,
        y: viewport.height - item.transform[5],
        width: item.width || 0,
        fontSize,
        // Encoding left/right half into the page number (rather than a
        // separate field) means the existing sort-by-page-then-y ordering
        // in itemsToPlainText automatically emits "all of the left sheet,
        // then all of the right sheet" with no other changes needed there.
        page: isWide ? pageNum * 2 + (x < midX ? 0 : 1) : pageNum * 2
      });
    });
  }
  return items;
}

// Groups items into lines by proximity rather than fixed-size rounding buckets
// (fixed buckets split items that straddle a rounding boundary onto different
// "lines"), then splits each line into left/right halves before joining, so a
// two-column layout (e.g. a name field beside a photo box) doesn't fuse into
// one string just because both sides sit at the same height.
function itemsToPlainText(items) {
  const sorted = [...items].sort((a, b) => a.page - b.page || a.y - b.y);
  const lines = [];
  const LINE_TOLERANCE = 3;
  sorted.forEach(it => {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(it.y - last.y) <= LINE_TOLERANCE) {
      last.items.push(it);
      last.y = (last.y * last.items.length + it.y) / (last.items.length + 1);
    } else {
      lines.push({ page: it.page, y: it.y, items: [it] });
    }
  });

  const textLines = [];
  lines.forEach(line => {
    line.items.sort((a, b) => a.x - b.x);
    // A large horizontal gap between consecutive items on the same visual line
    // usually means they belong to different columns (e.g. left info box vs.
    // the photo box to its right) — split into separate lines there.
    const COLUMN_GAP = 150;
    let current = [];
    let prevRight = null;
    line.items.forEach(it => {
      if (prevRight !== null && it.x - prevRight > COLUMN_GAP) {
        textLines.push(current);
        current = [];
      } else if (prevRight !== null && it.x - prevRight > 1) {
        current.push({ text: " ", x: prevRight, width: 0 });
      }
      current.push(it);
      prevRight = it.x + (it.width || 0);
    });
    if (current.length) textLines.push(current);
  });

  return textLines.map(items => items.map(it => it.text).join("")).join("\n");
}

// Chrome's headless PDF text layer sometimes encodes common single-component
// kanji (月, 日, 人, 高, 入, 大, ...) using their Kangxi Radical lookalike
// codepoints (U+2F00–U+2FD5) instead of the standard CJK Unified Ideograph —
// confirmed by inspecting actual extracted text (⽇=U+2F47, ⽉=U+2F49, etc.).
// The Kangxi Radicals block is laid out in the fixed, standard 214-radical
// dictionary order, so it can be reconstructed as a straight lookup table
// indexed by (codepoint - 0x2F00) rather than a hand-typed sparse map.
const KANGXI_RADICALS_IN_ORDER = (
  "一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子" +
  "宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戸手支攴文斗斤方无日曰月木欠止歹" +
  "殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立" +
  "竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走" +
  "足身車辛辰辵邑酉釆里金長門阜隶隹雨青非面革韋韭音頁風飛食首香馬骨高髟鬥鬯鬲鬼魚" +
  "鳥鹵鹿麦麻黄黍黒黹黽鼎鼓鼠鼻斉歯竜亀龠"
).split("");
// A handful of characters from the separate "CJK Radicals Supplement" block
// (U+2E80–U+2EF3) show up the same way. Unlike the Kangxi Radicals block
// above, this one isn't laid out in a simple sequential order, so only add
// entries here once actually confirmed against real extracted text (a wrong
// guessed mapping silently corrupts text, which is worse than leaving it
// unmapped) — ⻑ is confirmed from a real user-submitted PDF.
const CJK_RADICAL_SUPPLEMENT_MAP = {
  "⻑": "長"
};

function normalizeKangxiRadicals(text) {
  return text
    .replace(/[⼀-⿕]/g, ch => {
      const idx = ch.codePointAt(0) - 0x2F00;
      return KANGXI_RADICALS_IN_ORDER[idx] || ch;
    })
    .replace(/[⺀-⻿]/g, ch => CJK_RADICAL_SUPPLEMENT_MAP[ch] || ch);
}

async function extractTextFromPdfFile(file) {
  const items = await extractTextItemsFromPdf(file);
  return normalizeKangxiRadicals(itemsToPlainText(items));
}

// ---------- Image OCR (Tesseract.js, loaded on first use only) ----------
let tesseractLoadPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractLoadPromise) {
    tesseractLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "js/vendor/tesseract.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("OCRライブラリの読み込みに失敗しました"));
      document.head.appendChild(script);
    });
  }
  return tesseractLoadPromise;
}

async function extractTextFromImageFile(file, onProgress) {
  await loadTesseract();
  const { data } = await Tesseract.recognize(file, "jpn+eng", {
    logger: m => {
      if (onProgress && m.status && typeof m.progress === "number") {
        onProgress(m.status, m.progress);
      }
    }
  });
  return data.text;
}

// ---------- Field-guessing heuristics ----------
const JP_PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

// Converts Japanese era years (令和/平成/昭和/大正) to their Western-calendar
// equivalent (e.g. "令和5" -> "2023") so the rest of the parser — which
// otherwise only recognizes \d{4} western years — can read dates from
// resumes written in era notation, which is at least as common as western
// years on real Japanese documents. "元年" (the era's first year) is handled
// as year 1.
const ERA_START_YEAR = { "令和": 2018, "平成": 1988, "昭和": 1925, "大正": 1911 };
function convertEraYears(text) {
  return text.replace(/(令和|平成|昭和|大正)(元|\d{1,2})/g, (match, era, num) => {
    const n = num === "元" ? 1 : parseInt(num, 10);
    return String(ERA_START_YEAR[era] + n);
  });
}

function parseResumeText(rawText) {
  const text = convertEraYears(rawText);
  const result = {
    fullName: "", furigana: "", birthDate: "",
    zipCurrent: "", addressCurrent: "", addressCurrentFurigana: "", phoneCurrent: "", emailCurrent: "",
    educationRows: [], workHistoryRows: [], licenseRows: []
  };
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) result.emailCurrent = emailMatch[0];

  // Falls back to a bare 10-11 digit run (mobile numbers are always written
  // as exactly 11 digits, landlines as exactly 10, whatever the area code
  // length) when no dashed number is found — some templates write phone
  // numbers as one unbroken string of digits. The exact digit count rules
  // out a false match on a 7-digit zip code, so this can't misfire there.
  const phoneMatch = text.match(/0\d{1,4}-\d{1,4}-\d{3,4}/) || text.match(/\b0\d{9,10}\b/);
  if (phoneMatch) result.phoneCurrent = phoneMatch[0];

  // Prefer a zip code that's actually marked with the postal-mark 〒 (avoids
  // matching a substring of a phone number, which has the same digit-dash shape).
  const zipMatch = text.match(/〒\s*(\d{3}-?\d{4})/) || text.match(/\d{3}-\d{4}/);
  if (zipMatch) result.zipCurrent = zipMatch[1] || zipMatch[0];

  // Requires a trailing "生" so this can't match the unrelated "作成日"
  // (creation date) line at the top of the document, which has the same
  // YYYY年M月D日 shape. Loose \s* spacing survives whitespace/line-break
  // noise from PDF line reconstruction, as long as 年/月/日/生 stay intact.
  const birthMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*生/);
  if (birthMatch) {
    const [, y, m, d] = birthMatch;
    result.birthDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // A phone number or email address that ended up glued onto the end of an
  // address/furigana line (line-reconstruction from a differently-spaced PDF
  // can merge adjacent "columns" without a wide enough gap to split them).
  function stripTrailingContactInfo(str) {
    return str
      .replace(/\s*電話[:：]?\s*0[\d\-]{8,}.*$/, "")
      .replace(/\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}.*$/, "")
      .replace(/\s*0\d{1,4}-\d{1,4}-\d{3,4}.*$/, "")
      .replace(/\s*\b0\d{9,10}\b.*$/, "")
      .trim();
  }

  // Recognizes a school/company history row so it can be excluded below. Many
  // prefecture names are literal substrings of prefectural school names (e.g.
  // "三重県立松阪工業高等学校" contains "三重県"), so without this exclusion a
  // long school-history line can out-length the real address line and get
  // mistaken for it.
  const historyLineRe = /^(\d{4})[年\s]+(\d{1,2})[月\s]+(.{2,})$/;
  // Lines that mark a clear boundary (a different field/section starting) or
  // that are just a bare phone/email value or label with no address content
  // of their own. Column-based line reconstruction can place a line or two
  // from the neighboring phone/email column in between two lines of a
  // wrapped address (the address cell spans more lines than the row it's
  // next to), so these are skipped rather than treated as the end of the
  // address.
  // Some templates space out 2-character labels for visual alignment
  // ("学 歴" instead of "学歴"), so allow an optional space in each.
  const ADDR_BOUNDARY_RE = /^(ふりがな|連絡先|現\s?住\s?所|〒|学\s?歴|職\s?歴|免許|志望動機|本人希望|以上|同上)/;
  const EMAIL_ONLY_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const PHONE_ONLY_RE = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$|^0\d{9,10}$/;
  // Bare contact-info labels with no value on their own line — templates
  // vary in wording ("携帯番号" vs "電話", "e-mail" vs "Email"), so this is
  // intentionally case-insensitive and covers the common variants rather
  // than one exact string.
  const CONTACT_LABEL_ONLY_RE = /^(e[-‐]?mail|電話|電話番号|携帯|携帯番号|tel)$/i;

  lines.forEach((line, idx) => {
    if (historyLineRe.test(line)) return;
    const pref = JP_PREFECTURES.find(p => line.includes(p));
    if (!pref) return;
    let candidate = stripTrailingContactInfo(line.slice(line.indexOf(pref)).replace(/^〒?\d{3}-?\d{4}\s*/, ""));
    for (let j = idx + 1; j < Math.min(idx + 5, lines.length); j++) {
      const next = lines[j];
      if (EMAIL_ONLY_RE.test(next) || PHONE_ONLY_RE.test(next) || CONTACT_LABEL_ONLY_RE.test(next)) continue;
      if (ADDR_BOUNDARY_RE.test(next) || historyLineRe.test(next)) break;
      candidate += next;
    }
    if (candidate.length > result.addressCurrent.length) result.addressCurrent = candidate;
  });

  // Lines that are clearly template chrome, not a name, even if they end up
  // right after the "名前" label due to imperfect line reconstruction.
  const isNameNoise = l => /ふりがな|生年月日|証明写真|mm|単身|裏面|のりづけ/.test(l);
  // Some templates space out a 2-character label for visual alignment
  // ("氏 名" instead of "氏名"), so allow an optional space between the two.
  const NAME_LABEL_RE = /^(氏\s?名|名\s?前)/;
  const nameLabelIdx = lines.findIndex(l => NAME_LABEL_RE.test(l));
  if (nameLabelIdx >= 0) {
    const sameLine = lines[nameLabelIdx].replace(NAME_LABEL_RE, "").replace(/^[:：]?\s*/, "").trim();
    if (sameLine && sameLine !== lines[nameLabelIdx] && !isNameNoise(sameLine)) {
      result.fullName = sameLine;
    } else {
      for (let i = nameLabelIdx + 1; i < Math.min(nameLabelIdx + 4, lines.length); i++) {
        if (lines[i] && !isNameNoise(lines[i])) { result.fullName = lines[i]; break; }
      }
    }
  } else {
    // No "氏名"/"名前" label at all — some templates just print the reading
    // then the kanji name, unlabeled. Look for that pair (a kana-only line
    // immediately followed by a line containing kanji) near the very top of
    // the document, before any address/birthdate content would start, so
    // this can't accidentally grab the *address* furigana instead (which
    // always appears later, after the name/birthdate block).
    const headerEnd = Math.min(6, lines.length);
    for (let i = 0; i < headerEnd - 1; i++) {
      if (/^[ぁ-んァ-ヶーゝゞ\s]{2,20}$/.test(lines[i]) && /[一-龠]/.test(lines[i + 1])) {
        result.furigana = lines[i];
        result.fullName = lines[i + 1];
        break;
      }
    }
  }

  // The template has two "ふりがな" lines: one for the name, one for the
  // current address. Take them in order rather than just the first match.
  const furiganaLines = lines
    .map((l, i) => ({ i, text: stripTrailingContactInfo(l.replace(/^ふりがな[:：]?\s*/, "")) }))
    .filter(({ i, text }) => /^ふりがな/.test(lines[i]) && text);
  if (furiganaLines[0]) result.furigana = furiganaLines[0].text;
  if (furiganaLines[1]) result.addressCurrentFurigana = furiganaLines[1].text;

  lines.forEach(line => {
    const m = line.match(historyLineRe);
    if (!m) return;
    const [, year, month, content] = m;
    const trimmedContent = content.trim();
    if (/以上|貴社|規定に従います/.test(trimmedContent)) return;
    const row = { year, month, text: trimmedContent };
    if (/(大学|高等学校|高校|専門学校|中学校|小学校|学部|学科|入学|卒業)/.test(trimmedContent)) {
      result.educationRows.push(row);
    } else if (/(免許|資格|取得|検定|級|TOEIC)/.test(trimmedContent)) {
      result.licenseRows.push(row);
    } else if (/(株式会社|有限会社|合同会社|学校法人|社会福祉法人|特定非営利活動法人|NPO法人|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|入社|入職|退社|退職|勤務|配属)/.test(trimmedContent)) {
      result.workHistoryRows.push(row);
    }
  });

  // Left as separate one-event-per-row entries here — merging is only applied
  // later (see rirekisho.js's applyParsedFields), and only when the raw row
  // count actually needs it to fit the form's fixed capacity. Most resumes
  // don't need it, and one row per join/leave event reads more normally.
  return result;
}

// Merges an "入社/入職" row immediately followed by the matching "退社/退職"
// row for the same employer into one row (e.g. "◯◯ 入社（同年3月 一身上の
// 都合により退社）"), the same style resumes already use when someone left
// within the same reporting block. This halves the row count for anyone
// with a long work history, which matters because the printed form only has
// room for a fixed number of combined education+work rows.
function consolidateJoinLeavePairs(rows) {
  const JOIN_RE = /(入社|入職)/;
  const LEAVE_RE = /(退社|退職)/;
  const merged = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    const next = rows[i + 1];
    const joinMatch = row.text.match(JOIN_RE);
    if (joinMatch && !LEAVE_RE.test(row.text) && next) {
      const leaveMatch = next.text.match(LEAVE_RE);
      if (leaveMatch && !JOIN_RE.test(next.text)) {
        const company = row.text.slice(0, joinMatch.index).trim();
        const nextPrefix = next.text.slice(0, leaveMatch.index).replace(/一身上の都合により$/, "").trim();
        if (company && (nextPrefix === company || nextPrefix.startsWith(company))) {
          const sameYear = row.year === next.year;
          const remainder = next.text.slice(company.length).trim();
          merged.push({
            year: row.year,
            month: row.month,
            text: `${company} ${joinMatch[1]}（${sameYear ? "同年" : next.year + "年"}${next.month}月 ${remainder}）`
          });
          i += 2;
          continue;
        }
      }
    }
    merged.push(row);
    i += 1;
  }
  return merged;
}
