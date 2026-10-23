// `Oddments --mcp`: an MCP server over stdio for clients that start a local program (Claude Desktop). It is a thin
// pipe: each JSON-RPC line from stdin goes to the running app's receiver (POST /mcp, bridge.rs) with the integration
// token, and the answer goes to stdout. The tools themselves run in the window (lib/mcp.js). When Oddments is not
// running, it is started once and given a few seconds; if it still does not answer, requests get a JSON-RPC error.
// Runs before Tauri is built (lib.rs), so the single-instance guard never sees it.
use std::io::{BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

use crate::bridge::PORT;

const IDENT: &str = "app.perch.desktop"; // tauri.conf.json identifier: the app's local data folder

fn data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    { std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(IDENT)) }
    #[cfg(target_os = "macos")]
    { std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support").join(IDENT)) }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
            .map(|d| d.join(IDENT))
    }
}

fn token() -> String {
    data_dir().and_then(|d| std::fs::read_to_string(d.join("integration-token.txt")).ok()).map(|t| t.trim().to_string()).unwrap_or_default()
}

// one request to the receiver; Ok(body) only for a real answer of Oddments (2xx)
fn post(body: &str, token: &str) -> std::io::Result<String> {
    let mut last = std::io::Error::other("no receiver");
    for port in PORT..PORT + 5 {
        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        let mut s = match TcpStream::connect_timeout(&addr, Duration::from_millis(400)) { Ok(s) => s, Err(e) => { last = e; continue; } };
        s.set_read_timeout(Some(Duration::from_secs(100)))?;
        let head = format!(
            "POST /mcp?token={token} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n\
             Accept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        s.write_all(head.as_bytes())?;
        s.write_all(body.as_bytes())?;
        s.flush()?;
        let mut raw = Vec::new();
        s.read_to_end(&mut raw)?;
        let text = String::from_utf8_lossy(&raw).into_owned();
        let (head, rest) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
        let code: u16 = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
        if (200..300).contains(&code) { return Ok(rest.to_string()); }
        if code == 504 { return Ok(rest.to_string()); } // Oddments answered: the window was too slow — pass its error on
        last = std::io::Error::other(format!("HTTP {code}"));
    }
    Err(last)
}

fn launch_app() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new(exe)
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .spawn();
    }
}

fn error_for(line: &str, message: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let id = v.get("id")?.clone(); // a notification has no id: nothing to answer
    Some(serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }).to_string())
}

pub fn stdio() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut launched = false;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() { continue; }
        let mut tok = token();
        let mut res = post(line, &tok);
        if res.is_err() && !launched {
            launched = true;
            launch_app();
            for _ in 0..40 {
                std::thread::sleep(Duration::from_millis(500));
                tok = token();
                res = post(line, &tok);
                if res.is_ok() { break; }
            }
        }
        let answer = match res {
            Ok(body) => { let b = body.trim().to_string(); if b.is_empty() { None } else { Some(b) } }
            Err(_) => error_for(line, "Oddments не отвечает: откройте приложение (и включите его приёмник интеграций)"),
        };
        if let Some(a) = answer {
            let _ = writeln!(out, "{a}");
            let _ = out.flush();
        }
    }
}
