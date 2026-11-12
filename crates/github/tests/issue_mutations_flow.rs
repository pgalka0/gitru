#![recursion_limit = "256"]

use std::sync::Arc;

use github::auth::token::AccessToken;
use github::auth::token_store::{MemoryTokenStore, StoredCredential};
use github::endpoints::Endpoints;
use github::models::{
    AddCommentRequest, ChangeLabelsRequest, CloseIssueRequest, CloseReason, CreateIssueRequest,
    EditIssueRequest, ReactionContent, RenderMarkdownRequest, RepositoryRef, SetReactionRequest,
    TimelineItemKind, TokenSource,
};
use github::{GithubError, GithubService};
use serde_json::json;
use wiremock::matchers::{
    body_json, body_partial_json, body_string_contains, header, method, path,
};
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

#[tokio::test]
async fn add_comment_sends_the_body_and_returns_the_new_comment() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(header("authorization", "Bearer gho_saved"))
        .and(body_string_contains("mutation AddComment"))
        .and(body_partial_json(json!({ "variables": {
            "subjectId": "I_42", "body": "Thanks, **fixed**"
        }})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": { "addComment": {
            "commentEdge": { "node": {
                "__typename": "IssueComment", "id": "IC_9", "url": "https://github.com/octo/hello/issues/42#issuecomment-9",
                "body": "Thanks, **fixed**", "bodyHTML": "<p>Thanks, <strong>fixed</strong></p>",
                "createdAt": "2026-02-01T00:00:00Z", "lastEditedAt": null, "authorAssociation": "OWNER",
                "isMinimized": false, "minimizedReason": null,
                "viewerCanUpdate": true, "viewerCanDelete": true, "viewerCanReact": true,
                "author": { "login": "mona", "avatarUrl": "https://avatars.githubusercontent.com/u/1?v=4", "url": "https://github.com/mona" },
                "reactionGroups": []
            } }
        } } })))
        .expect(1)
        .mount(&server)
        .await;

    let comment = signed_in_service(&server)
        .add_comment(AddCommentRequest {
            issue_id: "I_42".into(),
            body: "Thanks, **fixed**".into(),
        })
        .await
        .unwrap();

    assert_eq!(comment.kind, TimelineItemKind::Comment);
    assert_eq!(comment.id, "IC_9");
    assert_eq!(
        comment.body_html.as_deref(),
        Some("<p>Thanks, <strong>fixed</strong></p>")
    );
}

#[tokio::test]
async fn label_changes_skip_the_step_with_nothing_to_do() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("mutation ChangeLabels"))
        .and(body_partial_json(json!({ "variables": {
            "id": "I_42", "add": ["LA_2"], "remove": [], "adding": true, "removing": false
        }})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": {
            "added": { "labelable": { "labels": { "nodes": [
                { "id": "LA_1", "name": "bug", "color": "d73a4a", "description": null },
                { "id": "LA_2", "name": "docs", "color": "0075ca", "description": "Documentation" }
            ] } } }
        } })))
        .expect(1)
        .mount(&server)
        .await;

    let labels = signed_in_service(&server)
        .change_labels(ChangeLabelsRequest {
            issue_id: "I_42".into(),
            add_label_ids: vec!["LA_2".into()],
            remove_label_ids: Vec::new(),
        })
        .await
        .unwrap();

    let names: Vec<_> = labels.iter().map(|label| label.name.as_str()).collect();
    assert_eq!(names, ["bug", "docs"]);
}

#[tokio::test]
async fn create_issue_looks_up_the_repository_then_creates_it() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("query RepositoryIssueMetadata"))
        .and(body_partial_json(
            json!({ "variables": { "owner": "octo", "name": "hello" } }),
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": { "repository": {
            "id": "R_1", "viewerCanCreateIssues": true, "milestones": { "nodes": [] }
        } } })),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("mutation CreateIssue"))
        .and(body_partial_json(json!({ "variables": { "input": {
            "repositoryId": "R_1", "title": "Crash on start", "body": "Steps",
            "labelIds": ["LA_1"], "assigneeIds": ["U_1"], "milestoneId": "MI_1"
        } } })))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": { "createIssue": {
            "issue": { "number": 43, "url": "https://github.com/octo/hello/issues/43" }
        } } })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let created = signed_in_service(&server)
        .create_issue(CreateIssueRequest {
            repository: repo(),
            title: "Crash on start".into(),
            body: "Steps".into(),
            label_ids: vec!["LA_1".into()],
            assignee_ids: vec!["U_1".into()],
            milestone_id: Some("MI_1".into()),
        })
        .await
        .unwrap();

    assert_eq!(created.number, 43);
}

#[tokio::test]
async fn create_issue_stops_when_the_viewer_cannot_open_issues() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("query RepositoryIssueMetadata"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": { "repository": {
            "id": "R_1", "viewerCanCreateIssues": false, "milestones": { "nodes": [] }
        } } })),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("mutation CreateIssue"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;

    let error = signed_in_service(&server)
        .create_issue(CreateIssueRequest {
            repository: repo(),
            title: "Crash".into(),
            body: String::new(),
            label_ids: Vec::new(),
            assignee_ids: Vec::new(),
            milestone_id: None,
        })
        .await
        .unwrap_err();

    assert_eq!(error.to_string(), "You cannot open issues in octo/hello");
}

#[tokio::test]
async fn permission_errors_keep_githubs_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("mutation CloseIssue"))
        .and(body_partial_json(
            json!({ "variables": { "id": "I_42", "reason": "COMPLETED" } }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "closeIssue": null },
            "errors": [{ "type": "FORBIDDEN", "path": ["closeIssue"], "message": "mona does not have the correct permissions to execute `CloseIssue`" }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let error = signed_in_service(&server)
        .close_issue(CloseIssueRequest {
            issue_id: "I_42".into(),
            reason: CloseReason::Completed,
        })
        .await
        .unwrap_err();

    assert!(
        error
            .to_string()
            .contains("does not have the correct permissions"),
        "{error}"
    );
}

#[tokio::test]
async fn markdown_preview_uses_the_rest_endpoint_with_repository_context() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/markdown"))
        .and(header("authorization", "Bearer gho_saved"))
        .and(body_json(
            json!({ "text": "Fixes #1", "mode": "gfm", "context": "octo/hello" }),
        ))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(r#"<p>Fixes <a class="issue-link" href="https://github.com/octo/hello/issues/1">#1</a></p>"#),
        )
        .expect(1)
        .mount(&server)
        .await;

    let service = signed_in_service(&server);
    let html = service
        .render_markdown(RenderMarkdownRequest {
            repository: repo(),
            text: "Fixes #1".into(),
        })
        .await
        .unwrap();
    assert!(html.contains("issue-link"));

    let empty = service
        .render_markdown(RenderMarkdownRequest {
            repository: repo(),
            text: "  \n".into(),
        })
        .await
        .unwrap();
    assert_eq!(empty, "", "blank drafts render locally");
}

#[tokio::test]
async fn invalid_changes_fail_before_reaching_github() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let service = signed_in_service(&server);

    let errors = [
        service
            .add_comment(AddCommentRequest {
                issue_id: "I_42".into(),
                body: "   ".into(),
            })
            .await
            .unwrap_err(),
        service
            .add_comment(AddCommentRequest {
                issue_id: "I_42\"} }".into(),
                body: "hi".into(),
            })
            .await
            .unwrap_err(),
        service
            .edit_issue(EditIssueRequest {
                issue_id: "I_42".into(),
                title: Some("\n".into()),
                body: None,
            })
            .await
            .unwrap_err(),
        service
            .set_reaction(SetReactionRequest {
                subject_id: "I_42".into(),
                content: ReactionContent::Other,
                reacted: true,
            })
            .await
            .unwrap_err(),
        service.delete_comment("").await.unwrap_err(),
    ];

    for error in errors {
        assert!(matches!(error, GithubError::InvalidInput(_)), "{error:?}");
    }
}
