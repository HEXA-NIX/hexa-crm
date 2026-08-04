import { spawn, type ChildProcessByStdio } from "node:child_process";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

const WORKER = resolve(__dirname, "../../../tools/orca-worker.mjs");
type WorkerProcess = ChildProcessByStdio<null, Readable, Readable>;

let child: WorkerProcess | null = null;

afterEach(() => {
  child?.kill("SIGTERM");
  child = null;
});

function waitForReady(process: WorkerProcess) {
  return new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("El puente no arrancó")), 5_000);
    process.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Puente local listo")) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    process.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`El worker terminó antes de arrancar: ${code}`));
    });
  });
}

describe("API loopback del worker Orca", () => {
  it("exige emparejamiento y rechaza orígenes no autorizados", async () => {
    const port = 20_000 + Math.floor(Math.random() * 10_000);
    const token = "test-pairing-token";
    const worker = spawn(process.execPath, [WORKER], {
      cwd: resolve(__dirname, "../../.."),
      env: {
        ...process.env,
        HEXA_ORCA_BRIDGE_PORT: String(port),
        HEXA_ORCA_BRIDGE_TOKEN: token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = worker;
    await waitForReady(worker);

    const url = `http://127.0.0.1:${port}/health`;
    expect((await fetch(url, { headers: { Origin: "http://localhost:1420" } })).status).toBe(401);
    expect((await fetch(url, { headers: { Origin: "https://evil.example", "X-Hexa-Orca-Token": token } })).status).toBe(403);
    const response = await fetch(url, { headers: { Origin: "http://localhost:1420", "X-Hexa-Orca-Token": token } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, version: 1 });
  });
});
