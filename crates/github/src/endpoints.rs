/// Base URLs for GitHub. Overridable so tests can point at a local mock server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    /// REST and GraphQL API root, e.g. `https://api.github.com`.
    pub api: String,
    /// Web root used by OAuth, e.g. `https://github.com`.
    pub web: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            api: "https://api.github.com".to_string(),
            web: "https://github.com".to_string(),
        }
    }
}

impl Endpoints {
    pub fn graphql_url(&self) -> String {
        format!("{}/graphql", self.api.trim_end_matches('/'))
    }

    pub fn device_code_url(&self) -> String {
        format!("{}/login/device/code", self.web.trim_end_matches('/'))
    }

    pub fn access_token_url(&self) -> String {
        format!(
            "{}/login/oauth/access_token",
            self.web.trim_end_matches('/')
        )
    }
}
