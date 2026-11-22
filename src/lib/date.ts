export function formatDateES(value: string | Date | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const date = value instanceof Date
    ? value
    : /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))
      ? new Date(`${value.slice(0, 10)}T12:00:00`)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

export function formatDateTimeES(value: string | Date | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${formatDateES(date, fallback)} ${time}`;
}
