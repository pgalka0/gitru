import { describe, expect, it } from "vitest";
import {
  issueFilters,
  parseRepoParam,
  validateIssuesSearch,
} from "@/features/issues/issues-search";

describe("validateIssuesSearch", () => {
  it("keeps valid params and drops defaults", () => {
    expect(
      validateIssuesSearch({
        repo: "octo/hello",
        issue: 42,
        state: "open",
        sort: "newest",
        mine: true,
        labels: ["bug", " bug ", "", 7, "docs"],
        q: "  author:mona  ",
      }),
    ).toEqual({
      repo: "octo/hello",
      issue: 42,
      mine: true,
      labels: ["bug", "docs"],
      q: "author:mona",
    });
  });

  it("ignores values that could not come from the UI", () => {
    expect(
      validateIssuesSearch({
        repo: "octo/hello/extra",
        issue: -1,
        state: "merged",
        sort: "random",
        mine: "yes",
        labels: "bug",
      }),
    ).toEqual({});
    expect(validateIssuesSearch({ issue: "12", state: "closed" })).toEqual({
      issue: 12,
      state: "closed",
    });
  });
});

describe("parseRepoParam", () => {
  it("parses owner/name and rejects anything else", () => {
    expect(parseRepoParam("octo/hello.js")).toEqual({
      owner: "octo",
      name: "hello.js",
    });
    expect(parseRepoParam("octo")).toBeUndefined();
    expect(parseRepoParam("octo/he llo")).toBeUndefined();
  });
});

describe("issueFilters", () => {
  it("fills in defaults for the backend request", () => {
    expect(
      issueFilters({ labels: ["bug"] }, { owner: "octo", name: "hello" }),
    ).toEqual({
      repository: { owner: "octo", name: "hello" },
      state: "open",
      sort: "newest",
      assigned_to_me: false,
      labels: ["bug"],
      query: undefined,
    });
  });
});
