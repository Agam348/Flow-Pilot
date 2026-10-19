export const EXPENSE_FIELDS = ["suppliers", "payroll", "rent", "other"];

export function validateCase(data) {
  if (!data?.business || !Array.isArray(data.weeks) || data.weeks.length === 0) {
    throw new Error("Case must include business details and at least one forecast week.");
  }
  const required = ["openingCash", "cashReserve", "monthlyReceipts", "monthsOperating", "confirmedReceivables", "fundingNeed"];
  for (const key of required) {
    if (!Number.isFinite(data.business[key]) || data.business[key] < 0) throw new Error(`Invalid business input: ${key}`);
  }
  data.weeks.forEach((row, i) => {
    if (!Number.isFinite(Number(row.receipts)) || Number(row.receipts) < 0) throw new Error(`Week ${i + 1}: receipts must be a non-negative number.`);
    for (const field of EXPENSE_FIELDS) {
      if (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0) throw new Error(`Week ${i + 1}: ${field} must be a non-negative number.`);
    }
  });
  return true;
}

export function forecast(data, { receiptMultiplier = 1, oneOffOutflow = 0, oneOffWeek = 1 } = {}) {
  validateCase(data);
  if (!Number.isFinite(receiptMultiplier) || receiptMultiplier < 0 || receiptMultiplier > 2) throw new Error("Receipt multiplier must be between 0 and 2.");
  if (!Number.isFinite(oneOffOutflow) || oneOffOutflow < 0) throw new Error("One-off outflow must be non-negative.");
  let cash = data.business.openingCash;
  return data.weeks.map((row, index) => {
    const receipts = Math.round(Number(row.receipts) * receiptMultiplier);
    const expenses = EXPENSE_FIELDS.reduce((sum, field) => sum + Number(row[field]), 0) + (index + 1 === oneOffWeek ? oneOffOutflow : 0);
    const opening = cash;
    cash = opening + receipts - expenses;
    return { week: Number(row.week ?? index + 1), starting: row.starting, opening, receipts, expenses, net: receipts - expenses, closing: cash, reserve: data.business.cashReserve, belowReserve: cash < data.business.cashReserve };
  });
}

export function firstReserveBreach(rows) { return rows.find(row => row.belowReserve) ?? null; }

export function summarizeForecast(rows) {
  if (!rows.length) throw new Error("Forecast has no rows.");
  const min = rows.reduce((best, row) => row.closing < best.closing ? row : best, rows[0]);
  return { endingCash: rows.at(-1).closing, minimumCash: min.closing, minimumWeek: min.week, firstBreach: firstReserveBreach(rows), positiveCashThroughout: rows.every(row => row.closing >= 0) };
}

export function monthlyPayment(principal, annualRate, termMonths) {
  if (![principal, annualRate, termMonths].every(Number.isFinite) || principal <= 0 || annualRate < 0 || termMonths <= 0) throw new Error("Loan inputs must be positive; APR cannot be negative.");
  const rate = annualRate / 12;
  if (rate === 0) return principal / termMonths;
  return principal * rate / (1 - (1 + rate) ** -termMonths);
}

export function compareFinancing(data, requestedAmount = data.business.fundingNeed) {
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) throw new Error("Requested amount must be a positive number.");
  const b = data.business;
  return (data.financingOptions ?? []).map(option => {
    const cap = option.id === "invoice-finance" ? Math.min(option.maxAmount, b.confirmedReceivables) : option.maxAmount;
    const funded = Math.min(requestedAmount, cap);
    const amountEligible = cap >= requestedAmount;
    const revenueEligible = b.monthlyReceipts >= option.minMonthlyReceipts;
    const tenureEligible = b.monthsOperating >= option.minMonthsOperating;
    const payment = monthlyPayment(funded, option.apr, option.termMonths);
    const totalInterest = Math.max(0, payment * option.termMonths - funded);
    const fee = funded * option.feeRate;
    return {
      ...option,
      cap,
      funded,
      coverage: funded / requestedAmount,
      amountEligible,
      revenueEligible,
      tenureEligible,
      fullFit: amountEligible && revenueEligible && tenureEligible,
      partialFit: funded > 0 && revenueEligible && tenureEligible && !amountEligible,
      monthlyPayment: Math.round(payment),
      estimatedInterest: Math.round(totalInterest),
      estimatedFee: Math.round(fee),
      estimatedTotalCost: Math.round(totalInterest + fee),
      totalRepayment: Math.round(funded + totalInterest + fee)
    };
  }).sort((a, bOption) => Number(bOption.fullFit) - Number(a.fullFit) || a.estimatedTotalCost - bOption.estimatedTotalCost);
}

export function buildLenderPack(data, rows, options) {
  const summary = summarizeForecast(rows);
  return {
    generatedAt: new Date().toISOString(),
    case: "synthetic demonstration data",
    business: data.business.name,
    currency: data.business.currency,
    requestedAmount: data.business.fundingNeed,
    openingCash: data.business.openingCash,
    cashReserve: data.business.cashReserve,
    endingCash: summary.endingCash,
    minimumForecastCash: summary.minimumCash,
    minimumForecastWeek: summary.minimumWeek,
    firstReserveBreachWeek: summary.firstBreach?.week ?? null,
    monthlyReceipts: data.business.monthlyReceipts,
    monthsOperating: data.business.monthsOperating,
    forecast: rows,
    financingComparison: options.map(({name, cap, funded, coverage, fullFit, partialFit, monthlyPayment, estimatedFee, estimatedInterest, estimatedTotalCost, totalRepayment, note}) => ({name, cap, funded, coverage, fullFit, partialFit, monthlyPayment, estimatedFee, estimatedInterest, estimatedTotalCost, totalRepayment, note})),
    limitations: ["Synthetic case; not an actual business record.", "Financing options and terms are illustrative only and are not live lender offers.", "This summary is not a credit decision or loan approval."]
  };
}

export function parseForecastCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines.shift()?.split(",").map(value => value.trim().toLowerCase()) ?? [];
  const required = ["week", "receipts", ...EXPENSE_FIELDS];
  const missing = required.filter(name => !headers.includes(name));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);
  const parsed = lines.filter(Boolean).map((line, index) => {
    const values = line.split(",").map(value => value.trim());
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} values; expected ${headers.length}.`);
    const record = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
    const row = Object.fromEntries(["week", "receipts", ...EXPENSE_FIELDS].map(key => [key, Number(record[key])])) ;
    if (record.starting) row.starting = record.starting;
    return row;
  });
  if (!parsed.length) throw new Error("CSV contains no forecast rows.");
  parsed.forEach((row, index) => {
    if (!Number.isInteger(row.week) || row.week < 1) throw new Error(`CSV row ${index + 2}: week must be a positive integer.`);
    for (const key of ["receipts", ...EXPENSE_FIELDS]) if (!Number.isFinite(row[key]) || row[key] < 0) throw new Error(`CSV row ${index + 2}: ${key} must be non-negative numeric data.`);
  });
  return parsed;
}

export function routeIntent(text) {
  const query = String(text).trim().toLowerCase();
  const percent = query.match(/(\d+(?:\.\d+)?)\s*%/);
  if (/stress|fall|drop|lower|decline|down/.test(query) && percent) return { intent: "stress", percent: Number(percent[1]) };
  const amount = query.replace(/,/g, "").match(/(?:thb|฿)?\s*(\d{4,})/i);
  if (/loan|financ|fund|borrow|compare/.test(query)) return { intent: "compare", amount: amount ? Number(amount[1]) : null };
  if (/why|explain|alert|risk|reserve|shortfall/.test(query)) return { intent: "explain" };
  if (/pack|export|lender|application|summary/.test(query)) return { intent: "pack" };
  if (/forecast|cash|runway|projection/.test(query)) return { intent: "forecast" };
  return { intent: "help" };
}
