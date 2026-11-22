import { describe, expect, it } from "vitest";
import { formatMoneyInput, parseMoneyInput } from "./money-input";

describe("money input", () => {
  it("separa miles y conserva decimales españoles", () => {
    expect(formatMoneyInput("1000000.25")).toBe("1.000.000,25");
    expect(parseMoneyInput("1.000.000,25")).toBe("1000000.25");
  });

  it("permite escribir la coma decimal progresivamente", () => {
    expect(formatMoneyInput("1250.")).toBe("1.250,");
  });
});
