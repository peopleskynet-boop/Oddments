// Local receiver for integrations (the Blender add-on and the Figma plugin).
// A tiny HTTP server on 127.0.0.1 only, standard library, no extra crates:
//   GET  /ping                      → {"app":"perch"}             (no token: lets add-ons find Oddments)
//   POST /import?name=…&token=…     → body is a file; saved to the inbox and handed to the window
//   GET  /selection?token=…         → JSON array of the selected files' absolute paths
//   POST /import?…&folder=…&tags=… (browser extension) → folder id and tags (one per line) go to the window too
//   GET  /library?token=…           → {"folders":[…],"tags":[…]} the window last pushed (set_catalog), for the extension's picker
//   GET  /items?token=…             → the library's files as JSON (the window pushes it: set_catalog), for the Figma plugin
//   GET  /file?token=…&path=files/… → one file of the library (a thumbnail or an original); only under files/
//   GET  /outbox?token=…            → files Oddments sent to Blender («В Blender»), JSON array; the queue is emptied.
//                                     The add-on polls it about once a second, so Oddments knows whether Blender listens.
//   POST /mcp?token=… (or Authorization: Bearer …) → MCP (Streamable HTTP, JSON answers): the JSON-RPC message goes to
//                                     the window (event «perch-mcp»), which runs the tools (lib/mcp.js) and answers
//                                     through mcp_reply; `Oddments --mcp` (mcp.rs) forwards stdio to here.
// Every other request needs the token, which is created once and kept in the app's local data.
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::sync::mpsc;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

// 7865 was taken by another app on the user's machine; try a short range from a quiet base
pub const PORT: u16 = 47215;
const PORT_TRIES: u16 = 5;
const MAX_BODY: usize = 1024 * 1024 * 1024; // 1 GB
// at most this many requests at once (audit #35): a flood of slow connections cannot pile up threads
const MAX_CONN: usize = 32;
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
const MAX_HEADERS: usize = 100;
const MAX_LINE: usize = 8 * 1024;

#[derive(Default)]
pub struct Bridge {
    pub token: String,
    pub running: bool,
    pub port: u16,
    pub selection: Vec<String>,
    pub inbox: PathBuf,
    pub outbox: Vec<String>,
    pub polled: u64, // ms since the epoch of the add-on's last /outbox poll
    pub catalog: String, // folders and tags as JSON, pushed by the window
    pub items: String,   // the files (id, name, tags, paths…) as JSON, pushed by the window
    pub root: String,    // the library folder, for /file
    pub mcp: HashMap<u64, mpsc::Sender<String>>, // MCP requests waiting for the window's answer
    pub mcp_seq: u64,
    pub seen: HashMap<String, u64>, // which integration last talked to the receiver, and when (ms): the plugin hub
}

#[derive(Clone, serde::Serialize)]
struct McpMsg { id: u64, body: String }
pub type Shared = Arc<Mutex<Bridge>>;

fn random_hex() -> String {
    let mut out = String::new();
    for i in 0..4u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out[..32].to_string()
}

// token.txt in the app's local data folder: stable across restarts, so add-ons are set up once
fn load_token(dir: &PathBuf) -> String {
    let f = dir.join("integration-token.txt");
    if let Ok(t) = std::fs::read_to_string(&f) {
        let t = t.trim().to_string();
        if t.len() >= 16 { return t; }
    }
    let t = random_hex();
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(&f, &t);
    t
}

pub fn start(app: &AppHandle) -> Shared {
    let dir = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("perch"));
    let inbox = dir.join("inbox");
    let _ = std::fs::create_dir_all(&inbox);
    let shared: Shared = Arc::new(Mutex::new(Bridge { token: load_token(&dir), running: false, port: PORT, selection: vec![], inbox, outbox: vec![], polled: 0, catalog: String::new(), items: String::new(), root: String::new(), mcp: HashMap::new(), mcp_seq: 0, seen: HashMap::new() }));
    let bound = (PORT..PORT + PORT_TRIES).find_map(|p| TcpListener::bind(("127.0.0.1", p)).ok().map(|l| (p, l)));
    match bound {
        Some((port, listener)) => {
            if let Ok(mut b) = shared.lock() { b.running = true; b.port = port; }
            let st = shared.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    if ACTIVE.load(Ordering::SeqCst) >= MAX_CONN { drop(stream); continue; }
                    ACTIVE.fetch_add(1, Ordering::SeqCst);
                    let st = st.clone();
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = handle(stream, &st, &app);
                        ACTIVE.fetch_sub(1, Ordering::SeqCst);
                    });
                }
            });
        }
        None => { /* all ports busy — integrations are simply off */ }
    }
    shared
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(v) = hex { out.push(v); i += 3; continue; }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query(q: &str, key: &str) -> Option<String> {
    q.split('&').find_map(|kv| {
        let mut it = kv.splitn(2, '=');
        if it.next()? == key { Some(pct_decode(it.next().unwrap_or(""))) } else { None }
    })
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c }).collect();
    let t = cleaned.trim().trim_matches('.').to_string();
    let t = if t.is_empty() { "file".to_string() } else { t };
    t.chars().take(120).collect()
}

fn reply(s: &mut TcpStream, code: &str, ctype: &str, body: &[u8]) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {code}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\n\
         Access-Control-Allow-Private-Network: true\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(head.as_bytes())?;
    s.write_all(body)?;
    s.flush()
}

fn json_str(v: &str) -> String {
    let mut o = String::from("\"");
    for c in v.chars() {
        match c { '"' => o.push_str("\\\""), '\\' => o.push_str("\\\\"), '\n' => o.push_str("\\n"), c if (c as u32) < 0x20 => o.push(' '), c => o.push(c) }
    }
    o.push('"');
    o
}

fn handle(mut stream: TcpStream, st: &Shared, app: &AppHandle) -> std::io::Result<()> {
    // the request line and headers must come quickly; the body may take longer (a big file over a slow disk)
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    (&mut reader).take(MAX_LINE as u64).read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let mut len: usize = 0;
    let mut host = String::new();
    let mut bearer = String::new();
    let mut origin = String::new();
    let mut agent = String::new();
    let mut n_headers = 0;
    loop {
        let mut h = String::new();
        if (&mut reader).take(MAX_LINE as u64).read_line(&mut h)? == 0 { break; }
        n_headers += 1;
        if n_headers > MAX_HEADERS { return reply(&mut stream, "431 Request Header Fields Too Large", "text/plain", b"headers"); }
        let h = h.trim_end();
        if h.is_empty() { break; }
        let lower = h.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") { len = v.trim().parse().unwrap_or(0); }
        if let Some(v) = lower.strip_prefix("host:") { host = v.trim().to_string(); }
        if lower.starts_with("authorization:") { if let Some((_, v)) = h.split_once(':') { bearer = v.trim().trim_start_matches("Bearer ").trim().to_string(); } }
        if let Some(v) = lower.strip_prefix("origin:") { origin = v.trim().to_string(); }
        if let Some(v) = lower.strip_prefix("user-agent:") { agent = v.trim().to_string(); }
    }
    // Any refusal first reads the rest of the request: on Windows, closing a socket with unread data resets
    // the connection, and the client sees "connection aborted" (WinError 10053) instead of our answer.
    let drain = |reader: &mut BufReader<TcpStream>| {
        if len > 0 && len <= MAX_BODY { let _ = std::io::copy(&mut reader.by_ref().take(len as u64), &mut std::io::sink()); }
    };
    stream.set_read_timeout(Some(Duration::from_secs(60)))?;
    // DNS-rebinding guard: exactly the loopback names, with or without a port (audit #34: «localhost.evil.com» used
    // to pass a starts_with test)
    let name = match host.rsplit_once(':') {
        Some((n, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => n,
        _ => host.as_str(),
    };
    let host_ok = host.is_empty() || name == "127.0.0.1" || name == "localhost" || name == "[::1]";
    if !host_ok { drain(&mut reader); return reply(&mut stream, "403 Forbidden", "text/plain", b"bad host"); }
    if method == "OPTIONS" { return reply(&mut stream, "204 No Content", "text/plain", b""); }

    let (path, q) = match target.split_once('?') { Some((p, q)) => (p.to_string(), q.to_string()), None => (target.clone(), String::new()) };
    if path == "/ping" { return reply(&mut stream, "200 OK", "application/json", b"{\"app\":\"perch\"}"); }

    let (token, inbox, selection, catalog, items, root) = {
        let b = st.lock().map_err(|_| std::io::Error::other("lock"))?;
        (b.token.clone(), b.inbox.clone(), b.selection.clone(), b.catalog.clone(), b.items.clone(), b.root.clone())
    };
    if query(&q, "token").as_deref() != Some(token.as_str()) && bearer != token {
        drain(&mut reader);
        return reply(&mut stream, "401 Unauthorized", "application/json", b"{\"error\":\"token\"}");
    }

    // the plugin hub shows which integrations are alive: guessed from the path and the caller's origin / agent
    let who = if path == "/mcp" { "mcp" }
        else if path == "/outbox" || agent.contains("python") { "blender" }
        else if origin.contains("extension://") { "browser" }
        else if origin == "null" || origin.contains("figma") { "figma" }
        else { "" };
    if !who.is_empty() { if let Ok(mut b) = st.lock() { b.seen.insert(who.to_string(), now_ms()); } }

    match (method.as_str(), path.as_str()) {
        ("POST", "/mcp") => {
            if len == 0 || len > 4 * 1024 * 1024 { drain(&mut reader); return reply(&mut stream, "413 Payload Too Large", "application/json", b"{\"error\":\"size\"}"); }
            let mut body = vec![0u8; len];
            reader.read_exact(&mut body)?;
            let (tx, rx) = mpsc::channel::<String>();
            let id = {
                let mut b = st.lock().map_err(|_| std::io::Error::other("lock"))?;
                b.mcp_seq += 1;
                let id = b.mcp_seq;
                b.mcp.insert(id, tx);
                id
            };
            let _ = app.emit("perch-mcp", McpMsg { id, body: String::from_utf8_lossy(&body).into_owned() });
            let out = rx.recv_timeout(Duration::from_secs(90));
            if let Ok(mut b) = st.lock() { b.mcp.remove(&id); }
            match out {
                Ok(s) if s.trim().is_empty() => reply(&mut stream, "202 Accepted", "application/json", b""),
                Ok(s) => reply(&mut stream, "200 OK", "application/json", s.as_bytes()),
                Err(_) => reply(&mut stream, "504 Gateway Timeout", "application/json", b"{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32001,\"message\":\"Oddments did not answer\"}}"),
            }
        }
        ("GET", "/mcp") => reply(&mut stream, "405 Method Not Allowed", "text/plain", b"POST only"),
        ("GET", "/selection") => {
            let body = format!("[{}]", selection.iter().map(|p| json_str(p)).collect::<Vec<_>>().join(","));
            reply(&mut stream, "200 OK", "application/json", body.as_bytes())
        }
        ("GET", "/library") => {
            let body = if catalog.is_empty() { "{\"folders\":[],\"tags\":[]}".to_string() } else { catalog };
            reply(&mut stream, "200 OK", "application/json", body.as_bytes())
        }
        ("GET", "/items") => {
            let body = if items.is_empty() { "[]".to_string() } else { items };
            reply(&mut stream, "200 OK", "application/json", body.as_bytes())
        }
        ("GET", "/file") => {
            // a path inside the library's files/ folder only: no parent steps, no drive letters, no backslashes
            let rel = query(&q, "path").unwrap_or_default();
            let ok = !root.is_empty() && rel.starts_with("files/") && !rel.contains("..") && !rel.contains('\\') && !rel.contains(':');
            if !ok { return reply(&mut stream, "400 Bad Request", "application/json", b"{\"error\":\"path\"}"); }
            let mut full = PathBuf::from(&root);
            for part in rel.split('/') { if !part.is_empty() { full.push(part); } }
            match std::fs::read(&full) {
                Ok(bytes) => {
                    let ext = rel.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
                    let ctype = match ext.as_str() {
                        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp",
                        "svg" => "image/svg+xml", "avif" => "image/avif", "mp4" => "video/mp4", _ => "application/octet-stream",
                    };
                    reply(&mut stream, "200 OK", ctype, &bytes)
                }
                Err(_) => reply(&mut stream, "404 Not Found", "application/json", b"{\"error\":\"file\"}"),
            }
        }
        ("GET", "/outbox") => {
            let list = {
                let mut b = st.lock().map_err(|_| std::io::Error::other("lock"))?;
                b.polled = now_ms();
                std::mem::take(&mut b.outbox)
            };
            let body = format!("[{}]", list.iter().map(|p| json_str(p)).collect::<Vec<_>>().join(","));
            reply(&mut stream, "200 OK", "application/json", body.as_bytes())
        }
        ("POST", "/import") => {
            if len == 0 || len > MAX_BODY { return reply(&mut stream, "413 Payload Too Large", "application/json", b"{\"error\":\"size\"}"); }
            let name = safe_name(&query(&q, "name").unwrap_or_else(|| "file".into()));
            let source = query(&q, "source").unwrap_or_default();
            let mut body = vec![0u8; len];
            reader.read_exact(&mut body)?;
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            let dir = inbox.join(stamp.to_string());
            std::fs::create_dir_all(&dir)?;
            let file = dir.join(&name);
            std::fs::write(&file, &body)?;
            // folder and tags are present only when the sender chose them (the browser extension);
            // without them the window files the import by its current view, as before
            let mut payload = format!("{{\"path\":{},\"source\":{}", json_str(&file.to_string_lossy()), json_str(&source));
            for key in ["folder", "tags"] {
                if let Some(v) = query(&q, key) { payload.push_str(&format!(",{}:{}", json_str(key), json_str(&v))); }
            }
            payload.push('}');
            let _ = app.emit("perch-import", payload);
            reply(&mut stream, "200 OK", "application/json", b"{\"ok\":true}")
        }
        _ => { drain(&mut reader); reply(&mut stream, "404 Not Found", "application/json", b"{\"error\":\"not found\"}") }
    }
}

#[tauri::command]
pub fn integration_info(state: tauri::State<'_, Shared>) -> (u16, String, bool) {
    let b = state.lock().unwrap();
    (b.port, b.token.clone(), b.running)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Queue files for the Blender add-on. Returns true when the add-on has polled in the last few seconds
/// (Blender is open with «Принимать из Oddments» on), so the window can say whether the files will arrive.
#[tauri::command]
pub fn send_to_blender(paths: Vec<String>, state: tauri::State<'_, Shared>) -> bool {
    let mut b = state.lock().unwrap();
    b.outbox.extend(paths);
    if b.outbox.len() > 200 { let n = b.outbox.len() - 200; b.outbox.drain(..n); }
    now_ms().saturating_sub(b.polled) < 4000
}

/// Folders and tags for the browser extension's picker (JSON made by the window).
#[tauri::command]
pub fn set_catalog(json: String, items: Option<String>, root: Option<String>, state: tauri::State<'_, Shared>) {
    if let Ok(mut b) = state.lock() {
        b.catalog = json;
        if let Some(i) = items { b.items = i; }
        if let Some(r) = root { b.root = r; }
    }
}

#[tauri::command]
pub fn set_selection(paths: Vec<String>, state: tauri::State<'_, Shared>) {
    if let Ok(mut b) = state.lock() { b.selection = paths; }
}

/// The window's answer to an MCP message (lib/mcp.js).
#[tauri::command]
pub fn mcp_reply(id: u64, body: String, state: tauri::State<'_, Shared>) {
    if let Ok(mut b) = state.lock() {
        if let Some(tx) = b.mcp.remove(&id) { let _ = tx.send(body); }
    }
}

/// When each integration last talked to the receiver (ms since the epoch), for the plugin hub.
#[tauri::command]
pub fn integration_seen(state: tauri::State<'_, Shared>) -> HashMap<String, u64> {
    state.lock().map(|b| b.seen.clone()).unwrap_or_default()
}
