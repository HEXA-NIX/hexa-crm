export function parseMoneyInput(input: string): string {
  const cleaned = String(input ?? "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return "";
  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/-/g, "");
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  const separator = Math.max(lastComma, lastDot);
  const decimalCandidate = separator >= 0 ? unsigned.slice(separator + 1).replace(/\D/g, "") : "";
  const hasDecimal = separator >= 0 && (unsigned[separator] === "," || decimalCandidate.length <= 2) && decimalCandidate.length <= 2;
  const integer = (hasDecimal ? unsigned.slice(0, separator) : unsigned).replace(/\D/g, "").replace(/^0+(?=\d)/, "") || "0";
  const decimal = hasDecimal ? decimalCandidate.slice(0, 2) : "";
  return `${negative ? "-" : ""}${integer}${hasDecimal ? `.${decimal}` : ""}`;
}

export function formatMoneyInput(raw: string | number): string {
  const normalized = parseMoneyInput(String(raw ?? ""));
  if (!normalized) return "";
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace("-", "");
  const [integer, decimal] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}${normalized.includes(".") ? `,${decimal ?? ""}` : ""}`;
}

export function isMoneyLabel(label: string, placeholder = ""): boolean {
  return /€|\b(precio|coste|importe|bruto|capital|principal|valor(?:aci[oó]n)?|presupuesto|salario|n[oó]mina)\b/i.test(`${label} ${placeholder}`);
}
