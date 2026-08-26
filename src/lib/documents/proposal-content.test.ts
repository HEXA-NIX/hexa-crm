import { describe, expect, it } from "vitest";
import { parseProposalContent, serializeProposalContent } from "./proposal-content";

describe("proposal content", () => {
  it("stores a dedicated title without breaking legacy proposal bodies", () => {
    const stored = serializeProposalContent("Motor comercial", "## Contexto\nDescripción");
    expect(parseProposalContent(stored)).toEqual({ title: "Motor comercial", body: "## Contexto\nDescripción", technologies: {} });
    expect(parseProposalContent("Texto antiguo")).toEqual({ title: "", body: "Texto antiguo", technologies: {} });
  });
});
