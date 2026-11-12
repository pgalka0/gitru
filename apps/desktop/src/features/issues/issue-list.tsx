import type { IssueSummary, RepositoryRef } from "@gitru/commands";
import { Button } from "@gitru/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@gitru/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@gitru/ui/components/input-group";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@gitru/ui/components/menu";
import { ScrollArea } from "@gitru/ui/components/scroll-area";
import { Skeleton } from "@gitru/ui/components/skeleton";
import { Spinner } from "@gitru/ui/components/spinner";
import { Toggle } from "@gitru/ui/components/toggle";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@gitru/ui/components/toggle-group";
import { cn } from "@gitru/ui/lib/utils";
import {
  ArrowDownWideNarrowIcon,
  ChevronDownIcon,
  MessageSquareIcon,
  SearchIcon,
  TagIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import { useState } from "react";
import {
  actorLogin,
  GithubAvatar,
  IssueStateIcon,
  LabelChip,
  RelativeTime,
} from "@/components/github/github-primitives";
import { githubErrorMessage } from "@/hooks/use-github";
import {
  useGithubIssues,
  useGithubRepositoryLabels,
} from "@/hooks/use-github-issues";
import {
  DEFAULT_SORT,
  DEFAULT_STATE,
  hasActiveFilters,
  type IssueSort,
  type IssueStateFilter,
  type IssuesSearch,
  issueFilters,
  SORT_LABELS,
} from "./issues-search";

export type IssuesSearchPatch = Partial<IssuesSearch>;

export function IssueList({
  repository,
  search,
  onSearchChange,
  onSelectIssue,
}: {
  repository: RepositoryRef;
  search: IssuesSearch;
  onSearchChange: (patch: IssuesSearchPatch) => void;
  onSelectIssue: (number: number) => void;
}) {
  const query = useGithubIssues(issueFilters(search, repository));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <IssueFilters
        repository={repository}
        search={search}
        onSearchChange={onSearchChange}
        totalCount={query.totalCount}
        fetching={query.isFetching}
      />

      {query.isPending && query.fetchStatus !== "idle" ? (
        <IssueListSkeleton />
      ) : query.error ? (
        <p role="alert" className="p-4 text-sm text-destructive-foreground">
          {githubErrorMessage(query.error)}
        </p>
      ) : query.issues.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle className="text-base">No issues</EmptyTitle>
            <EmptyDescription>
              {hasActiveFilters(search) || search.state
                ? "Nothing matches these filters."
                : "This repository has no open issues."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul aria-label="Issues" className="flex flex-col">
            {query.issues.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                selected={issue.number === search.issue}
                onSelect={() => onSelectIssue(issue.number)}
              />
            ))}
          </ul>
          {query.hasNextPage && (
            <div className="flex justify-center p-3">
              <Button
                variant="outline"
                size="sm"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage && <Spinner />}
                Load more
              </Button>
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}

function IssueFilters({
  repository,
  search,
  onSearchChange,
  totalCount,
  fetching,
}: {
  repository: RepositoryRef;
  search: IssuesSearch;
  onSearchChange: (patch: IssuesSearchPatch) => void;
  totalCount: number | undefined;
  fetching: boolean;
}) {
  const state = search.state ?? DEFAULT_STATE;
  const sort = search.sort ?? DEFAULT_SORT;

  return (
    <div className="flex flex-col gap-2 border-b p-3">
      {/* Remount when the committed text changes elsewhere (e.g. "Clear"). */}
      <IssueSearchInput
        key={search.q ?? ""}
        committed={search.q ?? ""}
        onCommit={(q) =>
          onSearchChange({ q: q || undefined, issue: undefined })
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[state]}
          onValueChange={(value: string[]) => {
            const next = value[0] as IssueStateFilter | undefined;
            if (next) {
              onSearchChange({
                state: next === DEFAULT_STATE ? undefined : next,
                issue: undefined,
              });
            }
          }}
          aria-label="Issue state"
        >
          <ToggleGroupItem value="open">Open</ToggleGroupItem>
          <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>

        <Toggle
          variant="outline"
          size="sm"
          pressed={search.mine === true}
          onPressedChange={(pressed: boolean) =>
            onSearchChange({ mine: pressed || undefined, issue: undefined })
          }
          aria-label="Assigned to me"
          title="Assigned to me"
        >
          <UserRoundCheckIcon />
        </Toggle>

        <LabelFilter
          repository={repository}
          selected={search.labels ?? []}
          onChange={(labels) =>
            onSearchChange({
              labels: labels.length > 0 ? labels : undefined,
              issue: undefined,
            })
          }
        />

        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="sm" className="ml-auto" />}
          >
            <ArrowDownWideNarrowIcon />
            {SORT_LABELS[sort]}
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuRadioGroup
              value={sort}
              onValueChange={(value: IssueSort) =>
                onSearchChange({
                  sort: value === DEFAULT_SORT ? undefined : value,
                })
              }
            >
              {(Object.keys(SORT_LABELS) as IssueSort[]).map((value) => (
                <MenuRadioItem key={value} value={value}>
                  {SORT_LABELS[value]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      </div>

      <div className="flex h-4 items-center gap-2 text-xs text-muted-foreground">
        {totalCount !== undefined && (
          <span className="tabular-nums">
            {totalCount.toLocaleString()}{" "}
            {totalCount === 1 ? "issue" : "issues"}
          </span>
        )}
        {fetching && <Spinner className="size-3" />}
        {hasActiveFilters(search) && (
          <button
            type="button"
            className="ml-auto hover:text-foreground hover:underline"
            onClick={() =>
              onSearchChange({
                q: undefined,
                labels: undefined,
                mine: undefined,
                issue: undefined,
              })
            }
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function IssueSearchInput({
  committed,
  onCommit,
}: {
  committed: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(committed);
  const commit = () => {
    const value = draft.trim();
    if (value !== committed) onCommit(value);
  };

  return (
    <InputGroup>
      <InputGroupInput
        aria-label="Search issues"
        placeholder="Search, e.g. author:octocat crash"
        type="search"
        value={draft}
        maxLength={256}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape" && draft) {
            event.stopPropagation();
            setDraft("");
            if (committed) onCommit("");
          }
        }}
        onBlur={commit}
      />
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
    </InputGroup>
  );
}

function LabelFilter({
  repository,
  selected,
  onChange,
}: {
  repository: RepositoryRef;
  selected: string[];
  onChange: (labels: string[]) => void;
}) {
  const labels = useGithubRepositoryLabels(repository);
  const known = labels.data ?? [];
  // Keep labels from the URL visible even if the repository no longer has them.
  const extra = selected
    .filter((name) => !known.some((label) => label.name === name))
    .map((name) => ({ name, color: "ededed", description: undefined }));
  const options = [...known, ...extra];

  const toggle = (name: string, checked: boolean) =>
    onChange(
      checked
        ? [...selected, name]
        : selected.filter((current) => current !== name),
    );

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(selected.length > 0 && "border-primary/40")}
          />
        }
      >
        <TagIcon />
        {selected.length > 0 ? `Labels (${selected.length})` : "Labels"}
        <ChevronDownIcon className="opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-80 w-64 overflow-y-auto">
        <MenuGroup>
          <MenuGroupLabel>Filter by label</MenuGroupLabel>
          {labels.isPending && labels.fetchStatus !== "idle" && (
            <div className="flex justify-center p-2">
              <Spinner />
            </div>
          )}
          {labels.error && (
            <p className="px-2 py-1 text-xs text-destructive-foreground">
              {githubErrorMessage(labels.error)}
            </p>
          )}
          {!labels.isPending && options.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              This repository has no labels.
            </p>
          )}
          {options.map((label) => (
            <MenuCheckboxItem
              key={label.name}
              checked={selected.includes(label.name)}
              onCheckedChange={(checked: boolean) =>
                toggle(label.name, checked)
              }
            >
              <LabelChip label={label} />
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function IssueRow({
  issue,
  selected,
  onSelect,
}: {
  issue: IssueSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full gap-2.5 px-3 py-2.5 text-left outline-none transition-colors",
          "hover:bg-accent/50 focus-visible:bg-accent/60",
          selected && "bg-accent",
        )}
      >
        <IssueStateIcon
          state={issue.state}
          state_reason={issue.state_reason}
          className="mt-0.5 size-4 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-5 [overflow-wrap:anywhere]">
            {issue.title}
            {issue.labels.map((label) => (
              <LabelChip
                key={label.name}
                label={label}
                className="ms-1.5 align-[1px]"
              />
            ))}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            #{issue.number}{" "}
            {issue.state === "open" || !issue.closed_at ? (
              <>
                opened <RelativeTime iso={issue.created_at} />
              </>
            ) : (
              <>
                closed <RelativeTime iso={issue.closed_at} />
              </>
            )}{" "}
            by {actorLogin(issue.author)}
            {issue.milestone && <> · {issue.milestone}</>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {issue.assignees.length > 0 && (
            <div className="flex -space-x-1.5">
              {issue.assignees.slice(0, 3).map((assignee) => (
                <GithubAvatar
                  key={assignee.login}
                  actor={assignee}
                  className="size-4 ring-2 ring-background"
                />
              ))}
            </div>
          )}
          {issue.comments > 0 && (
            <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <MessageSquareIcon className="size-3" aria-hidden />
              {issue.comments}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function IssueListSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-3" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex gap-2.5">
          <Skeleton className="size-4 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
