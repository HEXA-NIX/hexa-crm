import { describe, expect, it } from "vitest";
import { validateUserAvatar } from "./user-avatar";

describe("validateUserAvatar", () => {
  it("acepta vacío y formatos raster compatibles", () => {
    expect(validateUserAvatar("")).toBeNull();
    expect(validateUserAvatar("data:image/jpeg;base64,aGV4YQ==")).toBeNull();
  });

  it("rechaza otros formatos", () => {
    expect(validateUserAvatar("data:image/svg+xml;base64,PHN2Zz4=")).toMatch(/PNG/);
  });
});
