// i18n completeness audit — every STRINGS key must carry all 7 languages.
// Run: node scripts/i18n-audit.mjs   (exit 1 on any gap)
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LANGS = ["en", "hi", "bn", "ta", "te", "mr", "kn"];

// Strip types so the object literal can be evaluated as JS.
const raw = readFileSync("src/i18n/strings.ts", "utf8");
const start = raw.indexOf("export const STRINGS = {");
const end = raw.indexOf("} as const;", start);
// body is the entries INCLUDING the opening "{" and EXCLUDING the final "}"
const body = raw
  .slice(start + "export const STRINGS = ".length, end + 1) // up to and including final }
  .replace(/^\s*\/\/.*$/gm, ""); // strip line comments
// eslint-disable-next-line no-new-func
const STRINGS = new Function(`return (${body});`)();

let bad = 0;
const keys = Object.keys(STRINGS);
for (const k of keys) {
  const entry = STRINGS[k];
  const missing = LANGS.filter((l) => typeof entry?.[l] !== "string" || !entry[l].trim());
  if (missing.length) {
    bad++;
    console.log(`MISSING ${k}: ${missing.join(", ")}`);
  }
}
console.log(`${keys.length} keys audited, ${bad} incomplete, ${LANGS.length} languages`);
if (bad > 0) process.exit(1);
