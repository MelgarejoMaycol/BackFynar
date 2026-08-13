import { Prisma } from "@prisma/client";

export type DecimalInput = Prisma.Decimal | string | number;
export type InterestRateBasis =
  "EFFECTIVE_ANNUAL" | "NOMINAL_ANNUAL" | "EFFECTIVE_MONTHLY" | "NOMINAL_MONTHLY";

export interface FixedPaymentInput {
  principal: DecimalInput;
  periodicRate: DecimalInput;
  numberOfInstallments: number;
}

export interface InstallmentCalculationInput {
  openingBalance: DecimalInput;
  periodicRate: DecimalInput;
  paymentAmount: DecimalInput;
  finalInstallment?: boolean;
}

export interface InstallmentCalculation {
  interestAmount: Prisma.Decimal;
  principalAmount: Prisma.Decimal;
  paymentAmount: Prisma.Decimal;
  closingBalance: Prisma.Decimal;
}

export interface AmortizationScheduleInput extends FixedPaymentInput {
  firstPaymentDate: Date;
  paymentAmount?: DecimalInput;
  insuranceAmount?: DecimalInput;
  feeAmount?: DecimalInput;
}

export interface AmortizationInstallment {
  installmentNumber: number;
  dueDate: Date;
  openingBalance: Prisma.Decimal;
  principalAmount: Prisma.Decimal;
  interestAmount: Prisma.Decimal;
  insuranceAmount: Prisma.Decimal;
  feeAmount: Prisma.Decimal;
  paymentAmount: Prisma.Decimal;
  closingBalance: Prisma.Decimal;
}

export interface CreditTotals {
  totalPrincipal: Prisma.Decimal;
  totalInterest: Prisma.Decimal;
  totalInsurance: Prisma.Decimal;
  totalFees: Prisma.Decimal;
  totalCost: Prisma.Decimal;
}
