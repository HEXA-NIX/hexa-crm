import { beforeEach, describe, expect, it } from "vitest";
import { __resetBrowserStoreForTests, browserApi } from "./browser-store";
import type { WorkProjectRequest } from "$lib/types";

describe("project requests persistence", () => {
  beforeEach(() => __resetBrowserStoreForTests());

  it("persists the intake workflow, discussion and linked task", async () => {
    const { token } = await browserApi.login("admin", "1234");
    const project = await browserApi.upsertWorkProject({ name: "Portal", requests: [] }, token);
    const now = new Date().toISOString();
    const request: WorkProjectRequest = {
      id: "request-1", type: "suggestion", title: "Añadir buscador", description: "Buscar documentos",
      requester: "Cliente", priority: "normal", impact: "Reduce tiempos", status: "accepted",
      reviewer_id: null, task_id: null,
      messages: [{ id: "message-1", author: "admin", text: "Aprobado", created_at: now }],
      created_at: now, updated_at: now,
    };
    await browserApi.upsertWorkProject({ id: project.id, name: project.name, requests: [request] }, token);

    const saved = await browserApi.getWorkProject(project.id, token);
    expect(saved.requests).toEqual([request]);
  });
});
