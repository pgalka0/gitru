import type { IssueDetail, RepositoryRef } from "@gitru/commands";
import { Button } from "@gitru/ui/components/button";
import { Group, GroupSeparator } from "@gitru/ui/components/group";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@gitru/ui/components/menu";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  LockIcon,
} from "lucide-react";
import { type Ref, useCallback, useState } from "react";
import { GithubAvatar } from "@/components/github/github-primitives";
import {
  MAX_MARKDOWN_LENGTH,
  MarkdownEditor,
} from "@/components/github/markdown-editor";
import { useGithubAuth } from "@/hooks/use-github";
import type { IssueMutations } from "@/hooks/use-github-issue-mutations";
import type { CloseReason } from "@/lib/github-issue-changes";

// Unsent comments survive switching between issues for the session.
const drafts = new Map<string, string>();

/** The comment draft of one issue, kept while the app runs. */
export function useIssueDraft(issueId: string) {
  const [draft, setDraftState] = useState(() => drafts.get(issueId) ?? "");

  const setDraft = useCallback(
    (next: string | ((current: string) => string)) =>
      setDraftState((current) => {
        const value = typeof next === "function" ? next(current) : next;
        // Idempotent, so a repeated updater call in StrictMode is harmless.
        if (value) drafts.set(issueId, value);
        else drafts.delete(issueId);
        return value;
      }),
    [issueId],
  );

  return [draft, setDraft] as const;
}

const CLOSE_LABEL: Record<CloseReason, string> = {
  completed: "Close as completed",
  notPlanned: "Close as not planned",
};

export function IssueComposer({
  repository,
  issue,
  mutations,
  draft,
  setDraft,
  textareaRef,
}: {
  repository: RepositoryRef;
  issue: IssueDetail;
  mutations: IssueMutations;
  draft: string;
  setDraft: (next: string | ((current: string) => string)) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const viewer = useGithubAuth().data?.viewer;
  const { can_comment, can_close, can_reopen } = issue.viewer;
  const open = issue.state === "open";
  const hasText = draft.trim().length > 0;
  const tooLong = draft.length > MAX_MARKDOWN_LENGTH;

  /** Post the draft; on failure put it back so nothing typed is lost. */
  const postDraft = async () => {
    const body = draft;
    setDraft("");
    try {
      await mutations.comment(body);
      return true;
    } catch {
      setDraft((current) => (current.trim() ? current : body));
      return false;
    }
  };

  const submitComment = () => {
    if (hasText && !tooLong) void postDraft();
  };

  const close = async (reason: CloseReason) => {
    if (hasText && can_comment && !(await postDraft())) return;
    await mutations.close(reason).catch(() => undefined);
  };

  const reopen = async () => {
    if (hasText && can_comment && !(await postDraft())) return;
    await mutations.reopen().catch(() => undefined);
  };

  const stateButton =
    open && can_close ? (
      <Group aria-label="Close issue">
        <Button
          variant="outline"
          size="sm"
          disabled={mutations.changingState || tooLong}
          onClick={() => void close("completed")}
        >
          <CircleCheckIcon className="text-violet-600 dark:text-violet-400" />
          {hasText && can_comment ? "Close with comment" : "Close issue"}
        </Button>
        <GroupSeparator />
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Choose how to close"
                disabled={mutations.changingState || tooLong}
              />
            }
          >
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => void close("completed")}>
              <CircleCheckIcon className="text-violet-600 dark:text-violet-400" />
              {CLOSE_LABEL.completed}
            </MenuItem>
            <MenuItem onClick={() => void close("notPlanned")}>
              <CircleSlashIcon />
              {CLOSE_LABEL.notPlanned}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </Group>
    ) : !open && can_reopen ? (
      <Button
        variant="outline"
        size="sm"
        disabled={mutations.changingState || tooLong}
        onClick={() => void reopen()}
      >
        <CircleDotIcon className="text-emerald-600 dark:text-emerald-400" />
        {hasText && can_comment ? "Reopen with comment" : "Reopen issue"}
      </Button>
    ) : null;

  if (!can_comment) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <LockIcon className="size-3.5" aria-hidden />
        <span className="me-auto">
          {issue.locked
            ? "This conversation is locked. Only collaborators can comment."
            : "You cannot comment on this issue."}
        </span>
        {stateButton}
      </div>
    );
  }

  return (
    <section aria-label="Add a comment" className="flex gap-3">
      <GithubAvatar actor={viewer} className="mt-1 hidden size-8 @xl:flex" />
      <MarkdownEditor
        className="min-w-0 flex-1"
        repository={repository}
        label="Comment"
        value={draft}
        onChange={setDraft}
        onSubmit={submitComment}
        textareaRef={textareaRef}
        footer={
          <>
            {stateButton}
            <Button
              size="sm"
              disabled={!hasText || tooLong}
              onClick={submitComment}
            >
              Comment
            </Button>
          </>
        }
      />
    </section>
  );
}
