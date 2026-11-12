import type {
  AuthStatus,
  IssueDetail,
  IssuePage,
  IssuePermissions,
  TimelineItem,
} from "@gitru/commands";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { mockTauriCommandResult } from "./tauri";

export const repository = { owner: "octo", name: "hello" };

export const mona = {
  id: "U_mona",
  login: "mona",
  avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
  html_url: "https://github.com/mona",
};

export const hubot = {
  id: "U_hubot",
  login: "hubot",
  avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
  html_url: "https://github.com/hubot",
};

export const bug = { id: "LA_bug", name: "bug", color: "d73a4a" };
export const docs = {
  id: "LA_docs",
  name: "docs",
  color: "0075ca",
  description: "Documentation",
};

const signedIn: AuthStatus = {
  signed_in: true,
  device_flow_available: false,
  source: "ghCli",
  viewer: {
    login: mona.login,
    avatar_url: mona.avatar_url,
    html_url: mona.html_url,
  },
};

export function renderWithQuery(ui: ReactNode) {
  mockTauriCommandResult("github_auth_status", signedIn);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
  };
}

export const issuePage = (numbers: number[], next?: string): IssuePage => ({
  issues: numbers.map((number) => ({
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/octo/hello/issues/${number}`,
    state: "open",
    author: mona,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    comments: number,
    labels: number === 1 ? [bug] : [],
    assignees: [],
  })),
  total_count: 3,
  has_next_page: next !== undefined,
  end_cursor: next,
});

export const timelineItem = (item: Partial<TimelineItem>): TimelineItem => ({
  id: "x",
  kind: "comment",
  created_at: "2026-01-02T00:00:00Z",
  reactions: [],
  will_close: false,
  viewer_can_update: false,
  viewer_can_delete: false,
  viewer_can_react: false,
  ...item,
});

export const allowed: IssuePermissions = {
  can_update: true,
  can_close: true,
  can_reopen: true,
  can_react: true,
  can_comment: true,
  can_label: true,
  can_assign: true,
  can_set_milestone: true,
};

export const issueDetail = (
  items: TimelineItem[],
  overrides: Partial<IssueDetail> = {},
  next?: string,
): IssueDetail => ({
  id: "I_42",
  number: 42,
  title: "Crash on start",
  html_url: "https://github.com/octo/hello/issues/42",
  state: "closed",
  state_reason: "completed",
  body: "See #7",
  body_html:
    '<p>See <a class="issue-link" href="https://github.com/octo/hello/issues/7">#7</a></p><script>window.pwned=1</script>',
  author: mona,
  author_association: "OWNER",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-05T00:00:00Z",
  locked: false,
  comments: 1,
  labels: [bug],
  assignees: [mona],
  participants: [mona],
  participant_count: 1,
  reactions: [{ content: "thumbsUp", count: 3, viewer_has_reacted: true }],
  linked_pull_requests: [],
  timeline: {
    items,
    total_count: items.length + (next ? 1 : 0),
    has_next_page: next !== undefined,
    end_cursor: next,
  },
  viewer: allowed,
  ...overrides,
});
