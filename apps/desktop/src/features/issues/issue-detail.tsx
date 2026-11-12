import type { IssueDetail, RepositoryRef } from "@gitru/commands";
import { Button } from "@gitru/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@gitru/ui/components/empty";
import { ScrollArea } from "@gitru/ui/components/scroll-area";
import { Skeleton } from "@gitru/ui/components/skeleton";
import { Spinner } from "@gitru/ui/components/spinner";
import { cn } from "@gitru/ui/lib/utils";
import {
  ExternalLinkIcon,
  LockIcon,
  MousePointerClickIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  actorLogin,
  GithubAvatar,
  IssueStateIcon,
  issueStateLabel,
  LabelChip,
  RelativeTime,
} from "@/components/github/github-primitives";
import { githubErrorMessage } from "@/hooks/use-github";
import { useGithubIssue } from "@/hooks/use-github-issues";
import { openExternalUrlSafely } from "@/lib/open-external-url";
import {
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
  const currentRepository = `${repository.owner}/${repository.name}`;

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

  const remaining = Math.max(0, issue.timeline.total_count - timeline.length);

  return (
    <ScrollArea className="h-full">
      <div className="@container mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">
        <IssueHeader issue={issue} fetching={query.isFetching} />

        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_13rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <CommentCard
              actor={issue.author}
              association={issue.author_association}
              createdAt={issue.created_at}
              lastEditedAt={issue.last_edited_at}
              bodyHtml={issue.body_html}
              reactions={issue.reactions}
              htmlUrl={issue.html_url}
              verb="opened this issue"
              onOpenIssue={onOpenIssue}
            />

            {timeline.map((item) => (
              <TimelineEntry
                key={item.id}
                item={item}
                currentRepository={currentRepository}
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

            {issue.locked && (
              <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <LockIcon className="size-3.5" aria-hidden />
                This conversation has been locked
                {issue.active_lock_reason
                  ? ` as ${issue.active_lock_reason.toLowerCase().replace("_", " ")}`
                  : ""}
                .
              </p>
            )}
          </div>

          <IssueSidebar
            issue={issue}
            currentRepository={currentRepository}
            onOpenIssue={onOpenIssue}
          />
        </div>
      </div>
    </ScrollArea>
  );
}

function IssueHeader({
  issue,
  fetching,
}: {
  issue: IssueDetail;
  fetching: boolean;
}) {
  const open = issue.state === "open";
  const notPlanned =
    issue.state_reason === "notPlanned" || issue.state_reason === "duplicate";

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 text-xl font-semibold leading-snug [overflow-wrap:anywhere]">
          {issue.title}{" "}
          <span className="font-normal text-muted-foreground">
            #{issue.number}
          </span>
        </h1>
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
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5 border-b pb-3 last:border-b-0">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}

const None = ({ children }: { children: ReactNode }) => (
  <span className="text-xs text-muted-foreground">{children}</span>
);

function IssueSidebar({
  issue,
  currentRepository,
  onOpenIssue,
}: {
  issue: IssueDetail;
  currentRepository: string;
  onOpenIssue: OpenIssueHandler;
}) {
  return (
    <aside className="flex flex-col gap-3 @3xl:sticky @3xl:top-0 @3xl:self-start">
      <SidebarSection title="Assignees">
        {issue.assignees.length === 0 ? (
          <None>No one assigned</None>
        ) : (
          <ul className="flex flex-col gap-1">
            {issue.assignees.map((assignee) => (
              <li key={assignee.login} className="flex items-center gap-1.5">
                <GithubAvatar actor={assignee} />
                <span className="truncate">{assignee.login}</span>
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      <SidebarSection title="Labels">
        {issue.labels.length === 0 ? (
          <None>None yet</None>
        ) : (
          <div className="flex flex-wrap gap-1">
            {issue.labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </div>
        )}
      </SidebarSection>

      <SidebarSection title="Milestone">
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
