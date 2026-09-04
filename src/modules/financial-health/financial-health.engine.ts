import { Prisma } from "@prisma/client";

export const FINANCIAL_HEALTH_VERSION = "financial-health-v1";

export type FinancialHealthDimensionId =
  | "LIQUIDITY"
  | "DEBT"
  | "SPENDING_CONTROL"
  | "SAVINGS"
  | "PAYMENT_COMPLIANCE";

export type FinancialHealthBand =
  | "SOLID"
  | "STABLE"
  | "ATTENTION"
  | "FRAGILE"
  | "INSUFFICIENT";

export type DecimalLike = Prisma.Decimal | string | number;

export interface FinancialHealthInput {
  currency: string;
  liquidAvailable: DecimalLike;
  monthlyExpenseReference: DecimalLike | null;
  totalDebt: DecimalLike;
  monthlyIncomeReference: DecimalLike | null;
  budgetAmount: DecimalLike;
  projectedBudgetSpend: DecimalLike;
  periodIncome: DecimalLike;
  periodExpenses: DecimalLike;
  paymentsDue: number;
  paymentsOnTime: number;
  paymentsLateOrMissed: number;
}

export interface FinancialHealthDimension {
  id: FinancialHealthDimensionId;
  label: string;
  score: number | null;
  available: boolean;
  status: FinancialHealthBand;
  summary: string;
  explanation: string;
  metrics: Record<string, string | number | null>;
  action: { label: string; url: string } | null;
}

export interface FinancialHealthResult {
  version: typeof FINANCIAL_HEALTH_VERSION;
  score: number | null;
  band: FinancialHealthBand;
  coverage: number;
  availableDimensions: number;
  dimensions: FinancialHealthDimension[];
  recommendations: Array<{
    dimension: FinancialHealthDimensionId;
    title: string;
    detail: string;
    action: { label: string; url: string };
  }>;
  methodology: {
    version: typeof FINANCIAL_HEALTH_VERSION;
    aggregation: string;
    rules: string[];
    disclaimer: string;
  };
}

const D = (value: DecimalLike) => new Prisma.Decimal(value);
const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);
const percent = (value: Prisma.Decimal) => value.mul(100).toDecimalPlaces(2).toNumber();
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const roundedScore = (value: number) => Math.round(clamp(value));

const bandFor = (score: number | null): FinancialHealthBand => {
  if (score === null) return "INSUFFICIENT";
  if (score >= 80) return "SOLID";
  if (score >= 60) return "STABLE";
  if (score >= 40) return "ATTENTION";
  return "FRAGILE";
};

const money = (value: Prisma.Decimal, currency: string) => `${fixed(value)} ${currency}`;

function liquidityDimension(input: FinancialHealthInput): FinancialHealthDimension {
  const available = Prisma.Decimal.max(D(input.liquidAvailable), 0);
  const reference = input.monthlyExpenseReference === null ? null : D(input.monthlyExpenseReference);
  if (!reference || reference.lte(0)) {
    return {
      id: "LIQUIDITY",
      label: "Liquidez",
      score: null,
      available: false,
      status: "INSUFFICIENT",
      summary: "Aún no hay historial suficiente para estimar cobertura de gastos.",
      explanation:
        "Fynar necesita al menos un mes razonablemente representativo de gastos para comparar la liquidez disponible.",
      metrics: {
        liquidAvailable: fixed(available),
        monthlyExpenseReference: reference ? fixed(reference) : null,
        coverageMonths: null,
      },
      action: { label: "Ver cuentas", url: "/app/accounts" },
    };
  }

  const coverageMonths = available.div(reference);
  // Regla v1: tres meses de gasto cubiertos representan el máximo de esta dimensión.
  const score = roundedScore(coverageMonths.div(3).mul(100).toNumber());
  return {
    id: "LIQUIDITY",
    label: "Liquidez",
    score,
    available: true,
    status: bandFor(score),
    summary:
      coverageMonths.gte(3)
        ? "La liquidez disponible cubre al menos tres meses del gasto de referencia."
        : `La liquidez disponible cubre aproximadamente ${coverageMonths.toDecimalPlaces(1).toFixed(1)} meses de gasto.`,
    explanation:
      "Se compara el dinero líquido realmente disponible —descontando reservas de metas— con el gasto mensual de referencia de los últimos 90 días.",
    metrics: {
      liquidAvailable: fixed(available),
      monthlyExpenseReference: fixed(reference),
      coverageMonths: coverageMonths.toDecimalPlaces(2).toNumber(),
    },
    action: score < 60 ? { label: "Revisar cuentas", url: "/app/accounts" } : null,
  };
}

function debtDimension(input: FinancialHealthInput): FinancialHealthDimension {
  const debt = Prisma.Decimal.max(D(input.totalDebt), 0);
  const monthlyIncome = input.monthlyIncomeReference === null ? null : D(input.monthlyIncomeReference);
  if (debt.eq(0)) {
    return {
      id: "DEBT",
      label: "Endeudamiento",
      score: 100,
      available: true,
      status: "SOLID",
      summary: "No hay saldo de deuda activo en la moneda base.",
      explanation:
        "La dimensión compara deuda activa con ingreso anualizado. Sin deuda activa, la exposición por endeudamiento es mínima.",
      metrics: {
        totalDebt: "0.00",
        monthlyIncomeReference: monthlyIncome ? fixed(monthlyIncome) : null,
        debtToAnnualIncome: 0,
      },
      action: null,
    };
  }
  if (!monthlyIncome || monthlyIncome.lte(0)) {
    return {
      id: "DEBT",
      label: "Endeudamiento",
      score: null,
      available: false,
      status: "INSUFFICIENT",
      summary: "Hay deuda activa, pero todavía no existe un ingreso de referencia suficiente para dimensionarla.",
      explanation:
        "Fynar conserva el saldo real de deuda, pero no penaliza la puntuación por falta de historial de ingresos. La dimensión se habilita cuando existe un ingreso mensual de referencia positivo.",
      metrics: {
        totalDebt: fixed(debt),
        monthlyIncomeReference: monthlyIncome ? fixed(monthlyIncome) : null,
        debtToAnnualIncome: null,
      },
      action: { label: "Revisar deudas", url: "/app/commitments" },
    };
  }

  const annualIncome = monthlyIncome.mul(12);
  const ratio = debt.div(annualIncome);
  // Regla v1: el puntaje cae linealmente hasta cero cuando la deuda equivale a un año de ingreso de referencia.
  const score = roundedScore(D(1).minus(Prisma.Decimal.min(ratio, 1)).mul(100).toNumber());
  return {
    id: "DEBT",
    label: "Endeudamiento",
    score,
    available: true,
    status: bandFor(score),
    summary: `La deuda activa equivale al ${percent(ratio)}% del ingreso anualizado de referencia.`,
    explanation:
      "Se suman deudas activas y cuentas de naturaleza pasivo sin duplicar deudas vinculadas a una cuenta. El resultado se compara con doce meses del ingreso de referencia.",
    metrics: {
      totalDebt: fixed(debt),
      monthlyIncomeReference: fixed(monthlyIncome),
      debtToAnnualIncome: ratio.toDecimalPlaces(4).toNumber(),
    },
    action: score < 60 ? { label: "Revisar deudas", url: "/app/commitments" } : null,
  };
}

function spendingDimension(input: FinancialHealthInput): FinancialHealthDimension {
  const amount = D(input.budgetAmount);
  const projected = D(input.projectedBudgetSpend);
  if (amount.lte(0)) {
    return {
      id: "SPENDING_CONTROL",
      label: "Control del gasto",
      score: null,
      available: false,
      status: "INSUFFICIENT",
      summary: "No hay presupuestos activos aplicables al periodo actual.",
      explanation:
        "Esta versión mide el control del gasto con presupuestos reales para no duplicar la dimensión de ahorro ni inventar un límite de gasto.",
      metrics: {
        budgetAmount: "0.00",
        projectedBudgetSpend: "0.00",
        projectedUtilization: null,
      },
      action: { label: "Crear o revisar presupuestos", url: "/app/budgets" },
    };
  }

  const utilization = projected.div(amount);
  // Cumplir el presupuesto conserva 100; el exceso proyectado reduce el puntaje linealmente hasta 0 al duplicarlo.
  const excess = Prisma.Decimal.max(utilization.minus(1), 0);
  const score = roundedScore(D(1).minus(Prisma.Decimal.min(excess, 1)).mul(100).toNumber());
  return {
    id: "SPENDING_CONTROL",
    label: "Control del gasto",
    score,
    available: true,
    status: bandFor(score),
    summary:
      utilization.lte(1)
        ? "Los presupuestos activos se proyectan dentro de su monto definido."
        : `El gasto proyectado representa el ${percent(utilization)}% de los presupuestos activos.`,
    explanation:
      "Se utiliza la proyección de cada presupuesto del periodo. Estar dentro del monto definido no se penaliza; superar el total reduce la dimensión de forma proporcional.",
    metrics: {
      budgetAmount: fixed(amount),
      projectedBudgetSpend: fixed(projected),
      projectedUtilization: utilization.toDecimalPlaces(4).toNumber(),
    },
    action: score < 80 ? { label: "Revisar presupuestos", url: "/app/budgets" } : null,
  };
}

function savingsDimension(input: FinancialHealthInput): FinancialHealthDimension {
  const income = D(input.periodIncome);
  const expenses = D(input.periodExpenses);
  if (income.lte(0)) {
    return {
      id: "SAVINGS",
      label: "Ahorro",
      score: null,
      available: false,
      status: "INSUFFICIENT",
      summary: "El periodo actual no tiene ingresos confirmados suficientes para medir una tasa de ahorro.",
      explanation: "Fynar no inventa ingresos ni calcula una tasa de ahorro dividiendo por cero.",
      metrics: {
        periodIncome: fixed(income),
        periodExpenses: fixed(expenses),
        savingsRate: null,
      },
      action: { label: "Ver metas", url: "/app/goals" },
    };
  }

  const net = income.minus(expenses);
  const rate = net.div(income);
  // Regla v1: una tasa de ahorro del 20% o superior alcanza el máximo de esta dimensión.
  const score = roundedScore(Prisma.Decimal.max(rate, 0).div("0.20").mul(100).toNumber());
  return {
    id: "SAVINGS",
    label: "Ahorro",
    score,
    available: true,
    status: bandFor(score),
    summary:
      rate.gte(0)
        ? `El saldo entre ingresos y gastos del periodo equivale al ${percent(rate)}% de los ingresos.`
        : `Los gastos del periodo superan los ingresos en ${money(net.abs(), input.currency)}.`,
    explanation:
      "La tasa se calcula con ingresos y gastos confirmados del periodo actual. Es una medición de flujo; las reservas de metas no se cuentan como gasto ni como dinero nuevo.",
    metrics: {
      periodIncome: fixed(income),
      periodExpenses: fixed(expenses),
      netSavingsFlow: fixed(net),
      savingsRate: rate.toDecimalPlaces(4).toNumber(),
    },
    action: score < 60 ? { label: "Revisar metas", url: "/app/goals" } : null,
  };
}

function paymentsDimension(input: FinancialHealthInput): FinancialHealthDimension {
  if (input.paymentsDue <= 0) {
    return {
      id: "PAYMENT_COMPLIANCE",
      label: "Cumplimiento de pagos",
      score: null,
      available: false,
      status: "INSUFFICIENT",
      summary: "No hay vencimientos evaluables en la ventana reciente.",
      explanation:
        "Se necesitan pagos con fecha de vencimiento para medir cumplimiento. La ausencia de pagos no se interpreta automáticamente como 100 puntos.",
      metrics: {
        paymentsDue: 0,
        paymentsOnTime: 0,
        paymentsLateOrMissed: 0,
        onTimeRate: null,
      },
      action: { label: "Ver compromisos", url: "/app/commitments" },
    };
  }
  const rate = input.paymentsOnTime / input.paymentsDue;
  const score = roundedScore(rate * 100);
  return {
    id: "PAYMENT_COMPLIANCE",
    label: "Cumplimiento de pagos",
    score,
    available: true,
    status: bandFor(score),
    summary: `${input.paymentsOnTime} de ${input.paymentsDue} vencimientos recientes se pagaron a tiempo.`,
    explanation:
      "Se revisan vencimientos de obligaciones recurrentes y cuotas de deuda de los últimos 90 días. Un pago posterior a la fecha de vencimiento cuenta como tardío.",
    metrics: {
      paymentsDue: input.paymentsDue,
      paymentsOnTime: input.paymentsOnTime,
      paymentsLateOrMissed: input.paymentsLateOrMissed,
      onTimeRate: Number(rate.toFixed(4)),
    },
    action: score < 80 ? { label: "Revisar compromisos", url: "/app/commitments" } : null,
  };
}

export function buildFinancialHealth(input: FinancialHealthInput): FinancialHealthResult {
  const dimensions = [
    liquidityDimension(input),
    debtDimension(input),
    spendingDimension(input),
    savingsDimension(input),
    paymentsDimension(input),
  ];
  const available = dimensions.filter(
    (dimension): dimension is FinancialHealthDimension & { score: number } =>
      dimension.score !== null,
  );
  const coverage = Math.round((available.length / dimensions.length) * 100);
  const score =
    available.length >= 3
      ? Math.round(
          available.reduce((total, dimension) => total + dimension.score, 0) /
            available.length,
        )
      : null;
  const band = bandFor(score);

  const recommendationText: Record<
    FinancialHealthDimensionId,
    { title: string; detail: string }
  > = {
    LIQUIDITY: {
      title: "Fortalecer la liquidez disponible",
      detail: "Revisa cuánto dinero está libre después de reservas y compromisos próximos.",
    },
    DEBT: {
      title: "Revisar el peso de las deudas",
      detail: "Contrasta saldos activos y próximos pagos con tu ingreso de referencia.",
    },
    SPENDING_CONTROL: {
      title: "Ajustar presupuestos en riesgo",
      detail: "Prioriza los presupuestos cuya proyección supera el monto que definiste.",
    },
    SAVINGS: {
      title: "Recuperar margen de ahorro",
      detail:
        "Revisa la diferencia entre ingresos y gastos y dirige el margen disponible a tus objetivos.",
    },
    PAYMENT_COMPLIANCE: {
      title: "Evitar nuevos atrasos",
      detail: "Revisa vencimientos próximos y obligaciones que quedaron tardías o pendientes.",
    },
  };

  const recommendations = dimensions
    .filter(
      (dimension) =>
        dimension.action && (dimension.score === null || dimension.score < 60),
    )
    .sort((left, right) => (left.score ?? -1) - (right.score ?? -1))
    .slice(0, 3)
    .map((dimension) => ({
      dimension: dimension.id,
      ...recommendationText[dimension.id],
      action: dimension.action!,
    }));

  return {
    version: FINANCIAL_HEALTH_VERSION,
    score,
    band,
    coverage,
    availableDimensions: available.length,
    dimensions,
    recommendations,
    methodology: {
      version: FINANCIAL_HEALTH_VERSION,
      aggregation:
        "Promedio simple de las dimensiones disponibles. Todas pesan lo mismo en v1 para no privilegiar una dimensión sin evidencia de producto. Se requieren al menos 3 de 5 dimensiones para publicar puntuación general.",
      rules: [
        "Liquidez: cobertura de hasta 3 meses del gasto mensual de referencia.",
        "Endeudamiento: deuda activa frente al ingreso anualizado de referencia; sin ingreso de referencia suficiente, la dimensión no puntúa.",
        "Control del gasto: cumplimiento de la proyección de presupuestos activos.",
        "Ahorro: flujo neto del periodo frente a ingresos confirmados; 20% alcanza el máximo de la dimensión.",
        "Pagos: proporción de vencimientos pagados a tiempo en los últimos 90 días.",
      ],
      disclaimer:
        "La salud financiera de Fynar es un indicador educativo basado en los datos registrados. No es un score crediticio ni un diagnóstico o recomendación financiera profesional.",
    },
  };
}
