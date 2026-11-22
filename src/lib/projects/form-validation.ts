import { parseEurosInput } from "$lib/money";

export function hasInvalidDateRange(startDate: string, endDate: string) {
  return Boolean(startDate && endDate && startDate > endDate);
}

export function hasInvalidMoneyInput(value: string) {
  if (!value.trim()) return false;
  const amount = parseEurosInput(value);
  return amount == null || amount < 0;
}
