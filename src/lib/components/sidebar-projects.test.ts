import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SIDEBAR = readFileSync(resolve(__dirname, "./Sidebar.svelte"), "utf8");

describe("navegación de proyectos", () => {
  it("mantiene el listado de proyectos aunque exista un único proyecto", () => {
    expect(SIDEBAR).toContain('{ href: "/proyectos", label: "Proyectos"');
    expect(SIDEBAR).not.toContain("directProject");
    expect(SIDEBAR).not.toContain("workspaceProjects.length === 1");
  });
});
