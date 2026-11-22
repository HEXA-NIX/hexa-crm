import { describe, expect, it } from "vitest";
import { normalizeProjectDocuments, projectDocumentHref, validateProjectDocuments } from "./project-documents";

describe("project documents", () => {
  it("validates required locations and rejects executable URLs", () => {
    expect(validateProjectDocuments([{ title: "PRD", kind: "link", location: "", notes: "" }])).toContain("ubicación");
    expect(validateProjectDocuments([{ title: "PRD", kind: "link", location: "javascript:alert(1)", notes: "" }])).toContain("segura");
    expect(validateProjectDocuments([{ title: "Notas", kind: "note", location: "", notes: "Texto" }])).toBeNull();
  });

  it("normalizes fields and only exposes web links as clickable", () => {
    const [document] = normalizeProjectDocuments([{ title: "  Diseño ", kind: "link", location: " https://figma.com/file ", notes: " UI " }], "2026-08-05T08:00:00Z");
    expect(document).toMatchObject({ title: "Diseño", location: "https://figma.com/file", notes: "UI" });
    expect(projectDocumentHref(document)).toBe("https://figma.com/file");
    expect(projectDocumentHref({ ...document, kind: "file", location: "/srv/docs/prd.pdf" })).toBeNull();
  });
});
