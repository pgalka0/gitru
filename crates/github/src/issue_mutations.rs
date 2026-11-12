//! Issue changes: comments, title/body, state, labels, assignees, milestone,
//! reactions and new issues, plus the repository metadata the editor needs.
//!
//! Every document in `queries/` was checked against the live GitHub schema.
//! Everything coming from the webview is validated here before a request is
//! built; values travel only as GraphQL variables, never spliced into a query.

use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{
    error::GithubError,
    issues::{
        LabelNode, MilestoneNode, Nodes, ReactionGroupNode, UserNode, reactions, timeline_item,
    },
    models::{
        AddCommentRequest, AssignableUsersRequest, ChangeAssigneesRequest, ChangeLabelsRequest,
        CloseIssueRequest, CloseReason, CreateIssueRequest, CreatedIssue, EditCommentRequest,
        EditIssueRequest, IssueContent, IssueState, IssueStateReason, IssueStateUpdate, Label,
        Milestone, MilestoneUpdate, ReactionGroup, RepositoryIssueMetadata, RepositoryRef,
        SetMilestoneRequest, SetReactionRequest, TimelineItem, User,
    },
};

pub(crate) const ADD_COMMENT_MUTATION: &str = concat!(
    include_str!("queries/comment_fields.graphql"),
    include_str!("queries/add_comment.graphql")
);
pub(crate) const UPDATE_COMMENT_MUTATION: &str = concat!(
    include_str!("queries/comment_fields.graphql"),
    include_str!("queries/update_comment.graphql")
);
pub(crate) const DELETE_COMMENT_MUTATION: &str = include_str!("queries/delete_comment.graphql");
pub(crate) const UPDATE_ISSUE_MUTATION: &str = include_str!("queries/update_issue.graphql");
pub(crate) const CLOSE_ISSUE_MUTATION: &str = include_str!("queries/close_issue.graphql");
pub(crate) const REOPEN_ISSUE_MUTATION: &str = include_str!("queries/reopen_issue.graphql");
pub(crate) const CHANGE_LABELS_MUTATION: &str = include_str!("queries/change_labels.graphql");
pub(crate) const CHANGE_ASSIGNEES_MUTATION: &str = include_str!("queries/change_assignees.graphql");
pub(crate) const ADD_REACTION_MUTATION: &str = include_str!("queries/add_reaction.graphql");
pub(crate) const REMOVE_REACTION_MUTATION: &str = include_str!("queries/remove_reaction.graphql");
pub(crate) const CREATE_ISSUE_MUTATION: &str = include_str!("queries/create_issue.graphql");
pub(crate) const REPOSITORY_ISSUE_METADATA_QUERY: &str =
    include_str!("queries/repository_issue_metadata.graphql");
pub(crate) const ASSIGNABLE_USERS_QUERY: &str = include_str!("queries/assignable_users.graphql");

/// GitHub node IDs are short base64-like strings (`I_kwDO…`, `MDU6…==`).
const MAX_NODE_ID_LEN: usize = 128;
/// GitHub's own limit for issue and comment bodies.
pub(crate) const MAX_BODY_CHARS: usize = 65_536;
/// GitHub's own limit for issue titles.
pub(crate) const MAX_TITLE_CHARS: usize = 256;
const MAX_IDS_PER_CHANGE: usize = 100;
const MAX_USER_QUERY_CHARS: usize = 100;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn invalid(message: impl Into<String>) -> GithubError {
    GithubError::InvalidInput(message.into())
}

pub(crate) fn validate_node_id(id: &str, what: &str) -> Result<(), GithubError> {
    let valid = !id.is_empty()
        && id.len() <= MAX_NODE_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'=' | b'+' | b'/'));
    if valid {
        Ok(())
    } else {
        Err(invalid(format!("Invalid {what} ID")))
    }
}

/// Validated, de-duplicated IDs in their original order.
fn node_ids(ids: &[String], what: &str) -> Result<Vec<String>, GithubError> {
    if ids.len() > MAX_IDS_PER_CHANGE {
        return Err(invalid(format!(
            "Change at most {MAX_IDS_PER_CHANGE} {what}s at once"
        )));
    }
    let mut unique: Vec<String> = Vec::with_capacity(ids.len());
    for id in ids {
        validate_node_id(id, what)?;
        if !unique.contains(id) {
            unique.push(id.clone());
        }
    }
    Ok(unique)
}

fn comment_body(body: &str) -> Result<&str, GithubError> {
    if body.trim().is_empty() {
        return Err(invalid("A comment cannot be empty"));
    }
    issue_body(body)
}

fn issue_body(body: &str) -> Result<&str, GithubError> {
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(invalid(format!(
            "Text is too long (at most {MAX_BODY_CHARS} characters)"
        )));
    }
    Ok(body)
}

fn issue_title(title: &str) -> Result<&str, GithubError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(invalid("A title is required"));
    }
    if title.chars().any(char::is_control) {
        return Err(invalid("A title must be a single line"));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid(format!(
            "A title can have at most {MAX_TITLE_CHARS} characters"
        )));
    }
    Ok(title)
}

/// Add and remove lists for a labels/assignees change. An ID in both lists is
/// a contradiction, and an empty change would be a wasted round trip.
fn id_change(
    add: &[String],
    remove: &[String],
    what: &str,
) -> Result<(Vec<String>, Vec<String>), GithubError> {
    let add = node_ids(add, what)?;
    let remove = node_ids(remove, what)?;
    if add.iter().any(|id| remove.contains(id)) {
        return Err(invalid(format!("Cannot add and remove the same {what}")));
    }
    if add.is_empty() && remove.is_empty() {
        return Err(invalid("Nothing to change"));
    }
    Ok((add, remove))
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

pub(crate) fn add_comment_variables(request: &AddCommentRequest) -> Result<Value, GithubError> {
    validate_node_id(&request.issue_id, "issue")?;
    Ok(json!({
        "subjectId": request.issue_id,
        "body": comment_body(&request.body)?,
    }))
}

pub(crate) fn edit_comment_variables(request: &EditCommentRequest) -> Result<Value, GithubError> {
    validate_node_id(&request.comment_id, "comment")?;
    Ok(json!({ "id": request.comment_id, "body": comment_body(&request.body)? }))
}

pub(crate) fn delete_comment_variables(comment_id: &str) -> Result<Value, GithubError> {
    validate_node_id(comment_id, "comment")?;
    Ok(json!({ "id": comment_id }))
}

pub(crate) fn edit_issue_variables(request: &EditIssueRequest) -> Result<Value, GithubError> {
    validate_node_id(&request.issue_id, "issue")?;
    let mut input = Map::new();
    input.insert("id".into(), json!(request.issue_id));
    if let Some(title) = &request.title {
        input.insert("title".into(), json!(issue_title(title)?));
    }
    if let Some(body) = &request.body {
        input.insert("body".into(), json!(issue_body(body)?));
    }
    if input.len() == 1 {
        return Err(invalid("Nothing to change"));
    }
    Ok(json!({ "input": input }))
}

pub(crate) fn set_milestone_variables(request: &SetMilestoneRequest) -> Result<Value, GithubError> {
    validate_node_id(&request.issue_id, "issue")?;
    if let Some(milestone_id) = &request.milestone_id {
        validate_node_id(milestone_id, "milestone")?;
    }
    // An explicit `null` removes the milestone; leaving the key out would not.
    Ok(json!({ "input": { "id": request.issue_id, "milestoneId": request.milestone_id } }))
}

pub(crate) fn close_issue_variables(request: &CloseIssueRequest) -> Result<Value, GithubError> {
    validate_node_id(&request.issue_id, "issue")?;
    let reason = match request.reason {
        CloseReason::Completed => "COMPLETED",
        CloseReason::NotPlanned => "NOT_PLANNED",
    };
    Ok(json!({ "id": request.issue_id, "reason": reason }))
}

pub(crate) fn reopen_issue_variables(issue_id: &str) -> Result<Value, GithubError> {
    validate_node_id(issue_id, "issue")?;
    Ok(json!({ "id": issue_id }))
}

pub(crate) fn change_labels_variables(request: &ChangeLabelsRequest) -> Result<Value, GithubError> {
    validate_node_id(&request.issue_id, "issue")?;
    let (add, remove) = id_change(&request.add_label_ids, &request.remove_label_ids, "label")?;
    Ok(json!({
        "id": request.issue_id,
        "adding": !add.is_empty(),
        "removing": !remove.is_empty(),
        "add": add,
        "remove": remove,
    }))
}

pub(crate) fn change_assignees_variables(
    request: &ChangeAssigneesRequest,
) -> Result<Value, GithubError> {
    validate_node_id(&request.issue_id, "issue")?;
    let (add, remove) = id_change(&request.add_user_ids, &request.remove_user_ids, "assignee")?;
    Ok(json!({
        "id": request.issue_id,
        "adding": !add.is_empty(),
        "removing": !remove.is_empty(),
        "add": add,
        "remove": remove,
    }))
}

/// The document to run and its variables.
pub(crate) fn reaction_request(
    request: &SetReactionRequest,
) -> Result<(&'static str, Value), GithubError> {
    validate_node_id(&request.subject_id, "subject")?;
    let content = request
        .content
        .graphql_name()
        .ok_or_else(|| invalid("Unknown reaction"))?;
    let document = if request.reacted {
        ADD_REACTION_MUTATION
    } else {
        REMOVE_REACTION_MUTATION
    };
    Ok((
        document,
        json!({ "id": request.subject_id, "content": content }),
    ))
}

/// Checks a new issue before the repository ID is looked up.
pub(crate) fn validate_create_issue(request: &CreateIssueRequest) -> Result<(), GithubError> {
    request.repository.validate()?;
    issue_title(&request.title)?;
    issue_body(&request.body)?;
    node_ids(&request.label_ids, "label")?;
    node_ids(&request.assignee_ids, "assignee")?;
    if let Some(milestone_id) = &request.milestone_id {
        validate_node_id(milestone_id, "milestone")?;
    }
    Ok(())
}

pub(crate) fn create_issue_variables(
    request: &CreateIssueRequest,
    repository_id: &str,
) -> Result<Value, GithubError> {
    validate_create_issue(request)?;
    let mut input = Map::new();
    input.insert("repositoryId".into(), json!(repository_id));
    input.insert("title".into(), json!(issue_title(&request.title)?));
    input.insert("body".into(), json!(request.body));
    input.insert(
        "labelIds".into(),
        json!(node_ids(&request.label_ids, "label")?),
    );
    input.insert(
        "assigneeIds".into(),
        json!(node_ids(&request.assignee_ids, "assignee")?),
    );
    if let Some(milestone_id) = &request.milestone_id {
        input.insert("milestoneId".into(), json!(milestone_id));
    }
    Ok(json!({ "input": input }))
}

pub(crate) fn repository_variables(repository: &RepositoryRef) -> Result<Value, GithubError> {
    repository.validate()?;
    Ok(json!({ "owner": repository.owner, "name": repository.name }))
}

pub(crate) fn assignable_users_variables(
    request: &AssignableUsersRequest,
) -> Result<Value, GithubError> {
    request.repository.validate()?;
    let query = request
        .query
        .as_deref()
        .map(str::trim)
        .filter(|query| !query.is_empty());
    if let Some(query) = query
        && (query.chars().count() > MAX_USER_QUERY_CHARS || query.chars().any(char::is_control))
    {
        return Err(invalid("Invalid user search"));
    }
    Ok(json!({
        "owner": request.repository.owner,
        "name": request.repository.name,
        "query": query,
    }))
}

/// Markdown preview text, checked against the same limit as a real comment.
pub(crate) fn markdown_text(text: &str) -> Result<&str, GithubError> {
    issue_body(text)
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

fn no_result() -> GithubError {
    GithubError::Decode("GitHub did not return the changed item".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddCommentData {
    add_comment: Option<AddCommentPayload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddCommentPayload {
    comment_edge: Option<CommentEdge>,
}

#[derive(Deserialize)]
struct CommentEdge {
    node: Option<Value>,
}

impl AddCommentData {
    pub(crate) fn into_item(self) -> Result<TimelineItem, GithubError> {
        self.add_comment
            .and_then(|payload| payload.comment_edge)
            .and_then(|edge| edge.node)
            .and_then(timeline_item)
            .ok_or_else(no_result)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCommentData {
    update_issue_comment: Option<UpdateCommentPayload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCommentPayload {
    issue_comment: Option<Value>,
}

impl UpdateCommentData {
    pub(crate) fn into_item(self) -> Result<TimelineItem, GithubError> {
        self.update_issue_comment
            .and_then(|payload| payload.issue_comment)
            .and_then(timeline_item)
            .ok_or_else(no_result)
    }
}

/// `deleteIssueComment` returns nothing worth reading; errors fail the call.
#[derive(Deserialize)]
pub(crate) struct DeleteCommentData {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateIssueData {
    update_issue: Option<UpdateIssuePayload>,
}

#[derive(Deserialize)]
struct UpdateIssuePayload {
    issue: Option<UpdatedIssueNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatedIssueNode {
    title: String,
    #[serde(default)]
    body: String,
    #[serde(rename = "bodyHTML")]
    body_html: String,
    last_edited_at: Option<String>,
    milestone: Option<MilestoneNode>,
}

impl UpdateIssueData {
    fn into_issue(self) -> Result<UpdatedIssueNode, GithubError> {
        self.update_issue
            .and_then(|payload| payload.issue)
            .ok_or_else(no_result)
    }

    pub(crate) fn into_content(self) -> Result<IssueContent, GithubError> {
        let issue = self.into_issue()?;
        Ok(IssueContent {
            title: issue.title,
            body: issue.body,
            body_html: issue.body_html,
            last_edited_at: issue.last_edited_at,
        })
    }

    pub(crate) fn into_milestone(self) -> Result<MilestoneUpdate, GithubError> {
        Ok(MilestoneUpdate {
            milestone: self.into_issue()?.milestone.map(Milestone::from),
        })
    }
}

/// `closeIssue` and `reopenIssue` share a payload shape.
#[derive(Deserialize)]
pub(crate) struct IssueStateData {
    #[serde(alias = "closeIssue", alias = "reopenIssue")]
    payload: Option<IssueStatePayload>,
}

#[derive(Deserialize)]
struct IssueStatePayload {
    issue: Option<IssueStateNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueStateNode {
    state: IssueState,
    state_reason: Option<IssueStateReason>,
}

impl IssueStateData {
    pub(crate) fn into_update(self) -> Result<IssueStateUpdate, GithubError> {
        let issue = self
            .payload
            .and_then(|payload| payload.issue)
            .ok_or_else(no_result)?;
        Ok(IssueStateUpdate {
            state: issue.state,
            state_reason: issue.state_reason,
        })
    }
}

/// `added` / `removed` are absent when skipped by `@include`.
#[derive(Deserialize)]
pub(crate) struct ChangeLabelsData {
    added: Option<LabelablePayload>,
    removed: Option<LabelablePayload>,
}

#[derive(Deserialize)]
struct LabelablePayload {
    labelable: Option<LabelsHolder>,
}

#[derive(Deserialize)]
struct LabelsHolder {
    labels: Option<Nodes<LabelNode>>,
}

impl ChangeLabelsData {
    /// Labels after both steps; the last step that ran holds the final state.
    pub(crate) fn into_labels(self) -> Result<Vec<Label>, GithubError> {
        let holder = self
            .removed
            .or(self.added)
            .and_then(|payload| payload.labelable)
            .ok_or_else(no_result)?;
        Ok(holder.labels.map(Nodes::into_vec).unwrap_or_default())
    }
}

#[derive(Deserialize)]
pub(crate) struct ChangeAssigneesData {
    added: Option<AssignablePayload>,
    removed: Option<AssignablePayload>,
}

#[derive(Deserialize)]
struct AssignablePayload {
    assignable: Option<AssigneesHolder>,
}

#[derive(Deserialize)]
struct AssigneesHolder {
    assignees: Nodes<UserNode>,
}

impl ChangeAssigneesData {
    pub(crate) fn into_users(self) -> Result<Vec<User>, GithubError> {
        let holder = self
            .removed
            .or(self.added)
            .and_then(|payload| payload.assignable)
            .ok_or_else(no_result)?;
        Ok(holder.assignees.into_vec())
    }
}

/// `addReaction` and `removeReaction` share a payload shape.
#[derive(Deserialize)]
pub(crate) struct ReactionData {
    #[serde(alias = "addReaction", alias = "removeReaction")]
    payload: Option<ReactionPayload>,
}

#[derive(Deserialize)]
struct ReactionPayload {
    subject: Option<ReactionSubject>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReactionSubject {
    reaction_groups: Option<Vec<ReactionGroupNode>>,
}

impl ReactionData {
    pub(crate) fn into_reactions(self) -> Result<Vec<ReactionGroup>, GithubError> {
        let subject = self
            .payload
            .and_then(|payload| payload.subject)
            .ok_or_else(no_result)?;
        Ok(reactions(subject.reaction_groups))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateIssueData {
    create_issue: Option<CreateIssuePayload>,
}

#[derive(Deserialize)]
struct CreateIssuePayload {
    issue: Option<CreatedIssueNode>,
}

#[derive(Deserialize)]
struct CreatedIssueNode {
    number: u32,
    url: String,
}

impl CreateIssueData {
    pub(crate) fn into_created(self) -> Result<CreatedIssue, GithubError> {
        let issue = self
            .create_issue
            .and_then(|payload| payload.issue)
            .ok_or_else(no_result)?;
        Ok(CreatedIssue {
            number: issue.number,
            html_url: issue.url,
        })
    }
}

#[derive(Deserialize)]
pub(crate) struct RepositoryIssueMetadataData {
    repository: Option<MetadataRepositoryNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataRepositoryNode {
    id: String,
    #[serde(default)]
    viewer_can_create_issues: bool,
    viewer_permission: Option<String>,
    milestones: Option<Nodes<MilestoneNode>>,
}

impl RepositoryIssueMetadataData {
    /// The repository node ID and its metadata; `None` when not found.
    pub(crate) fn into_metadata(self) -> Option<(String, RepositoryIssueMetadata)> {
        let repository = self.repository?;
        Some((
            repository.id,
            RepositoryIssueMetadata {
                can_create_issues: repository.viewer_can_create_issues,
                can_triage: matches!(
                    repository.viewer_permission.as_deref(),
                    Some("ADMIN" | "MAINTAIN" | "WRITE" | "TRIAGE")
                ),
                milestones: repository
                    .milestones
                    .map(Nodes::into_vec)
                    .unwrap_or_default(),
            },
        ))
    }
}

#[derive(Deserialize)]
pub(crate) struct AssignableUsersData {
    repository: Option<AssignableRepositoryNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssignableRepositoryNode {
    assignable_users: Option<Nodes<UserNode>>,
}

impl AssignableUsersData {
    pub(crate) fn into_users(self) -> Option<Vec<User>> {
        Some(
            self.repository?
                .assignable_users
                .map(Nodes::into_vec)
                .unwrap_or_default(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReactionContent, TimelineItemKind};

    const ISSUE: &str = "I_kwDOAbc123";

    #[test]
    fn node_ids_accept_github_formats_and_reject_anything_else() {
        for id in [
            "I_kwDODKw3uc5RFrNZ",
            "MDU6TGFiZWwxNTkzNDg0NjIw",
            "MDEwOlJl+/w==",
        ] {
            assert!(validate_node_id(id, "issue").is_ok(), "{id}");
        }
        for id in [
            "",
            "has space",
            "a\"b",
            "x{y}",
            &"x".repeat(MAX_NODE_ID_LEN + 1),
        ] {
            assert!(validate_node_id(id, "issue").is_err(), "{id}");
        }
    }

    #[test]
    fn comments_need_text_within_githubs_limit() {
        let request = |body: &str| AddCommentRequest {
            issue_id: ISSUE.into(),
            body: body.into(),
        };
        assert_eq!(
            add_comment_variables(&request("**hi**\n")).unwrap(),
            json!({ "subjectId": ISSUE, "body": "**hi**\n" })
        );
        assert!(add_comment_variables(&request(" \n\t")).is_err());
        assert!(add_comment_variables(&request(&"x".repeat(MAX_BODY_CHARS + 1))).is_err());
    }

    #[test]
    fn edit_issue_sends_only_what_changed() {
        let request = |title: Option<&str>, body: Option<&str>| EditIssueRequest {
            issue_id: ISSUE.into(),
            title: title.map(str::to_string),
            body: body.map(str::to_string),
        };
        assert_eq!(
            edit_issue_variables(&request(Some("  New title "), None)).unwrap(),
            json!({ "input": { "id": ISSUE, "title": "New title" } })
        );
        assert_eq!(
            edit_issue_variables(&request(None, Some(""))).unwrap(),
            json!({ "input": { "id": ISSUE, "body": "" } })
        );
        assert!(edit_issue_variables(&request(None, None)).is_err());
        assert!(edit_issue_variables(&request(Some("   "), None)).is_err());
        assert!(edit_issue_variables(&request(Some("two\nlines"), None)).is_err());
    }

    #[test]
    fn clearing_the_milestone_sends_an_explicit_null() {
        let variables = set_milestone_variables(&SetMilestoneRequest {
            issue_id: ISSUE.into(),
            milestone_id: None,
        })
        .unwrap();
        assert_eq!(
            variables,
            json!({ "input": { "id": ISSUE, "milestoneId": null } })
        );
    }

    #[test]
    fn label_changes_are_deduplicated_and_must_be_consistent() {
        let request = |add: &[&str], remove: &[&str]| ChangeLabelsRequest {
            issue_id: ISSUE.into(),
            add_label_ids: add.iter().map(|s| s.to_string()).collect(),
            remove_label_ids: remove.iter().map(|s| s.to_string()).collect(),
        };
        assert_eq!(
            change_labels_variables(&request(&["LA_1", "LA_1"], &[])).unwrap(),
            json!({ "id": ISSUE, "adding": true, "removing": false, "add": ["LA_1"], "remove": [] })
        );
        assert!(change_labels_variables(&request(&["LA_1"], &["LA_1"])).is_err());
        assert!(change_labels_variables(&request(&[], &[])).is_err());
        assert!(change_labels_variables(&request(&["bad id"], &[])).is_err());
    }

    #[test]
    fn close_reasons_and_reactions_map_to_github_enums() {
        assert_eq!(
            close_issue_variables(&CloseIssueRequest {
                issue_id: ISSUE.into(),
                reason: CloseReason::NotPlanned,
            })
            .unwrap()["reason"],
            json!("NOT_PLANNED")
        );

        let (document, variables) = reaction_request(&SetReactionRequest {
            subject_id: ISSUE.into(),
            content: ReactionContent::ThumbsUp,
            reacted: false,
        })
        .unwrap();
        assert_eq!(document, REMOVE_REACTION_MUTATION);
        assert_eq!(variables["content"], json!("THUMBS_UP"));

        assert!(
            reaction_request(&SetReactionRequest {
                subject_id: ISSUE.into(),
                content: ReactionContent::Other,
                reacted: true,
            })
            .is_err()
        );
    }

    #[test]
    fn new_issues_are_validated_before_any_lookup() {
        let mut request = CreateIssueRequest {
            repository: RepositoryRef {
                owner: "octo".into(),
                name: "hello".into(),
            },
            title: " Crash on start ".into(),
            body: String::new(),
            label_ids: vec!["LA_1".into()],
            assignee_ids: Vec::new(),
            milestone_id: None,
        };
        assert_eq!(
            create_issue_variables(&request, "R_1").unwrap(),
            json!({ "input": {
                "repositoryId": "R_1", "title": "Crash on start", "body": "",
                "labelIds": ["LA_1"], "assigneeIds": []
            } })
        );

        request.title = String::new();
        assert!(validate_create_issue(&request).is_err());
    }

    #[test]
    fn user_search_is_optional_and_bounded() {
        let request = |query: Option<&str>| AssignableUsersRequest {
            repository: RepositoryRef {
                owner: "octo".into(),
                name: "hello".into(),
            },
            query: query.map(str::to_string),
        };
        assert_eq!(
            assignable_users_variables(&request(Some("  "))).unwrap()["query"],
            Value::Null
        );
        assert_eq!(
            assignable_users_variables(&request(Some(" mo "))).unwrap()["query"],
            json!("mo")
        );
        assert!(assignable_users_variables(&request(Some(&"x".repeat(101)))).is_err());
    }

    #[test]
    fn responses_decode_into_models() {
        let comment: AddCommentData = serde_json::from_value(json!({ "addComment": { "commentEdge": { "node": {
            "__typename": "IssueComment", "id": "IC_1", "url": "https://github.com/octo/hello/issues/1#issuecomment-1",
            "body": "**hi**", "bodyHTML": "<p><strong>hi</strong></p>", "createdAt": "2026-01-01T00:00:00Z",
            "lastEditedAt": null, "authorAssociation": "OWNER", "isMinimized": false, "minimizedReason": null,
            "viewerCanUpdate": true, "viewerCanDelete": true, "viewerCanReact": true,
            "author": { "login": "mona", "avatarUrl": "https://avatars.githubusercontent.com/u/1?v=4", "url": "https://github.com/mona" },
            "reactionGroups": [{ "content": "ROCKET", "reactors": { "totalCount": 1 }, "viewerHasReacted": true }]
        } } } }))
        .unwrap();
        let item = comment.into_item().unwrap();
        assert_eq!(item.kind, TimelineItemKind::Comment);
        assert_eq!(item.body.as_deref(), Some("**hi**"));
        assert!(item.viewer_can_update && item.viewer_can_delete);
        assert_eq!(item.reactions[0].content, ReactionContent::Rocket);

        let labels: ChangeLabelsData = serde_json::from_value(json!({
            "added": { "labelable": { "labels": { "nodes": [{ "id": "LA_1", "name": "bug", "color": "d73a4a", "description": null }] } } }
        }))
        .unwrap();
        assert_eq!(labels.into_labels().unwrap()[0].id, "LA_1");

        let state: IssueStateData = serde_json::from_value(json!({
            "closeIssue": { "issue": { "state": "CLOSED", "stateReason": "NOT_PLANNED" } }
        }))
        .unwrap();
        assert_eq!(
            state.into_update().unwrap(),
            IssueStateUpdate {
                state: IssueState::Closed,
                state_reason: Some(IssueStateReason::NotPlanned)
            }
        );

        let milestone: UpdateIssueData = serde_json::from_value(json!({
            "updateIssue": { "issue": { "title": "t", "body": "", "bodyHTML": "", "lastEditedAt": null, "milestone": null } }
        }))
        .unwrap();
        assert_eq!(milestone.into_milestone().unwrap().milestone, None);

        let missing: AddCommentData =
            serde_json::from_value(json!({ "addComment": null })).unwrap();
        assert!(missing.into_item().is_err());
    }

    #[test]
    fn documents_use_the_fragments_they_define() {
        for document in [ADD_COMMENT_MUTATION, UPDATE_COMMENT_MUTATION] {
            assert!(document.contains("fragment CommentFields"));
            assert!(document.contains("...CommentFields"));
            assert!(document.contains("...ActorFields"));
        }
        assert!(CHANGE_LABELS_MUTATION.contains("@include(if: $removing)"));
        assert!(CHANGE_ASSIGNEES_MUTATION.contains("@include(if: $adding)"));
    }
}
