//! Issue list, issue detail and label queries, and their camelCase DTOs.
//!
//! The `.graphql` documents in `queries/` were checked against the live GitHub
//! schema. Timeline nodes are decoded one by one so a single unexpected item
//! cannot hide the whole issue.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    error::GithubError,
    models::{
        Actor, IssueDetail, IssueDetailRequest, IssueListRequest, IssuePage, IssueSort, IssueState,
        IssueStateFilter, IssueStateReason, IssueSummary, Label, Milestone, ReactionGroup,
        Reference, ReferenceKind, RepositoryRef, TimelineItem, TimelineItemKind, TimelinePage,
    },
};

pub(crate) const ISSUE_SEARCH_QUERY: &str = include_str!("queries/issue_search.graphql");
pub(crate) const ISSUE_DETAIL_QUERY: &str = include_str!("queries/issue_detail.graphql");
pub(crate) const REPOSITORY_LABELS_QUERY: &str = include_str!("queries/repository_labels.graphql");

pub(crate) const ISSUES_PER_PAGE: u32 = 50;
/// GitHub rejects search queries longer than 256 characters.
const MAX_SEARCH_TEXT: usize = 256;
const MAX_LABEL_FILTERS: usize = 20;
const MAX_CURSOR_LEN: usize = 512;
/// 5 pages of 100 labels; repositories rarely have more.
pub(crate) const MAX_LABEL_PAGES: usize = 5;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

fn validate_cursor(cursor: Option<&str>) -> Result<(), GithubError> {
    match cursor {
        Some(cursor) if cursor.is_empty() || cursor.len() > MAX_CURSOR_LEN => {
            Err(GithubError::InvalidInput("Invalid page cursor".to_string()))
        }
        _ => Ok(()),
    }
}

/// Builds the GitHub search string for an issue list. The repository is always
/// pinned with `repo:` and `is:issue`; user text is appended as-is so the full
/// GitHub search syntax keeps working.
pub(crate) fn issue_search_text(request: &IssueListRequest) -> Result<String, GithubError> {
    request.repository.validate()?;

    let mut parts = vec![
        format!(
            "repo:{}/{}",
            request.repository.owner, request.repository.name
        ),
        "is:issue".to_string(),
    ];

    match request.state {
        IssueStateFilter::Open => parts.push("is:open".to_string()),
        IssueStateFilter::Closed => parts.push("is:closed".to_string()),
        IssueStateFilter::All => {}
    }

    if request.assigned_to_me {
        parts.push("assignee:@me".to_string());
    }

    if request.labels.len() > MAX_LABEL_FILTERS {
        return Err(GithubError::InvalidInput(format!(
            "Filter by at most {MAX_LABEL_FILTERS} labels"
        )));
    }
    for label in &request.labels {
        let label: String = label
            .chars()
            .filter(|c| *c != '"' && !c.is_control())
            .collect();
        let label = label.trim();
        if !label.is_empty() {
            parts.push(format!("label:\"{label}\""));
        }
    }

    if let Some(text) = request
        .query
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        if text.chars().count() > MAX_SEARCH_TEXT || text.chars().any(char::is_control) {
            return Err(GithubError::InvalidInput(format!(
                "Search text must be a single line of at most {MAX_SEARCH_TEXT} characters"
            )));
        }
        parts.push(text.to_string());
    }

    parts.push(
        match request.sort {
            IssueSort::Newest => "sort:created-desc",
            IssueSort::Oldest => "sort:created-asc",
            IssueSort::RecentlyUpdated => "sort:updated-desc",
            IssueSort::MostCommented => "sort:comments-desc",
        }
        .to_string(),
    );

    Ok(parts.join(" "))
}

pub(crate) fn issue_search_variables(request: &IssueListRequest) -> Result<Value, GithubError> {
    validate_cursor(request.after.as_deref())?;
    Ok(json!({
        "search": issue_search_text(request)?,
        "first": ISSUES_PER_PAGE,
        "after": request.after,
    }))
}

pub(crate) fn issue_detail_variables(request: &IssueDetailRequest) -> Result<Value, GithubError> {
    request.repository.validate()?;
    if request.number == 0 {
        return Err(GithubError::InvalidInput(
            "Invalid issue number".to_string(),
        ));
    }
    validate_cursor(request.timeline_after.as_deref())?;
    Ok(json!({
        "owner": request.repository.owner,
        "name": request.repository.name,
        "number": request.number,
        "after": request.timeline_after,
    }))
}

pub(crate) fn repository_labels_variables(
    repository: &RepositoryRef,
    after: Option<&str>,
) -> Value {
    json!({ "owner": repository.owner, "name": repository.name, "after": after })
}

// ---------------------------------------------------------------------------
// Shared DTOs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActorNode {
    login: String,
    avatar_url: String,
    url: String,
}

impl From<ActorNode> for Actor {
    fn from(node: ActorNode) -> Self {
        Self {
            login: node.login,
            avatar_url: node.avatar_url,
            html_url: node.url,
        }
    }
}

/// A GraphQL connection's `nodes`, which may contain `null` entries.
#[derive(Deserialize)]
struct Nodes<T> {
    #[serde(default = "Vec::new")]
    nodes: Vec<Option<T>>,
}

impl<T> Nodes<T> {
    fn into_vec<U: From<T>>(self) -> Vec<U> {
        self.nodes.into_iter().flatten().map(U::from).collect()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Count {
    total_count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
struct LabelNode {
    name: String,
    color: String,
    description: Option<String>,
}

impl From<LabelNode> for Label {
    fn from(node: LabelNode) -> Self {
        Self {
            name: node.name,
            color: node.color,
            description: node.description.filter(|d| !d.trim().is_empty()),
        }
    }
}

#[derive(Deserialize)]
struct TitleNode {
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryNameNode {
    name_with_owner: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReactionGroupNode {
    content: String,
    reactors: Count,
    viewer_has_reacted: bool,
}

fn reactions(groups: Option<Vec<ReactionGroupNode>>) -> Vec<ReactionGroup> {
    groups
        .unwrap_or_default()
        .into_iter()
        .filter(|group| group.reactors.total_count > 0)
        .map(|group| ReactionGroup {
            content: group.content,
            count: group.reactors.total_count,
            viewer_has_reacted: group.viewer_has_reacted,
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueRefNode {
    number: u32,
    title: String,
    url: String,
    state: String,
    repository: RepositoryNameNode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestRefNode {
    number: u32,
    title: String,
    url: String,
    state: String,
    #[serde(default)]
    is_draft: bool,
    repository: RepositoryNameNode,
}

impl From<PullRequestRefNode> for Reference {
    fn from(node: PullRequestRefNode) -> Self {
        Self {
            kind: ReferenceKind::PullRequest,
            number: Some(node.number),
            title: node.title,
            html_url: node.url,
            state: Some(node.state.to_ascii_lowercase()),
            is_draft: node.is_draft,
            repository: Some(node.repository.name_with_owner),
            abbreviated_oid: None,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitNode {
    abbreviated_oid: String,
    url: String,
    message_headline: String,
}

impl CommitNode {
    fn into_reference(self, repository: Option<String>) -> Reference {
        Reference {
            kind: ReferenceKind::Commit,
            number: None,
            title: self.message_headline,
            html_url: self.url,
            state: None,
            is_draft: false,
            repository,
            abbreviated_oid: Some(self.abbreviated_oid),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "__typename")]
enum ReferencedNode {
    Issue(IssueRefNode),
    PullRequest(PullRequestRefNode),
    Commit(CommitNode),
    #[serde(other)]
    Other,
}

impl ReferencedNode {
    fn into_reference(self) -> Option<Reference> {
        match self {
            Self::Issue(node) => Some(Reference {
                kind: ReferenceKind::Issue,
                number: Some(node.number),
                title: node.title,
                html_url: node.url,
                state: Some(node.state.to_ascii_lowercase()),
                is_draft: false,
                repository: Some(node.repository.name_with_owner),
                abbreviated_oid: None,
            }),
            Self::PullRequest(node) => Some(node.into()),
            Self::Commit(node) => Some(node.into_reference(None)),
            Self::Other => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Issue list (search)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct IssueSearchData {
    search: SearchConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchConnection {
    issue_count: u32,
    page_info: PageInfo,
    #[serde(default)]
    nodes: Vec<Option<SearchNode>>,
}

// Boxed: a search page holds up to 50 nodes and most of the enum would
// otherwise be padding for the data-less `Other` variant.
#[derive(Deserialize)]
#[serde(tag = "__typename")]
enum SearchNode {
    Issue(Box<IssueSummaryNode>),
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueSummaryNode {
    number: u32,
    title: String,
    url: String,
    state: IssueState,
    state_reason: Option<IssueStateReason>,
    created_at: String,
    updated_at: String,
    closed_at: Option<String>,
    author: Option<ActorNode>,
    comments: Count,
    labels: Option<Nodes<LabelNode>>,
    assignees: Option<Nodes<ActorNode>>,
    milestone: Option<TitleNode>,
}

impl From<IssueSummaryNode> for IssueSummary {
    fn from(node: IssueSummaryNode) -> Self {
        Self {
            number: node.number,
            title: node.title,
            html_url: node.url,
            state: node.state,
            state_reason: node.state_reason,
            author: node.author.map(Actor::from),
            created_at: node.created_at,
            updated_at: node.updated_at,
            closed_at: node.closed_at,
            comments: node.comments.total_count,
            labels: node.labels.map(Nodes::into_vec).unwrap_or_default(),
            assignees: node.assignees.map(Nodes::into_vec).unwrap_or_default(),
            milestone: node.milestone.map(|m| m.title),
        }
    }
}

impl From<IssueSearchData> for IssuePage {
    fn from(data: IssueSearchData) -> Self {
        let search = data.search;
        Self {
            issues: search
                .nodes
                .into_iter()
                .flatten()
                .filter_map(|node| match node {
                    SearchNode::Issue(issue) => Some((*issue).into()),
                    SearchNode::Other => None,
                })
                .collect(),
            total_count: search.issue_count,
            has_next_page: search.page_info.has_next_page,
            end_cursor: search.page_info.end_cursor,
        }
    }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct RepositoryLabelsData {
    repository: Option<LabelsRepositoryNode>,
}

#[derive(Deserialize)]
struct LabelsRepositoryNode {
    labels: Option<LabelConnection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LabelConnection {
    page_info: PageInfo,
    #[serde(default)]
    nodes: Vec<Option<LabelNode>>,
}

pub(crate) struct LabelPage {
    pub labels: Vec<Label>,
    pub next_cursor: Option<String>,
}

impl RepositoryLabelsData {
    pub(crate) fn into_page(self) -> Option<LabelPage> {
        let connection = self.repository?.labels?;
        Some(LabelPage {
            labels: connection
                .nodes
                .into_iter()
                .flatten()
                .map(Label::from)
                .collect(),
            next_cursor: connection
                .page_info
                .has_next_page
                .then_some(connection.page_info.end_cursor)
                .flatten(),
        })
    }
}

// ---------------------------------------------------------------------------
// Issue detail and timeline
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct IssueDetailData {
    repository: Option<IssueRepositoryNode>,
}

#[derive(Deserialize)]
struct IssueRepositoryNode {
    issue: Option<IssueDetailNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueDetailNode {
    number: u32,
    title: String,
    url: String,
    state: IssueState,
    state_reason: Option<IssueStateReason>,
    #[serde(rename = "bodyHTML")]
    body_html: String,
    created_at: String,
    updated_at: String,
    closed_at: Option<String>,
    last_edited_at: Option<String>,
    author: Option<ActorNode>,
    author_association: String,
    locked: bool,
    active_lock_reason: Option<String>,
    comments: Count,
    labels: Option<Nodes<LabelNode>>,
    assignees: Nodes<ActorNode>,
    milestone: Option<MilestoneNode>,
    participants: ParticipantConnection,
    reaction_groups: Option<Vec<ReactionGroupNode>>,
    closed_by_pull_requests_references: Option<Nodes<PullRequestRefNode>>,
    timeline_items: TimelineConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MilestoneNode {
    title: String,
    url: String,
    due_on: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParticipantConnection {
    total_count: u32,
    #[serde(default)]
    nodes: Vec<Option<ActorNode>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimelineConnection {
    total_count: u32,
    page_info: PageInfo,
    /// Decoded item by item in [`timeline_item`].
    #[serde(default)]
    nodes: Vec<Value>,
}

impl IssueDetailData {
    /// `None` when the repository or issue does not exist or is not visible.
    pub(crate) fn into_detail(self) -> Option<IssueDetail> {
        let issue = self.repository?.issue?;
        let timeline = issue.timeline_items;

        Some(IssueDetail {
            number: issue.number,
            title: issue.title,
            html_url: issue.url,
            state: issue.state,
            state_reason: issue.state_reason,
            body_html: issue.body_html,
            author: issue.author.map(Actor::from),
            author_association: issue.author_association,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            closed_at: issue.closed_at,
            last_edited_at: issue.last_edited_at,
            locked: issue.locked,
            active_lock_reason: issue.active_lock_reason,
            comments: issue.comments.total_count,
            labels: issue.labels.map(Nodes::into_vec).unwrap_or_default(),
            assignees: issue.assignees.into_vec(),
            milestone: issue.milestone.map(|m| Milestone {
                title: m.title,
                html_url: m.url,
                due_on: m.due_on,
            }),
            participants: issue
                .participants
                .nodes
                .into_iter()
                .flatten()
                .map(Actor::from)
                .collect(),
            participant_count: issue.participants.total_count,
            reactions: reactions(issue.reaction_groups),
            linked_pull_requests: issue
                .closed_by_pull_requests_references
                .map(Nodes::into_vec)
                .unwrap_or_default(),
            timeline: TimelinePage {
                items: timeline
                    .nodes
                    .into_iter()
                    .filter_map(timeline_item)
                    .collect(),
                total_count: timeline.total_count,
                has_next_page: timeline.page_info.has_next_page,
                end_cursor: timeline.page_info.end_cursor,
            },
        })
    }
}

/// Every timeline node type shares this shape; fields a type does not select
/// stay `None`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimelineNode {
    #[serde(rename = "__typename")]
    typename: String,
    id: Option<String>,
    created_at: Option<String>,
    actor: Option<ActorNode>,
    author: Option<ActorNode>,
    #[serde(rename = "bodyHTML")]
    body_html: Option<String>,
    url: Option<String>,
    last_edited_at: Option<String>,
    author_association: Option<String>,
    #[serde(default)]
    is_minimized: bool,
    minimized_reason: Option<String>,
    reaction_groups: Option<Vec<ReactionGroupNode>>,
    label: Option<LabelNode>,
    assignee: Option<ActorNode>,
    previous_title: Option<String>,
    current_title: Option<String>,
    milestone_title: Option<String>,
    state_reason: Option<IssueStateReason>,
    lock_reason: Option<String>,
    closer: Option<ReferencedNode>,
    source: Option<ReferencedNode>,
    subject: Option<ReferencedNode>,
    canonical: Option<ReferencedNode>,
    commit: Option<CommitNode>,
    commit_repository: Option<RepositoryNameNode>,
    #[serde(default)]
    will_close_target: bool,
    from_repository: Option<RepositoryNameNode>,
}

fn timeline_kind(typename: &str) -> Option<TimelineItemKind> {
    use TimelineItemKind as Kind;
    Some(match typename {
        "IssueComment" => Kind::Comment,
        "LabeledEvent" => Kind::Labeled,
        "UnlabeledEvent" => Kind::Unlabeled,
        "AssignedEvent" => Kind::Assigned,
        "UnassignedEvent" => Kind::Unassigned,
        "ClosedEvent" => Kind::Closed,
        "ReopenedEvent" => Kind::Reopened,
        "RenamedTitleEvent" => Kind::Renamed,
        "MilestonedEvent" => Kind::Milestoned,
        "DemilestonedEvent" => Kind::Demilestoned,
        "CrossReferencedEvent" => Kind::CrossReferenced,
        "ReferencedEvent" => Kind::Referenced,
        "ConnectedEvent" => Kind::Connected,
        "DisconnectedEvent" => Kind::Disconnected,
        "LockedEvent" => Kind::Locked,
        "UnlockedEvent" => Kind::Unlocked,
        "PinnedEvent" => Kind::Pinned,
        "UnpinnedEvent" => Kind::Unpinned,
        "TransferredEvent" => Kind::Transferred,
        "MarkedAsDuplicateEvent" => Kind::MarkedAsDuplicate,
        _ => return None,
    })
}

fn timeline_item(value: Value) -> Option<TimelineItem> {
    let node: TimelineNode = match serde_json::from_value(value) {
        Ok(node) => node,
        Err(error) => {
            log::warn!(target: "github", "skipping undecodable timeline item: {error}");
            return None;
        }
    };
    let kind = timeline_kind(&node.typename)?;

    let reference = match kind {
        TimelineItemKind::Referenced => node
            .commit
            .map(|commit| commit.into_reference(node.commit_repository.map(|r| r.name_with_owner))),
        _ => node
            .closer
            .or(node.source)
            .or(node.subject)
            .or(node.canonical)
            .and_then(ReferencedNode::into_reference),
    };

    Some(TimelineItem {
        id: node.id?,
        kind,
        created_at: node.created_at?,
        actor: node.author.or(node.actor).map(Actor::from),
        body_html: node.body_html,
        author_association: node.author_association,
        last_edited_at: node.last_edited_at,
        html_url: node.url,
        reactions: reactions(node.reaction_groups),
        minimized_reason: node.is_minimized.then(|| {
            node.minimized_reason
                .unwrap_or_else(|| "hidden".to_string())
        }),
        label: node.label.map(Label::from),
        assignee: node.assignee.map(Actor::from),
        previous_title: node.previous_title,
        current_title: node.current_title,
        milestone_title: node.milestone_title,
        state_reason: node.state_reason,
        lock_reason: node.lock_reason,
        reference,
        will_close: node.will_close_target,
        from_repository: node.from_repository.map(|r| r.name_with_owner),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> IssueListRequest {
        IssueListRequest {
            repository: RepositoryRef {
                owner: "octo".into(),
                name: "hello".into(),
            },
            state: IssueStateFilter::Open,
            assigned_to_me: false,
            labels: Vec::new(),
            query: None,
            sort: IssueSort::Newest,
            after: None,
        }
    }

    #[test]
    fn search_text_pins_repository_and_maps_filters() {
        let mut request = request();
        assert_eq!(
            issue_search_text(&request).unwrap(),
            "repo:octo/hello is:issue is:open sort:created-desc"
        );

        request.state = IssueStateFilter::All;
        request.assigned_to_me = true;
        request.labels = vec!["good first issue".into(), "say \"hi\"".into(), " ".into()];
        request.query = Some("  author:octocat crash ".into());
        request.sort = IssueSort::MostCommented;
        assert_eq!(
            issue_search_text(&request).unwrap(),
            "repo:octo/hello is:issue assignee:@me label:\"good first issue\" \
             label:\"say hi\" author:octocat crash sort:comments-desc"
        );
    }

    #[test]
    fn search_rejects_bad_input() {
        let mut request = request();
        request.query = Some("x".repeat(MAX_SEARCH_TEXT + 1));
        assert!(issue_search_text(&request).is_err());

        let mut request = self::request();
        request.query = Some("one\ntwo".into());
        assert!(issue_search_text(&request).is_err());

        let mut request = self::request();
        request.repository.name = "hello world".into();
        assert!(issue_search_text(&request).is_err());

        let mut request = self::request();
        request.after = Some(String::new());
        assert!(issue_search_variables(&request).is_err());
    }

    #[test]
    fn search_page_keeps_issues_and_skips_other_nodes() {
        let data: IssueSearchData = serde_json::from_value(json!({
            "search": {
                "issueCount": 2,
                "pageInfo": { "hasNextPage": true, "endCursor": "Y3" },
                "nodes": [
                    {
                        "__typename": "Issue", "number": 7, "title": "Crash", "url": "https://github.com/octo/hello/issues/7",
                        "state": "CLOSED", "stateReason": "NOT_PLANNED",
                        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-02T00:00:00Z", "closedAt": "2026-01-02T00:00:00Z",
                        "author": null, "comments": { "totalCount": 3 },
                        "labels": { "nodes": [{ "name": "bug", "color": "d73a4a", "description": "" }, null] },
                        "assignees": { "nodes": [] }, "milestone": { "title": "v1" }
                    },
                    { "__typename": "PullRequest" },
                    null
                ]
            }
        }))
        .unwrap();

        let page = IssuePage::from(data);
        assert_eq!(page.total_count, 2);
        assert!(page.has_next_page);
        assert_eq!(page.end_cursor.as_deref(), Some("Y3"));
        assert_eq!(page.issues.len(), 1);
        let issue = &page.issues[0];
        assert_eq!(issue.state, IssueState::Closed);
        assert_eq!(issue.state_reason, Some(IssueStateReason::NotPlanned));
        assert_eq!(issue.author, None);
        assert_eq!(issue.labels[0].description, None);
        assert_eq!(issue.milestone.as_deref(), Some("v1"));
    }

    #[test]
    fn unknown_state_reason_does_not_fail_decoding() {
        let reason: IssueStateReason = serde_json::from_value(json!("SOMETHING_NEW")).unwrap();
        assert_eq!(reason, IssueStateReason::Other);
        assert_eq!(
            serde_json::to_value(IssueStateReason::NotPlanned).unwrap(),
            json!("notPlanned")
        );
        assert_eq!(
            serde_json::to_value(IssueState::Open).unwrap(),
            json!("open")
        );
    }

    fn actor(login: &str) -> Value {
        json!({ "login": login, "avatarUrl": "https://avatars.githubusercontent.com/u/1?v=4", "url": format!("https://github.com/{login}") })
    }

    #[test]
    fn timeline_items_map_each_event_type() {
        let items: Vec<TimelineItem> = [
            json!({
                "__typename": "IssueComment", "id": "IC_1", "url": "https://github.com/octo/hello/issues/7#issuecomment-1",
                "bodyHTML": "<p>hi</p>", "createdAt": "2026-01-01T00:00:00Z", "lastEditedAt": null,
                "authorAssociation": "MEMBER", "isMinimized": true, "minimizedReason": "outdated",
                "author": actor("mona"),
                "reactionGroups": [
                    { "content": "THUMBS_UP", "reactors": { "totalCount": 2 }, "viewerHasReacted": true },
                    { "content": "HEART", "reactors": { "totalCount": 0 }, "viewerHasReacted": false }
                ]
            }),
            json!({ "__typename": "LabeledEvent", "id": "LE_1", "createdAt": "2026-01-01T00:00:00Z", "actor": actor("mona"), "label": { "name": "bug", "color": "d73a4a" } }),
            json!({
                "__typename": "ClosedEvent", "id": "CE_1", "createdAt": "2026-01-02T00:00:00Z", "stateReason": "COMPLETED", "actor": null,
                "closer": { "__typename": "PullRequest", "number": 8, "title": "Fix", "url": "https://github.com/octo/hello/pull/8", "state": "MERGED", "isDraft": false, "repository": { "nameWithOwner": "octo/hello" } }
            }),
            json!({
                "__typename": "ReferencedEvent", "id": "RE_1", "createdAt": "2026-01-02T00:00:00Z", "actor": actor("mona"),
                "commit": { "abbreviatedOid": "abc1234", "url": "https://github.com/octo/other/commit/abc1234", "messageHeadline": "Mention #7" },
                "commitRepository": { "nameWithOwner": "octo/other" }
            }),
            json!({
                "__typename": "CrossReferencedEvent", "id": "CR_1", "createdAt": "2026-01-03T00:00:00Z", "actor": actor("mona"), "willCloseTarget": true,
                "source": { "__typename": "Issue", "number": 9, "title": "Related", "url": "https://github.com/octo/hello/issues/9", "state": "OPEN", "repository": { "nameWithOwner": "octo/hello" } }
            }),
            json!({ "__typename": "RenamedTitleEvent", "id": "RT_1", "createdAt": "2026-01-03T00:00:00Z", "actor": actor("mona"), "previousTitle": "Old", "currentTitle": "New" }),
            json!({ "__typename": "SubscribedEvent", "id": "X_1", "createdAt": "2026-01-03T00:00:00Z" }),
            json!({ "__typename": "LabeledEvent", "id": "LE_2" }),
            json!({ "__typename": "LabeledEvent", "id": "LE_3", "createdAt": 5 }),
        ]
        .into_iter()
        .filter_map(timeline_item)
        .collect();

        assert_eq!(items.len(), 6, "unknown and malformed items are skipped");

        let comment = &items[0];
        assert_eq!(comment.kind, TimelineItemKind::Comment);
        assert_eq!(comment.actor.as_ref().unwrap().login, "mona");
        assert_eq!(comment.minimized_reason.as_deref(), Some("outdated"));
        assert_eq!(comment.reactions.len(), 1);
        assert_eq!(comment.reactions[0].count, 2);

        assert_eq!(items[1].label.as_ref().unwrap().name, "bug");

        let closed = &items[2];
        assert_eq!(closed.state_reason, Some(IssueStateReason::Completed));
        assert_eq!(closed.actor, None);
        let closer = closed.reference.as_ref().unwrap();
        assert_eq!(
            (closer.kind, closer.number, closer.state.as_deref()),
            (ReferenceKind::PullRequest, Some(8), Some("merged"))
        );

        let commit = items[3].reference.as_ref().unwrap();
        assert_eq!(commit.kind, ReferenceKind::Commit);
        assert_eq!(commit.abbreviated_oid.as_deref(), Some("abc1234"));
        assert_eq!(commit.repository.as_deref(), Some("octo/other"));

        assert!(items[4].will_close);
        assert_eq!(
            items[4].reference.as_ref().unwrap().kind,
            ReferenceKind::Issue
        );

        assert_eq!(items[5].previous_title.as_deref(), Some("Old"));
    }

    #[test]
    fn missing_issue_decodes_to_none() {
        let data: IssueDetailData =
            serde_json::from_value(json!({ "repository": { "issue": null } })).unwrap();
        assert!(data.into_detail().is_none());
    }

    #[test]
    fn queries_select_what_the_dtos_read() {
        for field in [
            "bodyHTML",
            "timelineItems",
            "closedByPullRequestsReferences",
            "reactionGroups",
            "commitRepository",
        ] {
            assert!(ISSUE_DETAIL_QUERY.contains(field), "{field}");
        }
        assert!(ISSUE_SEARCH_QUERY.contains("search(query: $search, type: ISSUE"));
        assert!(REPOSITORY_LABELS_QUERY.contains("orderBy: { field: NAME, direction: ASC }"));
    }
}
