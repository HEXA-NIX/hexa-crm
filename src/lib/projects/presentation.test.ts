import { describe, expect, it } from "vitest";
import { projectStatusLabel, projectStatusTone } from "./presentation";

describe("presentación de estados de proyecto", () => {
  it("mantiene etiquetas y tonos compartidos entre portafolio y detalle", () => {
    expect(projectStatusLabel("paused")).toBe("En pausa");
    expect(projectStatusTone("planned")).toBe("warn");
    expect(projectStatusTone("done")).toBe("ok");
  });
});
