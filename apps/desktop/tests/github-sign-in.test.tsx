import type { AuthStatus, DeviceVerification } from "@gitru/commands";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { GithubProvider } from "../src/components/github/github-provider";
import { GithubSignInOptions } from "../src/components/github/github-sign-in-options";
import { githubKeys } from "../src/hooks/use-github";
import { mockTauriCommand, mockTauriCommandResult } from "./mocks/tauri";

const signedOut: AuthStatus = {
  signed_in: false,
  device_flow_available: true,
};

const signedIn: AuthStatus = {
  signed_in: true,
  device_flow_available: true,
  source: "deviceFlow",
  viewer: {
    login: "octocat",
    avatar_url: "https://avatars.githubusercontent.com/u/1",
    html_url: "https://github.com/octocat",
  },
};

const verification: DeviceVerification = {
  user_code: "WDJB-MJHT",
  verification_uri: "https://github.com/login/device",
  expires_in_secs: 900,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderSignIn() {
  mockTauriCommandResult("plugin:event|listen", 1);
  mockTauriCommandResult("plugin:event|unlisten", null);
  mockTauriCommandResult("github_auth_status", signedOut);
  mockTauriCommandResult("github_start_device_flow", verification);
  const cancel = mockTauriCommandResult("github_cancel_device_flow", null);
  const completion = deferred<AuthStatus>();
  const complete = mockTauriCommand(
    "github_complete_device_flow",
    () => completion.promise,
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <GithubProvider>
        <GithubSignInOptions />
      </GithubProvider>
    </QueryClientProvider>,
  );

  return { queryClient, completion, complete, cancel };
}

const signInButton = () =>
  screen.findByRole("button", { name: "Sign in with GitHub" });

describe("GitHub Device Flow sign-in", () => {
  test("shows the user code and stores the account once GitHub approves", async () => {
    const user = userEvent.setup();
    const { queryClient, completion, complete } = renderSignIn();

    const button = await signInButton();
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    expect(await screen.findByText("WDJB-MJHT")).toBeInTheDocument();
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));

    completion.resolve(signedIn);

    await waitFor(() =>
      expect(screen.queryByText("WDJB-MJHT")).not.toBeInTheDocument(),
    );
    expect(queryClient.getQueryData(githubKeys.auth())).toEqual(signedIn);
  });

  test("cancelling stops polling and ignores the late cancellation error", async () => {
    const user = userEvent.setup();
    const { completion, cancel } = renderSignIn();

    const button = await signInButton();
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await screen.findByText("WDJB-MJHT");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(cancel).toHaveBeenCalledTimes(1);
    completion.reject("Sign-in was cancelled");
    await waitFor(() =>
      expect(screen.queryByText("WDJB-MJHT")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("shows GitHub's error and lets the user try again", async () => {
    const user = userEvent.setup();
    const { completion } = renderSignIn();

    const button = await signInButton();
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await screen.findByText("WDJB-MJHT");

    completion.reject("The sign-in code expired. Start again.");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sign-in code expired",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  test("browser sign-in is disabled without an OAuth client ID", async () => {
    mockTauriCommandResult("plugin:event|listen", 1);
    mockTauriCommandResult("plugin:event|unlisten", null);
    mockTauriCommandResult("github_auth_status", {
      signed_in: false,
      device_flow_available: false,
    } satisfies AuthStatus);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <GithubProvider>
          <GithubSignInOptions />
        </GithubProvider>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(/GITRU_GITHUB_CLIENT_ID/, { selector: "code" }),
    ).toBeInTheDocument();
    expect(await signInButton()).toBeDisabled();
  });
});
