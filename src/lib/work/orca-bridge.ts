import type { WorkItem, WorkProject } from "$lib/types";

export const ORCA_CONFIG_KEY = "hexa-crm-orca-worker-config-v1";
export const ORCA_BRIDGE_TOKEN_KEY = "hexa-crm-orca-bridge-token-v1";

export type OrcaLocalConfig = {
  crm_url: string;
  repo_path: string;
  base_branch: string;
  poll_ms: string;
  bridge_url: string;
};

export type OrcaBridgeRun = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  worktree_id: string | null;
  commit: string | null;
  error: string | null;
  updated_at: string;
};

export function defaultOrcaLocalConfig(origin = ""): OrcaLocalConfig {
  return {
    crm_url: origin,
    repo_path: "/ruta/absoluta/hexa-crm",
    base_branch: "dev",
    poll_ms: "10000",
    bridge_url: "http://127.0.0.1:4765",
  };
}

export function loadOrcaLocalConfig(): OrcaLocalConfig {
  const fallback = defaultOrcaLocalConfig(typeof window !== "undefined" ? window.location.origin : "");
  if (typeof localStorage === "undefined") return fallback;
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(ORCA_CONFIG_KEY) || "{}") };
  } catch {
    return fallback;
  }
}

export function saveOrcaLocalConfig(config: OrcaLocalConfig) {
  localStorage.setItem(ORCA_CONFIG_KEY, JSON.stringify(config));
}

export function loadOrcaBridgeToken() {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(ORCA_BRIDGE_TOKEN_KEY) || "";
}

export function saveOrcaBridgeToken(token: string) {
  if (token.trim()) sessionStorage.setItem(ORCA_BRIDGE_TOKEN_KEY, token.trim());
  else sessionStorage.removeItem(ORCA_BRIDGE_TOKEN_KEY);
}

export function isLoopbackBridgeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function bridgeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const config = loadOrcaLocalConfig();
  const token = loadOrcaBridgeToken();
  if (!token) throw new Error("Configura una clave de emparejamiento en Ajustes → Orca");
  if (!isLoopbackBridgeUrl(config.bridge_url)) throw new Error("La URL del puente Orca debe apuntar a loopback (127.0.0.1 o localhost)");
  const response = await fetch(`${config.bridge_url.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Hexa-Orca-Token": token,
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Puente Orca: HTTP ${response.status}`);
  return data as T;
}

export function checkOrcaBridge() {
  return bridgeRequest<{ ok: true; version: number }>("/health");
}

export function dispatchToLocalOrca(input: {
  task: WorkItem;
  subtasks: WorkItem[];
  project: Pick<WorkProject, "name" | "description"> | null;
}) {
  return bridgeRequest<OrcaBridgeRun>("/runs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getLocalOrcaRun(id: string) {
  return bridgeRequest<OrcaBridgeRun>(`/runs/${encodeURIComponent(id)}`);
}
