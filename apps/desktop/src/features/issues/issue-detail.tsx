import type { IssueDetail, RepositoryRef, TimelineItem } from "@gitru/commands";
import { Button } from "@gitru/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@gitru/ui/components/empty";
import { Input } from "@gitru/ui/components/input";
import { ScrollArea } from "@gitru/ui/components/scroll-area";
import { Skeleton } from "@gitru/ui/components/skeleton";
import { Spinner } from "@gitru/ui/components/spinner";
import { cn } from "@gitru/ui/lib/utils";
import {
  ExternalLinkIcon,
  LockIcon,
  MousePointerClickIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import {
  actorLogin,
  GithubAvatar,
  IssueStateIcon,
  issueStateLabel,
  LabelChip,
  RelativeTime,
} from "@/components/github/github-primitives";
import { githubErrorMessage } from "@/hooks/use-github";
import {
  type IssueMutations,
  useIssueMutations,
} from "@/hooks/use-github-issue-mutations";
import { useGithubIssue } from "@/hooks/use-github-issues";
import { isOptimistic } from "@/lib/github-issue-changes";
import { openExternalUrlSafely } from "@/lib/open-external-url";
import { IssueComposer, useIssueDraft } from "./issue-composer";
import {
  AssigneesPicker,
  LabelsPicker,
  MilestonePicker,
} from "./issue-pickers";
import {
  type CommentActions,
  CommentCard,
  type OpenIssueHandler,
  ReferenceLink,
  TimelineEntry,
} from "./issue-timeline";

export function IssueDetailPane({
  repository,
  number,
  onOpenIssue,
}: {
  repository: RepositoryRef;
  number: number | undefined;
  onOpenIssue: OpenIssueHandler;
}) {
  if (number === undefined) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MousePointerClickIcon />
          </EmptyMedia>
          <EmptyTitle className="text-base">Select an issue</EmptyTitle>
          <EmptyDescription>
            Pick an issue from the list to read it here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <IssueDetailView
      // A different issue starts from the top with fresh state.
      key={`${repository.owner}/${repository.name}#${number}`}
      repository={repository}
      number={number}
      onOpenIssue={onOpenIssue}
    />
  );
}

function IssueDetailView({
  repository,
  number,
  onOpenIssue,
}: {
  repository: RepositoryRef;
  number: number;
  onOpenIssue: OpenIssueHandler;
}) {
  const query = useGithubIssue(repository, number);
  const { issue, timeline } = query;

  if (query.isPending) {
    return <IssueDetailSkeleton />;
  }

  if (query.error || !issue) {
    return (
      <div className="p-6">
        <p role="alert" className="text-sm text-destructive-foreground">
          {githubErrorMessage(query.error ?? "Issue not found")}
        </p>
      </div>
    );
  }

  return (
    <IssueDetailContent
      repository={repository}
      issue={issue}
      timeline={timeline}
      query={query}
      onOpenIssue={onOpenIssue}
    />
  );
}

function IssueDetailContent({
  repository,
  issue,
  timeline,
  query,
  onOpenIssue,
}: {
  repository: RepositoryRef;
  issue: IssueDetail;
  timeline: TimelineItem[];
  query: Pick<
    ReturnType<typeof useGithubIssue>,
    "isFetching" | "hasNextPage" | "isFetchingNextPage" | "fetchNextPage"
  >;
  onOpenIssue: OpenIssueHandler;
}) {
  const mutations = useIssueMutations(repository, issue);
  const [draft, setDraft] = useIssueDraft(issue.id);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const currentRepository = `${repository.owner}/${repository.name}`;
  const remaining = Math.max(0, issue.timeline.total_count - timeline.length);
  const { viewer } = issue;

  const appendQuote = (markdown: string) => {
    setDraft((current) =>
      current.trim()
        ? `${current.replace(/\s*$/, "")}\n\n${markdown}`
        : markdown,
    );
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ block: "center" });
    });
  };
  const quoteReply = viewer.can_comment ? appendQuote : undefined;

  const bodyActions: CommentActions = {
    onSave: viewer.can_update ? mutations.editBody : undefined,
    onReact: viewer.can_react
      ? (content, reacted) => mutations.react(issue.id, content, reacted)
      : undefined,
    onQuote: quoteReply,
    saving: mutations.savingBody,
  };

  const commentActions = (item: TimelineItem): CommentActions | undefined => {
    if (item.kind !== "comment" || isOptimistic(item)) return undefined;
    return {
      onSave: item.viewer_can_update
        ? (body) => mutations.editComment(item.id, body)
        : undefined,
      onDelete: item.viewer_can_delete
        ? () => mutations.deleteComment(item.id)
        : undefined,
      onReact: item.viewer_can_react
        ? (content, reacted) => mutations.react(item.id, content, reacted)
        : undefined,
      onQuote: quoteReply,
      saving: mutations.savingCommentId === item.id,
    };
  };

  return (
    <ScrollArea className="h-full">
      <div className="@container mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">
        <IssueHeader
          issue={issue}
          fetching={query.isFetching}
          onSaveTitle={viewer.can_update ? mutations.editTitle : undefined}
        />

        {mutations.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground"
          >
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {mutations.error}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss"
              onClick={mutations.dismissError}
            >
              <XIcon />
            </Button>
          </div>
        )}

        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_13rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <CommentCard
              actor={issue.author}
              association={issue.author_association}
              createdAt={issue.created_at}
              lastEditedAt={issue.last_edited_at}
              bodyHtml={issue.body_html}
              body={issue.body}
              reactions={issue.reactions}
              htmlUrl={issue.html_url}
              verb="opened this issue"
              repository={repository}
              actions={bodyActions}
              onOpenIssue={onOpenIssue}
            />

            {timeline.map((item) => (
              <TimelineEntry
                key={item.id}
                item={item}
                currentRepository={currentRepository}
                repository={repository}
                actions={commentActions(item)}
                pending={isOptimistic(item)}
                onOpenIssue={onOpenIssue}
              />
            ))}

            {query.hasNextPage && (
              <div className="flex justify-center py-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage && <Spinner />}
                  Load{" "}
                  {remaining > 0
                    ? `${remaining.toLocaleString()} more`
                    : "more"}
                </Button>
              </div>
            )}

            {issue.locked && viewer.can_comment && (
              <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <LockIcon className="size-3.5" aria-hidden />
                This conversation has been locked
                {issue.active_lock_reason
                  ? ` as ${issue.active_lock_reason.toLowerCase().replace("_", " ")}`
                  : ""}
                . You can still comment as a collaborator.
              </p>
            )}

            <IssueComposer
              repository={repository}
              issue={issue}
              mutations={mutations}
              draft={draft}
              setDraft={setDraft}
              textareaRef={composerRef}
            />
          </div>

          <IssueSidebar
            repository={repository}
            issue={issue}
            mutations={mutations}
            currentRepository={currentRepository}
            onOpenIssue={onOpenIssue}
          />
        </div>
      </div>
    </ScrollArea>
  );
}

function IssueTitle({
  issue,
  onSave,
}: {
  issue: IssueDetail;
  onSave?: (title: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing && onSave) {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      const title = draft.trim();
      if (!title) return;
      setEditing(false);
      if (title === issue.title) return;
      onSave(title).catch(() => {
        setDraft(title);
        setEditing(true);
      });
    };

    return (
      <form
        onSubmit={submit}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <Input
          aria-label="Issue title"
          value={draft}
          maxLength={256}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
          autoFocus
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <>
      <h1 className="min-w-0 flex-1 text-xl font-semibold leading-snug [overflow-wrap:anywhere]">
        {issue.title}{" "}
        <span className="font-normal text-muted-foreground">
          #{issue.number}
        </span>
      </h1>
      {onSave && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(issue.title);
            setEditing(true);
          }}
        >
          <PencilIcon />
          Edit
        </Button>
      )}
    </>
  );
}

function IssueHeader({
  issue,
  fetching,
  onSaveTitle,
}: {
  issue: IssueDetail;
  fetching: boolean;
  onSaveTitle?: (title: string) => Promise<unknown>;
}) {
  const open = issue.state === "open";
  const notPlanned =
    issue.state_reason === "notPlanned" || issue.state_reason === "duplicate";

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-start gap-1">
        <IssueTitle issue={issue} onSave={onSaveTitle} />
        <div className="flex shrink-0 items-center gap-1">
          {fetching && <Spinner className="size-3.5" />}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openExternalUrlSafely(issue.html_url)}
          >
            <ExternalLinkIcon />
            GitHub
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white",
            open
              ? "bg-emerald-600"
              : notPlanned
                ? "bg-neutral-500"
                : "bg-violet-600",
          )}
        >
          <IssueStateIcon
            state={issue.state}
            state_reason={issue.state_reason}
            className="size-3.5 text-white dark:text-white"
          />
          {issueStateLabel(issue)}
        </span>
        <span>
          <span className="font-medium text-foreground">
            {actorLogin(issue.author)}
          </span>{" "}
          opened this <RelativeTime iso={issue.created_at} /> ·{" "}
          {issue.comments.toLocaleString()}{" "}
          {issue.comments === 1 ? "comment" : "comments"}
        </span>
      </div>
    </header>
  );
}

function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  /** A picker trigger shown next to the title. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5 border-b pb-3 last:border-b-0">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="text-sm">{children}</div>
    </section>
  );
}

const None = ({ children }: { children: ReactNode }) => (
  <span className="text-xs text-muted-foreground">{children}</span>
);

function IssueSidebar({
  repository,
  issue,
  mutations,
  currentRepository,
  onOpenIssue,
}: {
  repository: RepositoryRef;
  issue: IssueDetail;
  mutations: IssueMutations;
  currentRepository: string;
  onOpenIssue: OpenIssueHandler;
}) {
  const { viewer } = issue;
  return (
    <aside className="flex flex-col gap-3 @3xl:sticky @3xl:top-0 @3xl:self-start">
      <SidebarSection
        title="Assignees"
        action={
          viewer.can_assign && (
            <AssigneesPicker
              repository={repository}
              selected={issue.assignees}
              onChange={mutations.setAssignees}
            />
          )
        }
      >
        {issue.assignees.length === 0 ? (
          <None>No one assigned</None>
        ) : (
          <ul className="flex flex-col gap-1">
            {issue.assignees.map((assignee) => (
              <li key={assignee.id} className="flex items-center gap-1.5">
                <GithubAvatar actor={assignee} />
                <span className="truncate">{assignee.login}</span>
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      <SidebarSection
        title="Labels"
        action={
          viewer.can_label && (
            <LabelsPicker
              repository={repository}
              selected={issue.labels}
              onChange={mutations.setLabels}
            />
          )
        }
      >
        {issue.labels.length === 0 ? (
          <None>None yet</None>
        ) : (
          <div className="flex flex-wrap gap-1">
            {issue.labels.map((label) => (
              <LabelChip key={label.id} label={label} />
            ))}
          </div>
        )}
      </SidebarSection>

      <SidebarSection
        title="Milestone"
        action={
          viewer.can_set_milestone && (
            <MilestonePicker
              repository={repository}
              selected={issue.milestone}
              onChange={mutations.setMilestone}
            />
          )
        }
      >
        {issue.milestone ? (
          <button
            type="button"
            className="text-left hover:underline"
            onClick={() =>
              issue.milestone &&
              void openExternalUrlSafely(issue.milestone.html_url)
            }
          >
            {issue.milestone.title}
            {issue.milestone.due_on && (
              <span className="block text-xs text-muted-foreground">
                Due {new Date(issue.milestone.due_on).toLocaleDateString()}
              </span>
            )}
          </button>
        ) : (
          <None>No milestone</None>
        )}
      </SidebarSection>

      <SidebarSection title="Development">
        {issue.linked_pull_requests.length === 0 ? (
          <None>No linked pull requests</None>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {issue.linked_pull_requests.map((reference) => (
              <li key={reference.html_url} className="min-w-0">
                <ReferenceLink
                  reference={reference}
                  currentRepository={currentRepository}
                  onOpenIssue={onOpenIssue}
                />
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      <SidebarSection
        title={`${issue.participant_count.toLocaleString()} ${issue.participant_count === 1 ? "participant" : "participants"}`}
      >
        <div className="flex flex-wrap gap-1">
          {issue.participants.map((participant) => (
            <span key={participant.login} title={participant.login}>
              <GithubAvatar actor={participant} />
            </span>
          ))}
        </div>
      </SidebarSection>
    </aside>
  );
}

function IssueDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-6 py-5" aria-busy="true">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
