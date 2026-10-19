//! Unit tests for logic that doesn't need a window, a PTY or git.

use serde_json::json;

use crate::{bridge, export, sessions, shell, worktrees};

fn launch(extra: serde_json::Value) -> shell::LaunchRequest {
    let mut base = json!({
        "paneId": "pane-1", "cwd": "C:\\repo", "kind": "claude", "launchId": "launch-1",
        "windowsHints": false, "approvals": true, "usage": true, "cols": 80, "rows": 24
    });
    base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    serde_json::from_value(base).unwrap()
}

#[test]
fn claude_line_for_new_resumed_and_task_sessions() {
    assert_eq!(shell::claude_line(&launch(json!({ "newSessionId": "abc" }))).unwrap(), "claude --session-id abc");
    assert_eq!(shell::claude_line(&launch(json!({ "resumeSessionId": "abc" }))).unwrap(), "claude --resume abc");
    assert_eq!(
        shell::claude_line(&launch(json!({ "newSessionId": "abc", "worktree": "fix-login" }))).unwrap(),
        "claude --session-id abc --worktree fix-login"
    );
    assert!(shell::claude_line(&launch(json!({ "kind": "shell" }))).is_none());
}

#[test]
fn extra_claude_options_cannot_add_new_lines() {
    let line = shell::claude_line(&launch(json!({ "newSessionId": "abc", "extraArgs": "--model sonnet\r\nRemove-Item x" }))).unwrap();
    assert!(!line.contains('\n') && !line.contains('\r'));
    assert!(line.starts_with("claude --session-id abc --model sonnet"));
}

#[test]
fn environment_variable_names_are_validated() {
    assert!(shell::valid_env_name("NODE_ENV"));
    assert!(!shell::valid_env_name("HELM_SETTINGS")); // Helm's own variables can't be overridden
    assert!(!shell::valid_env_name("BAD NAME"));
    assert!(!shell::valid_env_name(""));
}

#[test]
fn unsafe_ids_are_rejected_before_anything_runs() {
    let req = launch(json!({ "newSessionId": "abc; Remove-Item C:\\" }));
    assert!(shell::build(&req, std::path::Path::new("C:\\x.json")).is_err());
}

#[test]
fn status_line_shows_context_and_limits() {
    let data = json!({
        "context_window": { "used_percentage": 12.4 },
        "rate_limits": { "five_hour": { "used_percentage": 61.0 }, "seven_day": { "used_percentage": 9.6 } }
    });
    assert_eq!(bridge::status_line(&data), "ctx 12% · 5h 61% · week 10%");
    assert_eq!(bridge::status_line(&json!({})), "");
}

#[test]
fn worktree_list_parsing_skips_missing_folders() {
    let porcelain = "worktree C:/repo\nHEAD 1111\nbranch refs/heads/main\n\nworktree C:/repo/.claude/worktrees/fix\nHEAD 2222\nbranch refs/heads/worktree-fix\n\nworktree C:/gone\nHEAD 3333\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n";
    let list = worktrees::parse_porcelain(porcelain);
    assert_eq!(list.len(), 2);
    assert_eq!(list[0], ("C:\\repo".to_string(), Some("main".to_string())));
    assert_eq!(list[1].1.as_deref(), Some("worktree-fix"));
}

#[test]
fn only_human_prompts_count_in_history() {
    let typed = json!({ "type": "user", "message": { "content": "Fix the login bug" } });
    let tool_result = json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "ok" }] } });
    let meta = json!({ "type": "user", "isMeta": true, "message": { "content": "Caveat: ..." } });
    let command = json!({ "type": "user", "message": { "content": "<command-name>/clear</command-name>" } });
    assert_eq!(sessions::human_prompt(&typed).as_deref(), Some("Fix the login bug"));
    assert!(sessions::human_prompt(&tool_result).is_none());
    assert!(sessions::human_prompt(&meta).is_none());
    assert!(sessions::human_prompt(&command).is_none());
}

#[test]
fn titles_are_shortened_on_word_boundaries_safely() {
    assert_eq!(sessions::truncate("a  b\n c", 10), "a b c");
    let khmer = "សួស្តី".repeat(20);
    assert!(sessions::truncate(&khmer, 5).ends_with('…')); // multi-byte text never splits mid-character
}

#[test]
fn export_turns_a_transcript_into_markdown() {
    let dir = std::env::temp_dir().join(format!("helm-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("abc.jsonl");
    let lines = [
        json!({ "type": "user", "cwd": "C:\\repo", "timestamp": "2026-10-19T10:00:00.000Z", "message": { "content": "Add a test" } }),
        json!({ "type": "assistant", "message": { "content": [
            { "type": "tool_use", "name": "Bash", "input": { "command": "npm test" } },
            { "type": "text", "text": "Done, all tests pass." }
        ] } }),
        json!({ "type": "ai-title", "aiTitle": "Adding tests" }),
    ];
    std::fs::write(&path, lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
    let md = export::to_markdown(&path, true).unwrap();
    std::fs::remove_dir_all(&dir).ok();

    assert!(md.starts_with("# Adding tests"));
    assert!(md.contains("### You\n\nAdd a test"));
    assert!(md.contains("- Bash: `npm test`"));
    assert!(md.contains("Done, all tests pass."));
}
