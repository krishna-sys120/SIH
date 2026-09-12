export type LangCode = "en" | "hi" | "bn" | "ta" | "te" | "mr" | "kn";

export interface LanguageDef {
  code: LangCode;
  label: string;
  native: string;
  bcp47: string; // BCP-47 tag for speech recognition / synthesis
}

export const LANGUAGES: LanguageDef[] = [
  { code: "en", label: "English", native: "English", bcp47: "en-IN" },
  { code: "hi", label: "Hindi", native: "हिन्दी", bcp47: "hi-IN" },
  { code: "bn", label: "Bengali", native: "বাংলা", bcp47: "bn-IN" },
  { code: "ta", label: "Tamil", native: "தமிழ்", bcp47: "ta-IN" },
  { code: "te", label: "Telugu", native: "తెలుగు", bcp47: "te-IN" },
  { code: "mr", label: "Marathi", native: "मराठी", bcp47: "mr-IN" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ", bcp47: "kn-IN" },
];

export const L = LANGUAGES.map((l) => l.code);

export function isLangCode(x: string): x is LangCode {
  return L.includes(x as LangCode);
}
