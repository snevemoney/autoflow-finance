export function calcMonthlyFromExtraction(grossPay: number, frequency: string): number {
  switch (frequency) {
    case "weekly":
      return Math.round(grossPay * 4.33);
    case "biweekly":
      return Math.round(grossPay * 2.17);
    case "semimonthly":
      return Math.round(grossPay * 2);
    case "monthly":
      return grossPay;
    default:
      return grossPay;
  }
}

export const INCOME_DOC_TYPES = ["pay_stub", "bank_statement", "income_verification"] as const;

export function isIncomeDocType(type: string): boolean {
  return (INCOME_DOC_TYPES as readonly string[]).includes(type);
}
