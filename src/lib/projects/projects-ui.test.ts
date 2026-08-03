import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PORTFOLIO = readFileSync(resolve(__dirname, "../../routes/proyectos/+page.svelte"), "utf8");
const DETAIL = readFileSync(resolve(__dirname, "../../routes/proyectos/[id]/+page.svelte"), "utf8");

describe("estructura UI de proyectos", () => {
  it("protege la creación de proyectos por rol", () => {
    expect(PORTFOLIO).toMatch(/\{#if \$isAdmin\}[\s\S]*?\+ Nuevo proyecto/);
  });

  it("ofrece limpieza de filtros y conserva las preferencias de vista", () => {
    expect(PORTFOLIO).toContain("clearFilters");
    expect(PORTFOLIO).toContain("hexa-projects-sort");
    expect(DETAIL).toContain("clearTaskFilters");
    expect(DETAIL).toContain("hexa-project-view");
  });

  it("mantiene economía y salud bajo divulgación progresiva", () => {
    expect((DETAIL.match(/<details/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(DETAIL).toContain("ECONOMÍA DEL PROYECTO");
    expect(DETAIL).toContain("SALUD Y SEÑALES");
  });

  it("dispone de una vista explícita para archivadas y Kanban móvil", () => {
    expect(DETAIL).toContain('filterStatus === "archived"');
    expect(DETAIL).toContain("overflow-x-auto");
    expect(DETAIL).toContain("pantalla táctil");
  });
});
