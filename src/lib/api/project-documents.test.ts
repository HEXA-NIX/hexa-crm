import { beforeEach, describe, expect, it } from "vitest";
import { __resetBrowserStoreForTests, browserApi } from "./browser-store";

describe("project documents persistence", () => {
  beforeEach(() => __resetBrowserStoreForTests());

  it("creates, updates and removes project documents", async () => {
    const { token } = await browserApi.login("admin", "1234");
    const project = await browserApi.upsertWorkProject({
      name: "Portal",
      documents: [{ title: "Diseño", kind: "link", location: "https://figma.com/example", notes: "Versión aprobada" }],
    }, token);
    expect(project.documents).toHaveLength(1);

    const updated = await browserApi.upsertWorkProject({
      id: project.id,
      name: project.name,
      documents: [{ ...project.documents[0], notes: "Pendiente de revisión" }],
    }, token);
    expect(updated.documents[0].notes).toBe("Pendiente de revisión");

    await browserApi.upsertWorkProject({ id: project.id, name: project.name, documents: [] }, token);
    await expect(browserApi.getWorkProject(project.id, token)).resolves.toMatchObject({ documents: [] });
  });

  it("rejects unsafe locations even when bypassing the UI", async () => {
    const { token } = await browserApi.login("admin", "1234");
    await expect(browserApi.upsertWorkProject({
      name: "Inseguro",
      documents: [{ title: "Ataque", kind: "link", location: "javascript:alert(1)", notes: "" }],
    }, token)).rejects.toThrow("segura");
  });
});
