import { describe, expect, it } from "vitest";
import {
  idChange,
  isOptimistic,
  optimisticComment,
  toggleReaction,
} from "@/lib/github-issue-changes";

describe("toggleReaction", () => {
  it("adds a new reaction in github.com's order", () => {
    const next = toggleReaction(
      [{ content: "heart", count: 2, viewer_has_reacted: false }],
      "thumbsUp",
      true,
    );
    expect(next.map((group) => [group.content, group.count])).toEqual([
      ["thumbsUp", 1],
      ["heart", 2],
    ]);
  });

  it("removes the viewer's reaction and drops empty groups", () => {
    expect(
      toggleReaction(
        [{ content: "rocket", count: 1, viewer_has_reacted: true }],
        "rocket",
        false,
      ),
    ).toEqual([]);
    expect(
      toggleReaction(
        [{ content: "rocket", count: 4, viewer_has_reacted: true }],
        "rocket",
        false,
      ),
    ).toEqual([{ content: "rocket", count: 3, viewer_has_reacted: false }]);
  });

  it("ignores toggles that would not change anything", () => {
    const groups = [
      { content: "eyes" as const, count: 1, viewer_has_reacted: true },
    ];
    expect(toggleReaction(groups, "eyes", true)).toBe(groups);
    expect(toggleReaction(groups, "heart", false)).toBe(groups);
  });
});

describe("idChange", () => {
  it("lists what to add and remove", () => {
    expect(
      idChange([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]),
    ).toEqual({ add: ["c"], remove: ["a"] });
    expect(idChange([{ id: "a" }], [{ id: "a" }])).toEqual({
      add: [],
      remove: [],
    });
  });
});

describe("optimisticComment", () => {
  it("is recognisable and cannot be edited before GitHub saved it", () => {
    const comment = optimisticComment("hi", undefined);
    expect(isOptimistic(comment)).toBe(true);
    expect(isOptimistic({ id: "IC_1" })).toBe(false);
    expect(comment.viewer_can_update || comment.viewer_can_delete).toBe(false);
  });
});
