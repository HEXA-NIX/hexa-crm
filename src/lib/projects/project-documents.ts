import type { WorkProjectDocument, WorkProjectDocumentInput } from "../types";

export function validateProjectDocuments(documents: WorkProjectDocumentInput[]): string | null {
  for (const document of documents) {
    if (!document.title.trim()) return "Todos los documentos deben tener un título.";
    const location = document.location.trim();
    if (document.kind !== "note" && !location) return "Los enlaces y archivos deben indicar una ubicación.";
    if (/^(?:javascript|data):/i.test(location)) return "La ubicación del documento no es segura.";
  }
  return null;
}

export function normalizeProjectDocuments(
  documents: WorkProjectDocumentInput[],
  now = new Date().toISOString(),
): WorkProjectDocument[] {
  return documents.map((document, index) => ({
    id: document.id?.trim() || `doc-${Date.now().toString(36)}-${index}`,
    title: document.title.trim().slice(0, 160),
    kind: document.kind,
    location: document.location.trim().slice(0, 2_000),
    notes: document.notes.trim().slice(0, 4_000),
    updated_at: now,
  }));
}

export function projectDocumentHref(document: WorkProjectDocument): string | null {
  if (!document.location || document.kind === "note") return null;
  if (/^https?:\/\//i.test(document.location)) return document.location;
  return null;
}
