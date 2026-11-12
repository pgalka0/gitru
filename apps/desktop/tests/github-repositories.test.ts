import type { RepositoryInfo } from "@gitru/commands";
import { describe, expect, it } from "vitest";
import {
  groupGithubRepositories,
  isValidGithubRepositoryRef,
} from "@/lib/github-repositories";

const repo = (id: string, origin?: string): RepositoryInfo => ({
  id,
  name: id,
  path: `/tmp/${id}`,
  origin,
  has_uncommitted_changes: false,
  last_updated: 0,
});

describe("groupGithubRepositories", () => {
  it("keeps only github.com origins and groups clones of the same repository", () => {
    const groups = groupGithubRepositories([
      repo("b", "git@github.com:Octo/Hello.git"),
      repo("a", "https://github.com/octo/hello.git"),
      repo("c", "https://gitlab.com/octo/hello.git"),
      repo("d"),
      repo("e", "https://github.com/acme/api"),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "acme/api",
      "octo/hello",
    ]);
    expect(groups[1].ref).toEqual({ owner: "Octo", name: "Hello" });
    expect(groups[1].localRepositories.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("skips origins the GitHub API would reject", () => {
    const groups = groupGithubRepositories([
      repo("nested", "https://github.com/octo/hello/extra"),
      repo("spaces", "https://github.com/octo/hello%20world"),
    ]);

    expect(groups).toEqual([]);
  });
});

describe("isValidGithubRepositoryRef", () => {
  it("matches the Rust validation rules", () => {
    expect(
      isValidGithubRepositoryRef({ owner: "octo-cat", name: "a.b_c" }),
    ).toBe(true);
    expect(isValidGithubRepositoryRef({ owner: "", name: "x" })).toBe(false);
    expect(
      isValidGithubRepositoryRef({ owner: "o".repeat(40), name: "x" }),
    ).toBe(false);
    expect(isValidGithubRepositoryRef({ owner: "o", name: "a/b" })).toBe(false);
  });
});
