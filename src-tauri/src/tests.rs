//! Unit tests for logic that doesn't need a window, a PTY or git.

use serde_json::json;

use crate::{bridge, browser, export, preview, report, sessions, shell, tools, worktrees};

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
fn subagent_answer_comes_from_its_handback() {
    let dir = std::env::temp_dir().join(format!("helm-test-sub-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("agent-x.jsonl");
    let lines = [
        json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "Looking around" }] } }),
        json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "tool_use", "name": "SubagentHandback", "input": { "message": "Found 3 .txt files." } }] } }),
        json!({ "type": "user", "isSidechain": true, "message": { "content": [{ "type": "tool_result", "content": "ok" }] } }),
    ];
    std::fs::write(&path, lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
    let answer = sessions::last_assistant_text(&path);
    std::fs::remove_dir_all(&dir).ok();
    assert_eq!(answer.as_deref(), Some("Found 3 .txt files."));
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

#[test]
fn file_tabs_pick_the_right_viewer() {
    let dir = std::env::temp_dir().join(format!("helm-test-preview-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let write = |name: &str, bytes: &[u8]| {
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    };
    let kind = |p: &std::path::Path| serde_json::to_value(preview::read(p).unwrap()).unwrap()["kind"].as_str().unwrap().to_string();

    assert_eq!(kind(&write("a.rs", b"fn main() {}\n")), "text");
    assert_eq!(kind(&write("khmer.txt", "សួស្តី 👋".as_bytes())), "text");
    assert_eq!(kind(&write("logo.svg", b"<svg/>")), "image");
    assert_eq!(kind(&write("doc.PDF", b"%PDF-1.4")), "media");
    assert_eq!(kind(&write("clip.mp4", b"....")), "media");
    assert_eq!(kind(&write("blob.bin", &[1, 2, 0, 3])), "binary");
    assert!(preview::read(&dir.join("missing.txt")).is_err());
    assert!(preview::read(&dir).is_err()); // a folder
    // Raw bytes are only handed out for PDF, video and audio.
    assert!(preview::bytes(&dir.join("doc.PDF")).is_ok());
    assert!(preview::bytes(&dir.join("a.rs")).is_err());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn new_files_stay_in_their_folder_and_saves_notice_outside_changes() {
    let dir = std::env::temp_dir().join(format!("helm-test-newfile-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let editable = |p: &std::path::Path| serde_json::to_value(preview::read(p).unwrap()).unwrap()["editable"].as_bool().unwrap();

    let notes = preview::create(&dir, "notes.md").unwrap();
    assert!(notes.starts_with(&dir) && notes.is_file());
    assert!(preview::create(&dir, "notes.md").is_err(), "never replaces an existing file");
    assert!(preview::create(&dir, "docs/plan.md").unwrap().starts_with(dir.join("docs")));
    for bad in ["", "  ", "../escape.md", "a/../../b.md", "C:\\x.md", "what?.txt", "trailing."] {
        assert!(preview::create(&dir, bad).is_err(), "{bad:?} should be refused");
    }
    assert!(!dir.parent().unwrap().join("escape.md").exists());

    let start = serde_json::to_value(preview::read(&notes).unwrap()).unwrap()["modified"].as_u64().unwrap();
    let saved = preview::save(&notes, "# Hi\r\n", start, false).unwrap();
    assert_eq!(std::fs::read_to_string(&notes).unwrap(), "# Hi\r\n");
    assert!(editable(&notes));
    // Someone else wrote the file after the editor loaded it.
    std::thread::sleep(std::time::Duration::from_millis(20));
    std::fs::write(&notes, "theirs").unwrap();
    assert_eq!(preview::save(&notes, "mine", saved, false).unwrap_err(), "changed");
    assert_eq!(std::fs::read_to_string(&notes).unwrap(), "theirs");
    preview::save(&notes, "mine", saved, true).unwrap();
    assert_eq!(std::fs::read_to_string(&notes).unwrap(), "mine");

    // Not valid UTF-8: shown, but not offered for editing (saving would change the bytes).
    let latin = dir.join("latin1.txt");
    std::fs::write(&latin, [b'c', b'a', b'f', 0xE9]).unwrap();
    assert!(!editable(&latin));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn browser_addresses_are_completed_and_helm_itself_is_off_limits() {
    assert_eq!(browser::parse_url("localhost:5173").unwrap().as_str(), "http://localhost:5173/");
    assert_eq!(browser::parse_url("example.com/docs").unwrap().as_str(), "https://example.com/docs");
    assert!(browser::parse_url("javascript:alert(1)").is_err());
    let dev = tauri::Url::parse("http://localhost:1420").unwrap();
    let app = |u: &str| browser::is_app_url(&tauri::Url::parse(u).unwrap(), Some(&dev));
    assert!(app("http://tauri.localhost/index.html"));
    assert!(app("http://ipc.localhost/plugin:fs"));
    assert!(app("http://localhost:1420/"));
    assert!(!app("http://localhost:5173/"));
    assert!(!app("https://example.com/"));
}

#[test]
fn timestamps_and_local_days() {
    assert_eq!(report::parse_ts("1970-01-01T00:00:00.000Z"), Some(0));
    assert_eq!(report::parse_ts("2026-10-19T10:14:23.192Z"), Some(1_792_404_863_192));
    // 23:30 UTC is already the next day seven hours east.
    let t = report::parse_ts("2026-10-19T23:30:00Z").unwrap();
    assert_eq!(report::local_day(t, 0), "2026-10-19");
    assert_eq!(report::local_day(t, 420), "2026-10-20");
    assert_eq!(report::local_day(t, -300), "2026-10-19");
}

#[test]
fn context_output_is_read_into_categories() {
    let raw = "<local-command-stdout> \u{1b}[1mContext Usage\u{1b}[22m\n  52.3k/1m tokens (5%)\n  \u{1b}[38;2;1;2;3m\u{26c1}\u{1b}[39m System prompt: \u{1b}[38;2;9;9;9m2.9k tokens (0.3%)\u{1b}[39m\n  MCP tools: 695 tokens (0.1%)\n  Messages: 16.8k tokens (1.7%)\n  \u{26f6} Free space: 914.7k (91.5%)\n  Autocompact buffer: 33k tokens (3.3%)\n\nAuto-compact window: 1m tokens\n";
    let exact = report::parse_context_output(raw, 5).unwrap();
    assert_eq!((exact.used, exact.window, exact.at), (52_300, 1_000_000, 5));
    let get = |l: &str| exact.items.iter().find(|i| i.label == l).map(|i| (i.tokens, i.pct));
    assert_eq!(get("System prompt"), Some((2_900, 0.3)));
    assert_eq!(get("MCP tools"), Some((695, 0.1)));
    assert_eq!(get("Free space"), Some((914_700, 91.5)));
    assert_eq!(get("Autocompact buffer"), Some((33_000, 3.3)));
    assert!(get("Auto-compact window").is_none());
}

#[test]
fn developer_tools_basics() {
    // Tool data names can't leave the tools folder.
    let dir = std::env::temp_dir().join(format!("helm-test-tools-{}", std::process::id()));
    for bad in ["", "../x", "a/b", r"a\b",".hidden", "c:x"] {
        assert!(tools::data_path(&dir, bad).is_err(), "{bad:?}");
    }
    assert_eq!(tools::data_read(&dir, "requests.json").unwrap(), None);
    tools::data_write(&dir, "requests.json", "[1]").unwrap();
    assert_eq!(tools::data_read(&dir, "requests.json").unwrap().as_deref(), Some("[1]"));
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(tools::hash_text("abc", "md5").unwrap(), "900150983cd24fb0d6963f7d28e17f72");
    assert_eq!(tools::hash_text("abc", "sha1").unwrap(), "a9993e364706816aba3e25717850c26c9cd0d89d");
    assert_eq!(tools::hash_text("abc", "sha256").unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert!(tools::hash_text("abc", "crc").is_err());

    // A port this test opens shows up as ours, and Helm refuses to stop itself.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let ports = tools::ports().unwrap();
    let row = serde_json::to_value(ports.iter().find(|p| serde_json::to_value(p).unwrap()["port"] == port).expect("own port listed")).unwrap();
    assert_eq!(row["pid"], std::process::id());
    assert_eq!(row["protected"], true);
    assert!(tools::stop_process(std::process::id()).is_err());
    assert!(tools::stop_process(4).is_err());
}

#[test]
fn conversation_files_and_fork_launch() {
    let dir = std::env::temp_dir().join(format!("helm-test-files-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let t = dir.join("s.jsonl");
    let lines = [
        json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"C:/p/a.md"}}]}}),
        json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"C:/p/b.md"}}]}}),
        json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"c:/P/A.md"}},{"type":"tool_use","name":"NotebookEdit","input":{"notebook_path":"C:/p/n.ipynb"}}]}}),
    ];
    std::fs::write(&t, lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
    assert_eq!(sessions::changed_files(&t), vec!["C:/p/a.md".to_string(), "C:/p/n.ipynb".to_string()]);
    std::fs::remove_dir_all(&dir).ok();

    let fork = launch(json!({"resumeSessionId": "abc-123", "fork": true}));
    assert_eq!(shell::claude_line(&fork).unwrap(), "claude --resume abc-123 --fork-session");
    let plain = launch(json!({"resumeSessionId": "abc-123"}));
    assert_eq!(shell::claude_line(&plain).unwrap(), "claude --resume abc-123");
}

#[test]
fn workspace_tree_search_and_file_ops() {
    use crate::workspace;
    let root = std::env::temp_dir().join(format!("helm-test-ws-{}", std::process::id()));
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    std::fs::write(root.join(".gitignore"), "dist/\n").unwrap();
    std::fs::create_dir_all(root.join("dist")).unwrap();
    std::fs::write(root.join("dist/out.js"), "const hello = 1;").unwrap();
    std::fs::write(root.join("node_modules/pkg/index.js"), "hello").unwrap();
    std::fs::write(root.join("src/App.ts"), "// say Hello\nexport const x = 1;\n").unwrap();
    std::fs::write(root.join("b.txt"), "nothing").unwrap();

    // Tree: folders first, then files, everything shown (ignored folders too).
    let names: Vec<String> = workspace::list_dir(&root).unwrap().iter().map(|e| serde_json::to_value(e).unwrap()["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, [".gitignore", "b.txt"].iter().fold(vec!["dist".to_string(), "node_modules".into(), "src".into()], |mut v, n| { v.push(n.to_string()); v }));

    // Quick open and search skip node_modules and what .gitignore lists.
    let mut files = workspace::list_files(&root, 100);
    files.sort();
    assert_eq!(files, vec![".gitignore", "b.txt", r"src\App.ts"]);
    let found = serde_json::to_value(workspace::search(&root, "hello", false, 100)).unwrap();
    assert_eq!(found["matches"].as_array().unwrap().len(), 1);
    assert_eq!(found["matches"][0]["line"], 1);
    assert_eq!(found["matches"][0]["column"], 8);
    assert_eq!(serde_json::to_value(workspace::search(&root, "hello", true, 100)).unwrap()["matches"].as_array().unwrap().len(), 0);

    // File operations stay in place and never overwrite.
    assert!(workspace::create_dir(&root, "../escape").is_err());
    let docs = workspace::create_dir(&root, "docs").unwrap();
    assert!(workspace::create_dir(&root, "docs").is_err());
    assert!(workspace::rename(&root.join("b.txt"), "src").is_err(), "a folder already has that name");
    let renamed = workspace::rename(&root.join("b.txt"), "B.txt").unwrap();
    assert!(renamed.ends_with("B.txt"));
    assert!(workspace::rename(&docs, "a/b").is_err());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn snip_history_lists_and_deletes_only_its_own_files() {
    use crate::snip;
    let dir = std::env::temp_dir().join(format!("helm-test-snips-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for name in ["snip-a.png", "snip-a.json", "snip-a.edited.png", "snip-b.png", "other.png"] {
        std::fs::write(dir.join(name), b"x").unwrap();
    }
    let names: Vec<String> = snip::list(&dir).iter().map(|f| serde_json::to_value(f).unwrap()["path"].as_str().unwrap().rsplit(['\\', '/']).next().unwrap().to_string()).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(sorted, vec!["snip-a.png", "snip-b.png"], "edited copies and other files are left out");

    // Deleting a snip removes its notes and edited copy too, and nothing else.
    snip::delete(&dir, &dir.join("snip-a.png")).unwrap();
    assert!(!dir.join("snip-a.json").exists() && !dir.join("snip-a.edited.png").exists());
    assert!(dir.join("snip-b.png").exists() && dir.join("other.png").exists());
    // Never outside the snips folder.
    let outside = std::env::temp_dir().join(format!("helm-test-outside-{}.png", std::process::id()));
    std::fs::write(&outside, b"x").unwrap();
    assert!(snip::delete(&dir, &outside).is_err());
    assert!(outside.exists());
    std::fs::remove_file(outside).ok();
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn adb_device_list_and_android_app_id() {
    use crate::devices;
    let out = "* daemon started successfully\nList of devices attached\nR58M123ABC     device usb:1-1 product:o1s model:SM_G991B device:o1s transport_id:3\nemulator-5554  device product:sdk_gphone64 model:sdk_gphone64_x86_64 device:emu64x transport_id:1\n192.168.1.20:5555 device product:husky model:Pixel_8_Pro device:husky transport_id:4\nZY22ABC unauthorized usb:1-2 transport_id:5\n\n";
    let list = devices::parse_adb_devices(out);
    let v = |i: usize| serde_json::to_value(&list[i]).unwrap();
    assert_eq!(list.len(), 4);
    assert_eq!((v(0)["name"].as_str().unwrap(), v(0)["connection"].as_str().unwrap()), ("SM G991B", "usb"));
    assert_eq!(v(1)["connection"], "emulator");
    assert_eq!((v(2)["name"].as_str().unwrap(), v(2)["connection"].as_str().unwrap()), ("Pixel 8 Pro", "wifi"));
    assert_eq!((v(3)["state"].as_str().unwrap(), v(3)["name"].as_str().unwrap()), ("unauthorized", "Android phone"));

    // One USB phone: Windows' name for it ("dom's M53") replaces the model; an iPhone stays separate.
    let mut one = devices::parse_adb_devices("List of devices attached\nRFCT6100T2V device usb:1-1 model:SM_M536B transport_id:1\n");
    devices::merge_windows_names(&mut one, vec!["dom's M53".into(), "Apple iPhone".into()]);
    let names: Vec<String> = one.iter().map(|d| serde_json::to_value(d).unwrap()["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, vec!["dom's M53", "Apple iPhone"]);
    assert_eq!(serde_json::to_value(&one[0]).unwrap()["model"], "SM M536B");
    // No adb phones: Windows' phones are listed as seen by Windows only.
    let mut none = Vec::new();
    devices::merge_windows_names(&mut none, vec!["Galaxy A54".into()]);
    assert_eq!(serde_json::to_value(&none[0]).unwrap()["state"], "usb");

    let pkgs = devices::parse_packages("package:synergistic.ags_mobile_app.dev uid:11340\npackage:com.android.shell uid:2000\nError: java.lang.SecurityException: Shell does not have permission to access user 150\n");
    assert_eq!(pkgs, vec![("synergistic.ags_mobile_app.dev".to_string(), "11340".to_string()), ("com.android.shell".to_string(), "2000".to_string())]);

    let dir = std::env::temp_dir().join(format!("helm-test-android-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("android/app")).unwrap();
    assert_eq!(devices::app_id(&dir), None);
    std::fs::write(dir.join("android/app/build.gradle.kts"), "android {\n  defaultConfig {\n    applicationId = \"com.example.museum\"\n  }\n}\n").unwrap();
    assert_eq!(devices::app_id(&dir).as_deref(), Some("com.example.museum"));
    std::fs::remove_dir_all(&dir).ok();
}


#[test]
fn session_timeline_and_files_changed() {
    let dir = std::env::temp_dir().join(format!("helm-test-timeline-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("s.jsonl");
    let lines = [
        json!({"type":"user","timestamp":"2026-10-20T10:00:00Z","message":{"role":"user","content":"Fix the login bug"}}),
        json!({"type":"assistant","timestamp":"2026-10-20T10:00:05Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":10,"output_tokens":5},"content":[
            {"type":"tool_use","name":"Bash","input":{"command":"npm test","description":"Run the tests"}},
            {"type":"tool_use","name":"Edit","input":{"file_path":"C:/app/login.ts","old_string":"a\nb","new_string":"a\nb\nc"}},
            {"type":"tool_use","name":"Write","input":{"file_path":"C:/app/new.ts","content":"x\ny\n"}},
            {"type":"tool_use","name":"Edit","input":{"file_path":"c:/APP/login.ts","old_string":"z","new_string":""}}
        ]}}),
        json!({"type":"system","subtype":"compact_boundary","timestamp":"2026-10-20T10:05:00Z"}),
    ];
    std::fs::write(&path, lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
    let r = serde_json::to_value(report::session(&path)).unwrap();
    let kinds: Vec<&str> = r["timeline"].as_array().unwrap().iter().map(|e| e["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["prompt", "tool", "tool", "tool", "tool", "compact"]);
    assert_eq!(r["timeline"][0]["text"], "Fix the login bug");
    assert_eq!(r["timeline"][1]["text"], "Run the tests");
    assert_eq!(r["timeline"][2]["path"], "C:/app/login.ts");
    // Two edits of the same file (any case) add up; Write counts as created.
    assert_eq!(r["files"][0]["path"], "C:/app/login.ts");
    assert_eq!((r["files"][0]["added"].as_u64(), r["files"][0]["removed"].as_u64(), r["files"][0]["edits"].as_u64()), (Some(3), Some(3), Some(2)));
    assert_eq!((r["files"][1]["added"].as_u64(), r["files"][1]["created"].as_bool()), (Some(2), Some(true)));
    std::fs::remove_dir_all(&dir).ok();
}


#[test]
fn chats_count_toward_the_projects_they_edited() {
    let home = std::env::temp_dir().join(format!("helm-test-home-{}", std::process::id()));
    let app = home.join("app");
    let web = home.join("web");
    for d in [&app, &web] {
        std::fs::create_dir_all(d.join(".git")).unwrap();
        std::fs::create_dir_all(d.join("src")).unwrap();
    }
    let f = |p: &std::path::Path| p.to_string_lossy().into_owned();
    let mut cache = std::collections::HashMap::new();
    let shares = report::project_shares(&f(&home), &[f(&app.join("src/a.ts")), f(&app.join("src/b.ts")), f(&app.join("README.md")), f(&web.join("index.html"))], &mut cache);
    assert_eq!(shares[0], (f(&app), 0.75));
    assert_eq!(shares[1], (f(&web), 0.25));
    // Nothing edited: the folder it ran in. Files outside any repo also count there.
    assert_eq!(report::project_shares(&f(&home), &[], &mut cache), vec![(f(&home), 1.0)]);
    assert_eq!(report::project_shares(&f(&home), &[f(&home.join("notes.txt"))], &mut cache), vec![(f(&home), 1.0)]);
    // A project folder without git still counts as its own project; hidden folders don't.
    std::fs::create_dir_all(home.join("site")).unwrap();
    assert_eq!(report::project_shares(&f(&home), &[f(&home.join("site").join("index.html"))], &mut cache), vec![(f(&home.join("site")), 1.0)]);
    assert_eq!(report::project_shares(&f(&home), &[f(&home.join(".claude").join("memory.md"))], &mut cache), vec![(f(&home), 1.0)]);
    // Memory notes and temp scripts don't dilute a chat's real project.
    let mixed = report::project_shares(&f(&home), &[f(&app.join("src/a.ts")), f(&home.join(".claude").join("m.md")), f(&home.join("AppData").join("Local").join("Temp").join("t.mjs"))], &mut cache);
    assert_eq!(mixed, vec![(f(&app), 1.0)]);
    // Desktop, Documents and the like hold projects: the project is the folder inside.
    assert_eq!(report::project_shares(&f(&home), &[f(&home.join("Desktop").join("shop").join("a.js"))], &mut cache), vec![(f(&home.join("Desktop").join("shop")), 1.0)]);
    assert_eq!(report::project_shares(&f(&home), &[f(&home.join("Desktop").join("note.txt"))], &mut cache), vec![(f(&home), 1.0)]);
    std::fs::remove_dir_all(&home).ok();
}

#[test]
fn big_tool_results_are_skimmed_but_counted() {
    let dir = std::env::temp_dir().join(format!("helm-test-skim-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("s.jsonl");
    let big = "x".repeat(50_000);
    let lines = [
        json!({"type":"user","timestamp":"2026-10-20T10:00:00Z","message":{"role":"user","content":"Read the log"}}).to_string(),
        json!({"type":"assistant","timestamp":"2026-10-20T10:00:10Z","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":5},"content":[{"type":"tool_use","name":"Read","input":{"file_path":"C:/a.log"}}]}}).to_string(),
        json!({"type":"user","timestamp":"2026-10-20T10:00:20Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":big}]}}).to_string(),
        json!({"type":"assistant","timestamp":"2026-10-20T10:00:30Z","message":{"id":"m2","usage":{"input_tokens":20,"output_tokens":7},"content":[{"type":"text","text":"Done"}]}}).to_string(),
    ];
    std::fs::write(&path, lines.join("\n")).unwrap();
    let r = serde_json::to_value(report::session(&path)).unwrap();
    assert_eq!(r["prompts"], 1, "a tool result isn't a prompt");
    assert_eq!(r["replies"], 2);
    assert_eq!(r["activeMs"], 30_000, "the skimmed line's time still counts");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn background_task_finish_notices_are_read_incrementally() {
    use crate::bgtasks;
    let dir = std::env::temp_dir().join(format!("helm-test-bg-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("s.jsonl");
    let note = |id: &str, status: &str| json!({"type":"queue-operation","operation":"enqueue","content":format!("<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>{id}</tool-use-id>\n<output-file>C:/t/b1.output</output-file>\n<status>{status}</status>\n<summary>Background command \"npm run dev &amp;&amp; x\" completed</summary>\n</task-notification>")}).to_string();
    std::fs::write(&path, format!("{}\n{}\n", json!({"type":"user","message":{"content":"hi"}}), note("toolu_1", "completed"))).unwrap();
    let cache = bgtasks::BgTaskCache::default();
    let first = bgtasks::finished(&cache, &path);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].tool_use_id, "toolu_1");
    assert_eq!(first[0].summary.as_deref(), Some("Background command \"npm run dev && x\" completed"));
    assert_eq!(first[0].output_file.as_deref(), Some("C:/t/b1.output"));
    // New lines are picked up; a half-written last line waits for its newline.
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
    write!(f, "{}\n{}", note("toolu_2", "killed"), &note("toolu_3", "failed")[..40]).unwrap();
    drop(f);
    let mut ids: Vec<String> = bgtasks::finished(&cache, &path).into_iter().map(|x| format!("{}:{}", x.tool_use_id, x.status)).collect();
    ids.sort();
    assert_eq!(ids, vec!["toolu_1:completed", "toolu_2:killed"]);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn project_rename_rewrites_only_matching_cwd() {
    use crate::project_ops::{encode, rewrite_cwd, web_url};
    // Transcript lines hold JSON, where each backslash is written twice.
    let line = r#"{"cwd":"C:\\Users\\me\\shop","type":"user"}"#;
    assert_eq!(rewrite_cwd(line, r"C:\Users\me\shop", r"C:\Users\me\store").as_deref(), Some(r#"{"cwd":"C:\\Users\\me\\store","type":"user"}"#));
    // Inside the folder, and a different letter case.
    let inner = r#"{"cwd":"c:\\users\\me\\Shop\\api"}"#;
    assert_eq!(rewrite_cwd(inner, r"C:\Users\me\shop", r"C:\Users\me\store").as_deref(), Some(r#"{"cwd":"C:\\Users\\me\\store\\api"}"#));
    // A sibling whose name only starts the same is left alone.
    assert_eq!(rewrite_cwd(r#"{"cwd":"C:\\Users\\me\\shopping"}"#, r"C:\Users\me\shop", r"C:\Users\me\store"), None);
    assert_eq!(rewrite_cwd(r#"{"type":"user"}"#, r"C:\a", r"C:\b"), None);
    assert_eq!(encode(r"C:\Users\KEN\my app.v2"), "C--Users-KEN-my-app-v2");
    assert_eq!(web_url("git@github.com:me/repo.git").as_deref(), Some("https://github.com/me/repo"));
    assert_eq!(web_url("https://me:tok@github.com/me/repo.git").as_deref(), Some("https://github.com/me/repo"));
    assert_eq!(web_url("ssh://git@gitlab.com:22/me/repo.git").as_deref(), Some("https://gitlab.com/me/repo"));
}

#[test]
fn project_ops_protect_home_and_drives() {
    use crate::project_ops::protected;
    use std::path::Path;
    assert!(protected(Path::new(r"C:\")).is_some());
    let home = dirs::home_dir().unwrap();
    assert!(protected(&home).is_some());
    assert!(protected(home.parent().unwrap()).is_some());
    assert!(protected(&home.join("Desktop")).is_some());
    assert!(protected(&home.join(".claude").join("projects")).is_some());
    assert!(protected(&home.join("code").join("my-app")).is_none());
}

/// Needs the downloaded voice model: set HELM_VOICE_DIR (Helm's voice folder) and HELM_VOICE_WAV
/// (16 kHz mono speech), then run `cargo test voice_ -- --ignored --nocapture`.
#[test]
#[ignore]
fn voice_transcribes_a_recording_phrase_by_phrase() {
    use std::path::Path;
    let dir = std::env::var("HELM_VOICE_DIR").expect("HELM_VOICE_DIR");
    let wav = std::env::var("HELM_VOICE_WAV").expect("HELM_VOICE_WAV");
    let dir = Path::new(&dir);
    let recognizer = crate::voice::load_recognizer(dir).expect("model loads");
    let vad = crate::voice::create_vad(dir).expect("vad loads");
    let wave = sherpa_onnx::Wave::read(&wav).expect("wav reads");
    assert_eq!(wave.sample_rate(), 16000);
    let started = std::time::Instant::now();
    let mut phrases = Vec::new();
    // The same steps as listening: 512-sample windows through the detector, decode each phrase.
    for chunk in wave.samples().chunks(512) {
        if chunk.len() == 512 {
            vad.accept_waveform(chunk);
        }
        while let Some(seg) = vad.front() {
            vad.pop();
            phrases.push(crate::voice::decode(&recognizer, seg.samples()));
        }
    }
    vad.flush();
    while let Some(seg) = vad.front() {
        vad.pop();
        phrases.push(crate::voice::decode(&recognizer, seg.samples()));
    }
    println!("phrases: {phrases:?}\ntook {:?}", started.elapsed());
    let all = phrases.join(" ").to_lowercase();
    assert!(all.contains("dark mode") && all.contains("settings page") && all.contains("tests"), "{all}");
}
