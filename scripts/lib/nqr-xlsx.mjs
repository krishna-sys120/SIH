/**
 * Minimal zero-dependency .xlsx reader — used ONLY for the official NQR
 * summary export from https://www.nqr.gov.in (Phase 3: official structured
 * export preferred over scraping).
 *
 * Scope: single-sheet workbooks with inline shared strings. This is enough for
 * the NQR export and avoids adding a heavy Excel dependency. Unknown cell
 * types are treated as raw strings; missing cells become empty strings.
 */
import { inflateRawSync } from "node:zlib";

/** Decode the XML entities the export actually uses. */
export function xmlDecode(s) {
  return String(s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function colToIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    if (ch >= "A" && ch <= "Z") n = n * 26 + (ch.charCodeAt(0) - 64);
    else break;
  }
  return n - 1;
}

/** Parse the sharedStrings table into an array of decoded strings. */
export function parseSharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push(m[1].replace(/<t[^>]*>/g, "").replace(/<\/t>/g, ""));
  }
  return out;
}

/**
 * Parse a worksheet XML into row objects keyed by header name.
 * Header row = the first row whose cells are all plain strings.
 */
export function parseSheet(xml, sharedStrings) {
  const rowsXml = [...xml.matchAll(/<row[^>]*?>([\s\S]*?)<\/row>/g)].map((m) => m[1]);
  const rows = rowsXml.map((rx) => {
    const cells = {};
    for (const c of rx.matchAll(
      /<c\s+r="([A-Z]+)\d+"([^>]*?)\/>|<c\s+r="([A-Z]+)\d+"([^>]*?)>([\s\S]*?)<\/c>/g,
    )) {
      const col = colToIndex(c[1] ?? c[3]);
      const attrs = c[2] ?? c[4] ?? "";
      const inner = c[5] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      const isNode = c[5] !== undefined;
      let val = "";
      if (isNode && v) {
        val = /t="s"/.test(attrs) ? (sharedStrings[Number(v[1])] ?? "") : v[1];
      }
      cells[col] = xmlDecode(val);
    }
    return cells;
  });

  if (rows.length === 0) return [];
  // Heuristic header row: NQR export has two header rows (banner + names) but
  // generically we take the first row with >3 non-empty string cells.
  let headerIdx = rows.findIndex(
    (r) => Object.values(r).filter((v) => v && !/^\d+(\.\d+)?$/.test(v)).length > 3,
  );
  if (headerIdx < 0) headerIdx = 0;
  const header = rows[headerIdx];
  const width = Math.max(...rows.map((r) => Math.max(-1, ...Object.keys(r).map(Number))));
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    for (let col = 0; col <= width; col++) {
      const key = header[col];
      if (!key) continue;
      obj[key] = r[col] ?? "";
    }
    // Skip fully-empty rows (NQR export interleaves separators).
    if (Object.values(obj).some((v) => String(v).trim() !== "")) out.push(obj);
  }
  return out;
}

/** Read one workbook from a Buffer. Returns array of row objects. */
export function readXlsx(buf) {
  // Minimal ZIP local-file-header reader (stored or deflate entries).
  const entries = readZipEntries(buf);
  const shared = parseSharedStrings((entries.get("xl/sharedStrings.xml") ?? "").toString("utf8"));
  const sheetName = [...entries.keys()].find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k));
  if (!sheetName) throw new Error("workbook has no sheet1 worksheet");
  return parseSheet(entries.get(sheetName).toString("utf8"), shared);
}

/** Minimal ZIP central-directory reader — no dependencies. */
export function readZipEntries(buf) {
  // Locate End Of Central Directory record.
  const sigEOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === sigEOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (no EOCD)");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  const sigCD = 0x02014b50;
  const sigLFH = 0x04034b50;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== sigCD) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOff = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    // Local header: name/extra lengths can differ from central directory.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) {
      out.set(name, Buffer.from(raw));
    } else if (method === 8) {
      out.set(name, inflateRawSync(raw));
    } else {
      throw new Error(`unsupported compression method ${method} for ${name}`);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
