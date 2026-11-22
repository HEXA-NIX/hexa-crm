import type { WorkProject } from "$lib/types";

export type BadgeTone = "neutral" | "ok" | "warn" | "danger" | "ai";

export function projectStatusLabel(status: WorkProject["status"] | string) {
  switch (status) {
    case "planned": return "Planificado";
    case "active": return "Activo";
    case "paused": return "En pausa";
    case "done": return "Completado";
    case "archived": return "Archivado";
    default: return status;
  }
}

export function projectStatusTone(status: WorkProject["status"] | string): BadgeTone {
  switch (status) {
    case "active":
    case "done":
      return "ok";
    case "planned":
      return "warn";
    default:
      return "neutral";
  }
}
