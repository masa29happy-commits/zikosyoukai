// Best-effort "read an existing resume file and pre-fill the form" helper.
// No AI/API involved: PDF text is extracted with pdf.js, image text with
// Tesseract.js OCR (both free, run entirely in the browser), then a handful of
// regex/keyword heuristics guess which text is the name, address, history rows,
// etc. This is inherently approximate — the caller must let the user review
// and correct the result, especially for scanned/handwritten sources.

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

async function extractTextItemsFromPdf(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const items = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    content.items.forEach(item => {
      if (!item.str || !item.str.trim()) return;
      const fontSize = Math.hypot(item.transform[0], item.transform[1]) || 0;
      items.push({
        // Some PDF generators pad digits with literal space characters within
        // a single text run for visual justification (e.g. "1 9 9 9" instead
        // of "1999"). Since this happens inside ONE run (pdf.js already
        // grouped it as one item), collapsing spaces between digits here is
        // safe — it can't accidentally bridge two genuinely separate fields,
        // which always arrive as separate items.
        text: item.str.replace(/(\d)\s+(?=\d)/g, "$1"),
        x: item.transform[4],
        y: viewport.height - item.transform[5],
        width: item.width || 0,
        fontSize,
        page: pageNum
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

function parseResumeText(text) {
  const result = {
    fullName: "", furigana: "", birthDate: "",
    zipCurrent: "", addressCurrent: "", addressCurrentFurigana: "", phoneCurrent: "", emailCurrent: "",
    educationRows: [], workHistoryRows: [], licenseRows: []
  };
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) result.emailCurrent = emailMatch[0];

  const phoneMatch = text.match(/0\d{1,4}-\d{1,4}-\d{3,4}/);
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
  const ADDR_BOUNDARY_RE = /^(ふりがな|連絡先|現住所|〒|学歴|職歴|免許|志望動機|本人希望|以上)/;
  const EMAIL_ONLY_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const PHONE_ONLY_RE = /^0\d{1,4}-\d{1,4}-\d{3,4}$/;

  lines.forEach((line, idx) => {
    if (historyLineRe.test(line)) return;
    const pref = JP_PREFECTURES.find(p => line.includes(p));
    if (!pref) return;
    let candidate = stripTrailingContactInfo(line.slice(line.indexOf(pref)).replace(/^〒?\d{3}-?\d{4}\s*/, ""));
    for (let j = idx + 1; j < Math.min(idx + 5, lines.length); j++) {
      const next = lines[j];
      if (EMAIL_ONLY_RE.test(next) || PHONE_ONLY_RE.test(next) || next === "Email" || next === "電話") continue;
      if (ADDR_BOUNDARY_RE.test(next) || historyLineRe.test(next)) break;
      candidate += next;
    }
    if (candidate.length > result.addressCurrent.length) result.addressCurrent = candidate;
  });

  // Lines that are clearly template chrome, not a name, even if they end up
  // right after the "名前" label due to imperfect line reconstruction.
  const isNameNoise = l => /ふりがな|生年月日|証明写真|mm|単身|裏面|のりづけ/.test(l);
  const nameLabelIdx = lines.findIndex(l => /^(氏名|名前)[:：\s]/.test(l) || /^(氏名|名前)$/.test(l));
  if (nameLabelIdx >= 0) {
    const sameLine = lines[nameLabelIdx].replace(/^(氏名|名前)[:：]?\s*/, "").trim();
    if (sameLine && sameLine !== lines[nameLabelIdx] && !isNameNoise(sameLine)) {
      result.fullName = sameLine;
    } else {
      for (let i = nameLabelIdx + 1; i < Math.min(nameLabelIdx + 4, lines.length); i++) {
        if (lines[i] && !isNameNoise(lines[i])) { result.fullName = lines[i]; break; }
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
    } else if (/(株式会社|有限会社|合同会社|入社|退社|退職|勤務|配属)/.test(trimmedContent)) {
      result.workHistoryRows.push(row);
    }
  });

  return result;
}
