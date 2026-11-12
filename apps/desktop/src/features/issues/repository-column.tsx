import type { RepositoryRef, RepositorySummaryResult } from "@gitru/commands";
import { Issue } from "@gitru/icon";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@gitru/ui/components/avatar";
import { ScrollArea } from "@gitru/ui/components/scroll-area";
import { Skeleton } from "@gitru/ui/components/skeleton";
import { cn } from "@gitru/ui/lib/utils";
import { LockIcon } from "lucide-react";
import { useMemo } from "react";
import { useGithubRepositorySummaries } from "@/hooks/use-github";
import { githubAccountAvatarUrl } from "@/lib/external-content";
import {
  type GithubRepositoryGroup,
  githubRepositoryKey,
  MAX_GITHUB_REPOSITORIES_PER_REQUEST,
} from "@/lib/github-repositories";

export function RepositoryColumn({
  groups,
  selected,
  onSelect,
}: {
  groups: GithubRepositoryGroup[];
  selected: RepositoryRef | undefined;
  onSelect: (repository: RepositoryRef) => void;
}) {
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
  const selectedKey = selected ? githubRepositoryKey(selected) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3 pb-2 text-xs font-medium text-muted-foreground">
        Repositories
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav
          aria-label="Repositories"
          className="flex flex-col gap-px px-1.5 pb-2"
        >
          {groups.map((group) => (
            <RepositoryItem
              key={group.key}
              group={group}
              result={resultsByKey.get(group.key)}
              loading={summaries.isPending && summaries.fetchStatus !== "idle"}
              selected={group.key === selectedKey}
              onSelect={() => onSelect(group.ref)}
            />
          ))}
        </nav>
      </ScrollArea>
    </div>
  );
}

function RepositoryItem({
  group,
  result,
  loading,
  selected,
  onSelect,
}: {
  group: GithubRepositoryGroup;
  result?: RepositorySummaryResult;
  loading: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { owner, name } = group.ref;
  const summary = result?.summary;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "page" : undefined}
      title={result?.error ?? `${owner}/${name}`}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors",
        "hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-accent text-accent-foreground",
      )}
    >
      <Avatar className="size-5 shrink-0 rounded">
        <AvatarImage src={githubAccountAvatarUrl(owner)} alt="" />
        <AvatarFallback className="rounded text-[0.6rem]">
          {owner.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{owner}/</span>
        {name}
      </span>
      {summary?.is_private && (
        <LockIcon
          aria-label="Private"
          className="size-3 shrink-0 text-muted-foreground"
        />
      )}
      <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
        <Issue className="size-3.5" aria-hidden />
        {loading ? (
          <Skeleton className="h-3 w-4" />
        ) : result?.error ? (
          <span className="text-destructive-foreground">!</span>
        ) : (
          (summary?.open_issues ?? "–")
        )}
      </span>
    </button>
  );
}
