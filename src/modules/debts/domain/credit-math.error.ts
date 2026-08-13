export type CreditMathErrorCode =
  | "INVALID_PRINCIPAL"
  | "INVALID_RATE"
  | "INVALID_TERM"
  | "INVALID_PAYMENT"
  | "INVALID_DATE"
  | "INVALID_AMOUNT"
  | "PAYMENT_TOO_LOW"
  | "CALCULATION_NOT_POSSIBLE"
  | "INSUFFICIENT_DATA"
  | "INCONSISTENT_INPUT"
  | "RATE_NOT_SOLVABLE"
  | "INVALID_RELATIONSHIP";

export class CreditMathError extends Error {
  constructor(public readonly code: CreditMathErrorCode) {
    super(code);
    this.name = "CreditMathError";
  }
}
