//! GitHub API client for Gitru.
//!
//! Security invariant: access tokens live only inside this crate. No public
//! type serializes or `Debug`-prints a raw token, no error message contains one,
//! and tokens are sent only in the `Authorization` header (never in URLs).

pub mod auth;
pub mod client;
pub mod endpoints;
pub mod error;
mod graphql;
pub mod models;
pub mod service;

pub use error::GithubError;
pub use service::GithubService;
