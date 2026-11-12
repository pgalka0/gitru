import type { IssueDetail, TimelineItem } from "@gitru/commands";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { IssueDetailPane } from "../src/features/issues/issue-detail";
import { IssueList } from "../src/features/issues/issue-list";
import {
  bug,
  docs,
  hubot,
  issueDetail,
  issuePage,
  renderWithQuery,
  repository,
  timelineItem,
} from "./mocks/github-issues";
import { mockTauriCommand, mockTauriCommandResult } from "./mocks/tauri";

vi.mock("@gitru/ui/components/menu", async () => {
  return (await import("./mocks/ui-overlays")).menuModule;
});
vi.mock("@gitru/ui/components/popover", async () => {
  return (await import("./mocks/ui-overlays")).popoverModule;
});
vi.mock("@gitru/ui/components/alert-dialog", async () => {
  return (await import("./mocks/ui-overlays")).alertDialogModule;
});
vi.mock("@gitru/ui/components/dialog", async () => {
  return (await import("./mocks/ui-overlays")).dialogModule;
});

const comment = timelineItem({
  id: "IC_1",
  actor: hubot,
  body: "Same here",
  body_html: "<p>Same here</p>",
  html_url: "https://github.com/octo/hello/issues/42#issuecomment-1",
  viewer_can_update: true,
  viewer_can_delete: true,
  viewer_can_react: true,
});

const openIssue = (
  items: TimelineItem[] = [comment],
  overrides: Partial<IssueDetail> = {},
) =>
  issueDetail(items, { state: "open", state_reason: undefined, ...overrides });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderIssue(initial: IssueDetail = openIssue()) {
  let current = initial;
  const getIssue = mockTauriCommand("github_issue", () => current);
  const view = renderWithQuery(
    <IssueDetailPane
      repository={repository}
      number={42}
      onOpenIssue={() => false}
    />,
  );
  await screen.findByRole("heading", { name: /Crash on start/ });
  return {
    ...view,
    getIssue,
    setServerIssue: (next: IssueDetail) => {
      current = next;
    },
  };
}

describe("issue comments", () => {
  test("posts a comment optimistically, then shows GitHub's version", async () => {
    const user = userEvent.setup();
    const posted = timelineItem({
      id: "IC_2",
      body: "Looks good",
      body_html: "<p>Looks <em>good</em></p>",
      viewer_can_update: true,
    });
    const reply = deferred<TimelineItem>();
    const addComment = mockTauriCommand(
      "github_add_comment",
      () => reply.promise,
    );
    const { setServerIssue } = await renderIssue();

    const box = screen.getByRole("textbox", { name: "Comment" });
    await user.type(box, "Looks good");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(box).toHaveValue("");
    expect(screen.getByText("Posting…")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
    expect(addComment).toHaveBeenCalledWith({
      request: { issue_id: "I_42", body: "Looks good" },
    });

    setServerIssue(openIssue([comment, posted], { comments: 2 }));
    reply.resolve(posted);

    expect(await screen.findByText("good")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Posting…")).not.toBeInTheDocument(),
    );
  });

  test("keeps the draft and explains why when GitHub refuses the comment", async () => {
    const user = userEvent.setup();
    mockTauriCommand("github_add_comment", () => {
      throw "GitHub query failed: Resource not accessible by integration";
    });
    await renderIssue();

    const box = screen.getByRole("textbox", { name: "Comment" });
    await user.type(box, "Looks good");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not add the comment: GitHub query failed: Resource not accessible",
    );
    expect(box).toHaveValue("Looks good");
    expect(screen.queryByText("Posting…")).not.toBeInTheDocument();

    // Drafts outlive the component on purpose; don't leak this one into
    // the next test, which would post it before closing.
    await user.clear(box);
  });

  test("deletes a comment only after confirmation", async () => {
    const user = userEvent.setup();
    const deleteComment = mockTauriCommandResult("github_delete_comment", null);
    const { setServerIssue } = await renderIssue();

    const menus = screen.getAllByRole("button", { name: "Comment actions" });
    await user.click(menus[1]);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(deleteComment).not.toHaveBeenCalled();

    setServerIssue(openIssue([], { comments: 0 }));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(deleteComment).toHaveBeenCalledWith({ commentId: "IC_1" });
    await waitFor(() =>
      expect(screen.queryByText("Same here")).not.toBeInTheDocument(),
    );
  });

  test("toggles the viewer's reaction and updates the count at once", async () => {
    const user = userEvent.setup();
    const reply = deferred<unknown>();
    const setReaction = mockTauriCommand(
      "github_set_reaction",
      () => reply.promise,
    );
    await renderIssue();

    const thumbs = screen.getByRole("button", { name: "+1: 3" });
    expect(thumbs).toHaveAttribute("aria-pressed", "true");
    await user.click(thumbs);

    await waitFor(() =>
      expect(setReaction).toHaveBeenCalledWith({
        request: { subject_id: "I_42", content: "thumbsUp", reacted: false },
      }),
    );
    expect(screen.getByRole("button", { name: "+1: 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    reply.resolve([
      { content: "thumbsUp", count: 2, viewer_has_reacted: false },
    ]);
  });
});

describe("issue state and metadata", () => {
  test("closes as not planned and shows the new state right away", async () => {
    const user = userEvent.setup();
    const reply = deferred<unknown>();
    const closeIssue = mockTauriCommand(
      "github_close_issue",
      () => reply.promise,
    );
    await renderIssue();

    await user.click(
      screen.getByRole("button", { name: "Choose how to close" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Close as not planned" }),
    );

    // The request leaves after the optimistic patch, a few ticks later.
    await waitFor(() =>
      expect(closeIssue).toHaveBeenCalledWith({
        request: { issue_id: "I_42", reason: "notPlanned" },
      }),
    );
    expect(screen.getByText("Closed as not planned")).toBeInTheDocument();
    reply.resolve({ state: "closed", state_reason: "notPlanned" });
  });

  test("sends only the label difference when the picker closes", async () => {
    const user = userEvent.setup();
    mockTauriCommandResult("github_repository_labels", [bug, docs]);
    const changeLabels = mockTauriCommandResult("github_change_labels", [
      bug,
      docs,
    ]);
    const { setServerIssue } = await renderIssue();

    await user.click(screen.getByRole("button", { name: "Edit labels" }));
    const row = (await screen.findByText("Documentation")).closest("label");
    if (!row) throw new Error("label row not found");
    await user.click(within(row).getByRole("checkbox"));
    expect(changeLabels).not.toHaveBeenCalled();

    setServerIssue(openIssue([comment], { labels: [bug, docs] }));
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(changeLabels).toHaveBeenCalledWith({
        request: {
          issue_id: "I_42",
          add_label_ids: ["LA_docs"],
          remove_label_ids: [],
        },
      }),
    );
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByText("docs")).toBeInTheDocument();
  });

  test("edits the title in place", async () => {
    const user = userEvent.setup();
    const editIssue = mockTauriCommandResult("github_edit_issue", {
      title: "Crash on launch",
      body: "See #7",
      body_html: "<p>See #7</p>",
    });
    const { setServerIssue } = await renderIssue();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByRole("textbox", { name: "Issue title" });
    await user.clear(input);
    setServerIssue(openIssue([comment], { title: "Crash on launch" }));
    await user.type(input, "Crash on launch{Enter}");

    expect(editIssue).toHaveBeenCalledWith({
      request: { issue_id: "I_42", title: "Crash on launch" },
    });
    expect(
      await screen.findByRole("heading", { name: /Crash on launch/ }),
    ).toBeInTheDocument();
  });

  test("offers no controls the viewer is not allowed to use", async () => {
    await renderIssue(
      openIssue(
        [
          timelineItem({
            ...comment,
            viewer_can_update: false,
            viewer_can_delete: false,
            viewer_can_react: false,
          }),
        ],
        {
          locked: true,
          viewer: {
            can_update: false,
            can_close: false,
            can_reopen: false,
            can_react: false,
            can_comment: false,
            can_label: false,
            can_assign: false,
            can_set_milestone: false,
          },
        },
      ),
    );

    expect(
      screen.queryByRole("textbox", { name: "Comment" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/This conversation is locked/)).toBeInTheDocument();
    for (const name of [
      "Edit",
      "Edit labels",
      "Edit assignees",
      "Edit milestone",
      "Add reaction",
      "Choose how to close",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});

describe("new issue", () => {
  test("creates the issue and selects it", async () => {
    const user = userEvent.setup();
    mockTauriCommandResult("github_repository_labels", []);
    mockTauriCommandResult("github_list_issues", issuePage([1]));
    mockTauriCommandResult("github_repository_issue_metadata", {
      can_create_issues: true,
      can_triage: false,
      milestones: [],
    });
    const createIssue = mockTauriCommandResult("github_create_issue", {
      number: 43,
      html_url: "https://github.com/octo/hello/issues/43",
    });
    const onSelectIssue = vi.fn();

    renderWithQuery(
      <IssueList
        repository={repository}
        search={{}}
        onSearchChange={vi.fn()}
        onSelectIssue={onSelectIssue}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New issue" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).queryByRole("button", { name: "Edit labels" }),
      "no triage access, no label picker",
    ).not.toBeInTheDocument();

    const create = within(dialog).getByRole("button", { name: "Create issue" });
    expect(create).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Title" }),
      "Crash",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Description" }),
      "Steps",
    );
    await user.click(create);

    expect(createIssue).toHaveBeenCalledWith({
      request: expect.objectContaining({
        repository,
        title: "Crash",
        body: "Steps",
        label_ids: [],
        assignee_ids: [],
      }),
    });
    await waitFor(() => expect(onSelectIssue).toHaveBeenCalledWith(43));
  });
});
