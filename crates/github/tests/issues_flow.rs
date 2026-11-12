#![recursion_limit = "256"]

use std::sync::Arc;

use github::auth::token::AccessToken;
use github::auth::token_store::{MemoryTokenStore, StoredCredential};
use github::endpoints::Endpoints;
use github::models::{
    IssueDetailRequest, IssueListRequest, IssueSort, IssueState, IssueStateFilter, ReferenceKind,
    RepositoryRef, TimelineItemKind, TokenSource,
};
use github::{GithubError, GithubService};
use serde_json::json;
use wiremock::matchers::{body_partial_json, body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn signed_in_service(server: &MockServer) -> GithubService {
    let store = Arc::new(MemoryTokenStore::with_credential(StoredCredential {
        token: AccessToken::parse("gho_saved").unwrap(),
        source: TokenSource::GhCli,
    }));
    GithubService::with_endpoints(
        store,
        None,
        Endpoints {
            api: server.uri(),
            web: server.uri(),
        },
    )
    .unwrap()
}

fn repo() -> RepositoryRef {
    RepositoryRef {
        owner: "octo".into(),
        name: "hello".into(),
    }
}

fn actor(login: &str) -> serde_json::Value {
    json!({
        "login": login,
        "avatarUrl": "https://avatars.githubusercontent.com/u/1?v=4",
        "url": format!("https://github.com/{login}")
    })
}

#[tokio::test]
async fn list_issues_sends_filters_as_search_syntax_and_maps_the_page() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("query IssueSearch"))
        .and(body_partial_json(json!({ "variables": {
            "search": "repo:octo/hello is:issue is:closed assignee:@me label:\"bug\" crash sort:updated-desc",
            "first": 50,
            "after": "Y3Vyc29yOjUw"
        }})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": { "search": {
            "issueCount": 51,
            "pageInfo": { "hasNextPage": false, "endCursor": "Y3Vyc29yOjUx" },
            "nodes": [{
                "__typename": "Issue", "number": 42, "title": "Crash on start",
                "url": "https://github.com/octo/hello/issues/42",
                "state": "CLOSED", "stateReason": "COMPLETED",
                "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-05T00:00:00Z",
                "closedAt": "2026-01-05T00:00:00Z", "author": actor("mona"),
                "comments": { "totalCount": 4 },
                "labels": { "nodes": [{ "name": "bug", "color": "d73a4a" }] },
                "assignees": { "nodes": [actor("octocat")] },
                "milestone": null
            }]
        }}})))
        .expect(1)
        .mount(&server)
        .await;

    let page = signed_in_service(&server)
        .list_issues(IssueListRequest {
            repository: repo(),
            state: IssueStateFilter::Closed,
            assigned_to_me: true,
            labels: vec!["bug".into()],
            query: Some("crash".into()),
            sort: IssueSort::RecentlyUpdated,
            after: Some("Y3Vyc29yOjUw".into()),
        })
        .await
        .unwrap();

    assert_eq!(page.total_count, 51);
    assert!(!page.has_next_page);
    let issue = &page.issues[0];
    assert_eq!(
        (issue.number, issue.state, issue.comments),
        (42, IssueState::Closed, 4)
    );
    assert_eq!(issue.assignees[0].login, "octocat");
    assert_eq!(
        issue.author.as_ref().unwrap().html_url,
        "https://github.com/mona"
    );
}

#[tokio::test]
async fn issue_detail_maps_metadata_and_requests_the_next_timeline_page() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("query IssueDetail"))
        .and(body_partial_json(json!({ "variables": {
            "owner": "octo", "name": "hello", "number": 42, "after": "cursor-100"
        }})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": { "repository": { "issue": {
            "number": 42, "title": "Crash on start", "url": "https://github.com/octo/hello/issues/42",
            "state": "OPEN", "stateReason": null, "bodyHTML": "<p>Steps</p>",
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-05T00:00:00Z",
            "closedAt": null, "lastEditedAt": "2026-01-02T00:00:00Z",
            "author": null, "authorAssociation": "NONE",
            "locked": false, "activeLockReason": null,
            "comments": { "totalCount": 120 },
            "labels": { "nodes": [{ "name": "bug", "color": "d73a4a", "description": "Something is broken" }] },
            "assignees": { "nodes": [] },
            "milestone": { "title": "v1", "url": "https://github.com/octo/hello/milestone/1", "state": "OPEN", "dueOn": null },
            "participants": { "totalCount": 31, "nodes": [actor("mona")] },
            "reactionGroups": [
                { "content": "THUMBS_UP", "reactors": { "totalCount": 7 }, "viewerHasReacted": false },
                { "content": "EYES", "reactors": { "totalCount": 0 }, "viewerHasReacted": false }
            ],
            "closedByPullRequestsReferences": { "nodes": [{
                "number": 43, "title": "Fix crash", "url": "https://github.com/octo/hello/pull/43",
                "state": "OPEN", "isDraft": true, "repository": { "nameWithOwner": "octo/hello" }
            }]},
            "timelineItems": {
                "totalCount": 130,
                "pageInfo": { "hasNextPage": false, "endCursor": "cursor-130" },
                "nodes": [
                    { "__typename": "IssueComment", "id": "IC_101", "url": "https://github.com/octo/hello/issues/42#issuecomment-101",
                      "bodyHTML": "<p>Same here</p>", "createdAt": "2026-01-03T00:00:00Z", "lastEditedAt": null,
                      "authorAssociation": "CONTRIBUTOR", "isMinimized": false, "minimizedReason": null,
                      "author": actor("mona"), "reactionGroups": [] },
                    { "__typename": "AssignedEvent", "id": "AE_1", "createdAt": "2026-01-04T00:00:00Z",
                      "actor": actor("octocat"), "assignee": actor("mona") }
                ]
            }
        }}}})))
        .expect(1)
        .mount(&server)
        .await;

    let issue = signed_in_service(&server)
        .issue(IssueDetailRequest {
            repository: repo(),
            number: 42,
            timeline_after: Some("cursor-100".into()),
        })
        .await
        .unwrap();

    assert_eq!(issue.state, IssueState::Open);
    assert_eq!(issue.author, None, "ghost author");
    assert_eq!(issue.milestone.as_ref().unwrap().title, "v1");
    assert_eq!(issue.participant_count, 31);
    assert_eq!(issue.reactions.len(), 1);
    let linked = &issue.linked_pull_requests[0];
    assert_eq!(
        (linked.kind, linked.number, linked.is_draft),
        (ReferenceKind::PullRequest, Some(43), true)
    );

    let kinds: Vec<_> = issue.timeline.items.iter().map(|item| item.kind).collect();
    assert_eq!(
        kinds,
        [TimelineItemKind::Comment, TimelineItemKind::Assigned]
    );
    assert_eq!(
        issue.timeline.items[1].assignee.as_ref().unwrap().login,
        "mona"
    );
    assert_eq!(issue.timeline.end_cursor.as_deref(), Some("cursor-130"));
}

#[tokio::test]
async fn missing_issue_reports_githubs_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "repository": { "issue": null } },
            "errors": [{ "type": "NOT_FOUND", "path": ["repository", "issue"],
                         "message": "Could not resolve to an Issue with the number of 999." }]
        })))
        .mount(&server)
        .await;

    let error = signed_in_service(&server)
        .issue(IssueDetailRequest {
            repository: repo(),
            number: 999,
            timeline_after: None,
        })
        .await
        .unwrap_err();

    assert!(
        error
            .to_string()
            .contains("Could not resolve to an Issue with the number of 999."),
        "{error}"
    );
}

#[tokio::test]
async fn invalid_requests_fail_before_reaching_github() {
    let server = MockServer::start().await;
    let service = signed_in_service(&server);

    let bad_number = service
        .issue(IssueDetailRequest {
            repository: repo(),
            number: 0,
            timeline_after: None,
        })
        .await;
    let bad_repo = service
        .list_issues(IssueListRequest {
            repository: RepositoryRef {
                owner: "octo".into(),
                name: "a b".into(),
            },
            state: IssueStateFilter::Open,
            assigned_to_me: false,
            labels: vec![],
            query: None,
            sort: IssueSort::Newest,
            after: None,
        })
        .await;

    assert!(matches!(bad_number, Err(GithubError::InvalidInput(_))));
    assert!(matches!(bad_repo, Err(GithubError::InvalidInput(_))));
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn repository_labels_follow_pagination() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(json!({ "variables": { "after": null } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({ "data": { "repository": { "labels": {
                "pageInfo": { "hasNextPage": true, "endCursor": "page-2" },
                "nodes": [{ "name": "bug", "color": "d73a4a", "description": "" }]
            }}}}),
        ))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_partial_json(
            json!({ "variables": { "after": "page-2" } }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({ "data": { "repository": { "labels": {
                "pageInfo": { "hasNextPage": false, "endCursor": "page-3" },
                "nodes": [{ "name": "docs", "color": "0075ca", "description": "Documentation" }]
            }}}}),
        ))
        .expect(1)
        .mount(&server)
        .await;

    let labels = signed_in_service(&server)
        .repository_labels(repo())
        .await
        .unwrap();

    let names: Vec<_> = labels.iter().map(|label| label.name.as_str()).collect();
    assert_eq!(names, ["bug", "docs"]);
    assert_eq!(labels[0].description, None);
    assert_eq!(labels[1].description.as_deref(), Some("Documentation"));
}
