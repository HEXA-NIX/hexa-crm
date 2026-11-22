export function payrollTotals(input: {
  gross_cents: number;
  employee_ss_cents: number;
  irpf_cents: number;
  other_deductions_cents: number;
  employer_ss_cents: number;
}) {
  const clean = (value: number) => Math.max(0, Math.round(Number(value) || 0));
  const gross = clean(input.gross_cents);
  const employeeSs = clean(input.employee_ss_cents);
  const irpf = clean(input.irpf_cents);
  const other = clean(input.other_deductions_cents);
  const employerSs = clean(input.employer_ss_cents);
  return {
    net_cents: Math.max(0, gross - employeeSs - irpf - other),
    total_cost_cents: gross + employerSs,
  };
}
