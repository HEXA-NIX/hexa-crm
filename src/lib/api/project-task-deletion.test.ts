import { beforeEach, describe, expect, it } from "vitest";
import { __resetBrowserStoreForTests, browserApi } from "./browser-store";

describe("deleteProjectWorkItems", () => {
  beforeEach(() => __resetBrowserStoreForTests());

  it("deletes every task and subtask in one project without touching another", async () => {
    const { token } = await browserApi.login("admin", "1234");
    const firstProject = await browserApi.upsertWorkProject({ name: "Primero" }, token);
    const secondProject = await browserApi.upsertWorkProject({ name: "Segundo" }, token);
    const parent = await browserApi.upsertWorkItem(
      { title: "Padre", project_id: firstProject.id },
      token,
    );
    await browserApi.upsertWorkItem(
      { title: "Hija", project_id: firstProject.id, parent_id: parent.id },
      token,
    );
    await browserApi.upsertWorkItem(
      { title: "Conservar", project_id: secondProject.id },
      token,
    );

    await expect(browserApi.deleteProjectWorkItems(firstProject.id, undefined, token)).resolves.toBe(2);
    await expect(browserApi.listWorkItems({ project_id: firstProject.id }, token)).resolves.toEqual([]);
    const remaining = await browserApi.listWorkItems({ project_id: secondProject.id }, token);
    expect(remaining.map((item) => item.title)).toEqual(["Conservar"]);
    await expect(browserApi.getWorkProject(firstProject.id, token)).resolves.toMatchObject({ id: firstProject.id });
  });

  it("requires an administrator", async () => {
    const admin = await browserApi.login("admin", "1234");
    const project = await browserApi.upsertWorkProject({ name: "Privado" }, admin.token);
    const cashier = await browserApi.login("cajero", "0000");

    await expect(browserApi.deleteProjectWorkItems(project.id, undefined, cashier.token)).rejects.toThrow();
  });

  it("deletes only selected items and cascades a selected parent's subtasks", async () => {
    const { token } = await browserApi.login("admin", "1234");
    const project = await browserApi.upsertWorkProject({ name: "Selección" }, token);
    const parent = await browserApi.upsertWorkItem({ title: "Borrar", project_id: project.id }, token);
    await browserApi.upsertWorkItem(
      { title: "También borrar", project_id: project.id, parent_id: parent.id },
      token,
    );
    await browserApi.upsertWorkItem({ title: "Conservar", project_id: project.id }, token);

    await expect(browserApi.deleteProjectWorkItems(project.id, [parent.id], token)).resolves.toBe(2);
    const remaining = await browserApi.listWorkItems({ project_id: project.id }, token);
    expect(remaining.map((item) => item.title)).toEqual(["Conservar"]);
  });
});
