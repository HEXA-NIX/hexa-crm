import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKER = readFileSync(resolve(__dirname, "../../../tools/orca-worker.mjs"), "utf8");
const DETAIL = readFileSync(resolve(__dirname, "../../routes/proyectos/[id]/+page.svelte"), "utf8");

describe("worker local de Orca", () => {
  it("lanza Orca sin shell y crea el agente desde dev", () => {
    expect(WORKER).toContain('baseBranch: process.env.HEXA_ORCA_BASE_BRANCH || "dev"');
    expect(WORKER).toContain('"--agent", "codex"');
    expect(WORKER).toContain('"--base-branch", config.baseBranch');
    expect(WORKER).not.toMatch(/shell\s*:\s*true/);
  });

  it("expone el puente solo en loopback, con token y orígenes permitidos", () => {
    expect(WORKER).toContain('server.listen(config.bridgePort, "127.0.0.1"');
    expect(WORKER).toContain("timingSafeEqual");
    expect(WORKER).toContain("config.bridgeOrigins.has(origin)");
    expect(WORKER).toContain('request.headers["x-hexa-orca-token"]');
  });

  it("exige tests, build, worktree limpio y commit antes de completar", () => {
    expect(WORKER).toContain('run("npm", ["test"]');
    expect(WORKER).toContain('run("npm", ["run", "build"]');
    expect(WORKER).toContain('run("git", ["status", "--porcelain"]');
    expect(WORKER).toContain('run("git", ["rev-list", "--count"');
    expect(WORKER).toContain('status: "done", source_type: SOURCE.completed');
  });

  it("expone el despacho tanto para central como para el puente local", () => {
    expect(DETAIL).toContain("supportsOrcaWorker()");
    expect(DETAIL).toContain("Enviar a Orca");
    expect(DETAIL).toContain("usesLocalOrcaBridge()");
    expect(DETAIL).toContain("dispatchToLocalOrca");
    expect(DETAIL).toContain('orcaExecutionState(editingTask) === "failed"');
  });
});
