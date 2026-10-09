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

/** lowercase, strip accents, turn separators into spaces */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/[_\-.+()[\]'’`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Order matters: the first matching rule wins (e.g. "assurance maladie" is a health card → ID).
const RULES: { type: DocumentType; patterns: RegExp[] }[] = [
  { type: "id_verification", patterns: [
    /\b(permis|driver'?s? ?licen[cs]e|licen[cs]e|passport|passeport|photo ?id|id ?card|carte d ?identite|assurance maladie|health card|carte soleil|ramq)\b/,
    /^(id|piece d ?identite|identite)( |$)/,
  ] },
  { type: "pay_stub", patterns: [
    /\b(pay ?stubs?|pay ?slips?|paystub|payslip|talons? de paie|talon|bulletins? de paie|releves? de paie|stub|paie)\b/,
  ] },
  { type: "income_verification", patterns: [
    /\b(employment ?letter|lettre d ?emploi|attestation d ?emploi|confirmation d ?emploi|t4|releve 1|rl ?1|notice of assessment|avis de cotisation|noa|pension|rentes?|benefits?|prestations?|ei statement|assurance emploi)\b/,
  ] },
  { type: "bank_statement", patterns: [
    /\b(bank ?statements?|releves? bancaires?|releves? de compte|etats? de compte|statements?)\b/,
  ] },
  { type: "credit_application", patterns: [
    /\b(credit ?app(lication)?|demande de credit|application de credit|credit ?form)\b/,
  ] },
  { type: "trade_in", patterns: [/\b(trade ?in|echange|vehicule d ?echange|payoff)\b/] },
  { type: "insurance", patterns: [
    /\b(insurance|assurances?|binder|pink ?slip|carte rose|certificat d ?assurance|policy|police d ?assurance)\b/,
  ] },
  { type: "vehicle_invoice", patterns: [
    /\b(invoice|facture|bill of sale|contrat de vente|bon de commande|purchase agreement|buyers? order|bos)\b/,
  ] },
];

/** Returns a type when the file name says clearly what it is, otherwise null. */
export function classifyByFilename(name: string): DocumentType | null {
  const n = normalizeName(name);
  if (!n) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(n))) return rule.type;
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
  return `File name: "${fileName}".

1. Classify the document as exactly one of:
   credit_application, income_verification (employment letter, T4/RL-1, notice of assessment, pension or benefit letter),
   pay_stub (talon de paie), bank_statement (relevé bancaire), vehicle_invoice (bill of sale, facture, purchase agreement),
   trade_in, insurance (proof of insurance, binder), id_verification (driver's licence, passport, health card), other.
2. If it is a pay_stub, bank_statement or income_verification, read the income figures.
   - gross_pay = gross pay for THIS pay period only (French: "salaire brut", "brut"), not year-to-date.
   - ytd_gross = year-to-date gross (French: "cumulatif", "cumul annuel", "depuis le début de l'année").
   - net_pay = take-home pay for the period ("net à payer").
   - pay_frequency from the period dates or wording: weekly, biweekly (every 2 weeks / aux deux semaines),
     semimonthly (twice a month), monthly.
   - Numbers as plain numbers with a dot for decimals (1 234,56 $ → 1234.56). Use null when not visible.

Return:
{"document_type": "...", "type_confidence": "high|medium|low",
 "income": null or {"gross_pay": number|null, "net_pay": number|null, "pay_frequency": "weekly|biweekly|semimonthly|monthly"|null,
   "pay_date": "YYYY-MM-DD"|null, "employer_name": string|null, "ytd_gross": number|null, "confidence": "high|medium|low"},
 "summary": "one short sentence describing the document, no personal numbers"}`;
}

export interface IncomeReading {
  gross_pay: number | null;
  net_pay: number | null;
  pay_frequency: PayFrequency | null;
  pay_date: string | null;
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

function toDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
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

/** Should a second, stronger model re-read this document? */
export function isUnsure(r: DocumentReading): boolean {
  if (r.type_confidence === "low") return true;
  if (INCOME_TYPES.includes(r.document_type)) {
    if (!r.income) return r.document_type === "pay_stub";
    return r.income.confidence === "low";
  }
  return false;
}
