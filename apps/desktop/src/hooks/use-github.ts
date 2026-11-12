import {
  type AuthStatus,
  type DeviceVerification,
  githubAuthStatus,
  githubCancelDeviceFlow,
  githubCompleteDeviceFlow,
  githubImportCliToken,
  githubRepositorySummaries,
  githubSignOut,
  githubStartDeviceFlow,
  type IssueListRequest,
  type RepositoryRef,
} from "@gitru/commands";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

/** Emitted by the Rust backend to every webview when the account changes. */
export const GITHUB_AUTH_CHANGED_EVENT = "github://auth-changed";

export const githubKeys = {
  all: ["github"] as const,
  auth: () => [...githubKeys.all, "auth"] as const,
  repositorySummaries: (repositories: RepositoryRef[]) =>
    [...githubKeys.all, "repository-summaries", repositories] as const,
  issues: (filters: Omit<IssueListRequest, "after">) =>
    [...githubKeys.all, "issues", filters] as const,
  issue: (repository: RepositoryRef, number: number) =>
    [
      ...githubKeys.all,
      "issue",
      repository.owner.toLowerCase(),
      repository.name.toLowerCase(),
      number,
    ] as const,
  labels: (repository: RepositoryRef) =>
    [
      ...githubKeys.all,
      "labels",
      repository.owner.toLowerCase(),
      repository.name.toLowerCase(),
    ] as const,
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Store a new auth state and drop every cached GitHub response that belonged
 * to the previous account.
 */
export function applyGithubAuthStatus(
  queryClient: QueryClient,
  status: AuthStatus,
) {
  queryClient.setQueryData(githubKeys.auth(), status);
  queryClient.removeQueries({
    queryKey: githubKeys.all,
    predicate: (query) => query.queryKey[1] !== "auth",
  });
}

export function useGithubAuth() {
  return useQuery({
    queryKey: githubKeys.auth(),
    queryFn: () => githubAuthStatus(),
    staleTime: 5 * 60_000,
  });
}

export function useIsGithubSignedIn() {
  const { data } = useGithubAuth();
  return data?.signed_in === true;
}

/**
 * Keeps this webview's cache in sync with sign-in/out performed in any other
 * webview (each workspace tab runs its own React tree and QueryClient).
 */
export function useGithubAuthSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<AuthStatus>(GITHUB_AUTH_CHANGED_EVENT, (event) => {
          applyGithubAuthStatus(queryClient, event.payload);
        }),
      )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("failed to subscribe to GitHub auth changes", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [queryClient]);
}

export function useGithubImportCliToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => githubImportCliToken(),
    onSuccess: (status) => applyGithubAuthStatus(queryClient, status),
  });
}

export function useGithubSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => githubSignOut(),
    onSuccess: (status) => applyGithubAuthStatus(queryClient, status),
  });
}

/**
 * Device Flow: `start` returns the code to show, `complete` waits (up to the
 * code lifetime) until the user approves it on github.com.
 */
export function useGithubDeviceFlow() {
  const queryClient = useQueryClient();

  const start = useMutation<DeviceVerification, unknown>({
    mutationFn: () => githubStartDeviceFlow(),
  });

  const complete = useMutation<AuthStatus, unknown>({
    mutationFn: () => githubCompleteDeviceFlow(),
    onSuccess: (status) => applyGithubAuthStatus(queryClient, status),
  });

  const cancel = async () => {
    try {
      await githubCancelDeviceFlow();
    } catch (error) {
      console.error("failed to cancel GitHub sign-in", errorMessage(error));
    }
  };

  return { start, complete, cancel };
}

export function useGithubRepositorySummaries(repositories: RepositoryRef[]) {
  const signedIn = useIsGithubSignedIn();

  return useQuery({
    queryKey: githubKeys.repositorySummaries(repositories),
    queryFn: () => githubRepositorySummaries({ repositories }),
    enabled: signedIn && repositories.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export { errorMessage as githubErrorMessage };
