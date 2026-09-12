import type { Beneficiary } from "./model";
import { COURSE_SEED } from "./courses";

const BEN_KEY = "skillsetu.beneficiaries";

export function loadDemoBeneficiaries(): Beneficiary[] {
  try {
    const raw = localStorage.getItem(BEN_KEY);
    return raw ? (JSON.parse(raw) as Beneficiary[]) : DEMO_BENEFICIARIES;
  } catch {
    return DEMO_BENEFICIARIES;
  }
}

export function saveDemoBeneficiaries(list: Beneficiary[]) {
  try {
    localStorage.setItem(BEN_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function addDemoBeneficiary(b: Beneficiary) {
  const list = loadDemoBeneficiaries();
  list.unshift({ ...b, id: crypto.randomUUID() });
  saveDemoBeneficiaries(list);
}

const DEMO_BENEFICIARIES: Beneficiary[] = [
  {
    id: "demo1",
    name: "Sunita Meshram",
    age: 24,
    gender: "female",
    phone: "9812345670",
    state: "Maharashtra",
    district: "Nagpur",
    category: "sc",
    income: 72000,
    work_type: "tailor",
    education: "secondary",
    skills: "stitching, embroidery",
    interest: "fashion design",
    created_at: new Date(Date.now() - 3 * 864e5).toISOString(),
  },
  {
    id: "demo2",
    name: "Ramesh Bhalerao",
    age: 28,
    gender: "male",
    phone: "9812345671",
    state: "Maharashtra",
    district: "Gadchiroli",
    category: "sc",
    income: 60000,
    work_type: "artisan",
    education: "primary",
    skills: "bamboo craft",
    interest: "handicrafts business",
    created_at: new Date(Date.now() - 6 * 864e5).toISOString(),
  },
  {
    id: "demo3",
    name: "K. Lakshmi",
    age: 22,
    gender: "female",
    phone: "9812345672",
    state: "Telangana",
    district: "Hyderabad",
    category: "sc",
    income: 90000,
    work_type: "homemaker",
    education: "senior",
    skills: "cooking",
    interest: "beauty & wellness",
    created_at: new Date(Date.now() - 1 * 864e5).toISOString(),
  },
  {
    id: "demo4",
    name: "Mohan Kumbhar",
    age: 31,
    gender: "male",
    phone: "9812345673",
    state: "Maharashtra",
    district: "Nagpur",
    category: "sc",
    income: 84000,
    work_type: "mechanic",
    education: "secondary",
    skills: "two-wheeler repair",
    interest: "electric vehicles",
    created_at: new Date(Date.now() - 9 * 864e5).toISOString(),
  },
  {
    id: "demo5",
    name: "P. Anitha",
    age: 19,
    gender: "female",
    phone: "9812345674",
    state: "Andhra Pradesh",
    district: "Guntur",
    category: "sc",
    income: 48000,
    work_type: "student",
    education: "senior",
    skills: "basic computer",
    interest: "IT jobs",
    created_at: new Date(Date.now() - 2 * 864e5).toISOString(),
  },
];

export const DEMO_COURSES = COURSE_SEED;
