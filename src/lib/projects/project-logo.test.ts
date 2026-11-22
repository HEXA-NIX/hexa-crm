import { describe, expect, it } from "vitest";
import { validateProjectLogo } from "./project-logo";

describe("validateProjectLogo", () => {
  it("acepta vacío e imágenes compatibles", () => {
    expect(validateProjectLogo("")).toBeNull();
    expect(validateProjectLogo("data:image/png;base64,aGV4YQ==")).toBeNull();
  });

  it("rechaza formatos no compatibles", () => {
    expect(validateProjectLogo("data:image/svg+xml;base64,PHN2Zz4=")).toMatch(/PNG/);
  });
});
