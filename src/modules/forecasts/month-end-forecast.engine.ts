import { Prisma } from "@prisma/client";

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const zero = () => D(0);
const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);

export type ForecastDataQuality = "PARTIAL" | "LOW" | "MEDIUM" | "HIGH";

export interface ForecastCashEvent {
  date: string;
  amount: Prisma.Decimal.Value;
  direction: "IN" | "OUT";
  label: string;
  source: "EXPECTED_INCOME" | "KNOWN_COMMITMENT";
}

export interface MonthEndForecastEngineInput {
  currency: string;
  currentAvailable: Prisma.Decimal.Value;
  expectedIncome: Prisma.Decimal.Value;
  knownCommitments: Prisma.Decimal.Value;
  historicalVariableExpense: Prisma.Decimal.Value;
  historyDays: number;
  daysRemaining: number;
  today: string;
  monthEnd: string;
  cashEvents: ForecastCashEvent[];
}

const qualityForHistory = (days: number): ForecastDataQuality => {
  if (days < 14) return "PARTIAL";
  if (days < 28) return "LOW";
  if (days < 45) return "MEDIUM";
  return "HIGH";
};

const eachDate = (from: string, to: string) => {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

export function buildMonthEndForecast(input: MonthEndForecastEngineInput) {
  const currentAvailable = D(input.currentAvailable);
  const expectedIncome = D(input.expectedIncome);
  const knownCommitments = D(input.knownCommitments);
  const historyExpense = D(input.historicalVariableExpense);
  const dataQuality = qualityForHistory(input.historyDays);
  const hasVariableEstimate = dataQuality !== "PARTIAL" && input.daysRemaining > 0;
  const dailyVariableExpense =
    hasVariableEstimate && input.historyDays > 0 ? historyExpense.div(input.historyDays) : zero();
  const estimatedVariableExpenses = hasVariableEstimate
    ? dailyVariableExpense.mul(input.daysRemaining)
    : null;
  const knownClosingBalance = currentAvailable.plus(expectedIncome).minus(knownCommitments);
  const projectedClosingBalance = estimatedVariableExpenses
    ? knownClosingBalance.minus(estimatedVariableExpenses)
    : knownClosingBalance;

  const eventsByDate = new Map<string, ForecastCashEvent[]>();
  for (const event of input.cashEvents) {
    const effectiveDate = event.date < input.today ? input.today : event.date;
    const items = eventsByDate.get(effectiveDate) ?? [];
    items.push(event);
    eventsByDate.set(effectiveDate, items);
  }

  let runningBalance = currentAvailable;
  let lowest = { date: input.today, amount: runningBalance };
  const timeline = eachDate(input.today, input.monthEnd).map((date) => {
    const dayEvents = eventsByDate.get(date) ?? [];
    for (const event of dayEvents) {
      runningBalance =
        event.direction === "IN"
          ? runningBalance.plus(event.amount)
          : runningBalance.minus(event.amount);
    }
    if (estimatedVariableExpenses && date !== input.today) {
      runningBalance = runningBalance.minus(dailyVariableExpense);
    }
    if (runningBalance.lt(lowest.amount)) lowest = { date, amount: runningBalance };
    return {
      date,
      projectedBalance: fixed(runningBalance),
      events: dayEvents.map((event) => ({
        date: event.date,
        direction: event.direction,
        amount: fixed(D(event.amount)),
        label: event.label,
        source: event.source,
      })),
    };
  });

  const limitations: string[] = [];
  if (!hasVariableEstimate)
    limitations.push(
      "Aún no hay suficiente historial de gastos con salida real de dinero para estimar el gasto cotidiano restante.",
    );
  if (input.cashEvents.every((event) => event.source !== "EXPECTED_INCOME"))
    limitations.push(
      "No hay ingresos futuros confirmados o programados para este mes; solo se suman los que Fynar conoce explícitamente.",
    );

  return {
    currency: input.currency,
    status: hasVariableEstimate ? ("COMPLETE" as const) : ("PARTIAL" as const),
    dataQuality,
    currentAvailable: fixed(currentAvailable),
    expectedIncome: fixed(expectedIncome),
    knownCommitments: fixed(knownCommitments),
    estimatedVariableExpenses: estimatedVariableExpenses
      ? fixed(estimatedVariableExpenses)
      : null,
    knownClosingBalance: fixed(knownClosingBalance),
    projectedClosingBalance: fixed(projectedClosingBalance),
    lowestProjectedBalance: {
      date: lowest.date,
      amount: fixed(lowest.amount),
    },
    historyDays: input.historyDays,
    daysRemaining: input.daysRemaining,
    assumptions: [
      "Solo se considera dinero disponible en cuentas de activo y se descuenta el dinero reservado en metas.",
      "Los compromisos conocidos incluyen cuotas, obligaciones recurrentes y pagos de tarjeta pendientes.",
      ...(hasVariableEstimate
        ? [
            `El gasto cotidiano restante usa el promedio diario de ${input.historyDays} días de gastos confirmados pagados desde cuentas de activo.`,
          ]
        : []),
      "La proyección es una estimación y no modifica saldos, movimientos ni presupuestos.",
    ],
    limitations,
    timeline,
  };
}
