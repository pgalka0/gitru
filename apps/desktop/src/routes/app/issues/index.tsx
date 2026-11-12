import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@gitru/ui/components/empty";
import { Spinner } from "@gitru/ui/components/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderGit2Icon, GithubIcon } from "lucide-react";
import { useMemo } from "react";
import { GithubSignInOptions } from "@/components/github/github-sign-in-options";
import PageLayout from "@/components/page-layout";
import { ResizableLayout } from "@/components/resizable-layout";
import { IssueDetailPane } from "@/features/issues/issue-detail";
import {
  IssueList,
  type IssuesSearchPatch,
} from "@/features/issues/issue-list";
import type { OpenIssueHandler } from "@/features/issues/issue-timeline";
import {
  parseRepoParam,
  repoParam,
  validateIssuesSearch,
} from "@/features/issues/issues-search";
import { RepositoryColumn } from "@/features/issues/repository-column";
import { useGithubAuth } from "@/hooks/use-github";
import { useRepositories } from "@/hooks/use-repositories";
import {
  githubRepositoryKey,
  groupGithubRepositories,
} from "@/lib/github-repositories";

export const Route = createFileRoute("/app/issues/")({
  validateSearch: validateIssuesSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { data: auth, isPending } = useGithubAuth();

  return (
    <PageLayout>
      {isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : auth?.signed_in ? (
        <IssuesWorkspace />
      ) : (
        <SignedOutState error={auth?.error} />
      )}
    </PageLayout>
  );
}

function IssuesWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { repositories } = useRepositories();
  const groups = useMemo(
    () => groupGithubRepositories(repositories),
    [repositories],
  );

  // Without an explicit choice, show the first repository.
  const repository = parseRepoParam(search.repo) ?? groups[0]?.ref;

  const update = (patch: IssuesSearchPatch, replace = true) =>
    void navigate({
      search: (previous) => validateIssuesSearch({ ...previous, ...patch }),
      replace,
    });

  const openIssue: OpenIssueHandler = (target) => {
    const key = githubRepositoryKey(target);
    const sameRepository =
      repository !== undefined && githubRepositoryKey(repository) === key;
    const known = groups.find((group) => group.key === key);
    if (!sameRepository && !known) return false;

    update(
      {
        repo: repoParam(known?.ref ?? target),
        issue: target.number,
        ...(sameRepository
          ? {}
          : {
              state: undefined,
              labels: undefined,
              q: undefined,
              mine: undefined,
            }),
      },
      false,
    );
    return true;
  };

  if (groups.length === 0 || !repository) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderGit2Icon />
          </EmptyMedia>
          <EmptyTitle>No GitHub repositories yet</EmptyTitle>
          <EmptyDescription>
            Add or clone a repository whose <code>origin</code> remote points at
            github.com and its issues will show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <ResizableLayout
        id="issues-repositories"
        defaultWidth={220}
        minWidth={170}
        maxWidth={360}
        leftPanelClassName="min-h-0 overflow-hidden"
        rightPanelClassName="min-h-0 min-w-0 overflow-hidden"
      >
        <RepositoryColumn
          groups={groups}
          selected={repository}
          onSelect={(ref) =>
            update(
              {
                repo: repoParam(ref),
                issue: undefined,
                labels: undefined,
                q: undefined,
              },
              false,
            )
          }
        />
        <ResizableLayout
          id="issues-list"
          defaultWidth={380}
          minWidth={300}
          maxWidth={640}
          leftPanelClassName="min-h-0 overflow-hidden"
          rightPanelClassName="min-h-0 min-w-0 overflow-hidden"
        >
          <IssueList
            repository={repository}
            search={search}
            onSearchChange={(patch) => update(patch)}
            onSelectIssue={(number) => update({ issue: number }, false)}
          />
          <IssueDetailPane
            repository={repository}
            number={search.issue}
            onOpenIssue={openIssue}
          />
        </ResizableLayout>
      </ResizableLayout>
    </div>
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
