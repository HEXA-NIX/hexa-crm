import { describe, expect, it } from "vitest";
import { formatEUR } from "./money";

describe("formatEUR", () => {
  it("agrupa también los importes de cuatro cifras", () => {
    expect(formatEUR(600_000)).toContain("6.000,00");
  });
});
