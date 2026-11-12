import {
  githubIssue,
  githubListIssues,
  githubRepositoryLabels,
  type IssueDetail,
  type IssueListRequest,
  type IssuePage,
  type RepositoryRef,
  type TimelineItem,
} from "@gitru/commands";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { githubKeys, useIsGithubSignedIn } from "./use-github";

/** GitHub does not push to desktop clients; refresh while the window is in use. */
const REFRESH_INTERVAL_MS = 60_000;

export function useGithubIssues(filters: Omit<IssueListRequest, "after">) {
  const signedIn = useIsGithubSignedIn();

  const query = useInfiniteQuery({
    queryKey: githubKeys.issues(filters),
    queryFn: ({ pageParam }) =>
      githubListIssues({ request: { ...filters, after: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: IssuePage) =>
      page.has_next_page ? page.end_cursor : undefined,
    enabled: signedIn,
    staleTime: REFRESH_INTERVAL_MS,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const issues = useMemo(
    () => query.data?.pages.flatMap((page) => page.issues) ?? [],
    [query.data],
  );

  return {
    ...query,
    issues,
    totalCount: query.data?.pages[0]?.total_count,
  };
}

/**
 * An issue and its timeline. The first page carries the issue itself; further
 * pages (100 timeline items each) are loaded on demand.
 */
export function useGithubIssue(
  repository: RepositoryRef | undefined,
  number: number | undefined,
) {
  const signedIn = useIsGithubSignedIn();
  const enabled = signedIn && repository !== undefined && number !== undefined;

  const query = useInfiniteQuery({
    queryKey: githubKeys.issue(
      repository ?? { owner: "", name: "" },
      number ?? 0,
    ),
    queryFn: ({ pageParam }) => {
      if (!repository || number === undefined) {
        throw new Error("No issue selected");
      }
      return githubIssue({
        request: { repository, number, timeline_after: pageParam },
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: IssueDetail) =>
      page.timeline.has_next_page ? page.timeline.end_cursor : undefined,
    enabled,
    staleTime: REFRESH_INTERVAL_MS,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const pages = query.data?.pages;
  const issue = pages?.[0];
  const timeline = useMemo<TimelineItem[]>(
    () => pages?.flatMap((page) => page.timeline.items) ?? [],
    [pages],
  );

  return { ...query, issue, timeline };
}

export function useGithubRepositoryLabels(
  repository: RepositoryRef | undefined,
) {
  const signedIn = useIsGithubSignedIn();

  return useQuery({
    queryKey: githubKeys.labels(repository ?? { owner: "", name: "" }),
    queryFn: () => {
      if (!repository) throw new Error("No repository selected");
      return githubRepositoryLabels({ repository });
    },
    enabled: signedIn && repository !== undefined,
    staleTime: 5 * 60_000,
  });
}
