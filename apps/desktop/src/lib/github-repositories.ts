import type { RepositoryInfo, RepositoryRef } from "@gitru/commands";
import { parseOrigin } from "./parse-origin";

/** Mirrors `MAX_REPOSITORIES_PER_REQUEST` in `crates/github`. */
export const MAX_GITHUB_REPOSITORIES_PER_REQUEST = 50;

export interface GithubRepositoryGroup {
  /** Lower-cased `owner/name`; GitHub treats both parts case-insensitively. */
  key: string;
  ref: RepositoryRef;
  /** Local clones whose `origin` points at this repository. */
  localRepositories: RepositoryInfo[];
}

const isValidPart = (value: string, max: number) =>
  value.length > 0 && value.length <= max && /^[A-Za-z0-9._-]+$/.test(value);

/** Same rule as `RepositoryRef::validate` in Rust, so one bad origin cannot fail the whole batch. */
export function isValidGithubRepositoryRef(ref: RepositoryRef) {
  return isValidPart(ref.owner, 39) && isValidPart(ref.name, 100);
}

export function githubRepositoryKey(ref: RepositoryRef) {
  return `${ref.owner}/${ref.name}`.toLowerCase();
}

/**
 * Groups the user's local repositories by the github.com repository their
 * `origin` remote points at, sorted by `owner/name`.
 */
export function groupGithubRepositories(
  repositories: RepositoryInfo[],
): GithubRepositoryGroup[] {
  const groups = new Map<string, GithubRepositoryGroup>();

  for (const repository of repositories) {
    const origin = parseOrigin(repository.origin);
    if (origin?.provider !== "github") continue;

    const ref = { owner: origin.owner, name: origin.repo };
    if (!isValidGithubRepositoryRef(ref)) continue;

    const key = githubRepositoryKey(ref);
    const group = groups.get(key);
    if (group) {
      group.localRepositories.push(repository);
    } else {
      groups.set(key, { key, ref, localRepositories: [repository] });
    }
  }

  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
