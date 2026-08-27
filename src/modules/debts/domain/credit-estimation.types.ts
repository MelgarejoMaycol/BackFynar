import { Prisma } from "@prisma/client";
import type {
  AmortizationInstallment,
  DecimalInput,
  InterestRateBasis,
  PaymentFrequency,
} from "./credit-math.types.js";

export type EstimationSource = "PROVIDED" | "CALCULATED" | "ESTIMATED" | "UNKNOWN";
export type EstimationQuality =
  "EXACT" | "HIGH_ESTIMATE" | "MEDIUM_ESTIMATE" | "LOW_ESTIMATE" | "INSUFFICIENT_DATA";
export type EstimationAssumption =
  | "MONTHLY_PAYMENT_FREQUENCY"
  | "FIXED_PAYMENT_AMORTIZATION"
  | "CONSTANT_INTEREST_RATE"
  | "NO_UNMODELED_FEES_OR_INSURANCE";
export type EstimationIssue =
  "INSUFFICIENT_DATA" | "INCONSISTENT_INPUT" | "PAYMENT_TOO_LOW" | "RATE_NOT_SOLVABLE";

export interface EstimatedValue<T> {
  value: T | null;
  source: EstimationSource;
  quality: EstimationQuality;
  derivedFrom: readonly CreditEstimationField[];
}

export type CreditEstimationField =
  | "originalPrincipal"
  | "currentBalance"
  | "paymentAmount"
  | "periodicRate"
  | "totalInstallments"
  | "installmentsPaid"
  | "remainingInstallments"
  | "firstPaymentDate"
  | "estimatedEndDate";

export interface CreditEstimationInput {
  originalPrincipal?: DecimalInput;
  currentBalance?: DecimalInput;
  paymentAmount?: DecimalInput;
  periodicRate?: DecimalInput;
  interestRate?: DecimalInput;
  interestRateBasis?: InterestRateBasis;
  paymentFrequency?: PaymentFrequency;
  totalInstallments?: number;
  installmentsPaid?: number;
  remainingInstallments?: number;
  disbursementDate?: Date;
  firstPaymentDate?: Date;
  currentDate?: Date;
  estimatedEndDate?: Date;
}

export interface PaymentComparison {
  provided: Prisma.Decimal;
  calculated: Prisma.Decimal;
  absoluteDifference: Prisma.Decimal;
  percentageDifference: Prisma.Decimal;
  consistent: boolean;
}

export interface CreditEstimationResult {
  originalPrincipal: EstimatedValue<Prisma.Decimal>;
  currentBalance: EstimatedValue<Prisma.Decimal>;
  paymentAmount: EstimatedValue<Prisma.Decimal>;
  periodicRate: EstimatedValue<Prisma.Decimal>;
  totalInstallments: EstimatedValue<number>;
  installmentsPaid: EstimatedValue<number>;
  remainingInstallments: EstimatedValue<number>;
  estimatedEndDate: EstimatedValue<Date>;
  paymentComparison: PaymentComparison | null;
  estimatedSchedule: readonly AmortizationInstallment[] | null;
  assumptions: readonly EstimationAssumption[];
  issues: readonly EstimationIssue[];
  overallQuality: EstimationQuality;
}

export interface PeriodicRateSolverInput {
  principal: DecimalInput;
  paymentAmount: DecimalInput;
  numberOfInstallments: number;
  rateTolerance?: DecimalInput;
  moneyTolerance?: DecimalInput;
  maxIterations?: number;
  maximumRate?: DecimalInput;
}
