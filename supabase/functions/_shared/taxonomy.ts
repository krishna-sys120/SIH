/**
 * NSQF / QP / NOS prototype taxonomy.
 *
 * HONESTY NOTE (SIH26097 Phase 7): this file encodes a PROTOTYPE mapping
 * between livelihoods, job roles, competencies (NOS-style), and NSQF levels.
 * Official NSQF/QP/NOS identifiers are NOT invented here: every record is
 * `verification: "prototype"` and MUST be displayed with the
 * "Prototype mapping — requires official verification" badge until mapped to
 * real QP references from the NSQF/MSDE Skill India registry (which would set
 * qp_ref / qp_source_url / verification: "official").
 *
 * Pure TypeScript — shared by the Vite app, vitest, and Deno edge functions.
 * Type-only import of the domain model keeps the runtime dependency-free.
 */
import type { Sector, LivelihoodId } from "../../../src/data/model";

/** Canonical skill ids used across extraction, skill-gap and scoring. */
export type SkillId =
  | "mechanical_repair"
  | "vehicle_servicing"
  | "tool_handling"
  | "electrical_basic"
  | "electrical_diagnostics"
  | "stitching"
  | "embroidery"
  | "loom_weaving"
  | "garment_fitting"
  | "customer_service"
  | "food_prep"
  | "food_safety"
  | "sales_handling"
  | "bookkeeping"
  | "digital_basics"
  | "data_entry"
  | "patient_care"
  | "hygiene_practices"
  | "beauty_services"
  | "skin_hair_care"
  | "masonry"
  | "concrete_work"
  | "safety_compliance"
  | "crop_cultivation"
  | "soil_management"
  | "irrigation"
  | "animal_care"
  | "dairy_processing"
  | "fish_handling"
  | "craft_making"
  | "bamboo_craft"
  | "leather_work"
  | "inventory_mgmt"
  | "communication";

export interface SkillDef {
  id: SkillId;
  /** i18n key: `skill.<id>` (labels.core) — falls back to the English label. */
  label: string;
}

export const SKILLS: SkillDef[] = [
  { id: "mechanical_repair", label: "Basic mechanical repair" },
  { id: "vehicle_servicing", label: "Vehicle servicing" },
  { id: "tool_handling", label: "Tool handling" },
  { id: "electrical_basic", label: "Basic electrical work" },
  { id: "electrical_diagnostics", label: "Electrical diagnostics" },
  { id: "stitching", label: "Stitching" },
  { id: "embroidery", label: "Embroidery" },
  { id: "loom_weaving", label: "Loom weaving" },
  { id: "garment_fitting", label: "Garment fitting" },
  { id: "customer_service", label: "Customer service" },
  { id: "food_prep", label: "Food preparation" },
  { id: "food_safety", label: "Food safety & hygiene" },
  { id: "sales_handling", label: "Selling & billing" },
  { id: "bookkeeping", label: "Basic bookkeeping" },
  { id: "digital_basics", label: "Basic computer use" },
  { id: "data_entry", label: "Data entry" },
  { id: "patient_care", label: "Patient care" },
  { id: "hygiene_practices", label: "Hygiene practices" },
  { id: "beauty_services", label: "Beauty services" },
  { id: "skin_hair_care", label: "Skin & hair care" },
  { id: "masonry", label: "Masonry" },
  { id: "concrete_work", label: "Concrete work" },
  { id: "safety_compliance", label: "Workplace safety" },
  { id: "crop_cultivation", label: "Crop cultivation" },
  { id: "soil_management", label: "Soil management" },
  { id: "irrigation", label: "Irrigation" },
  { id: "animal_care", label: "Animal care" },
  { id: "dairy_processing", label: "Dairy processing" },
  { id: "fish_handling", label: "Fish handling & preservation" },
  { id: "craft_making", label: "Handicraft making" },
  { id: "bamboo_craft", label: "Bamboo craft" },
  { id: "leather_work", label: "Leather work" },
  { id: "inventory_mgmt", label: "Stock & inventory" },
  { id: "communication", label: "Communication" },
];

export const SKILL_IDS = SKILLS.map((s) => s.id);

/**
 * Multilingual spoken-form → skill lexicon (extraction layer). Keywords cover
 * the 7 UI languages; matching is case-insensitive substring on the raw
 * utterance, same pragmatic approach as the livelihood WORK_HINTS lexicon.
 */
export const SKILL_HINTS: Array<{ id: SkillId; words: string[] }> = [
  { id: "mechanical_repair", words: ["repair", "fix", "मरम्मत", "मेकॅनिक", "मैकेनिक", "दुरुस्त", "பழுது", "రిపేర్", "ದುರಸ್ತಿ", "মেরামত", "سرو"] },
  { id: "vehicle_servicing", words: ["motorcycle", "bike", "two wheeler", "two-wheeler", "scooter", "auto rickshaw", "vehicle", "बाइक", "मोटर", "బైక్", "ವಾಹನ", "ಬೈಕ್", "গাড়ি", "वाहन"] },
  { id: "tool_handling", words: ["tools", "औज़ार", "औजार", "अौजार", "கருவி", "సాధనాలు", "ಉಪಕರಣ", "টুল", "औत" ] },
  { id: "electrical_basic", words: ["wiring", "electric", "wire", "बिजली", "विद्युत", "மின்", "కరెంట్", "ಕರೆಂಟ್", "ವಿದ್ಯುತ್", "বিদ্যুৎ"] },
  { id: "electrical_diagnostics", words: ["diagnostic", "multimeter", "डायग्नोस्टिक", "ರೋಗನಿರ್ಣಯ"] },
  { id: "stitching", words: ["stitch", "sew", "tailor", "सिलाई", "दर्जी", "தையல்", "కుట్టు", "ಹೊಲಿಗೆ", "ದರ್ಜಿ", "সেলাই", "शिवण"] },
  { id: "embroidery", words: ["embroidery", "कढ़ाई", "कषाई", "எம்பிராய்டரி", "కసూతి", "ಕಸೂತಿ", "কাঁথা"] },
  { id: "loom_weaving", words: ["loom", "weav", "करघा", "बुनकर", "நெசவு", "నేత", "ನೇಯ್ಗೆ", "বুনন"] },
  { id: "garment_fitting", words: ["fitting", "measurement", "माप", "मापजोख"] },
  { id: "customer_service", words: ["customer", "service", "ग्राहक", "सेवा", "வாடிக்கை", "సేవ", "ಗ್ರಾಹಕ", "কাস্টমার"] },
  { id: "food_prep", words: ["cook", "cooking", "खाना", "पाक", "சமையல்", "వంట", "ಅಡುಗೆ", "রান্না", "स्वयंपाक"] },
  { id: "food_safety", words: ["hygiene", "fssai", "स्वच्छता", "சுகாதார", "పరిశుభ్రత", "ಸ್ವಚ್ಛತೆ", "স্বাস্থ্যকর"] },
  { id: "sales_handling", words: ["sell", "sales", "shop", "दुकान", "विक्री", "விற்பனை", "అమ్మకం", "ಮಾರಾಟ", "বিক্রি", "विक्रय"] },
  { id: "bookkeeping", words: ["account", "billing", "cash", "हिसाब", "लेखा", "கணக்கு", "ఖాతా", "ಲೆಕ್ಕ", "হিসাব"] },
  { id: "digital_basics", words: ["computer", "mobile phone", "smartphone", "कंप्यूटर", "संगणक", "கணினி", "కంప్యూటర్", "ಗಣಕ", "ಕಂಪ್ಯೂಟರ್", "কম্পিউটার"] },
  { id: "data_entry", words: ["typing", "data entry", "टाइप", "typewrit", "టైపింగ్", "ಟೈಪಿಂಗ್"] },
  { id: "patient_care", words: ["patient", "caregiv", "nursing", "मरीज़", "मरीज", "रोगी", "நோயாளி", "రోగి", "ರೋಗಿ", "রোগী"] },
  { id: "hygiene_practices", words: ["clean", "सफाई", "சுத்தம்", "శుభ్రం", "ಸ್ವಚ್ಛ"] },
  { id: "beauty_services", words: ["beauty", "salon", "facial", "ब्यूटी", "सलून", "அழகு", "బ్యూటీ", "ಸೌಂದರ್ಯ", "ಬ್ಯೂಟಿ", "সৌন্দর্য"] },
  { id: "skin_hair_care", words: ["hair", "skin", "ग्रूमिंग", "मेहंदी", "mehendi", "henna"] },
  { id: "masonry", words: ["mason", "brick", "plaster", "मिस्त्री", "राज", "चिनाई", "கட்டுமான", "మేస్త్రీ", "ಮೇಸ್ತ್ರಿ", "রাজমিস্ত্রি"] },
  { id: "concrete_work", words: ["concrete", "cement", "सीमेंट", "சிமென்ட்", "సిమెంట్", "ಸಿಮೆಂಟ್"] },
  { id: "safety_compliance", words: ["safety", "helmet", "सुरक्षा", "பாதுகாப்பு", "భద్రత", "ಸುರಕ್ಷತೆ", "নিরাপত্তা"] },
  { id: "crop_cultivation", words: ["farm", "crop", "seed", "खेती", "कृषि", "फसल", "விவசாய", "వ్యవసాయ", "ಕೃಷಿ", "ಬೇಸಾಯ", "চাষ", "शेती"] },
  { id: "soil_management", words: ["soil", "fertilizer", "मिट्टी", "खाद", "மண்", "నేల", "ಮಣ್ಣು", "মাটি"] },
  { id: "irrigation", words: ["irrigation", "borewell", "canal", "सिंचाई", "பாசன", "నీటిపారుదల", "ನೀರಾವರಿ"] },
  { id: "animal_care", words: ["cattle", "goat", "poultry", "livestock", "गाय", "मवेशी", "बकरी", "கால்நடை", "పశు", "ಜಾನುವಾರು", "গরু"] },
  { id: "dairy_processing", words: ["dairy", "milk", "दूध", "दुग्ध", "பால்", "పాల", "ಹಾಲು", "ডুগ্ধ", "दूध व्यवसाय"] },
  { id: "fish_handling", words: ["fish", "aquacultur", "मछली", "मासे", "மீன்", "చేప", "ಮೀನು", "মাছ"] },
  { id: "craft_making", words: ["craft", "artisan", "कारीगर", "कारागीर", "கைவினை", "ಕುಶಲಕರ್ಮಿ", "শিল্প", "हस्तकला"] },
  { id: "bamboo_craft", words: ["bamboo", "basket", "बांस", "टोकरी", "கூடை", "ಬುಟ್ಟಿ", "বাঁশ"] },
  { id: "leather_work", words: ["leather", "चर्म", "चामड", "தோல்", "చర్మ", "ಚರ್ಮ", "চামড়া", "footwear"] },
  { id: "inventory_mgmt", words: ["stock", "inventory", "godown", "भंडार", "ದಾಸ್ತಾನು"] },
  { id: "communication", words: ["talk", "speak", "convince", "बातचीत", "பேச", "మాట్లాడ", "ಮಾತನಾಡ"] },
];

export interface BusinessIdea {
  /** i18n key: `biz.<id>` */
  id: string;
  skills: SkillId[];
  /** Indicative startup tool/resource needs (not fabricated costs). */
  tools: string[];
  /**
   * Relevant public government schemes. Named schemes are real central
   * schemes; the UI links nothing and labels them "verify current guidelines
   * at the official portal" — we do NOT fabricate eligibility details.
   */
  schemes: string[];
}

export interface JobRole {
  id: string;
  title: string;
  sector: Sector;
  /** Indicative NSQF level for this role in the prototype mapping. */
  nsqf_level: number;
  /**
   * Official QP reference id (e.g. "ASC/Q9901") — null in this prototype
   * because we do not fabricate official identifiers.
   */
  qp_ref: string | null;
  /** Official source URL once verified; null in the prototype. */
  qp_source_url: string | null;
  /** "official" only when qp_ref + qp_source_url are verified; else "prototype". */
  verification: "official" | "prototype";
  /** Required competencies (NOS-style ids from SKILLS). */
  competencies: SkillId[];
  /** Physical demands the work typically involves (for constraint scoring). */
  physical_demands: Array<"standing" | "heavy_lifting" | "outdoor" | "fine_motor">;
  /** Livelihoods that commonly feed into this role. */
  feeds_from: LivelihoodId[];
  /** Indicative career progression (role ids). */
  career_path: string[];
  /** Enterprise/self-employment pathway options for this role. */
  business: BusinessIdea[];
}

// ── Job roles (prototype mapping) ────────────────────────────────
export const JOB_ROLES: JobRole[] = [
  {
    id: "automotive_service_tech",
    title: "Automotive Service Technician",
    sector: "automotive",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["mechanical_repair", "vehicle_servicing", "tool_handling", "electrical_diagnostics", "safety_compliance", "customer_service"],
    physical_demands: ["standing", "fine_motor"],
    feeds_from: ["mechanic", "electrician", "construction-labour", "student"],
    career_path: ["automotive_service_tech", "ev_service_assistant"],
    business: [
      { id: "two_wheeler_repair_shop", skills: ["mechanical_repair", "vehicle_servicing", "tool_handling", "sales_handling"], tools: ["hand tool set", "small workshop space"], schemes: ["PM MUDRA (Shishu/Kishor)", "PMEGP"] },
    ],
  },
  {
    id: "ev_service_assistant",
    title: "Electric Vehicle Service Assistant",
    sector: "automotive",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["electrical_basic", "electrical_diagnostics", "mechanical_repair", "tool_handling", "safety_compliance"],
    physical_demands: ["standing", "fine_motor"],
    feeds_from: ["mechanic", "electrician", "student"],
    career_path: ["ev_service_assistant"],
    business: [],
  },
  {
    id: "sewing_machine_operator",
    title: "Sewing Machine Operator",
    sector: "textiles",
    nsqf_level: 2,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["stitching", "garment_fitting", "tool_handling", "safety_compliance"],
    physical_demands: ["standing", "fine_motor"],
    feeds_from: ["tailor", "handloom-weaver", "homemaker"],
    career_path: ["sewing_machine_operator", "garment_quality_checker"],
    business: [
      { id: "tailoring_shop", skills: ["stitching", "garment_fitting", "customer_service", "bookkeeping"], tools: ["sewing machine", "shop space or home counter"], schemes: ["PM MUDRA (Shishu)", "PMEGP"] },
    ],
  },
  {
    id: "garment_quality_checker",
    title: "Garment Quality Checker",
    sector: "textiles",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["stitching", "garment_fitting", "customer_service", "inventory_mgmt"],
    physical_demands: ["standing", "fine_motor"],
    feeds_from: ["tailor", "handloom-weaver"],
    career_path: ["garment_quality_checker"],
    business: [],
  },
  {
    id: "handloom_weaver_enterprise",
    title: "Handloom Weaver (Enterprise)",
    sector: "textiles",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["loom_weaving", "craft_making", "inventory_mgmt", "sales_handling"],
    physical_demands: ["standing", "fine_motor"],
    feeds_from: ["handloom-weaver", "artisan", "homemaker"],
    career_path: ["handloom_weaver_enterprise"],
    business: [
      { id: "handloom_unit", skills: ["loom_weaving", "bookkeeping", "sales_handling", "communication"], tools: ["loom", "yarn supply chain"], schemes: ["Handloom Mark scheme (verify)", "PM MUDRA"] },
    ],
  },
  {
    id: "general_duty_assistant",
    title: "General Duty Assistant (Healthcare)",
    sector: "healthcare",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["patient_care", "hygiene_practices", "communication", "safety_compliance"],
    physical_demands: ["standing"],
    feeds_from: ["domestic-worker", "homemaker", "student", "unemployed"],
    career_path: ["general_duty_assistant"],
    business: [],
  },
  {
    id: "solar_field_technician",
    title: "Solar Field Technician",
    sector: "electronics",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["electrical_basic", "tool_handling", "safety_compliance", "customer_service"],
    physical_demands: ["standing", "outdoor", "heavy_lifting"],
    feeds_from: ["electrician", "construction-labour", "farmer", "student"],
    career_path: ["solar_field_technician", "ev_service_assistant"],
    business: [
      { id: "solar_maintenance_service", skills: ["electrical_basic", "tool_handling", "customer_service", "bookkeeping"], tools: ["basic electrical toolkit", "ladder"], schemes: ["PMEGP", "PM MUDRA (Kishor)"] },
    ],
  },
  {
    id: "mobile_repair_tech",
    title: "Mobile Phone Repair Technician",
    sector: "electronics",
    nsqf_level: 2,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["electrical_basic", "tool_handling", "customer_service", "digital_basics"],
    physical_demands: ["fine_motor"],
    feeds_from: ["electrician", "student", "mechanic", "street-vendor"],
    career_path: ["mobile_repair_tech"],
    business: [
      { id: "mobile_repair_kiosk", skills: ["electrical_basic", "customer_service", "sales_handling", "inventory_mgmt"], tools: ["repair toolkit", "spare-parts supplier contact"], schemes: ["PM MUDRA (Shishu)", "PMEGP"] },
    ],
  },
  {
    id: "field_technician_electrical",
    title: "Field Technician — Electrical",
    sector: "construction",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["electrical_basic", "electrical_diagnostics", "tool_handling", "safety_compliance"],
    physical_demands: ["standing", "outdoor"],
    feeds_from: ["electrician", "construction-labour"],
    career_path: ["field_technician_electrical", "solar_field_technician"],
    business: [
      { id: "electrical_contracting", skills: ["electrical_basic", "electrical_diagnostics", "customer_service", "bookkeeping"], tools: ["electrician toolkit"], schemes: ["PM MUDRA (Kishor)", "PMEGP"] },
    ],
  },
  {
    id: "mason_general",
    title: "Mason General",
    sector: "construction",
    nsqf_level: 2,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["masonry", "concrete_work", "tool_handling", "safety_compliance"],
    physical_demands: ["standing", "heavy_lifting", "outdoor"],
    feeds_from: ["construction-labour", "leather-worker", "waste-picker"],
    career_path: ["mason_general"],
    business: [
      { id: "masonry_contracting", skills: ["masonry", "concrete_work", "bookkeeping", "communication"], tools: ["masonry tools"], schemes: ["PM MUDRA", "PMEGP"] },
    ],
  },
  {
    id: "beauty_therapist",
    title: "Beauty Therapist",
    sector: "beauty",
    nsqf_level: 2,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["beauty_services", "skin_hair_care", "hygiene_practices", "customer_service"],
    physical_demands: ["standing", "fine_motor"],
    feeds_from: ["beautician", "domestic-worker", "homemaker"],
    career_path: ["beauty_therapist"],
    business: [
      { id: "home_salon", skills: ["beauty_services", "customer_service", "bookkeeping", "sales_handling"], tools: ["beauty kit", "home space or salon rental"], schemes: ["PM MUDRA (Shishu)", "PMEGP"] },
    ],
  },
  {
    id: "food_service_steward",
    title: "Food & Beverage Service Steward",
    sector: "food",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["customer_service", "food_safety", "food_prep", "communication"],
    physical_demands: ["standing"],
    feeds_from: ["street-vendor", "domestic-worker", "student", "unemployed"],
    career_path: ["food_service_steward"],
    business: [
      { id: "food_stall_catering", skills: ["food_prep", "food_safety", "sales_handling", "bookkeeping"], tools: ["cooking setup", "vendor license (check local rules)"], schemes: ["PM SVANidhi (street vendors)", "PM MUDRA"] },
    ],
  },
  {
    id: "organic_grower",
    title: "Organic Grower",
    sector: "agri",
    nsqf_level: 2,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["crop_cultivation", "soil_management", "irrigation", "sales_handling"],
    physical_demands: ["outdoor", "heavy_lifting"],
    feeds_from: ["farmer", "agri-labour", "waste-picker"],
    career_path: ["organic_grower"],
    business: [
      { id: "organic_veg_supply", skills: ["crop_cultivation", "soil_management", "sales_handling", "bookkeeping"], tools: ["land or lease", "compost setup"], schemes: ["Paramparagat Krishi Vikas Yojana (verify)", "PM MUDRA"] },
    ],
  },
  {
    id: "dairy_farmer_ent",
    title: "Dairy Farmer / Dairy Entrepreneur",
    sector: "agri",
    nsqf_level: 2,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["animal_care", "dairy_processing", "sales_handling", "bookkeeping"],
    physical_demands: ["outdoor", "heavy_lifting"],
    feeds_from: ["dairy", "farmer", "agri-labour"],
    career_path: ["dairy_farmer_ent"],
    business: [
      { id: "dairy_unit", skills: ["animal_care", "dairy_processing", "bookkeeping", "sales_handling"], tools: ["cattle shed", "chilling/collection tie-up"], schemes: ["Dairy Entrepreneurship Development Scheme (verify)", "NABARD subsidy schemes (verify)"] },
    ],
  },
  {
    id: "data_entry_operator",
    title: "Data Entry Operator",
    sector: "it",
    nsqf_level: 3,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["digital_basics", "data_entry", "communication", "bookkeeping"],
    physical_demands: ["fine_motor"],
    feeds_from: ["student", "unemployed", "homemaker"],
    career_path: ["data_entry_operator"],
    business: [],
  },
  {
    id: "bamboo_craft_artisan_ent",
    title: "Bamboo Craft Artisan (Enterprise)",
    sector: "handicrafts",
    nsqf_level: 2,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["bamboo_craft", "craft_making", "inventory_mgmt", "sales_handling"],
    physical_demands: ["fine_motor"],
    feeds_from: ["artisan", "handloom-weaver", "waste-picker"],
    career_path: ["bamboo_craft_artisan_ent"],
    business: [
      { id: "craft_sales_coop", skills: ["craft_making", "bamboo_craft", "sales_handling", "bookkeeping"], tools: ["workspace", "online/offline sales channel"], schemes: ["SFURTI cluster scheme (verify)", "PMEGP"] },
    ],
  },
  {
    id: "leather_goods_maker",
    title: "Leather Goods Maker",
    sector: "handicrafts",
    nsqf_level: 2,
    qp_ref: null,
    qp_source_url: null,
    verification: "prototype",
    competencies: ["leather_work", "craft_making", "tool_handling", "sales_handling"],
    physical_demands: ["fine_motor"],
    feeds_from: ["leather-worker", "artisan"],
    career_path: ["leather_goods_maker"],
    business: [
      { id: "leather_products_unit", skills: ["leather_work", "craft_making", "sales_handling", "bookkeeping"], tools: ["stitching tools", "leather supplier"], schemes: ["Indian Leather Development Programme (verify)", "PMEGP"] },
    ],
  },
];

export const ROLE_IDS = JOB_ROLES.map((r) => r.id);

export function roleById(id: string): JobRole | undefined {
  return JOB_ROLES.find((r) => r.id === id);
}

/** Roles most relevant for a given livelihood (prototype affinity). */
export function rolesForLivelihood(liv: LivelihoodId): JobRole[] {
  const direct = JOB_ROLES.filter((r) => r.feeds_from.includes(liv));
  return direct;
}

/** Prototype-mapping badge state every role must surface in the UI. */
export const PROTOTYPE_NOTICE_KEY = "nsqf.prototypeNotice";
