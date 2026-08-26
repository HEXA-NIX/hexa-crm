import { describe, expect, it } from "vitest";
import { normalizeProjectBrief, normalizeProjectPrd, normalizeTechStack, parseTechStack, projectTechnologyCount } from "./project-brief";

describe("project technical brief", () => {
  it("normalizes PRD and stack entries", () => {
    expect(normalizeProjectPrd("  Objetivo del producto  ")).toBe("Objetivo del producto");
    expect(normalizeTechStack([" Svelte 5 ", "PostgreSQL", "svelte 5", ""])).toEqual(["Svelte 5", "PostgreSQL"]);
  });

  it("accepts comma and line separated stacks", () => {
    expect(parseTechStack("Svelte, TypeScript\nTauri")).toEqual(["Svelte", "TypeScript", "Tauri"]);
  });

  it("normalizes a complete structured brief and counts its technologies", () => {
    const brief = normalizeProjectBrief({
      summary: "  CRM para comercio ",
      scope: "Inventario y ventas",
      technology: { frontend: ["Svelte", "Svelte"], backend: ["Rust"], database: ["SQLite"] },
    });
    expect(brief.summary).toBe("CRM para comercio");
    expect(brief.technology.frontend).toEqual(["Svelte"]);
    expect(projectTechnologyCount(brief)).toBe(3);
    expect(normalizeProjectBrief({ technology: { repository_url: "javascript:alert(1)" } }).technology.repository_url).toBe("");
  });
});
