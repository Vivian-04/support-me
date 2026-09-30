import { contrastRatio, relativeLuminance } from "../../lib/contrast";

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
  });
});

describe("contrastRatio", () => {
  it("spans 1 (identical colors) to 21 (black on white)", () => {
    expect(contrastRatio("#7c3aed", "#7c3aed")).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#ffffff", "#7c3aed")).toBe(contrastRatio("#7c3aed", "#ffffff"));
  });

  it("passes the default accent for white button text under WCAG AA (4.5:1)", () => {
    expect(contrastRatio("#7c3aed", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
