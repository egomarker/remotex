//! The public path a reverse proxy mounts the gateway under.
//!
//! The router itself still receives origin-form paths such as `/api/config`: a
//! proxy strips its public prefix before forwarding and states that prefix in
//! `X-Forwarded-Prefix`.  Keeping its parsing here gives the document, redirects,
//! and cookie scope one spelling of the path.

use axum::http::HeaderMap;

pub(crate) const FORWARDED_PREFIX: &str = "x-forwarded-prefix";

/// The validated public prefix, with no trailing slash. The origin root is the
/// empty string, whether the header is absent or explicitly `/`.
///
/// A present malformed header is an error rather than a root deployment. Falling
/// back to `/` would broaden the session cookie beyond the path the proxy meant
/// to isolate.
pub(crate) fn forwarded_prefix(headers: &HeaderMap) -> Result<&str, ()> {
    let mut values = headers.get_all(FORWARDED_PREFIX).iter();
    let Some(value) = values.next() else {
        return Ok("");
    };
    if values.next().is_some() {
        return Err(());
    }
    let value = value.to_str().map_err(|_| ())?;
    normalize(value).ok_or(())
}

/// Normalize one header value. One trailing slash is accepted because operators
/// commonly spell a browser mount with it; every other byte must already be in a
/// canonical, unambiguous path segment.
fn normalize(value: &str) -> Option<&str> {
    if value == "/" {
        return Some("");
    }
    if value.is_empty() || value.len() > 1024 || !value.starts_with('/') {
        return None;
    }
    let value = value.strip_suffix('/').unwrap_or(value);
    if value.is_empty() {
        return Some("");
    }
    value.split('/').skip(1).all(valid_segment).then_some(value)
}

fn valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !matches!(segment, "." | "..")
        && segment.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
        })
}

/// The prefix as a directory path, for `<base href>` and `Path=`.
pub(crate) fn directory(prefix: &str) -> String {
    if prefix.is_empty() {
        "/".to_owned()
    } else {
        format!("{prefix}/")
    }
}

/// Put an upstream path-and-query back under its public proxy prefix.
pub(crate) fn public_path(prefix: &str, path_and_query: &str) -> String {
    debug_assert!(path_and_query.starts_with('/'));
    format!("{prefix}{path_and_query}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn parsed(value: Option<&str>) -> Result<String, ()> {
        let mut headers = HeaderMap::new();
        if let Some(value) = value {
            headers.insert(FORWARDED_PREFIX, HeaderValue::from_str(value).unwrap());
        }
        forwarded_prefix(&headers).map(str::to_owned)
    }

    #[test]
    fn root_and_nested_mounts_have_one_canonical_shape() {
        assert_eq!(parsed(None).unwrap(), "");
        assert_eq!(parsed(Some("/")).unwrap(), "");
        assert_eq!(parsed(Some("/apps/remotex")).unwrap(), "/apps/remotex");
        assert_eq!(parsed(Some("/apps/remotex/")).unwrap(), "/apps/remotex");
        assert_eq!(parsed(Some("/tools/remote-v2_1.~")).unwrap(), "/tools/remote-v2_1.~");
        assert_eq!(directory(""), "/");
        assert_eq!(directory("/apps/remotex"), "/apps/remotex/");
        assert_eq!(public_path("/apps/remotex", "/?next=1"), "/apps/remotex/?next=1");
    }

    #[test]
    fn ambiguous_or_header_active_prefixes_are_refused() {
        for value in [
            "",
            "apps/remotex",
            "//apps/remotex",
            "/apps//remotex",
            "/apps/remotex//",
            "/apps/./remotex",
            "/apps/../remotex",
            "/apps/%2e%2e/remotex",
            "/apps/remotex?other=1",
            "/apps/remotex#other",
            "/apps\\remotex",
            "/apps; Path=/",
            "/apps, /other",
            "/white space",
        ] {
            assert!(parsed(Some(value)).is_err(), "{value:?} must be refused");
        }
    }

    #[test]
    fn more_than_one_forwarded_prefix_is_refused() {
        let mut headers = HeaderMap::new();
        headers.append(FORWARDED_PREFIX, HeaderValue::from_static("/one"));
        headers.append(FORWARDED_PREFIX, HeaderValue::from_static("/two"));
        assert!(forwarded_prefix(&headers).is_err());
    }
}
