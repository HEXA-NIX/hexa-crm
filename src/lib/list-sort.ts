export type SortDirection = "asc" | "desc";

/** Compares mixed table values consistently (empty values sort last). */
export function compareSortValues(a: unknown, b: unknown, direction: SortDirection = "asc"): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let result: number;
  if (typeof a === "number" && typeof b === "number") {
    result = a - b;
  } else {
    const aText = String(a).toLocaleLowerCase("es");
    const bText = String(b).toLocaleLowerCase("es");
    result = aText.localeCompare(bText, "es", { numeric: true, sensitivity: "base" });
  }
  return direction === "asc" ? result : -result;
}

export function sortedCopy<T>(items: readonly T[], getValue: (item: T) => unknown, direction: SortDirection): T[] {
  return [...items].sort((a, b) => compareSortValues(getValue(a), getValue(b), direction));
}
