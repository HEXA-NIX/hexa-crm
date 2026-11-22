#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import process from "node:process";
import { resolve } from "node:path";

const config = {
  crmUrl: (process.env.HEXA_CRM_URL || "http://127.0.0.1:1420").replace(/\/$/, ""),
  token: process.env.HEXA_CRM_AGENT_TOKEN || process.env.HEXA_CRM_TOKEN || "",
  companyId: Number(process.env.HEXA_ORCA_COMPANY_ID || 0),
  orcaCommand: process.env.ORCA_CLI_COMMAND || "orca",
  repoPath: resolve(process.env.HEXA_ORCA_REPO_PATH || process.cwd()),
  baseBranch: process.env.HEXA_ORCA_BASE_BRANCH || "dev",
  pollMs: Math.max(2_000, Number(process.env.HEXA_ORCA_POLL_MS || 10_000)),
  timeoutMs: Math.max(60_000, Number(process.env.HEXA_ORCA_TIMEOUT_MS || 3_600_000)),
  once: process.env.HEXA_ORCA_ONCE === "1",
  bridgePort: Math.max(1_024, Number(process.env.HEXA_ORCA_BRIDGE_PORT || 4_765)),
  bridgeToken: process.env.HEXA_ORCA_BRIDGE_TOKEN || randomBytes(24).toString("base64url"),
  bridgeOrigins: new Set((process.env.HEXA_ORCA_BRIDGE_ORIGINS || "http://localhost:1420,http://127.0.0.1:1420").split(",").map((value) => value.trim()).filter(Boolean)),
};

const SOURCE = {
  queued: "orca_queued",
  running: "orca_running",
  completed: "orca_completed",
  failed: "orca_failed",
};

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function log(message, details) {
  const suffix = details === undefined ? "" : ` ${typeof details === "string" ? details : JSON.stringify(details)}`;
  process.stdout.write(`[${new Date().toISOString()}] ${message}${suffix}\n`);
}

async function rpc(cmd, args = {}) {
  const response = await fetch(`${config.crmUrl}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ cmd, args }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || `RPC ${cmd}: HTTP ${response.status}`);
  return data;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || config.repoPath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} ${args[0] || ""} superó el tiempo máximo`));
    }, options.timeoutMs || config.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `${command} terminó con código ${code}`).trim().slice(-4_000)));
        return;
      }
      resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runJson(command, args, options) {
  const { stdout } = await run(command, args, options);
  try {
    return JSON.parse(stdout);
  } catch {
    const firstBrace = stdout.indexOf("{");
    if (firstBrace >= 0) return JSON.parse(stdout.slice(firstBrace));
    throw new Error(`Respuesta JSON inválida de ${command} ${args[0] || ""}`);
  }
}

function unwrap(result) {
  return result?.result ?? result;
}

function taskInput(task, overrides = {}) {
  return {
    id: task.id,
    parent_id: task.parent_id,
    title: task.title,
    description: task.description,
    type: task.type,
    status: task.status,
    priority: task.priority,
    category_id: task.category_id,
    project_id: task.project_id,
    assignee_id: task.assignee_id,
    start_date: task.start_date,
    due_date: task.due_date,
    sort_order: task.sort_order,
    source_type: task.source_type,
    source_key: task.source_key,
    source_href: task.source_href,
    ...overrides,
  };
}

function slug(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "tarea";
}

function taskPrompt(task, subtasks, project) {
  const lines = [`# Tarea: ${task.title}`];
  if (project?.name) lines.push("", `Proyecto: ${project.name}`);
  lines.push("", "## Contexto", `Estado: ${task.status}`, `Prioridad: ${task.priority}`);
  if (task.description?.trim()) lines.push("", task.description.trim());
  if (subtasks.length) {
    lines.push("", "## Subtareas");
    for (const child of subtasks) {
      lines.push(`- [${child.status === "done" ? "x" : " "}] ${child.title}`);
      if (child.description?.trim()) lines.push(`  ${child.description.trim().replace(/\n/g, "\n  ")}`);
    }
  }
  lines.push(
    "",
    "## Entrega obligatoria",
    "Trabaja autónomamente en el worktree creado por Orca y respeta AGENTS.md.",
    "Implementa la tarea y sus subtareas pendientes. Ejecuta los tests y el build relevantes.",
    "Corrige los fallos causados por tus cambios y crea un commit con un mensaje completo en español.",
    "No hagas push ni merge a dev o main. Si hay un bloqueo real, explícalo claramente y no simules que la tarea está terminada.",
  );
  return lines.join("\n");
}

async function ensureOrca() {
  let status = unwrap(await runJson(config.orcaCommand, ["status", "--json"], { timeoutMs: 30_000 }));
  if (!status?.app?.running) {
    log("Orca no está abierto; iniciándolo");
    await runJson(config.orcaCommand, ["open", "--json"], { timeoutMs: 60_000 });
    status = unwrap(await runJson(config.orcaCommand, ["status", "--json"], { timeoutMs: 30_000 }));
  }
  if (!status?.app?.running || status?.runtime?.reachable === false) throw new Error("Orca no está disponible");
}

async function verifyWorktree(worktreePath) {
  await run("npm", ["test"], { cwd: worktreePath });
  await run("npm", ["run", "build"], { cwd: worktreePath });
  const status = await run("git", ["status", "--porcelain"], { cwd: worktreePath, timeoutMs: 30_000 });
  if (status.stdout) throw new Error("El agente dejó cambios sin confirmar en el worktree");
  const count = await run("git", ["rev-list", "--count", `${config.baseBranch}..HEAD`], { cwd: worktreePath, timeoutMs: 30_000 });
  if (Number(count.stdout) < 1) throw new Error(`No existe ningún commit nuevo respecto a ${config.baseBranch}`);
  return (await run("git", ["rev-parse", "HEAD"], { cwd: worktreePath, timeoutMs: 30_000 })).stdout;
}

async function updateTask(task, overrides) {
  return rpc("upsert_work_item", { input: taskInput(task, overrides) });
}

async function executeTask(task, subtasks, project, onRunning = async () => {}) {
  await ensureOrca();
  const created = unwrap(await runJson(config.orcaCommand, [
    "worktree", "create",
    "--repo", `path:${config.repoPath}`,
    "--name", `hexa-${task.id}-${slug(task.title)}-${Date.now().toString(36)}`,
    "--no-parent",
    "--base-branch", config.baseBranch,
    "--agent", "codex",
    "--prompt", taskPrompt(task, subtasks, project),
    "--json",
  ]));
  const worktree = created?.worktree ?? created;
  const worktreeId = worktree?.id || created?.id || "";
  const worktreePath = worktree?.path || created?.path;
  const terminalHandle = created?.startupTerminal?.handle || created?.terminal?.handle;
  if (!worktreeId || !worktreePath || !terminalHandle) throw new Error("Orca no devolvió worktree, ruta y terminal de inicio");
  await onRunning({ worktreeId, worktreePath, terminalHandle });
  log(`Tarea ${task.id}: agente iniciado`, { worktreeId, terminalHandle });
  await runJson(config.orcaCommand, ["terminal", "wait", "--terminal", terminalHandle, "--for", "tui-idle", "--timeout-ms", String(config.timeoutMs), "--json"]);
  const commit = await verifyWorktree(worktreePath);
  return { worktreeId, commit };
}

async function processTask(task, allTasks, projects) {
  const subtasks = allTasks.filter((item) => item.parent_id === task.id && item.status !== "archived");
  const project = projects.find((item) => item.id === task.project_id) || null;
  const runId = task.source_key || crypto.randomUUID();
  let current = await updateTask(task, {
    status: "in_progress",
    source_type: SOURCE.running,
    source_key: runId,
    source_href: null,
  });
  let worktreeId = "";
  try {
    const result = await executeTask(task, subtasks, project, async (running) => {
      worktreeId = running.worktreeId;
      current = await updateTask(current, { source_href: worktreeId });
    });
    worktreeId = result.worktreeId;
    const commit = result.commit;
    for (const child of subtasks.filter((item) => item.status !== "done")) {
      await updateTask(child, { status: "done", source_type: SOURCE.completed, source_key: runId, source_href: worktreeId });
    }
    await updateTask(current, { status: "done", source_type: SOURCE.completed, source_key: commit, source_href: worktreeId });
    log(`Tarea ${task.id}: completada`, { commit, worktreeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTask(current, { status: "blocked", source_type: SOURCE.failed, source_key: message.slice(0, 500), source_href: worktreeId || current.source_href });
    log(`Tarea ${task.id}: bloqueada`, message);
  }
}

const bridgeRuns = new Map();
let bridgeQueue = Promise.resolve();

function publicRun(run) {
  return {
    id: run.id,
    status: run.status,
    worktree_id: run.worktreeId || null,
    commit: run.commit || null,
    error: run.error || null,
    updated_at: run.updatedAt,
  };
}

function sameToken(actual) {
  const expectedBuffer = Buffer.from(config.bridgeToken);
  const actualBuffer = Buffer.from(actual || "");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function allowedOrigin(origin) {
  return !origin || config.bridgeOrigins.has(origin);
}

function sendJson(response, status, body, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
    if (raw.length > 1_000_000) throw new Error("La petición supera 1 MB");
  }
  return JSON.parse(raw || "{}");
}

function validateBridgePayload(payload) {
  const task = payload?.task;
  if (!task || !Number.isFinite(Number(task.id)) || typeof task.title !== "string" || !task.title.trim()) throw new Error("Tarea local inválida");
  if (task.parent_id != null) throw new Error("Solo se pueden enviar tareas principales a Orca");
  const subtasks = Array.isArray(payload.subtasks) ? payload.subtasks.slice(0, 200) : [];
  if (task.title.length > 255 || String(task.description || "").length > 100_000) throw new Error("La tarea supera el tamaño permitido");
  return { task, subtasks, project: payload.project || null };
}

async function processBridgeRun(run) {
  run.status = "running";
  run.updatedAt = new Date().toISOString();
  try {
    const result = await executeTask(run.task, run.subtasks, run.project, async ({ worktreeId }) => {
      run.worktreeId = worktreeId;
      run.updatedAt = new Date().toISOString();
    });
    run.worktreeId = result.worktreeId;
    run.commit = result.commit;
    run.status = "completed";
    run.updatedAt = new Date().toISOString();
    log(`Ejecución local ${run.id}: completada`, { commit: run.commit });
  } catch (error) {
    run.error = (error instanceof Error ? error.message : String(error)).slice(0, 4_000);
    run.status = "failed";
    run.updatedAt = new Date().toISOString();
    log(`Ejecución local ${run.id}: bloqueada`, run.error);
  }
}

function startBridge() {
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin || "";
    if (!allowedOrigin(origin)) return sendJson(response, 403, { error: "Origen no autorizado" });
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Content-Type, X-Hexa-Orca-Token",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        Vary: "Origin",
      });
      return response.end();
    }
    if (!sameToken(request.headers["x-hexa-orca-token"])) return sendJson(response, 401, { error: "Clave de emparejamiento incorrecta" }, origin);
    const url = new URL(request.url || "/", `http://127.0.0.1:${config.bridgePort}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { ok: true, version: 1 }, origin);
      if (request.method === "POST" && url.pathname === "/runs") {
        const input = validateBridgePayload(await readJsonBody(request));
        const run = {
          id: randomUUID(),
          status: "queued",
          worktreeId: "",
          commit: "",
          error: "",
          updatedAt: new Date().toISOString(),
          ...input,
        };
        bridgeRuns.set(run.id, run);
        bridgeQueue = bridgeQueue.then(() => processBridgeRun(run)).catch((error) => log("Error interno de cola local", String(error)));
        return sendJson(response, 202, publicRun(run), origin);
      }
      if (request.method === "GET" && url.pathname.startsWith("/runs/")) {
        const run = bridgeRuns.get(decodeURIComponent(url.pathname.slice(6)));
        return run ? sendJson(response, 200, publicRun(run), origin) : sendJson(response, 404, { error: "Ejecución no encontrada; puede que el worker se haya reiniciado" }, origin);
      }
      return sendJson(response, 404, { error: "Ruta no encontrada" }, origin);
    } catch (error) {
      return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin);
    }
  });
  server.listen(config.bridgePort, "127.0.0.1", () => {
    log("Puente local listo", { url: `http://127.0.0.1:${config.bridgePort}`, origins: [...config.bridgeOrigins] });
    log("Clave de emparejamiento", config.bridgeToken);
  });
  return server;
}

async function cycle() {
  if (config.companyId > 0) await rpc("set_active_company", { company_id: config.companyId });
  const [tasks, projects] = await Promise.all([
    rpc("list_work_items", { filters: {} }),
    rpc("list_work_projects", {}),
  ]);
  const queued = tasks.filter((task) => task.source_type === SOURCE.queued && task.parent_id == null && !["done", "archived"].includes(task.status));
  for (const task of queued) {
    if (stopping) break;
    log(`Tarea ${task.id}: reclamada`, task.title);
    await processTask(task, tasks, projects);
  }
  return queued.length;
}

async function main() {
  const bridge = startBridge();
  log("Worker Orca iniciado", { crm: config.token ? config.crmUrl : "puente local", repo: config.repoPath, base: config.baseBranch });
  if (!config.token) {
    while (!stopping) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    bridge.close();
    log("Worker Orca detenido");
    return;
  }
  do {
    try {
      const processed = await cycle();
      if (config.once) {
        log("Ejecución única finalizada", { processed });
        break;
      }
    } catch (error) {
      log("Error de ciclo", error instanceof Error ? error.message : String(error));
    }
    if (!stopping) await new Promise((resolvePromise) => setTimeout(resolvePromise, config.pollMs));
  } while (!stopping);
  bridge.close();
  log("Worker Orca detenido");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
