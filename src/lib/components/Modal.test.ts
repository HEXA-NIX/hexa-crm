import { describe, expect, it } from "vitest";
import Modal, { type ModalSize } from "./Modal.svelte";

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
});
