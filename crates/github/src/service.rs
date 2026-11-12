use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::sync::{OnceCell, RwLock};

use crate::{
    auth::{
        device_flow::{self, CancelSignal, DEFAULT_SCOPES, DeviceCode},
        gh_cli,
        token::AccessToken,
        token_store::{StoredCredential, TokenStore},
    },
    client::{GithubClient, build_http_client},
    endpoints::Endpoints,
    error::GithubError,
    graphql::{self, RepositorySummaryNode, ViewerData},
    issue_mutations::{
        self as mutations, AddCommentData, AssignableUsersData, ChangeAssigneesData,
        ChangeLabelsData, CreateIssueData, DeleteCommentData, IssueStateData, ReactionData,
        RepositoryIssueMetadataData, UpdateCommentData, UpdateIssueData,
    },
    issues::{self, IssueDetailData, IssueSearchData, RepositoryLabelsData},
    models::{
        AddCommentRequest, AssignableUsersRequest, AuthStatus, ChangeAssigneesRequest,
        ChangeLabelsRequest, CloseIssueRequest, CreateIssueRequest, CreatedIssue,
        DeviceVerification, EditCommentRequest, EditIssueRequest, IssueContent, IssueDetail,
        IssueDetailRequest, IssueListRequest, IssuePage, IssueStateUpdate, Label, MilestoneUpdate,
        ReactionGroup, RenderMarkdownRequest, RepositoryIssueMetadata, RepositoryRef,
        RepositorySummary, RepositorySummaryResult, SetMilestoneRequest, SetReactionRequest,
        TimelineItem, TokenSource, User, Viewer,
    },
};

/// Upper bound per summaries request; keeps GraphQL query cost predictable.
pub const MAX_REPOSITORIES_PER_REQUEST: usize = 50;
const GITHUB_HOST: &str = "github.com";

#[derive(Default)]
struct Session {
    client: Option<Arc<GithubClient>>,
    viewer: Option<Viewer>,
    source: Option<TokenSource>,
    scopes: Option<Vec<String>>,
    error: Option<String>,
}

struct PendingDeviceFlow {
    code: DeviceCode,
    cancel: CancelSignal,
}

/// Process-wide GitHub session. Managed as Tauri state and shared by every
/// webview, so signing in once applies to all tabs.
pub struct GithubService {
    http: reqwest::Client,
    endpoints: Endpoints,
    store: Arc<dyn TokenStore>,
    client_id: Option<String>,
    session: RwLock<Session>,
    restored: OnceCell<()>,
    device_flow: Mutex<Option<PendingDeviceFlow>>,
}

impl GithubService {
    pub fn new(store: Arc<dyn TokenStore>, client_id: Option<String>) -> Result<Self, GithubError> {
        Self::with_endpoints(store, client_id, Endpoints::default())
    }

    pub fn with_endpoints(
        store: Arc<dyn TokenStore>,
        client_id: Option<String>,
        endpoints: Endpoints,
    ) -> Result<Self, GithubError> {
        Ok(Self {
            http: build_http_client()?,
            endpoints,
            store,
            client_id: client_id.filter(|id| !id.trim().is_empty()),
            session: RwLock::new(Session::default()),
            restored: OnceCell::new(),
            device_flow: Mutex::new(None),
        })
    }

    pub fn device_flow_available(&self) -> bool {
        self.client_id.is_some()
    }

    /// Current state. Restores the saved credential on first use and retries the
    /// viewer lookup if an earlier attempt failed (e.g. the app started offline).
    pub async fn status(&self) -> AuthStatus {
        self.ensure_restored().await;

        let needs_viewer = {
            let session = self.session.read().await;
            session.client.is_some() && session.viewer.is_none()
        };
        if needs_viewer {
            self.refresh_viewer().await;
        }

        self.snapshot().await
    }

    pub async fn start_device_flow(&self) -> Result<DeviceVerification, GithubError> {
        let client_id = self
            .client_id
            .as_deref()
            .ok_or(GithubError::DeviceFlowNotConfigured)?;
        let code = device_flow::request_device_code(
            &self.http,
            &self.endpoints,
            client_id,
            DEFAULT_SCOPES,
        )
        .await?;
        let verification = DeviceVerification::from(&code);

        let previous = self
            .device_flow
            .lock()
            .expect("device flow poisoned")
            .replace(PendingDeviceFlow {
                code,
                cancel: CancelSignal::default(),
            });
        if let Some(previous) = previous {
            previous.cancel.cancel();
        }

        Ok(verification)
    }

    /// Wait for the user to approve the code shown by `start_device_flow`.
    pub async fn complete_device_flow(&self) -> Result<AuthStatus, GithubError> {
        let client_id = self
            .client_id
            .as_deref()
            .ok_or(GithubError::DeviceFlowNotConfigured)?;
        let (code, cancel) = {
            let pending = self.device_flow.lock().expect("device flow poisoned");
            let pending = pending.as_ref().ok_or(GithubError::DeviceFlowNotStarted)?;
            (pending.code.clone(), pending.cancel.clone())
        };

        let result =
            device_flow::wait_for_token(&self.http, &self.endpoints, client_id, &code, &cancel)
                .await;

        {
            let mut pending = self.device_flow.lock().expect("device flow poisoned");
            if pending
                .as_ref()
                .is_some_and(|flow| flow.cancel.same_as(&cancel))
            {
                pending.take();
            }
        }

        self.sign_in_with(result?, TokenSource::DeviceFlow).await
    }

    pub fn cancel_device_flow(&self) {
        if let Some(pending) = self
            .device_flow
            .lock()
            .expect("device flow poisoned")
            .take()
        {
            pending.cancel.cancel();
        }
    }

    pub async fn import_gh_cli_token(
        &self,
        gh_path: &Path,
        path_env: &OsStr,
    ) -> Result<AuthStatus, GithubError> {
        let token = gh_cli::read_token(gh_path, path_env, GITHUB_HOST).await?;
        self.sign_in_with(token, TokenSource::GhCli).await
    }

    pub async fn sign_out(&self) -> Result<AuthStatus, GithubError> {
        self.cancel_device_flow();
        self.ensure_restored().await;
        *self.session.write().await = Session::default();
        self.delete_credential().await?;
        Ok(self.snapshot().await)
    }

    /// Open issue / pull request counts for each repository, in input order.
    pub async fn repository_summaries(
        &self,
        repositories: Vec<RepositoryRef>,
    ) -> Result<Vec<RepositorySummaryResult>, GithubError> {
        let mut seen = HashSet::new();
        let repositories: Vec<RepositoryRef> = repositories
            .into_iter()
            .filter(|repository| seen.insert(repository.clone()))
            .collect();

        if repositories.len() > MAX_REPOSITORIES_PER_REQUEST {
            return Err(GithubError::InvalidInput(format!(
                "At most {MAX_REPOSITORIES_PER_REQUEST} repositories can be loaded at once"
            )));
        }
        for repository in &repositories {
            repository.validate()?;
        }
        if repositories.is_empty() {
            return Ok(Vec::new());
        }

        let client = self.client().await?;
        let (query, variables) = graphql::repository_summaries_request(&repositories);
        let response = self
            .guard(
                client
                    .execute::<HashMap<String, Option<RepositorySummaryNode>>>(&query, variables)
                    .await,
            )
            .await?;

        let mut nodes = response.data.unwrap_or_default();
        let results = repositories
            .into_iter()
            .enumerate()
            .map(|(index, repository)| {
                let alias = graphql::repository_alias(index);
                let summary = nodes.remove(&alias).flatten().map(RepositorySummary::from);
                let error = if summary.is_some() {
                    None
                } else {
                    Some(
                        response
                            .errors
                            .iter()
                            .find(|error| {
                                error.path.first().and_then(|p| p.as_str()) == Some(alias.as_str())
                            })
                            .map(|error| error.message.clone())
                            .unwrap_or_else(|| {
                                "Repository not found or not accessible".to_string()
                            }),
                    )
                };

                RepositorySummaryResult {
                    owner: repository.owner,
                    name: repository.name,
                    summary,
                    error,
                }
            })
            .collect();

        Ok(results)
    }

    /// One page of a repository's issues, filtered and sorted like the
    /// github.com issue list (backed by GitHub search).
    pub async fn list_issues(&self, request: IssueListRequest) -> Result<IssuePage, GithubError> {
        let variables = issues::issue_search_variables(&request)?;
        let client = self.client().await?;
        let (data, _) = self
            .guard(
                client
                    .query::<IssueSearchData>(issues::ISSUE_SEARCH_QUERY, variables)
                    .await,
            )
            .await?;
        Ok(data.into())
    }

    /// An issue with one page of its timeline (100 items).
    pub async fn issue(&self, request: IssueDetailRequest) -> Result<IssueDetail, GithubError> {
        let variables = issues::issue_detail_variables(&request)?;
        let client = self.client().await?;
        let (data, _) = self
            .guard(
                client
                    .query::<IssueDetailData>(issues::ISSUE_DETAIL_QUERY, variables)
                    .await,
            )
            .await?;
        data.into_detail().ok_or_else(|| {
            GithubError::InvalidInput(format!(
                "Issue #{} was not found in {}/{}",
                request.number, request.repository.owner, request.repository.name
            ))
        })
    }

    /// All labels of a repository, sorted by name.
    pub async fn repository_labels(
        &self,
        repository: RepositoryRef,
    ) -> Result<Vec<Label>, GithubError> {
        repository.validate()?;
        let client = self.client().await?;
        let mut labels = Vec::new();
        let mut after: Option<String> = None;

        for _ in 0..issues::MAX_LABEL_PAGES {
            let variables = issues::repository_labels_variables(&repository, after.as_deref());
            let (data, _) = self
                .guard(
                    client
                        .query::<RepositoryLabelsData>(issues::REPOSITORY_LABELS_QUERY, variables)
                        .await,
                )
                .await?;
            let Some(page) = data.into_page() else {
                return Err(GithubError::InvalidInput(format!(
                    "Repository {}/{} was not found",
                    repository.owner, repository.name
                )));
            };
            labels.extend(page.labels);
            match page.next_cursor {
                Some(cursor) => after = Some(cursor),
                None => break,
            }
        }

        Ok(labels)
    }

    pub async fn add_comment(
        &self,
        request: AddCommentRequest,
    ) -> Result<TimelineItem, GithubError> {
        let variables = mutations::add_comment_variables(&request)?;
        self.graphql::<AddCommentData>(mutations::ADD_COMMENT_MUTATION, variables)
            .await?
            .into_item()
    }

    pub async fn edit_comment(
        &self,
        request: EditCommentRequest,
    ) -> Result<TimelineItem, GithubError> {
        let variables = mutations::edit_comment_variables(&request)?;
        self.graphql::<UpdateCommentData>(mutations::UPDATE_COMMENT_MUTATION, variables)
            .await?
            .into_item()
    }

    pub async fn delete_comment(&self, comment_id: &str) -> Result<(), GithubError> {
        let variables = mutations::delete_comment_variables(comment_id)?;
        self.graphql::<DeleteCommentData>(mutations::DELETE_COMMENT_MUTATION, variables)
            .await?;
        Ok(())
    }

    pub async fn edit_issue(&self, request: EditIssueRequest) -> Result<IssueContent, GithubError> {
        let variables = mutations::edit_issue_variables(&request)?;
        self.graphql::<UpdateIssueData>(mutations::UPDATE_ISSUE_MUTATION, variables)
            .await?
            .into_content()
    }

    pub async fn close_issue(
        &self,
        request: CloseIssueRequest,
    ) -> Result<IssueStateUpdate, GithubError> {
        let variables = mutations::close_issue_variables(&request)?;
        self.graphql::<IssueStateData>(mutations::CLOSE_ISSUE_MUTATION, variables)
            .await?
            .into_update()
    }

    pub async fn reopen_issue(&self, issue_id: &str) -> Result<IssueStateUpdate, GithubError> {
        let variables = mutations::reopen_issue_variables(issue_id)?;
        self.graphql::<IssueStateData>(mutations::REOPEN_ISSUE_MUTATION, variables)
            .await?
            .into_update()
    }

    /// The issue's labels after the change.
    pub async fn change_labels(
        &self,
        request: ChangeLabelsRequest,
    ) -> Result<Vec<Label>, GithubError> {
        let variables = mutations::change_labels_variables(&request)?;
        self.graphql::<ChangeLabelsData>(mutations::CHANGE_LABELS_MUTATION, variables)
            .await?
            .into_labels()
    }

    /// The issue's assignees after the change.
    pub async fn change_assignees(
        &self,
        request: ChangeAssigneesRequest,
    ) -> Result<Vec<User>, GithubError> {
        let variables = mutations::change_assignees_variables(&request)?;
        self.graphql::<ChangeAssigneesData>(mutations::CHANGE_ASSIGNEES_MUTATION, variables)
            .await?
            .into_users()
    }

    pub async fn set_milestone(
        &self,
        request: SetMilestoneRequest,
    ) -> Result<MilestoneUpdate, GithubError> {
        let variables = mutations::set_milestone_variables(&request)?;
        self.graphql::<UpdateIssueData>(mutations::UPDATE_ISSUE_MUTATION, variables)
            .await?
            .into_milestone()
    }

    /// The subject's reactions after the change.
    pub async fn set_reaction(
        &self,
        request: SetReactionRequest,
    ) -> Result<Vec<ReactionGroup>, GithubError> {
        let (document, variables) = mutations::reaction_request(&request)?;
        self.graphql::<ReactionData>(document, variables)
            .await?
            .into_reactions()
    }

    pub async fn create_issue(
        &self,
        request: CreateIssueRequest,
    ) -> Result<CreatedIssue, GithubError> {
        mutations::validate_create_issue(&request)?;
        let (repository_id, metadata) = self.issue_metadata(&request.repository).await?;
        if !metadata.can_create_issues {
            return Err(GithubError::InvalidInput(format!(
                "You cannot open issues in {}/{}",
                request.repository.owner, request.repository.name
            )));
        }
        let variables = mutations::create_issue_variables(&request, &repository_id)?;
        self.graphql::<CreateIssueData>(mutations::CREATE_ISSUE_MUTATION, variables)
            .await?
            .into_created()
    }

    /// Open milestones and whether the viewer may open issues.
    pub async fn repository_issue_metadata(
        &self,
        repository: RepositoryRef,
    ) -> Result<RepositoryIssueMetadata, GithubError> {
        Ok(self.issue_metadata(&repository).await?.1)
    }

    /// Up to 20 users who can be assigned, optionally filtered by login/name.
    pub async fn assignable_users(
        &self,
        request: AssignableUsersRequest,
    ) -> Result<Vec<User>, GithubError> {
        let variables = mutations::assignable_users_variables(&request)?;
        self.graphql::<AssignableUsersData>(mutations::ASSIGNABLE_USERS_QUERY, variables)
            .await?
            .into_users()
            .ok_or_else(|| repository_not_found(&request.repository))
    }

    /// GitHub-rendered HTML for a draft. Untrusted, like any `bodyHTML`.
    pub async fn render_markdown(
        &self,
        request: RenderMarkdownRequest,
    ) -> Result<String, GithubError> {
        request.repository.validate()?;
        let text = mutations::markdown_text(&request.text)?;
        if text.trim().is_empty() {
            return Ok(String::new());
        }
        let context = format!("{}/{}", request.repository.owner, request.repository.name);
        let client = self.client().await?;
        self.guard(client.render_markdown(text, &context).await)
            .await
    }

    async fn issue_metadata(
        &self,
        repository: &RepositoryRef,
    ) -> Result<(String, RepositoryIssueMetadata), GithubError> {
        let variables = mutations::repository_variables(repository)?;
        self.graphql::<RepositoryIssueMetadataData>(
            mutations::REPOSITORY_ISSUE_METADATA_QUERY,
            variables,
        )
        .await?
        .into_metadata()
        .ok_or_else(|| repository_not_found(repository))
    }

    /// A GraphQL call where any error fails the whole operation.
    async fn graphql<T: DeserializeOwned>(
        &self,
        document: &str,
        variables: Value,
    ) -> Result<T, GithubError> {
        let client = self.client().await?;
        let (data, _) = self
            .guard(client.query::<T>(document, variables).await)
            .await?;
        Ok(data)
    }

    async fn client(&self) -> Result<Arc<GithubClient>, GithubError> {
        self.ensure_restored().await;
        self.session
            .read()
            .await
            .client
            .clone()
            .ok_or(GithubError::NotSignedIn)
    }

    /// A revoked token signs the user out everywhere instead of failing forever.
    async fn guard<T>(&self, result: Result<T, GithubError>) -> Result<T, GithubError> {
        if matches!(result, Err(GithubError::Unauthorized)) {
            *self.session.write().await = Session::default();
            if let Err(error) = self.delete_credential().await {
                log::warn!(target: "github", "failed to remove rejected credential: {error}");
            }
        }
        result
    }

    async fn sign_in_with(
        &self,
        token: AccessToken,
        source: TokenSource,
    ) -> Result<AuthStatus, GithubError> {
        self.ensure_restored().await;
        let client = Arc::new(GithubClient::new(
            self.http.clone(),
            self.endpoints.clone(),
            token.clone(),
        ));
        let (viewer, scopes) = fetch_viewer(&client).await?;
        self.save_credential(StoredCredential { token, source })
            .await?;

        *self.session.write().await = Session {
            client: Some(client),
            viewer: Some(viewer),
            source: Some(source),
            scopes,
            error: None,
        };
        Ok(self.snapshot().await)
    }

    async fn ensure_restored(&self) {
        self.restored
            .get_or_init(|| async {
                let store = Arc::clone(&self.store);
                let loaded = tokio::task::spawn_blocking(move || store.load()).await;
                let mut session = self.session.write().await;
                match loaded {
                    Ok(Ok(Some(credential))) => {
                        session.client = Some(Arc::new(GithubClient::new(
                            self.http.clone(),
                            self.endpoints.clone(),
                            credential.token,
                        )));
                        session.source = Some(credential.source);
                    }
                    Ok(Ok(None)) => {}
                    Ok(Err(error)) => session.error = Some(error.to_string()),
                    Err(_) => {
                        session.error =
                            Some("Could not read the saved GitHub credential".to_string())
                    }
                }
            })
            .await;
    }

    async fn refresh_viewer(&self) {
        let Some(client) = self.session.read().await.client.clone() else {
            return;
        };

        match self.guard(fetch_viewer(&client).await).await {
            Ok((viewer, scopes)) => {
                let mut session = self.session.write().await;
                if session
                    .client
                    .as_ref()
                    .is_some_and(|c| Arc::ptr_eq(c, &client))
                {
                    session.viewer = Some(viewer);
                    session.scopes = scopes;
                    session.error = None;
                }
            }
            Err(GithubError::Unauthorized) => {
                self.session.write().await.error = Some(GithubError::Unauthorized.to_string());
            }
            Err(error) => self.session.write().await.error = Some(error.to_string()),
        }
    }

    async fn snapshot(&self) -> AuthStatus {
        let session = self.session.read().await;
        AuthStatus {
            signed_in: session.client.is_some(),
            viewer: session.viewer.clone(),
            source: session.source,
            scopes: session.scopes.clone(),
            device_flow_available: self.device_flow_available(),
            rate_limit: session
                .client
                .as_ref()
                .and_then(|client| client.rate_limit()),
            error: session.error.clone(),
        }
    }

    async fn save_credential(&self, credential: StoredCredential) -> Result<(), GithubError> {
        let store = Arc::clone(&self.store);
        tokio::task::spawn_blocking(move || store.save(&credential))
            .await
            .map_err(|_| GithubError::CredentialStore("credential save was interrupted".into()))?
    }

    async fn delete_credential(&self) -> Result<(), GithubError> {
        let store = Arc::clone(&self.store);
        tokio::task::spawn_blocking(move || store.delete())
            .await
            .map_err(|_| {
                GithubError::CredentialStore("credential removal was interrupted".into())
            })?
    }
}

fn repository_not_found(repository: &RepositoryRef) -> GithubError {
    GithubError::InvalidInput(format!(
        "Repository {}/{} was not found",
        repository.owner, repository.name
    ))
}

async fn fetch_viewer(client: &GithubClient) -> Result<(Viewer, Option<Vec<String>>), GithubError> {
    let (data, scopes) = client
        .query::<ViewerData>(graphql::VIEWER_QUERY, serde_json::json!({}))
        .await?;
    Ok((Viewer::from(data), scopes))
}
