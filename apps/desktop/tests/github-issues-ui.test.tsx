import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { IssueDetailPane } from "../src/features/issues/issue-detail";
import { IssueList } from "../src/features/issues/issue-list";
import {
  issueDetail,
  mona,
  issuePage as page,
  renderWithQuery,
  repository,
  timelineItem,
} from "./mocks/github-issues";
import { mockTauriCommand, mockTauriCommandResult } from "./mocks/tauri";

const metadata = { can_create_issues: true, can_triage: true, milestones: [] };

describe("IssueList", () => {
  test("lists issues, pages with the cursor and reports filter changes", async () => {
    const user = userEvent.setup();
    mockTauriCommandResult("github_repository_labels", [
      { id: "LA_bug", name: "bug", color: "d73a4a" },
    ]);
    mockTauriCommandResult("github_repository_issue_metadata", metadata);
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
    mockTauriCommandResult("github_repository_issue_metadata", metadata);
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

describe("IssueDetailPane", () => {
  test("renders the issue, its timeline and opens issue links in-app", async () => {
    const user = userEvent.setup();
    const getIssue = mockTauriCommand("github_issue", (payload) => {
      const request = (payload as { request: { timeline_after?: string } })
        .request;
      return request.timeline_after === "t-2"
        ? issueDetail([
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
        : issueDetail(
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
                label: { id: "LA_bug", name: "bug", color: "d73a4a" },
              }),
            ],
            {},
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
