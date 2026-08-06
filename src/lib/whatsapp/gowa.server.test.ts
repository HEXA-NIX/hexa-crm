import { describe, expect, it } from "vitest";
import { gowaDeviceId, normalizeWhatsAppPhone } from "./gowa.server";

describe("GOWA WhatsApp provider", () => {
  it("normaliza teléfonos internacionales sin perder el prefijo", () => {
    expect(normalizeWhatsAppPhone("+34 600 111 222")).toBe("+34600111222");
  });

  it("rechaza teléfonos ambiguos sin código de país", () => {
    expect(() => normalizeWhatsAppPhone("600111222")).toThrow(/prefijo internacional/);
  });

  it("aísla el dispositivo por empresa y usuario", () => {
    expect(gowaDeviceId(2, 7)).toBe("hexa-2-7");
    expect(gowaDeviceId(3, 7)).not.toBe(gowaDeviceId(2, 7));
  });
});
