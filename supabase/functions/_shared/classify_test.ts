// deno test supabase/functions/_shared
import nodeAssert from "node:assert/strict";
import { classifyByFilename, isUnsure, normalizeName, normalizeReading, type DocumentType } from "./classify.ts";

const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);

// Realistic dealer uploads, French and English. null = the name is not enough, the AI decides.
const CASES: [string, DocumentType | null][] = [
  // ---- names that already sorted correctly and must keep working
  ["Talon de paie - juin.pdf", "pay_stub"],
  ["paystub_2026-09-15.jpg", "pay_stub"],
  ["relevé bancaire Desjardins.pdf", "bank_statement"],
  ["Bank Statement Aug.pdf", "bank_statement"],
  ["Permis de conduire recto.jpg", "id_verification"],
  ["carte assurance maladie.jpg", "id_verification"],
  ["Preuve d'assurance auto.pdf", "insurance"],
  ["insurance_binder.pdf", "insurance"],
  ["Facture véhicule RAV4.pdf", "vehicle_invoice"],
  ["Bill_of_Sale.pdf", "vehicle_invoice"],
  ["Demande de crédit signée.pdf", "credit_application"],
  ["credit-app.pdf", "credit_application"],
  ["Lettre d'emploi.pdf", "income_verification"],
  ["Avis de cotisation 2025.pdf", "income_verification"],
  ["trade-in payoff letter.pdf", "trade_in"],
  ["IMG_4402.jpg", null],
  ["scan0001.pdf", null],

  // ---- camelCase and digits glued to words
  ["PayStub2026.pdf", "pay_stub"],
  ["TalonDePaie.pdf", "pay_stub"],
  ["TalonDePaie_Sept2026.jpg", "pay_stub"],
  ["BankStatement-Aug.pdf", "bank_statement"],
  ["ReleveBancaire.pdf", "bank_statement"],
  ["DriversLicense.jpg", "id_verification"],
  ["PermisDeConduire.png", "id_verification"],
  ["BillOfSale.pdf", "vehicle_invoice"],
  ["CreditApplication.pdf", "credit_application"],
  ["EmploymentLetter.pdf", "income_verification"],
  ["T4_2025.pdf", "income_verification"],
  ["T4A 2025.pdf", "income_verification"],
  ["Releve1-2025.pdf", "income_verification"],
  ["RL-1 2025.pdf", "income_verification"],
  ["IMG20260915.jpg", null],

  // ---- a bare "facture"/"invoice" is not a vehicle invoice
  ["Facture Hydro-Québec.pdf", null],
  ["Facture Vidéotron.pdf", null],
  ["facture bell.pdf", null],
  ["Facture.pdf", null],
  ["invoice.pdf", null],
  ["Facture Rogers internet.pdf", null],
  ["facture_cellulaire.pdf", null],
  ["Facture vehicule.pdf", "vehicle_invoice"],
  ["Facture Toyota Corolla 2024.pdf", "vehicle_invoice"],
  ["Contrat de vente signé.pdf", "vehicle_invoice"],
  ["Bon de commande.pdf", "vehicle_invoice"],
  ["Purchase Agreement - Civic.pdf", "vehicle_invoice"],
  ["Buyer's Order.pdf", "vehicle_invoice"],
  ["Buyers_Order_2026.pdf", "vehicle_invoice"],
  ["Vehicle Invoice.pdf", "vehicle_invoice"],
  ["Offre d'achat.pdf", "vehicle_invoice"],
  ["Dealer invoice F-150.pdf", "vehicle_invoice"],

  // ---- insurance means proof of vehicle insurance
  ["assurance vie.pdf", null],
  ["Life Insurance Policy.pdf", null],
  ["privacy policy.pdf", null],
  ["Politique de confidentialité.pdf", null],
  ["Assurance salaire.pdf", null],
  ["Carte d'assurance sociale.jpg", null],
  ["Assurance emploi - relevé.pdf", "income_verification"],
  ["Relevé de prestations d'assurance-emploi.pdf", "income_verification"],
  ["Proof of insurance.pdf", "insurance"],
  ["Certificat d'assurance.pdf", "insurance"],
  ["Carte rose.jpg", "insurance"],
  ["pink slip.jpg", "insurance"],
  ["Insurance card Intact.jpg", "insurance"],
  ["Police d'assurance auto Desjardins.pdf", "insurance"],

  // ---- identity documents (a work or study permit is not ID)
  ["Permis de travail.pdf", null],
  ["Work Permit.pdf", null],
  ["Permis d'études.pdf", null],
  ["Passeport.jpg", "id_verification"],
  ["passport_photo_page.jpg", "id_verification"],
  ["Carte d'identité.jpg", "id_verification"],
  ["ID front.jpg", "id_verification"],
  ["Driver's licence back.jpg", "id_verification"],
  ["Carte soleil.jpg", "id_verification"],

  // ---- cheques are not pay stubs
  ["Talon de chèque.pdf", null],
  ["Chèque annulé.jpg", null],
  ["void cheque.pdf", null],
  ["Specimen.pdf", null],
  ["Spécimen de chèque Desjardins.pdf", null],

  // ---- credit-card statements are not bank statements
  ["Visa statement.pdf", null],
  ["Relevé Mastercard sept.pdf", null],
  ["Amex statement Aug.pdf", null],
  ["Relevé carte de crédit.pdf", null],
  ["credit card statement.pdf", null],
  ["Demande de carte de crédit.pdf", null],

  // ---- bank statements
  ["Relevé de compte août.pdf", "bank_statement"],
  ["État de compte.pdf", "bank_statement"],
  ["statement_2026_08.pdf", "bank_statement"],
  ["Releve Desjardins sept.pdf", "bank_statement"],
  ["eStatement TD.pdf", "bank_statement"],

  // ---- pay stubs and income documents
  ["Bulletin de paie.pdf", "pay_stub"],
  ["Earnings Statement ADP.pdf", "pay_stub"],
  ["payslip.pdf", "pay_stub"],
  ["Relevé de paie.pdf", "pay_stub"],
  ["Notice of Assessment 2025.pdf", "income_verification"],
  ["Lettre de pension RRQ.pdf", "income_verification"],
  ["Attestation d'emploi.pdf", "income_verification"],
  ["Record of Employment.pdf", "income_verification"],

  // ---- credit application and trade-in
  ["Formulaire de demande de crédit.pdf", "credit_application"],
  ["Véhicule d'échange.jpg", "trade_in"],
  ["Tradein_payoff.pdf", "trade_in"],

  // ---- nothing to go on
  ["Document1.pdf", null],
  ["Screenshot 2026-09-14 at 10.32.11.png", null],
  ["preuve de résidence.pdf", null],
  ["WhatsApp Image 2026-09-14.jpeg", null],
];

Deno.test(`file names sort ${CASES.length} realistic French and English uploads`, () => {
  nodeAssert.ok(CASES.length >= 80, "at least 80 cases");
  const wrong = CASES
    .map(([name, expected]) => ({ name, expected, got: classifyByFilename(name) }))
    .filter((c) => c.got !== c.expected);
  assertEquals(wrong, [], wrong.map((w) => `${w.name}: expected ${w.expected}, got ${w.got}`).join("\n"));
});

Deno.test("file names are split on camelCase and digits before matching", () => {
  assertEquals(normalizeName("PayStub2026.pdf"), "pay stub 2026");
  assertEquals(normalizeName("TalonDePaie.PDF"), "talon de paie");
  assertEquals(normalizeName("IDCard-Recto.jpg"), "id card recto");
  assertEquals(normalizeName("RelevéBancaire_Août.pdf"), "releve bancaire aout");
});

Deno.test("escalation is only for an unsure first pass", () => {
  const read = (o: Record<string, unknown>) => normalizeReading(o);
  // type still to be decided and the model is unsure
  nodeAssert.ok(isUnsure(read({ document_type: "insurance", type_confidence: "low" })));
  // the file name already decided the type: the type confidence doesn't matter
  nodeAssert.ok(!isUnsure(read({ document_type: "insurance", type_confidence: "low" }), "insurance"));
  // income figures missing or low-confidence on an income document
  nodeAssert.ok(isUnsure(read({ document_type: "other", type_confidence: "low" }), "pay_stub"));
  nodeAssert.ok(isUnsure(read({ document_type: "pay_stub", type_confidence: "high",
    income: { gross_pay: 100, confidence: "low" } }), "pay_stub"));
  nodeAssert.ok(!isUnsure(read({ document_type: "pay_stub", type_confidence: "high",
    income: { gross_pay: 100, confidence: "medium" } }), "pay_stub"));
});

Deno.test("dates from the model are validated", () => {
  const r = normalizeReading({ document_type: "pay_stub", income: { gross_pay: 1, pay_date: "2026-02-30", period_end: "2026-02-27" } });
  assertEquals(r.income?.pay_date, null);
  assertEquals(r.income?.period_end, "2026-02-27");
});
