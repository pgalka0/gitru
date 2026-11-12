import { describe, expect, it } from "vitest";
import { labelColors } from "@/lib/github-labels";

describe("labelColors", () => {
  it("picks dark text on light labels and white text on dark ones", () => {
    expect(labelColors("fbca04")).toEqual({
      backgroundColor: "#fbca04",
      color: "#1f2328",
    });
    expect(labelColors("0E8A16").color).toBe("#ffffff");
    expect(labelColors("d73a4a").color).toBe("#ffffff");
  });

  it("falls back to GitHub's default grey for invalid colours", () => {
    expect(labelColors("red;position:fixed")).toEqual({
      backgroundColor: "#ededed",
      color: "#1f2328",
    });
  });
});
