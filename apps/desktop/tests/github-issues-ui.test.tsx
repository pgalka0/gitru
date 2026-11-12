import type {
  AuthStatus,
  IssueDetail,
  IssuePage,
  TimelineItem,
} from "@gitru/commands";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { IssueDetailPane } from "../src/features/issues/issue-detail";
import { IssueList } from "../src/features/issues/issue-list";
import { mockTauriCommand, mockTauriCommandResult } from "./mocks/tauri";

const repository = { owner: "octo", name: "hello" };

const signedIn: AuthStatus = {
  signed_in: true,
  device_flow_available: false,
  source: "ghCli",
  viewer: {
    login: "mona",
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    html_url: "https://github.com/mona",
  },
};

const mona = {
  login: "mona",
  avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
  html_url: "https://github.com/mona",
};

function renderWithQuery(ui: ReactNode) {
  mockTauriCommandResult("github_auth_status", signedIn);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const page = (numbers: number[], next?: string): IssuePage => ({
  issues: numbers.map((number) => ({
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/octo/hello/issues/${number}`,
    state: "open",
    author: mona,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    comments: number,
    labels: number === 1 ? [{ name: "bug", color: "d73a4a" }] : [],
    assignees: [],
  })),
  total_count: 3,
  has_next_page: next !== undefined,
  end_cursor: next,
});

describe("IssueList", () => {
  test("lists issues, pages with the cursor and reports filter changes", async () => {
    const user = userEvent.setup();
    mockTauriCommandResult("github_repository_labels", [
      { name: "bug", color: "d73a4a" },
    ]);
    const listIssues = mockTauriCommand("github_list_issues", (payload) => {
      const request = (payload as { request: { after?: string } }).request;
      return request.after === "cursor-2"
        ? page([3])
        : page([1, 2], "cursor-2");
    });
    const onSearchChange = vi.fn();
    const onSelectIssue = vi.fn();

    renderWithQuery(
      <IssueList
        repository={repository}
        search={{}}
        onSearchChange={onSearchChange}
        onSelectIssue={onSelectIssue}
      />,
    );

    const list = await screen.findByRole("list", { name: "Issues" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("3 issues")).toBeInTheDocument();
    expect(listIssues.mock.calls[0][0]).toMatchObject({
      request: {
        repository,
        state: "open",
        sort: "newest",
        assigned_to_me: false,
        labels: [],
      },
    });

    await user.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Issue 3");
    expect(listIssues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ after: "cursor-2" }),
      }),
    );

    await user.click(screen.getByText("Issue 2"));
    expect(onSelectIssue).toHaveBeenCalledWith(2);

    await user.click(screen.getByRole("button", { name: "Closed" }));
    expect(onSearchChange).toHaveBeenCalledWith({
      state: "closed",
      issue: undefined,
    });

    await user.type(
      screen.getByRole("searchbox", { name: "Search issues" }),
      "crash{Enter}",
    );
    expect(onSearchChange).toHaveBeenCalledWith({
      q: "crash",
      issue: undefined,
    });
  });

  test("shows GitHub's error instead of an empty list", async () => {
    mockTauriCommandResult("github_repository_labels", []);
    mockTauriCommand("github_list_issues", () => {
      throw "GitHub query failed: Something went wrong";
    });

    renderWithQuery(
      <IssueList
        repository={repository}
        search={{}}
        onSearchChange={vi.fn()}
        onSelectIssue={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong",
    );
  });
});

const timelineItem = (item: Partial<TimelineItem>): TimelineItem => ({
  id: "x",
  kind: "comment",
  created_at: "2026-01-02T00:00:00Z",
  reactions: [],
  will_close: false,
  ...item,
});

const detail = (items: TimelineItem[], next?: string): IssueDetail => ({
  number: 42,
  title: "Crash on start",
  html_url: "https://github.com/octo/hello/issues/42",
  state: "closed",
  state_reason: "completed",
  body_html:
    '<p>See <a class="issue-link" href="https://github.com/octo/hello/issues/7">#7</a></p><script>window.pwned=1</script>',
  author: mona,
  author_association: "OWNER",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-05T00:00:00Z",
  locked: false,
  comments: 1,
  labels: [{ name: "bug", color: "d73a4a" }],
  assignees: [mona],
  participants: [mona],
  participant_count: 1,
  reactions: [{ content: "THUMBS_UP", count: 3, viewer_has_reacted: true }],
  linked_pull_requests: [],
  timeline: {
    items,
    total_count: 3,
    has_next_page: next !== undefined,
    end_cursor: next,
  },
});

describe("IssueDetailPane", () => {
  test("renders the issue, its timeline and opens issue links in-app", async () => {
    const user = userEvent.setup();
    const getIssue = mockTauriCommand("github_issue", (payload) => {
      const request = (payload as { request: { timeline_after?: string } })
        .request;
      return request.timeline_after === "t-2"
        ? detail([
            timelineItem({
              id: "CE_1",
              kind: "closed",
              actor: mona,
              state_reason: "completed",
              reference: {
                kind: "pullRequest",
                number: 8,
                title: "Fix crash",
                html_url: "https://github.com/octo/hello/pull/8",
                state: "merged",
                is_draft: false,
                repository: "octo/hello",
              },
            }),
          ])
        : detail(
            [
              timelineItem({
                id: "IC_1",
                actor: mona,
                body_html: "<p>Same here</p>",
              }),
              timelineItem({
                id: "LE_1",
                kind: "labeled",
                actor: mona,
                label: { name: "bug", color: "d73a4a" },
              }),
            ],
            "t-2",
          );
    });
    const onOpenIssue = vi.fn(() => true);

    renderWithQuery(
      <IssueDetailPane
        repository={repository}
        number={42}
        onOpenIssue={onOpenIssue}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: /Crash on start/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Same here")).toBeInTheDocument();
    expect(screen.getByText("added")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect((window as { pwned?: number }).pwned).toBeUndefined();

    await user.click(screen.getByRole("link", { name: "#7" }));
    expect(onOpenIssue).toHaveBeenCalledWith({
      owner: "octo",
      name: "hello",
      number: 7,
    });

    await user.click(screen.getByRole("button", { name: "Load 1 more" }));
    expect(
      await screen.findByText(/closed this as completed/),
    ).toBeInTheDocument();
    expect(screen.getByText("Fix crash")).toBeInTheDocument();
    expect(getIssue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ timeline_after: "t-2" }),
      }),
    );
  });

  test("asks to pick an issue when none is selected", () => {
    renderWithQuery(
      <IssueDetailPane
        repository={repository}
        number={undefined}
        onOpenIssue={() => false}
      />,
    );

    expect(screen.getByText("Select an issue")).toBeInTheDocument();
  });

  test("reports a missing issue", async () => {
    mockTauriCommand("github_issue", () => {
      throw "Issue #42 was not found in octo/hello";
    });

    renderWithQuery(
      <IssueDetailPane
        repository={repository}
        number={42}
        onOpenIssue={() => false}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Issue #42 was not found",
      ),
    );
  });
});
