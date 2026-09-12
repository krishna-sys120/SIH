export type Sector =
  | "textiles"
  | "agri"
  | "construction"
  | "beauty"
  | "automotive"
  | "electronics"
  | "food"
  | "handicrafts"
  | "it"
  | "healthcare";

export type LivelihoodId =
  | "farmer"
  | "agri-labour"
  | "handloom-weaver"
  | "tailor"
  | "artisan"
  | "leather-worker"
  | "construction-labour"
  | "domestic-worker"
  | "street-vendor"
  | "beautician"
  | "mechanic"
  | "electrician"
  | "fisher"
  | "dairy"
  | "waste-picker"
  | "student"
  | "unemployed"
  | "homemaker";

export interface Livelihood {
  id: LivelihoodId;
  /** i18n key: `liv.<id>` */
  icon: string;
  sectors: Sector[];
}

export interface Course {
  id: string;
  name: string;
  sector: Sector;
  nsqf_level: number;
  duration_months: number;
  provider: string;
  district: string;
  state: string;
  seats_left: number;
  stipend_monthly: number;
  languages: string[];
  keywords: string[];
}

export interface Beneficiary {
  id?: string;
  name: string;
  age: number;
  gender: "male" | "female" | "other";
  phone: string;
  state: string;
  district: string;
  category: "sc" | "st" | "obc" | "gen";
  income: number;
  work_type: LivelihoodId;
  education: string;
  skills: string;
  interest: string;
  created_at?: string;
}

export interface MatchResult {
  course: Course;
  score: number;
  reasons: string[];
  /** Livelihood the match was computed against, for reason labels. */
  livelihood?: LivelihoodId;
}

const LIVELIHOOD_SECTORS: Record<LivelihoodId, Sector[]> = {
  farmer: ["agri"],
  "agri-labour": ["agri"],
  "handloom-weaver": ["textiles", "handicrafts"],
  tailor: ["textiles"],
  artisan: ["handicrafts"],
  "leather-worker": ["handicrafts", "construction"],
  "construction-labour": ["construction"],
  "domestic-worker": ["healthcare", "food"],
  "street-vendor": ["food"],
  beautician: ["beauty"],
  mechanic: ["automotive"],
  electrician: ["construction", "electronics"],
  fisher: ["agri", "food"],
  dairy: ["agri", "food"],
  "waste-picker": ["agri", "construction"],
  student: ["it", "electronics", "healthcare"],
  unemployed: ["it", "food", "construction", "textiles"],
  homemaker: ["textiles", "food", "beauty"],
};

/** Livelihood → sector mapping used by the AI matching engine. */
export function sectorsForLivelihood(id: LivelihoodId): Sector[] {
  return LIVELIHOOD_SECTORS[id] ?? [];
}

export const LIVELIHOOD_IDS = Object.keys(LIVELIHOOD_SECTORS) as LivelihoodId[];

export const SECTORS: Sector[] = [
  "textiles",
  "agri",
  "construction",
  "beauty",
  "automotive",
  "electronics",
  "food",
  "handicrafts",
  "it",
  "healthcare",
];

export const EDUCATION_LEVELS = ["none", "primary", "secondary", "senior", "graduate"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** NSQF eligibility: each level typically requires the previous level's education. */
export function educationCeiling(edu: EducationLevel): number {
  switch (edu) {
    case "none":
      return 1;
    case "primary":
      return 2;
    case "secondary":
      return 3;
    case "senior":
      return 4;
    case "graduate":
      return 4;
  }
}

export function educationLabelKey(edu: string): string {
  return `edu.${edu}`;
}
