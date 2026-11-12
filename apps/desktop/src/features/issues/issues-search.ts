import type { IssueListRequest, RepositoryRef } from "@gitru/commands";
import { isValidGithubRepositoryRef } from "@/lib/github-repositories";

export type IssueStateFilter = IssueListRequest["state"];
export type IssueSort = IssueListRequest["sort"];

/**
 * URL search params of `/app/issues/`. Keeping the selection in the URL lets
 * each workspace tab restore its own view (tabs persist their href). Defaults
 * are left out so the URL stays short.
 */
export interface IssuesSearch {
  /** `owner/name` */
  repo?: string;
  issue?: number;
  state?: IssueStateFilter;
  sort?: IssueSort;
  mine?: boolean;
  labels?: string[];
  q?: string;
}

export const DEFAULT_STATE: IssueStateFilter = "open";
export const DEFAULT_SORT: IssueSort = "newest";

const STATES: readonly IssueStateFilter[] = ["open", "closed", "all"];
const SORTS: readonly IssueSort[] = [
  "newest",
  "oldest",
  "recentlyUpdated",
  "mostCommented",
];

export const SORT_LABELS: Record<IssueSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  recentlyUpdated: "Recently updated",
  mostCommented: "Most commented",
};

const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  values.find((candidate) => candidate === value);

export function parseRepoParam(value: string | undefined) {
  if (!value) return undefined;
  const [owner, name, ...rest] = value.split("/");
  if (rest.length > 0 || !owner || !name) return undefined;
  const ref: RepositoryRef = { owner, name };
  return isValidGithubRepositoryRef(ref) ? ref : undefined;
}

export const repoParam = (ref: RepositoryRef) => `${ref.owner}/${ref.name}`;

export function validateIssuesSearch(
  raw: Record<string, unknown>,
): IssuesSearch {
  const search: IssuesSearch = {};

  if (typeof raw.repo === "string" && parseRepoParam(raw.repo)) {
    search.repo = raw.repo;
  }

  const issue = Number(raw.issue);
  if (Number.isInteger(issue) && issue > 0) search.issue = issue;

  const state = oneOf(STATES, raw.state);
  if (state && state !== DEFAULT_STATE) search.state = state;

  const sort = oneOf(SORTS, raw.sort);
  if (sort && sort !== DEFAULT_SORT) search.sort = sort;

  if (raw.mine === true || raw.mine === "true") search.mine = true;

  if (Array.isArray(raw.labels)) {
    const labels = raw.labels
      .filter((label): label is string => typeof label === "string")
      .map((label) => label.trim())
      .filter(Boolean);
    if (labels.length > 0) search.labels = [...new Set(labels)].slice(0, 20);
  }

  if (typeof raw.q === "string" && raw.q.trim()) {
    search.q = raw.q.trim().slice(0, 256);
  }

  return search;
}

export function issueFilters(
  search: IssuesSearch,
  repository: RepositoryRef,
): Omit<IssueListRequest, "after"> {
  return {
    repository,
    state: search.state ?? DEFAULT_STATE,
    sort: search.sort ?? DEFAULT_SORT,
    assigned_to_me: search.mine === true,
    labels: search.labels ?? [],
    query: search.q,
  };
}

export const hasActiveFilters = (search: IssuesSearch) =>
  Boolean(search.mine || search.labels?.length || search.q);
