//! GraphQL documents and their camelCase response DTOs.

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::models::{RepositoryRef, RepositorySummary, Viewer};

pub(crate) const VIEWER_QUERY: &str = "query Viewer { viewer { login name avatarUrl url } }";

#[derive(Deserialize)]
pub(crate) struct ViewerData {
    viewer: ViewerNode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerNode {
    login: String,
    name: Option<String>,
    avatar_url: String,
    url: String,
}

impl From<ViewerData> for Viewer {
    fn from(data: ViewerData) -> Self {
        Self {
            login: data.viewer.login,
            name: data.viewer.name.filter(|name| !name.is_empty()),
            avatar_url: data.viewer.avatar_url,
            html_url: data.viewer.url,
        }
    }
}

const REPOSITORY_SUMMARY_FRAGMENT: &str = "fragment RepositorySummary on Repository { \
    name owner { login } url isPrivate viewerPermission \
    issues(states: OPEN) { totalCount } \
    pullRequests(states: OPEN) { totalCount } }";

pub(crate) fn repository_alias(index: usize) -> String {
    format!("r{index}")
}

/// One round trip for many repositories using aliases `r0`, `r1`, …
/// Owner and name travel as variables, never interpolated into the document.
pub(crate) fn repository_summaries_request(repositories: &[RepositoryRef]) -> (String, Value) {
    let mut definitions = Vec::with_capacity(repositories.len() * 2);
    let mut selections = Vec::with_capacity(repositories.len());
    let mut variables = Map::new();

    for (index, repository) in repositories.iter().enumerate() {
        definitions.push(format!("$o{index}: String!, $n{index}: String!"));
        selections.push(format!(
            "{}: repository(owner: $o{index}, name: $n{index}) {{ ...RepositorySummary }}",
            repository_alias(index)
        ));
        variables.insert(format!("o{index}"), Value::String(repository.owner.clone()));
        variables.insert(format!("n{index}"), Value::String(repository.name.clone()));
    }

    let query = format!(
        "query RepositorySummaries({}) {{ {} }} {REPOSITORY_SUMMARY_FRAGMENT}",
        definitions.join(", "),
        selections.join(" ")
    );

    (query, Value::Object(variables))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositorySummaryNode {
    name: String,
    owner: OwnerNode,
    url: String,
    is_private: bool,
    viewer_permission: Option<String>,
    issues: CountNode,
    pull_requests: CountNode,
}

#[derive(Deserialize)]
struct OwnerNode {
    login: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CountNode {
    total_count: u32,
}

impl From<RepositorySummaryNode> for RepositorySummary {
    fn from(node: RepositorySummaryNode) -> Self {
        Self {
            owner: node.owner.login,
            name: node.name,
            url: node.url,
            is_private: node.is_private,
            viewer_permission: node.viewer_permission,
            open_issues: node.issues.total_count,
            open_pull_requests: node.pull_requests.total_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_aliased_query_with_variables() {
        let (query, variables) = repository_summaries_request(&[
            RepositoryRef {
                owner: "a".into(),
                name: "one".into(),
            },
            RepositoryRef {
                owner: "b".into(),
                name: "two".into(),
            },
        ]);

        assert!(query.starts_with(
            "query RepositorySummaries($o0: String!, $n0: String!, $o1: String!, $n1: String!)"
        ));
        assert!(query.contains("r0: repository(owner: $o0, name: $n0) { ...RepositorySummary }"));
        assert!(query.contains("r1: repository(owner: $o1, name: $n1)"));
        assert!(!query.contains("one") && !query.contains("two"));
        assert_eq!(variables["o1"], "b");
        assert_eq!(variables["n0"], "one");
    }

    #[test]
    fn viewer_drops_empty_display_name() {
        let data: ViewerData = serde_json::from_value(serde_json::json!({
            "viewer": { "login": "octo", "name": "", "avatarUrl": "https://a", "url": "https://github.com/octo" }
        }))
        .unwrap();

        let viewer = Viewer::from(data);
        assert_eq!(viewer.name, None);
        assert_eq!(viewer.html_url, "https://github.com/octo");
    }
}
