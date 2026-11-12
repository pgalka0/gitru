import {
  type CreateIssueRequest,
  githubAddComment,
  githubChangeAssignees,
  githubChangeLabels,
  githubCloseIssue,
  githubCreateIssue,
  githubDeleteComment,
  githubEditComment,
  githubEditIssue,
  githubReopenIssue,
  githubSetMilestone,
  githubSetReaction,
  type IssueDetail,
  type IssuePage,
  type IssueSummary,
  type Label,
  type Milestone,
  type RepositoryRef,
  type TimelineItem,
  type User,
} from "@gitru/commands";
import {
  type InfiniteData,
  type Query,
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import {
  byLogin,
  byName,
  type CloseReason,
  idChange,
  optimisticComment,
  type ReactionContent,
  toggleReaction,
} from "@/lib/github-issue-changes";
import { githubErrorMessage, githubKeys, useGithubAuth } from "./use-github";

type IssueData = InfiniteData<IssueDetail, string | undefined>;
type ListData = InfiniteData<IssuePage, string | undefined>;

/** How one change rewrites the cached issue, its timeline and list rows. */
interface CachePatch {
  /** Applied to the first page, which is what the detail view shows. */
  issue?: (issue: IssueDetail) => IssueDetail;
  timeline?: (
    page: IssueDetail,
    index: number,
    pages: number,
  ) => TimelineItem[];
  summary?: (summary: IssueSummary) => IssueSummary;
}

interface Snapshot {
  issue: IssueData | undefined;
  lists: [QueryKey, ListData | undefined][];
}

const sameRepository = (a: RepositoryRef | undefined, b: RepositoryRef) =>
  a !== undefined &&
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.name.toLowerCase() === b.name.toLowerCase();

/** Every cached issue list of one repository, whatever its filters. */
const listsOf = (repository: RepositoryRef) => ({
  queryKey: [...githubKeys.all, "issues"],
  predicate: (query: Query) =>
    sameRepository(
      (query.queryKey[2] as { repository?: RepositoryRef } | undefined)
        ?.repository,
      repository,
    ),
});

function applyPatch(
  queryClient: QueryClient,
  repository: RepositoryRef,
  number: number,
  patch: CachePatch,
) {
  const { issue, timeline, summary } = patch;
  if (issue || timeline) {
    queryClient.setQueryData<IssueData>(
      githubKeys.issue(repository, number),
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page, index) => {
            const next = index === 0 && issue ? issue(page) : page;
            return timeline
              ? {
                  ...next,
                  timeline: {
                    ...next.timeline,
                    items: timeline(next, index, data.pages.length),
                  },
                }
              : next;
          }),
        },
    );
  }
  if (summary) {
    // Lists come from GitHub search, which lags behind changes, so they are
    // patched rather than refetched; the regular refresh catches up later.
    queryClient.setQueriesData<ListData>(
      listsOf(repository),
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            issues: page.issues.map((row) =>
              row.number === number ? summary(row) : row,
            ),
          })),
        },
    );
  }
}

function useIssueChange<TVariables, TResult>({
  repository,
  number,
  action,
  mutationFn,
  optimistic,
  confirmed,
  onFailure,
}: {
  repository: RepositoryRef;
  number: number;
  /** Shown before GitHub's message when the change fails. */
  action: string;
  mutationFn: (variables: TVariables) => Promise<TResult>;
  optimistic: (variables: TVariables) => CachePatch;
  confirmed?: (result: TResult, variables: TVariables) => CachePatch;
  onFailure: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const issueKey = githubKeys.issue(repository, number);
  const mutationKey = githubKeys.issueChange(repository, number);

  return useMutation({
    mutationKey,
    mutationFn,
    onMutate: async (variables): Promise<Snapshot> => {
      await queryClient.cancelQueries({ queryKey: issueKey });
      const snapshot = {
        issue: queryClient.getQueryData<IssueData>(issueKey),
        lists: queryClient.getQueriesData<ListData>(listsOf(repository)),
      };
      applyPatch(queryClient, repository, number, optimistic(variables));
      return snapshot;
    },
    onError: (error, _variables, snapshot) => {
      if (snapshot) {
        queryClient.setQueryData(issueKey, snapshot.issue);
        for (const [key, data] of snapshot.lists) {
          queryClient.setQueryData(key, data);
        }
      }
      onFailure(`${action}: ${githubErrorMessage(error)}`);
    },
    onSuccess: (result, variables) => {
      if (confirmed) {
        applyPatch(
          queryClient,
          repository,
          number,
          confirmed(result, variables),
        );
      }
    },
    onSettled: () => {
      // Refetch after the last overlapping change only; an earlier refetch
      // could land with data that predates a newer optimistic update.
      if (queryClient.isMutating({ mutationKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey: issueKey });
      }
    },
  });
}

const mapItem =
  (id: string, update: (item: TimelineItem) => TimelineItem | undefined) =>
  (page: IssueDetail) =>
    page.timeline.items.flatMap((item) => {
      if (item.id !== id) return [item];
      const next = update(item);
      return next ? [next] : [];
    });

const countComments =
  (delta: number) =>
  (issue: IssueDetail): IssueDetail => ({
    ...issue,
    comments: Math.max(0, issue.comments + delta),
    timeline: {
      ...issue.timeline,
      total_count: Math.max(0, issue.timeline.total_count + delta),
    },
  });

/**
 * Every change to one issue, applied optimistically and rolled back with an
 * error message if GitHub refuses it.
 */
export function useIssueMutations(
  repository: RepositoryRef,
  issue: IssueDetail,
) {
  const viewer = useGithubAuth().data?.viewer;
  const [error, setError] = useState<string>();
  const base = {
    repository,
    number: issue.number,
    onFailure: setError,
  };

  const addComment = useIssueChange({
    ...base,
    action: "Could not add the comment",
    mutationFn: ({ body }: { body: string; placeholder: TimelineItem }) =>
      githubAddComment({ request: { issue_id: issue.id, body } }),
    optimistic: ({ placeholder }) => ({
      issue: countComments(1),
      // Only append when the end of the timeline is loaded; otherwise the
      // comment shows up with the remaining pages.
      timeline: (page, index, pages) =>
        index === pages - 1 && !page.timeline.has_next_page
          ? [...page.timeline.items, placeholder]
          : page.timeline.items,
      summary: (row) => ({ ...row, comments: row.comments + 1 }),
    }),
    confirmed: (comment, { placeholder }) => ({
      timeline: mapItem(placeholder.id, () => comment),
    }),
  });

  const editComment = useIssueChange({
    ...base,
    action: "Could not save the comment",
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      githubEditComment({ request: { comment_id: commentId, body } }),
    optimistic: ({ commentId, body }) => ({
      timeline: mapItem(commentId, (item) => ({ ...item, body })),
    }),
    confirmed: (comment) => ({
      timeline: mapItem(comment.id, () => comment),
    }),
  });

  const deleteComment = useIssueChange({
    ...base,
    action: "Could not delete the comment",
    mutationFn: ({ commentId }: { commentId: string }) =>
      githubDeleteComment({ commentId }),
    optimistic: ({ commentId }) => ({
      issue: countComments(-1),
      timeline: mapItem(commentId, () => undefined),
      summary: (row) => ({ ...row, comments: Math.max(0, row.comments - 1) }),
    }),
  });

  const editIssue = useIssueChange({
    ...base,
    action: "Could not save the issue",
    mutationFn: (change: { title?: string; body?: string }) =>
      githubEditIssue({ request: { issue_id: issue.id, ...change } }),
    optimistic: ({ title, body }) => ({
      issue: (current) => ({
        ...current,
        title: title?.trim() ?? current.title,
        body: body ?? current.body,
      }),
      summary: (row) => ({ ...row, title: title?.trim() ?? row.title }),
    }),
    confirmed: (content) => ({
      issue: (current) => ({ ...current, ...content }),
    }),
  });

  const closeIssue = useIssueChange({
    ...base,
    action: "Could not close the issue",
    mutationFn: ({ reason }: { reason: CloseReason }) =>
      githubCloseIssue({ request: { issue_id: issue.id, reason } }),
    optimistic: ({ reason }) => ({
      issue: (current) => ({
        ...current,
        state: "closed",
        state_reason: reason,
        closed_at: new Date().toISOString(),
      }),
      summary: (row) => ({ ...row, state: "closed", state_reason: reason }),
    }),
    confirmed: (update) => ({
      issue: (current) => ({ ...current, ...update }),
      summary: (row) => ({ ...row, ...update }),
    }),
  });

  const reopenIssue = useIssueChange({
    ...base,
    action: "Could not reopen the issue",
    mutationFn: (_: undefined) => githubReopenIssue({ issueId: issue.id }),
    optimistic: () => ({
      issue: (current) => ({
        ...current,
        state: "open",
        state_reason: "reopened",
        closed_at: undefined,
      }),
      summary: (row) => ({ ...row, state: "open", state_reason: "reopened" }),
    }),
    confirmed: (update) => ({
      issue: (current) => ({ ...current, ...update }),
      summary: (row) => ({ ...row, ...update }),
    }),
  });

  const changeLabels = useIssueChange({
    ...base,
    action: "Could not change labels",
    mutationFn: ({
      add,
      remove,
    }: {
      add: string[];
      remove: string[];
      next: Label[];
    }) =>
      githubChangeLabels({
        request: {
          issue_id: issue.id,
          add_label_ids: add,
          remove_label_ids: remove,
        },
      }),
    optimistic: ({ next }) => {
      const labels = [...next].sort(byName);
      return {
        issue: (current) => ({ ...current, labels }),
        summary: (row) => ({ ...row, labels }),
      };
    },
    confirmed: (labels) => ({
      issue: (current) => ({ ...current, labels }),
      summary: (row) => ({ ...row, labels }),
    }),
  });

  const changeAssignees = useIssueChange({
    ...base,
    action: "Could not change assignees",
    mutationFn: ({
      add,
      remove,
    }: {
      add: string[];
      remove: string[];
      next: User[];
    }) =>
      githubChangeAssignees({
        request: {
          issue_id: issue.id,
          add_user_ids: add,
          remove_user_ids: remove,
        },
      }),
    optimistic: ({ next }) => {
      const assignees = [...next].sort(byLogin);
      return {
        issue: (current) => ({ ...current, assignees }),
        summary: (row) => ({ ...row, assignees }),
      };
    },
    confirmed: (assignees) => ({
      issue: (current) => ({ ...current, assignees }),
      summary: (row) => ({ ...row, assignees }),
    }),
  });

  const setMilestone = useIssueChange({
    ...base,
    action: "Could not change the milestone",
    mutationFn: ({ milestone }: { milestone: Milestone | undefined }) =>
      githubSetMilestone({
        request: { issue_id: issue.id, milestone_id: milestone?.id },
      }),
    optimistic: ({ milestone }) => ({
      issue: (current) => ({ ...current, milestone }),
      summary: (row) => ({ ...row, milestone: milestone?.title }),
    }),
    confirmed: ({ milestone }) => ({
      issue: (current) => ({ ...current, milestone }),
    }),
  });

  const setReaction = useIssueChange({
    ...base,
    action: "Could not update the reaction",
    mutationFn: (request: {
      subject_id: string;
      content: ReactionContent;
      reacted: boolean;
    }) => githubSetReaction({ request }),
    optimistic: ({ subject_id, content, reacted }) =>
      subject_id === issue.id
        ? {
            issue: (current) => ({
              ...current,
              reactions: toggleReaction(current.reactions, content, reacted),
            }),
          }
        : {
            timeline: mapItem(subject_id, (item) => ({
              ...item,
              reactions: toggleReaction(item.reactions, content, reacted),
            })),
          },
    confirmed: (reactions, { subject_id }) =>
      subject_id === issue.id
        ? { issue: (current) => ({ ...current, reactions }) }
        : {
            timeline: mapItem(subject_id, (item) => ({ ...item, reactions })),
          },
  });

  return {
    error,
    dismissError: () => setError(undefined),
    /** Resolves when GitHub saved the comment; rejects with its error. */
    comment: (body: string) =>
      addComment.mutateAsync({
        body,
        placeholder: optimisticComment(body, viewer),
      }),
    editComment: (commentId: string, body: string) =>
      editComment.mutateAsync({ commentId, body }),
    savingCommentId: editComment.isPending
      ? editComment.variables?.commentId
      : undefined,
    deleteComment: (commentId: string) => deleteComment.mutate({ commentId }),
    editTitle: (title: string) => editIssue.mutateAsync({ title }),
    editBody: (body: string) => editIssue.mutateAsync({ body }),
    savingBody: editIssue.isPending && editIssue.variables?.body !== undefined,
    close: (reason: CloseReason) => closeIssue.mutateAsync({ reason }),
    reopen: () => reopenIssue.mutateAsync(undefined),
    changingState: closeIssue.isPending || reopenIssue.isPending,
    setLabels: (next: Label[]) => {
      const { add, remove } = idChange(issue.labels, next);
      if (add.length > 0 || remove.length > 0) {
        changeLabels.mutate({ add, remove, next });
      }
    },
    setAssignees: (next: User[]) => {
      const { add, remove } = idChange(issue.assignees, next);
      if (add.length > 0 || remove.length > 0) {
        changeAssignees.mutate({ add, remove, next });
      }
    },
    setMilestone: (milestone: Milestone | undefined) => {
      if (milestone?.id !== issue.milestone?.id) {
        setMilestone.mutate({ milestone });
      }
    },
    react: (subjectId: string, content: ReactionContent, reacted: boolean) =>
      setReaction.mutate({ subject_id: subjectId, content, reacted }),
  };
}

export type IssueMutations = ReturnType<typeof useIssueMutations>;

/**
 * Open a new issue. Lists come from GitHub search, which can take a few
 * seconds to index it, so they refresh once more shortly after.
 */
export function useCreateIssue(repository: RepositoryRef) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: Omit<CreateIssueRequest, "repository">) =>
      githubCreateIssue({ request: { ...request, repository } }),
    onSuccess: () => {
      const refresh = () =>
        void queryClient.invalidateQueries(listsOf(repository));
      refresh();
      setTimeout(refresh, SEARCH_INDEX_DELAY_MS);
    },
  });
}

const SEARCH_INDEX_DELAY_MS = 4_000;
