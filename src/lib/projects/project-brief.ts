import type { ProjectBrief, ProjectTechnicalProfile } from "../types";

export function normalizeProjectPrd(value: unknown): string {
  return String(value ?? "").trim().slice(0, 20_000);
}

export function normalizeTechStack(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    const key = clean.toLocaleLowerCase("es");
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= 40) break;
  }
  return result;
}

export function parseTechStack(value: string): string[] {
  return normalizeTechStack(value.split(/[,\n]/));
}

const text = (value: unknown, max = 12_000) => String(value ?? "").trim().slice(0, max);
const safeUrl = (value: unknown) => {
  const url = text(value, 2_000);
  return !url || /^https?:\/\//i.test(url) ? url : "";
};

export function emptyTechnicalProfile(): ProjectTechnicalProfile {
  return {
    frontend: [], backend: [], app: [], database: [], infrastructure: [], deployment: [],
    integrations: [], plugins: [], ai: [], tools: [], repository_url: "", documentation_url: "",
    staging_url: "", production_url: "",
  };
}

export function emptyProjectBrief(): ProjectBrief {
  return {
    summary: "", problem: "", objectives: "", users: "", scope: "", out_of_scope: "",
    functional_requirements: "", non_functional_requirements: "", acceptance_criteria: "",
    risks: "", dependencies: "", success_metrics: "", notes: "",
    technology: emptyTechnicalProfile(),
  };
}

export function normalizeProjectBrief(value: unknown, legacyStack: unknown = []): ProjectBrief {
  const raw = value && typeof value === "object" ? value as Record<string, any> : {};
  const technology = raw.technology && typeof raw.technology === "object" ? raw.technology as Record<string, unknown> : {};
  const stack = normalizeTechStack(legacyStack);
  return {
    summary: text(raw.summary, 4_000),
    problem: text(raw.problem),
    objectives: text(raw.objectives),
    users: text(raw.users),
    scope: text(raw.scope),
    out_of_scope: text(raw.out_of_scope),
    functional_requirements: text(raw.functional_requirements, 20_000),
    non_functional_requirements: text(raw.non_functional_requirements, 20_000),
    acceptance_criteria: text(raw.acceptance_criteria, 20_000),
    risks: text(raw.risks),
    dependencies: text(raw.dependencies),
    success_metrics: text(raw.success_metrics),
    notes: text(raw.notes, 20_000),
    technology: {
      frontend: normalizeTechStack(technology.frontend ?? stack),
      backend: normalizeTechStack(technology.backend),
      app: normalizeTechStack(technology.app),
      database: normalizeTechStack(technology.database),
      infrastructure: normalizeTechStack(technology.infrastructure),
      deployment: normalizeTechStack(technology.deployment),
      integrations: normalizeTechStack(technology.integrations),
      plugins: normalizeTechStack(technology.plugins),
      ai: normalizeTechStack(technology.ai),
      tools: normalizeTechStack(technology.tools),
      repository_url: safeUrl(technology.repository_url),
      documentation_url: safeUrl(technology.documentation_url),
      staging_url: safeUrl(technology.staging_url),
      production_url: safeUrl(technology.production_url),
    },
  };
}

export function projectTechnologyCount(brief: ProjectBrief): number {
  return [brief.technology.frontend, brief.technology.backend, brief.technology.app, brief.technology.database,
    brief.technology.infrastructure, brief.technology.deployment, brief.technology.integrations,
    brief.technology.plugins, brief.technology.ai, brief.technology.tools].reduce((total, group) => total + group.length, 0);
}
