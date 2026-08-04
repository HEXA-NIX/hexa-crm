import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultOrcaLocalConfig, isLoopbackBridgeUrl, loadOrcaBridgeToken, saveOrcaBridgeToken } from "./orca-bridge";

describe("configuración del puente local de Orca", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  it("usa loopback como dirección predeterminada", () => {
    expect(defaultOrcaLocalConfig().bridge_url).toBe("http://127.0.0.1:4765");
  });

  it("rechaza puentes remotos", () => {
    expect(isLoopbackBridgeUrl("http://127.0.0.1:4765")).toBe(true);
    expect(isLoopbackBridgeUrl("http://localhost:4765")).toBe(true);
    expect(isLoopbackBridgeUrl("https://evil.example")).toBe(false);
  });

  it("mantiene la clave de emparejamiento solo en sessionStorage", () => {
    saveOrcaBridgeToken("  pairing-secret  ");
    expect(loadOrcaBridgeToken()).toBe("pairing-secret");
  });
});
