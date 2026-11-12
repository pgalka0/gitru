import type { RepositorySummaryResult } from "@gitru/commands";
import { Issue, PullRequest } from "@gitru/icon";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@gitru/ui/components/avatar";
import { Badge } from "@gitru/ui/components/badge";
import { Button } from "@gitru/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@gitru/ui/components/empty";
import { ScrollArea } from "@gitru/ui/components/scroll-area";
import { Skeleton } from "@gitru/ui/components/skeleton";
import { Spinner } from "@gitru/ui/components/spinner";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLinkIcon, FolderGit2Icon, GithubIcon } from "lucide-react";
import { useMemo } from "react";
import { GithubSignInOptions } from "@/components/github/github-sign-in-options";
import PageLayout from "@/components/page-layout";
import {
  githubErrorMessage,
  useGithubAuth,
  useGithubRepositorySummaries,
} from "@/hooks/use-github";
import { useRepositories } from "@/hooks/use-repositories";
import { githubAccountAvatarUrl } from "@/lib/external-content";
import {
  type GithubRepositoryGroup,
  githubRepositoryKey,
  groupGithubRepositories,
  MAX_GITHUB_REPOSITORIES_PER_REQUEST,
} from "@/lib/github-repositories";
import { openExternalUrlSafely } from "@/lib/open-external-url";

export const Route = createFileRoute("/app/issues/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: auth, isPending } = useGithubAuth();

  return (
    <PageLayout>
      <header className="flex items-center justify-between gap-4 border-b px-5 py-3">
        <div className="min-w-0">
          <h1 className="font-heading text-base font-semibold">Issues</h1>
          <p className="text-xs text-muted-foreground">
            GitHub repositories you have cloned locally, grouped by repository.
          </p>
        </div>
      </header>

      {isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : auth?.signed_in ? (
        <RepositoryOverview />
      ) : (
        <SignedOutState error={auth?.error} />
      )}
    </PageLayout>
  );
}

function SignedOutState({ error }: { error?: string }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GithubIcon />
        </EmptyMedia>
        <EmptyTitle>Connect GitHub to see issues</EmptyTitle>
        <EmptyDescription>
          Gitru reads issues and pull requests for the repositories you work on.
          Your token stays in the system keychain.
        </EmptyDescription>
        {error && (
          <p className="text-sm text-destructive-foreground" role="alert">
            {error}
          </p>
        )}
      </EmptyHeader>
      <EmptyContent>
        <GithubSignInOptions className="w-64" />
      </EmptyContent>
    </Empty>
  );
}

function RepositoryOverview() {
  const { repositories } = useRepositories();
  const groups = useMemo(
    () => groupGithubRepositories(repositories),
    [repositories],
  );
  const requested = useMemo(
    () =>
      groups
        .slice(0, MAX_GITHUB_REPOSITORIES_PER_REQUEST)
        .map((group) => group.ref),
    [groups],
  );
  const summaries = useGithubRepositorySummaries(requested);

  const resultsByKey = useMemo(() => {
    const map = new Map<string, RepositorySummaryResult>();
    for (const result of summaries.data ?? []) {
      map.set(githubRepositoryKey(result), result);
    }
    return map;
  }, [summaries.data]);

  if (groups.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderGit2Icon />
          </EmptyMedia>
          <EmptyTitle>No GitHub repositories yet</EmptyTitle>
          <EmptyDescription>
            Add or clone a repository whose <code>origin</code> remote points at
            github.com and it will show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-3 p-5">
        {summaries.error && (
          <p className="text-sm text-destructive-foreground" role="alert">
            {githubErrorMessage(summaries.error)}
          </p>
        )}
        {groups.length > MAX_GITHUB_REPOSITORIES_PER_REQUEST && (
          <p className="text-xs text-muted-foreground">
            Showing counts for the first {MAX_GITHUB_REPOSITORIES_PER_REQUEST}{" "}
            of {groups.length} repositories.
          </p>
        )}
        <ul className="flex flex-col divide-y rounded-lg border">
          {groups.map((group) => (
            <RepositoryRow
              key={group.key}
              group={group}
              result={resultsByKey.get(group.key)}
              loading={summaries.isPending && summaries.fetchStatus !== "idle"}
            />
          ))}
        </ul>
      </div>
    </ScrollArea>
  );
}

function RepositoryRow({
  group,
  result,
  loading,
}: {
  group: GithubRepositoryGroup;
  result?: RepositorySummaryResult;
  loading: boolean;
}) {
  const { owner, name } = group.ref;
  const summary = result?.summary;
  const htmlUrl = summary?.url ?? `https://github.com/${owner}/${name}`;
  const localNames = group.localRepositories.map((repo) => repo.name);

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar className="size-8 rounded-md">
        <AvatarImage src={githubAccountAvatarUrl(owner)} alt={owner} />
        <AvatarFallback className="rounded-md text-xs">
          {owner.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            <span className="text-muted-foreground">{owner}/</span>
            {name}
          </span>
          {summary?.is_private && (
            <Badge variant="outline" size="sm">
              Private
            </Badge>
          )}
        </div>
        {result?.error ? (
          <p className="truncate text-xs text-destructive-foreground">
            {result.error}
          </p>
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            Local: {localNames.join(", ")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4 text-sm tabular-nums">
        <Count
          label="Open issues"
          icon={<Issue className="size-4" />}
          value={summary?.open_issues}
          loading={loading}
        />
        <Count
          label="Open pull requests"
          icon={<PullRequest className="size-4" />}
          value={summary?.open_pull_requests}
          loading={loading}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Open ${owner}/${name} on GitHub`}
          title="Open on GitHub"
          onClick={() => void openExternalUrlSafely(htmlUrl)}
        >
          <ExternalLinkIcon />
        </Button>
      </div>
    </li>
  );
}

function Count({
  label,
  icon,
  value,
  loading,
}: {
  label: string;
  icon: React.ReactNode;
  value?: number;
  loading: boolean;
}) {
  return (
    <span
      className="flex min-w-12 items-center gap-1.5 text-muted-foreground"
      title={label}
    >
      {icon}
      {loading ? (
        <Skeleton className="h-4 w-6" />
      ) : (
        <span className="text-foreground">{value ?? "–"}</span>
      )}
    </span>
  );
}
