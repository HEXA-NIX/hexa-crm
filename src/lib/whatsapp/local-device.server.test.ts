import { describe, expect, it } from "vitest";
import { localGowaDeviceId } from "./local-device.server";

describe("dispositivo GOWA para pruebas locales", () => {
  it("es estable para una sesión y no revela el token", () => {
    const token = "session-token-aleatorio-1234567890";
    const id = localGowaDeviceId(token);
    expect(id).toBe(localGowaDeviceId(token));
    expect(id).toMatch(/^hexa-local-[a-f0-9]{24}$/);
    expect(id).not.toContain(token);
  });

  it("aísla sesiones diferentes", () => {
    expect(localGowaDeviceId("session-token-aaaaaaaaaaaaaaaaaaaa"))
      .not.toBe(localGowaDeviceId("session-token-bbbbbbbbbbbbbbbbbbbb"));
  });

  it("rechaza identificadores cortos falsificables", () => {
    expect(() => localGowaDeviceId("corto")).toThrow(/Sesión local/);
  });
});
