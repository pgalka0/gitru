import type {
  Actor,
  CloseIssueRequest,
  ReactionGroup,
  TimelineItem,
} from "@gitru/commands";

// The generated bindings export enum schemas, not their types.
export type ReactionContent = ReactionGroup["content"];
export type CloseReason = CloseIssueRequest["reason"];

/** The order github.com shows reactions in. */
export const REACTION_ORDER: Exclude<ReactionContent, "other">[] = [
  "thumbsUp",
  "thumbsDown",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
];

export const REACTION_EMOJI: Record<ReactionContent, string> = {
  thumbsUp: "👍",
  thumbsDown: "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
  other: "•",
};

export const REACTION_LABEL: Record<ReactionContent, string> = {
  thumbsUp: "+1",
  thumbsDown: "-1",
  laugh: "Laugh",
  hooray: "Hooray",
  confused: "Confused",
  heart: "Heart",
  rocket: "Rocket",
  eyes: "Eyes",
  other: "Reaction",
};

/** Reaction groups after the viewer adds or removes one reaction. */
export function toggleReaction(
  groups: ReactionGroup[],
  content: ReactionContent,
  reacted: boolean,
): ReactionGroup[] {
  const existing = groups.find((group) => group.content === content);
  if (reacted) {
    if (existing?.viewer_has_reacted) return groups;
    const next = existing
      ? groups.map((group) =>
          group.content === content
            ? { ...group, count: group.count + 1, viewer_has_reacted: true }
            : group,
        )
      : [...groups, { content, count: 1, viewer_has_reacted: true }];
    return next.sort(
      (a, b) =>
        REACTION_ORDER.indexOf(a.content as (typeof REACTION_ORDER)[number]) -
        REACTION_ORDER.indexOf(b.content as (typeof REACTION_ORDER)[number]),
    );
  }
  if (!existing?.viewer_has_reacted) return groups;
  return groups.flatMap((group) => {
    if (group.content !== content) return [group];
    return group.count <= 1
      ? []
      : [{ ...group, count: group.count - 1, viewer_has_reacted: false }];
  });
}

/** IDs to add and remove to turn `current` into `next`. */
export function idChange<T extends { id: string }>(current: T[], next: T[]) {
  const before = new Set(current.map((item) => item.id));
  const after = new Set(next.map((item) => item.id));
  return {
    add: next.filter((item) => !before.has(item.id)).map((item) => item.id),
    remove: current
      .filter((item) => !after.has(item.id))
      .map((item) => item.id),
  };
}

export const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export const byLogin = <T extends { login: string }>(a: T, b: T) =>
  a.login.localeCompare(b.login, undefined, { sensitivity: "base" });

const OPTIMISTIC_PREFIX = "optimistic:";

/** A comment shown while GitHub is still saving it. */
export function optimisticComment(
  body: string,
  author: Actor | undefined,
): TimelineItem {
  return {
    id: `${OPTIMISTIC_PREFIX}${crypto.randomUUID()}`,
    kind: "comment",
    created_at: new Date().toISOString(),
    actor: author,
    body,
    body_html: undefined,
    reactions: [],
    viewer_can_update: false,
    viewer_can_delete: false,
    viewer_can_react: false,
    will_close: false,
  };
}

export const isOptimistic = (item: { id: string }) =>
  item.id.startsWith(OPTIMISTIC_PREFIX);
