import { describe, expect, it } from "vitest";
import { renderRichDescription } from "./rich-description";

describe("renderRichDescription", () => {
  it("renders the supported lightweight formatting", () => {
    expect(renderRichDescription("**Importante** y *detalle*\n- Uno\n- Dos\n1. Tres")).toBe(
      "<p><strong>Importante</strong> y <em>detalle</em></p><ul><li>Uno</li><li>Dos</li></ul><ol><li>Tres</li></ol>",
    );
  });

  it("escapes HTML before applying formatting", () => {
    const html = renderRichDescription('<img src=x onerror="alert(1)"> **seguro**');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>seguro</strong>");
  });
});
