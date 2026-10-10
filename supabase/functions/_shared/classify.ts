// Document sorting: free filename rules first (English + French), AI only when needed.
// Pure functions — no Deno or network APIs — so they are unit-tested from the app's test suite.

export const DOCUMENT_TYPES = [
  "credit_application",
  "income_verification",
  "pay_stub",
  "bank_statement",
  "vehicle_invoice",
  "trade_in",
  "insurance",
  "id_verification",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const INCOME_TYPES: DocumentType[] = ["pay_stub", "bank_statement", "income_verification"];
export const PAY_FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];
export type Confidence = "high" | "medium" | "low";

/**
 * "TalonDePaie_Sept2026.PDF" → "talon de paie sept 2026": strip the extension and accents,
 * split camelCase and letter/digit runs, lowercase, and turn separators into spaces.
 */
export function normalizeName(name: string): string {
  return name
    .replace(/\.[A-Za-z0-9]{2,5}$/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // payStub → pay Stub
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // IDCard → ID Card
    .replace(/([A-Za-z])(\d)/g, "$1 $2") // Stub2026 → Stub 2026
    .replace(/(\d)([A-Za-z])/g, "$1 $2") // 2026Stub → 2026 Stub
    .toLowerCase()
    .replace(/[_\-.+()[\]'’`,&#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const re = (words: string) => new RegExp(`\\b(?:${words})\\b`);

// Names that look like a known type but are not, so the AI decides: work/study permits are not
// ID, cheque stubs and void cheques are not pay stubs, and credit-card statements are not bank
// statements.
const NOT_SURE = re([
  "permis de? ?(?:travail|sejour|etudes?)", "work ?permits?", "study ?permits?",
  "talons? de cheques?", "cheques? annules?", "void(?:ed)? ?(?:cheques?|checks?)", "specimens?",
  "visa", "master ?cards?", "amex", "american express", "cartes? de credit", "credit ?cards?",
].join("|"));

// Words that make an "invoice"/"facture" a vehicle invoice.
const VEHICLE_CONTEXT = re([
  "vehicules?", "vehicles?", "auto", "automobiles?", "voitures?", "cars?", "camions?", "trucks?", "suv", "vus",
  "vin", "concessionnaires?", "dealers?", "dealerships?",
  "toyota", "honda", "ford", "chevrolet", "chevy", "gmc", "nissan", "hyundai", "kia", "mazda", "subaru",
  "volkswagen", "vw", "jeep", "dodge", "ram", "chrysler", "bmw", "mercedes", "audi", "lexus", "acura",
  "infiniti", "mitsubishi", "tesla", "buick", "cadillac", "lincoln", "volvo", "porsche", "genesis",
].join("|"));

// "assurance …" / "insurance …" that is not proof of vehicle insurance.
const NOT_VEHICLE_INSURANCE = re([
  "vie", "life", "emploi", "employment", "salaire", "invalidite", "disability", "voyage", "travel",
  "hypothecaire", "mortgage", "pret", "loan", "credit", "sociale", "social", "dentaire", "dental",
  "collective", "privacy", "confidentialite",
].join("|"));

type Rule = { type: DocumentType; test: (n: string) => boolean };
const matches = (r: RegExp, unless?: RegExp) => (n: string) => r.test(n) && !(unless && unless.test(n));

// Order matters: the first matching rule wins (e.g. "assurance maladie" is a health card → ID,
// "assurance emploi" is income, "relevé de paie" is a pay stub, not a bank statement).
const RULES: Rule[] = [
  { type: "id_verification", test: (n) =>
    matches(re([
      "permis", "permis de conduire", "drivers? ?s? ?licen[cs]es?", "driving ?licen[cs]es?", "licen[cs]es?",
      "passports?", "passeports?", "photo ?id", "id ?cards?", "cartes? d ?identite", "assurance maladie",
      "health ?cards?", "carte soleil", "ramq", "birth certificate", "certificat de naissance", "acte de naissance",
    ].join("|")), re("business|entreprise|commerce|rbq"))(n) || /^(?:id|piece d ?identite|identite)(?: |$)/.test(n) },
  { type: "pay_stub", test: matches(re([
    "pay ?stubs?", "pay ?slips?", "pay ?statements?", "pay ?cheq?ues?", "pay ?checks?", "earnings ?statements?",
    "statements? of earnings", "talons? de paie", "talons?", "bulletins? de paie", "releves? de paie",
    "cheques? de paie", "stubs?", "paie",
  ].join("|"))) },
  { type: "income_verification", test: matches(re([
    "employment ?letters?", "lettres? d ?emploi", "lettres? (?:de l )?employeur", "employer ?letters?", "job ?letters?",
    "attestations? d ?emploi", "confirmations? d ?emploi", "verification of employment", "verification d ?emploi",
    "contrat de travail", "employment contract", "offre d ?emploi", "job offer", "offer letter",
    "preuves? de revenus?", "proof of income", "attestations? de revenus?", "income ?letters?",
    "t ?4(?: ?a)?", "t ?1 general", "releve ?1", "rl ?1", "notice of assessment", "avis de cotisation", "noa",
    "declarations? de revenus?", "declarations? d ?impots?", "tax return",
    "pensions?", "rentes?", "rrq", "retraite quebec", "benefits?", "prestations?", "ei statement",
    "assurance emploi", "employment insurance", "releve d ?emploi", "record of employment", "roe",
    "aide sociale", "social assistance", "solidarite sociale", "allocations? familiales?", "child benefit",
  ].join("|"))) },
  { type: "trade_in", test: matches(
    re("trade ?ins?|vehicules? d ?echange|echange|payoff|pay off|lien payout"),
    re("courriels?|emails?|e mails?"),
  ) },
  { type: "bank_statement", test: matches(re([
    "bank ?statements?", "releves? bancaires?", "releves? de compte", "etats? de compte", "e ?statements?",
    "account ?statements?", "statements?", "historique (?:de|des) transactions", "transaction ?history",
    "releves? (?:desjardins|bnc|banque|rbc|td|bmo|scotia|scotiabank|cibc|tangerine|laurentienne|hsbc|koho|simplii|national|nationale)",
  ].join("|"))) },
  { type: "credit_application", test: matches(re([
    "credit ?app(?:lication)?s?", "demandes? de credit", "applications? de credit", "credit ?forms?",
    "formulaires? de credit", "demandes? de financement", "financing application", "loan application",
  ].join("|"))) },
  { type: "insurance", test: matches(
    re("insurance|assurances?|binders?|pink ?slips?|cartes? roses?|liability ?cards?|responsabilite civile"),
    NOT_VEHICLE_INSURANCE,
  ) },
  { type: "vehicle_invoice", test: (n) =>
    re([
      "bills? of sale", "bos", "contrats? de vente", "contrats? d ?achat", "bons? de commande", "purchase ?agreements?",
      "buyers? ?s? ?orders?", "offres? d ?achat", "sales ?contracts?", "vehicle ?invoices?", "dealer ?invoices?",
    ].join("|")).test(n)
    || (re("invoices?|factures?").test(n) && VEHICLE_CONTEXT.test(n)) },
];

/** Returns a type when the file name says clearly what it is, otherwise null (the AI decides). */
export function classifyByFilename(name: string): DocumentType | null {
  const n = normalizeName(name);
  if (!n || NOT_SURE.test(n)) return null;
  for (const rule of RULES) {
    if (rule.test(n)) return rule.type;
  }
  return null;
}

/** Does this document still need an AI pass? Non-income documents sorted by name do not. */
export function needsAi(type: DocumentType, autoFillIncome: boolean): boolean {
  if (type === "other") return true;
  return autoFillIncome && INCOME_TYPES.includes(type);
}

// ---------------------------------------------------------------- AI prompt + parsing
export const SYSTEM_PROMPT = `You sort and read documents for an auto-loan deal desk in Quebec, Canada.
Documents may be in English or French. Reply with ONE JSON object and nothing else.`;

export function userPrompt(fileName: string): string {
  return `File name: "${fileName.slice(0, 200)}".

1. Classify the document as exactly one of:
   credit_application, income_verification (employment letter, T4/RL-1, notice of assessment, pension or benefit letter),
   pay_stub (talon de paie), bank_statement (relevé bancaire), vehicle_invoice (vehicle bill of sale, dealer invoice, purchase agreement),
   trade_in, insurance (proof of vehicle insurance, binder), id_verification (driver's licence, passport, health card), other.
   These are "other": credit-card statements, void cheques / cheque specimens, utility or phone bills,
   life-insurance or privacy-policy documents, work or study permits.
2. If it is a pay_stub, bank_statement or income_verification, read the income figures.
   - gross_pay = gross pay for THIS pay period only (French: "salaire brut", "brut"), not year-to-date.
   - ytd_gross = year-to-date gross (French: "cumulatif", "cumul annuel", "depuis le début de l'année").
   - net_pay = take-home pay for the period ("net à payer").
   - pay_frequency from the period dates or wording: weekly, biweekly (every 2 weeks / aux deux semaines),
     semimonthly (twice a month), monthly.
   - pay_date = the pay (deposit) date; period_end = the last day of the pay period ("période se terminant le").
   - Numbers as plain numbers with a dot for decimals (1 234,56 $ → 1234.56). Use null when not visible.

Return:
{"document_type": "...", "type_confidence": "high|medium|low",
 "income": null or {"gross_pay": number|null, "net_pay": number|null, "pay_frequency": "weekly|biweekly|semimonthly|monthly"|null,
   "pay_date": "YYYY-MM-DD"|null, "period_end": "YYYY-MM-DD"|null, "employer_name": string|null, "ytd_gross": number|null,
   "confidence": "high|medium|low"},
 "summary": "one short sentence describing the document, no personal numbers"}`;
}

export interface IncomeReading {
  gross_pay: number | null;
  net_pay: number | null;
  pay_frequency: PayFrequency | null;
  pay_date: string | null;
  /** last day of the pay period, when the document shows it */
  period_end?: string | null;
  employer_name: string | null;
  ytd_gross: number | null;
  confidence: Confidence;
}

export interface DocumentReading {
  document_type: DocumentType;
  type_confidence: Confidence;
  income: IncomeReading | null;
  summary: string;
}

const conf = (v: unknown): Confidence => (v === "high" || v === "medium" || v === "low" ? v : "low");

/** "1 234,56 $" → 1234.56, "2,450.00" → 2450, junk → null */
export function toAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // comma is the decimal separator if followed by exactly 1-2 digits
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function toDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function normalizeReading(raw: Record<string, unknown>): DocumentReading {
  const t = String(raw.document_type ?? "").toLowerCase().trim();
  const document_type = (DOCUMENT_TYPES as readonly string[]).includes(t) ? (t as DocumentType) : "other";
  let income: IncomeReading | null = null;
  const inc = raw.income as Record<string, unknown> | null | undefined;
  if (inc && typeof inc === "object") {
    const freq = String(inc.pay_frequency ?? "").toLowerCase();
    income = {
      gross_pay: toAmount(inc.gross_pay),
      net_pay: toAmount(inc.net_pay),
      pay_frequency: (PAY_FREQUENCIES as readonly string[]).includes(freq) ? (freq as PayFrequency) : null,
      pay_date: toDate(inc.pay_date),
      period_end: toDate(inc.period_end),
      employer_name: typeof inc.employer_name === "string" && inc.employer_name.trim() ? inc.employer_name.trim().slice(0, 200) : null,
      ytd_gross: toAmount(inc.ytd_gross),
      confidence: conf(inc.confidence),
    };
    if (income.gross_pay == null && income.ytd_gross == null && income.net_pay == null) income = null;
  }
  return {
    document_type,
    type_confidence: conf(raw.type_confidence),
    income,
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 300) : "",
  };
}

/**
 * Should a second, stronger model re-read this document? Only when the first pass was unsure:
 * a low-confidence type (when the type is still to be decided), or an income document whose
 * figures came back missing (pay stub) or low-confidence. `knownType` is the type already
 * decided by a person or the file name; its confidence then doesn't matter.
 */
export function isUnsure(r: DocumentReading, knownType: DocumentType | null = null): boolean {
  if (!knownType && r.type_confidence === "low") return true;
  const type = knownType ?? r.document_type;
  if (INCOME_TYPES.includes(type)) {
    if (!r.income) return type === "pay_stub";
    return r.income.confidence === "low";
  }
  return false;
}
