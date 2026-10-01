use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Rule {
    pub process: String,
    #[serde(rename = "titleContains", default)]
    pub title_contains: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct RuleFile {
    pub rules: Vec<Rule>,
}

pub fn rules_path() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    base.join("PassBridge").join("apps.json")
}

pub fn load() -> RuleFile {
    let path = rules_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return RuleFile::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save(file: &RuleFile) -> Result<(), String> {
    let path = rules_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    }
    let text = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("could not write rules: {e}"))
}

pub fn find<'a>(rules: &'a [Rule], process: &str, title: &str) -> Option<&'a Rule> {
    rules.iter().find(|rule| {
        if !rule.process.eq_ignore_ascii_case(process) {
            return false;
        }
        if rule.title_contains.is_empty() {
            return true;
        }
        title.to_ascii_lowercase().contains(&rule.title_contains.to_ascii_lowercase())
    })
}

pub fn is_browser(process: &str) -> bool {
    matches!(
        process.to_ascii_lowercase().as_str(),
        "chrome.exe" | "msedge.exe" | "brave.exe" | "vivaldi.exe" | "chromium.exe"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_is_case_insensitive_and_title_is_optional() {
        let rules = vec![Rule {
            process: "RiotClientUx.exe".into(),
            title_contains: "Riot Client".into(),
            url: "https://account.riotgames.com".into(),
        }];
        assert!(find(&rules, "riotclientux.exe", "Riot Client").is_some());
        assert!(find(&rules, "RiotClientUx.exe", "Something else").is_none());
        let open = vec![Rule {
            process: "notepad.exe".into(),
            title_contains: String::new(),
            url: "https://example.com".into(),
        }];
        assert!(find(&open, "NOTEPAD.EXE", "Untitled").is_some());
    }

    #[test]
    fn browsers_are_left_to_the_extension() {
        assert!(is_browser("chrome.exe"));
        assert!(is_browser("msedge.exe"));
        assert!(!is_browser("RiotClientUx.exe"));
    }
}
