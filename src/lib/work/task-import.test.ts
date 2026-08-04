import { describe, expect, it } from "vitest";
import { countImportedTasks, parseTaskImport } from "./task-import";

describe("parseTaskImport", () => {
  it("parses numbered tasks and indented subtasks", () => {
    const result = parseTaskImport(`
Plan propuesto:
1. Preparar catálogo
   - Revisar duplicados
   - Añadir fotografías
2. Configurar TPV
   1. Crear usuarios
   2. Probar una venta
`);

    expect(result).toEqual([
      { title: "Preparar catálogo", description: "", subtasks: [
        { title: "Revisar duplicados", description: "" },
        { title: "Añadir fotografías", description: "" },
      ] },
      { title: "Configurar TPV", description: "", subtasks: [
        { title: "Crear usuarios", description: "" },
        { title: "Probar una venta", description: "" },
      ] },
    ]);
    expect(countImportedTasks(result)).toBe(6);
  });

  it("supports Markdown checkboxes and strips simple bold markers", () => {
    expect(parseTaskImport("- [ ] **Diseñar**\n  - [x] Crear boceto\n- Publicar")).toEqual([
      { title: "Diseñar", description: "", subtasks: [{ title: "Crear boceto", description: "" }] },
      { title: "Publicar", description: "", subtasks: [] },
    ]);
  });

  it("treats a flat list as independent tasks and ignores prose", () => {
    expect(parseTaskImport("Estas son las tareas:\n- Una\n- Dos\nGracias")).toEqual([
      { title: "Una", description: "", subtasks: [] },
      { title: "Dos", description: "", subtasks: [] },
    ]);
  });

  it("flattens deeper nesting under the current root task", () => {
    expect(parseTaskImport("- Principal\n  - Hija\n    - Nieta")).toEqual([
      { title: "Principal", description: "", subtasks: [
        { title: "Hija", description: "" },
        { title: "Nieta", description: "" },
      ] },
    ]);
  });

  it("attaches explicit and indented descriptions to tasks and subtasks", () => {
    expect(parseTaskImport(`
- Preparar catálogo
  Descripción: Revisar antes de publicar.
  Esta revisión incluye los artículos inactivos.
  - Revisar duplicados
    Buscar productos con el mismo SKU.
- Configurar TPV
  Description: Dejar preparado el puesto de caja.
`)).toEqual([
      {
        title: "Preparar catálogo",
        description: "Revisar antes de publicar.\nEsta revisión incluye los artículos inactivos.",
        subtasks: [{ title: "Revisar duplicados", description: "Buscar productos con el mismo SKU." }],
      },
      {
        title: "Configurar TPV",
        description: "Dejar preparado el puesto de caja.",
        subtasks: [],
      },
    ]);
  });

  it("reads optional delivery dates without adding them to descriptions", () => {
    expect(parseTaskImport(`
- Preparar catálogo
  Fecha de entrega: 2026-08-20
  - Revisar duplicados
    Fecha: 2026-08-18
`)).toEqual([
      {
        title: "Preparar catálogo",
        description: "",
        due_date: "2026-08-20",
        subtasks: [{ title: "Revisar duplicados", description: "", due_date: "2026-08-18" }],
      },
    ]);
  });
});
