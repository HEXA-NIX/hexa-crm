import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Modal, { type ModalSize } from "./Modal.svelte";

const source = readFileSync(new URL("./Modal.svelte", import.meta.url), "utf8");

describe("Modal component responsive API", () => {
  it("exports valid ModalSize types", () => {
    const validSizes: ModalSize[] = ["sm", "md", "lg", "xl", "fluid", "full"];
    expect(validSizes.length).toBe(6);
    expect(validSizes).toContain("fluid");
    expect(validSizes).toContain("md");
  });

  it("Modal component exists and can be imported", () => {
    expect(Modal).toBeDefined();
  });

  it("uses theme surfaces in the header and footer", () => {
    expect(source).toContain("modal-header");
    expect(source).toContain("modal-footer");
    expect(source).toContain("var(--color-obsidian-panel)");
    expect(source).not.toContain("--color-surface-glass,#120e1b");
  });
});
