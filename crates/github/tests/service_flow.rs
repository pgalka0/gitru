use std::sync::Arc;

use github::auth::token::AccessToken;
use github::auth::token_store::{MemoryTokenStore, StoredCredential, TokenStore};
use github::endpoints::Endpoints;
use github::models::{RepositoryRef, TokenSource};
use github::{GithubError, GithubService};
use serde_json::json;
use wiremock::matchers::{body_string_contains, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn endpoints(server: &MockServer) -> Endpoints {
    Endpoints {
        api: server.uri(),
        web: server.uri(),
    }
}

fn service(server: &MockServer, store: Arc<MemoryTokenStore>) -> GithubService {
    GithubService::with_endpoints(store, Some("client-123".to_string()), endpoints(server)).unwrap()
}

fn stored(token: &str, source: TokenSource) -> StoredCredential {
    StoredCredential {
        token: AccessToken::parse(token).unwrap(),
        source,
    }
}

fn viewer_response() -> ResponseTemplate {
    ResponseTemplate::new(200)
        .insert_header("x-oauth-scopes", "repo, read:org")
        .insert_header("x-ratelimit-limit", "5000")
        .insert_header("x-ratelimit-remaining", "4999")
        .insert_header("x-ratelimit-reset", "1794480000")
        .insert_header("x-ratelimit-resource", "graphql")
        .set_body_json(json!({
            "data": { "viewer": {
                "login": "octocat",
                "name": "The Octocat",
                "avatarUrl": "https://avatars.githubusercontent.com/u/583231",
                "url": "https://github.com/octocat"
            }}
        }))
}

async fn mount_viewer(server: &MockServer, token: &str) {
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(header("authorization", format!("Bearer {token}").as_str()))
        .and(body_string_contains("query Viewer"))
        .respond_with(viewer_response())
        .mount(server)
        .await;
}

async fn mount_device_code(server: &MockServer) {
    Mock::given(method("POST"))
        .and(path("/login/device/code"))
        .and(body_string_contains("client_id=client-123"))
        .and(body_string_contains("scope=repo+read%3Aorg"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "device_code": "dc-secret",
            "user_code": "WDJB-MJHT",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 900,
            "interval": 0
        })))
        .mount(server)
        .await;
}

fn token_endpoint() -> wiremock::MockBuilder {
    Mock::given(method("POST"))
        .and(path("/login/oauth/access_token"))
        .and(body_string_contains("device_code=dc-secret"))
        .and(body_string_contains(
            "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
        ))
}

#[tokio::test]
async fn device_flow_polls_through_pending_and_slow_down_then_signs_in() {
    let server = MockServer::start().await;
    mount_device_code(&server).await;
    token_endpoint()
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "error": "authorization_pending" })),
        )
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    token_endpoint()
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "error": "slow_down", "interval": 0 })),
        )
        .up_to_n_times(1)
        .with_priority(2)
        .mount(&server)
        .await;
    token_endpoint()
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "gho_device", "token_type": "bearer", "scope": "repo,read:org"
        })))
        .with_priority(3)
        .mount(&server)
        .await;
    mount_viewer(&server, "gho_device").await;

    let store = Arc::new(MemoryTokenStore::default());
    let github = service(&server, Arc::clone(&store));

    let verification = github.start_device_flow().await.unwrap();
    assert_eq!(verification.user_code, "WDJB-MJHT");
    assert_eq!(verification.expires_in_secs, 900);

    let status = github.complete_device_flow().await.unwrap();
    assert!(status.signed_in);
    assert_eq!(status.source, Some(TokenSource::DeviceFlow));
    assert_eq!(status.viewer.unwrap().login, "octocat");
    assert_eq!(
        status.scopes,
        Some(vec!["repo".to_string(), "read:org".to_string()])
    );
    assert_eq!(status.rate_limit.unwrap().remaining, 4999);

    assert_eq!(
        store.load().unwrap(),
        Some(stored("gho_device", TokenSource::DeviceFlow))
    );
}

#[tokio::test]
async fn device_flow_reports_denial_and_saves_nothing() {
    let server = MockServer::start().await;
    mount_device_code(&server).await;
    token_endpoint()
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "error": "access_denied" })))
        .mount(&server)
        .await;

    let store = Arc::new(MemoryTokenStore::default());
    let github = service(&server, Arc::clone(&store));
    github.start_device_flow().await.unwrap();

    assert_eq!(
        github.complete_device_flow().await.unwrap_err(),
        GithubError::DeviceFlowDenied
    );
    assert_eq!(store.load().unwrap(), None);
    assert!(!github.status().await.signed_in);
}

#[tokio::test]
async fn cancelling_stops_a_waiting_device_flow() {
    let server = MockServer::start().await;
    mount_device_code(&server).await;
    token_endpoint()
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "error": "authorization_pending" })),
        )
        .mount(&server)
        .await;

    let github = Arc::new(service(&server, Arc::new(MemoryTokenStore::default())));
    github.start_device_flow().await.unwrap();

    let waiting = {
        let github = Arc::clone(&github);
        tokio::spawn(async move { github.complete_device_flow().await })
    };
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    github.cancel_device_flow();

    let result = tokio::time::timeout(std::time::Duration::from_secs(2), waiting)
        .await
        .expect("cancel should stop polling")
        .unwrap();
    assert_eq!(result.unwrap_err(), GithubError::DeviceFlowCancelled);
}

#[tokio::test]
async fn device_flow_requires_a_client_id() {
    let server = MockServer::start().await;
    let github = GithubService::with_endpoints(
        Arc::new(MemoryTokenStore::default()),
        Some("  ".to_string()),
        endpoints(&server),
    )
    .unwrap();

    assert!(!github.device_flow_available());
    assert_eq!(
        github.start_device_flow().await.unwrap_err(),
        GithubError::DeviceFlowNotConfigured
    );
    assert!(!github.status().await.device_flow_available);
}

#[tokio::test]
async fn restores_saved_credential_on_first_status() {
    let server = MockServer::start().await;
    mount_viewer(&server, "gho_saved").await;
    let store = Arc::new(MemoryTokenStore::with_credential(stored(
        "gho_saved",
        TokenSource::GhCli,
    )));

    let status = service(&server, store).status().await;

    assert!(status.signed_in);
    assert_eq!(status.source, Some(TokenSource::GhCli));
    assert_eq!(status.viewer.unwrap().name.as_deref(), Some("The Octocat"));
    assert_eq!(status.error, None);
}

#[tokio::test]
async fn revoked_saved_token_signs_out_and_is_deleted() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({ "message": "Bad credentials" })),
        )
        .mount(&server)
        .await;
    let store = Arc::new(MemoryTokenStore::with_credential(stored(
        "gho_revoked",
        TokenSource::DeviceFlow,
    )));

    let status = service(&server, Arc::clone(&store)).status().await;

    assert!(!status.signed_in);
    assert!(status.viewer.is_none());
    assert_eq!(status.error, Some(GithubError::Unauthorized.to_string()));
    assert_eq!(store.load().unwrap(), None);
}

#[tokio::test]
async fn sign_out_clears_session_and_store() {
    let server = MockServer::start().await;
    mount_viewer(&server, "gho_saved").await;
    let store = Arc::new(MemoryTokenStore::with_credential(stored(
        "gho_saved",
        TokenSource::GhCli,
    )));
    let github = service(&server, Arc::clone(&store));
    assert!(github.status().await.signed_in);

    let status = github.sign_out().await.unwrap();

    assert!(!status.signed_in);
    assert_eq!(store.load().unwrap(), None);
    assert_eq!(
        github
            .repository_summaries(vec![RepositoryRef {
                owner: "a".into(),
                name: "b".into()
            }])
            .await
            .unwrap_err(),
        GithubError::NotSignedIn
    );
}

#[tokio::test]
async fn repository_summaries_keep_partial_results_in_input_order() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(body_string_contains("query RepositorySummaries"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "r0": {
                    "name": "gitru", "owner": { "login": "pgalka0" },
                    "url": "https://github.com/pgalka0/gitru", "isPrivate": false,
                    "viewerPermission": "ADMIN",
                    "issues": { "totalCount": 3 }, "pullRequests": { "totalCount": 1 }
                },
                "r1": null
            },
            "errors": [{
                "type": "NOT_FOUND", "path": ["r1"],
                "message": "Could not resolve to a Repository with the name 'ghost/missing'."
            }]
        })))
        .mount(&server)
        .await;
    let store = Arc::new(MemoryTokenStore::with_credential(stored(
        "gho_saved",
        TokenSource::GhCli,
    )));

    let results = service(&server, store)
        .repository_summaries(vec![
            RepositoryRef {
                owner: "pgalka0".into(),
                name: "gitru".into(),
            },
            RepositoryRef {
                owner: "ghost".into(),
                name: "missing".into(),
            },
            RepositoryRef {
                owner: "pgalka0".into(),
                name: "gitru".into(),
            },
        ])
        .await
        .unwrap();

    assert_eq!(results.len(), 2, "duplicates are dropped");
    let found = results[0].summary.as_ref().unwrap();
    assert_eq!((found.open_issues, found.open_pull_requests), (3, 1));
    assert_eq!(found.viewer_permission.as_deref(), Some("ADMIN"));
    assert!(results[1].summary.is_none());
    assert_eq!(
        results[1].error.as_deref(),
        Some("Could not resolve to a Repository with the name 'ghost/missing'.")
    );
}

#[tokio::test]
async fn repository_summaries_reject_invalid_names_before_any_request() {
    let server = MockServer::start().await;
    let store = Arc::new(MemoryTokenStore::with_credential(stored(
        "gho_saved",
        TokenSource::GhCli,
    )));

    let error = service(&server, store)
        .repository_summaries(vec![RepositoryRef {
            owner: "pgalka0".into(),
            name: "../etc".into(),
        }])
        .await
        .unwrap_err();

    assert!(matches!(error, GithubError::InvalidInput(_)));
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn graphql_rate_limit_error_is_reported_as_rate_limited() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-ratelimit-limit", "5000")
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-ratelimit-reset", "1794480000")
                .set_body_json(json!({
                    "data": null,
                    "errors": [{ "type": "RATE_LIMITED", "message": "API rate limit exceeded" }]
                })),
        )
        .mount(&server)
        .await;
    let store = Arc::new(MemoryTokenStore::with_credential(stored(
        "gho_saved",
        TokenSource::GhCli,
    )));

    let error = service(&server, store)
        .repository_summaries(vec![RepositoryRef {
            owner: "a".into(),
            name: "b".into(),
        }])
        .await
        .unwrap_err();

    assert_eq!(
        error,
        GithubError::RateLimited {
            reset_at: Some(1_794_480_000)
        }
    );
}
