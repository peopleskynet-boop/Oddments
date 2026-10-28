// Blender bridge: finds an installed Blender and runs it in the background (no window) to turn
// .blend and Alembic (.abc) files into GLB, which the in-app 3D viewer can show.
// Only an executable named blender(.exe) can be started, and only with our own export script,
// so this is narrower than a general "run any program" permission.
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

// Exports the opened .blend: visible objects, modifiers applied, no cameras or lights.
const EXPORT_BLEND: &str = r#"
import bpy, sys
out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, use_visible=True)
"#;

// Imports an Alembic cache into an empty scene, then exports it.
const EXPORT_ABC: &str = r#"
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.alembic_import(filepath=a[0], as_background_job=False)
bpy.ops.export_scene.gltf(filepath=a[1], export_format='GLB', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False)
"#;

const TIMEOUT: Duration = Duration::from_secs(180);

// «Развернуть UV»: the smart seams + minimum-stretch unwrap of the Oddments add-on, on any model Blender opens
const SMART_UV: &str = include_str!("smart_uv.py");
const UV_EXT: [&str; 11] = ["glb", "gltf", "fbx", "obj", "stl", "ply", "usd", "usdz", "usdc", "abc", "blend"];

fn is_blender_exe(p: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
    (name == "blender.exe" || name == "blender") && p.is_file()
}

// "Blender 5.2" → (5, 2) so the newest install wins
fn version_of(dir: &Path) -> (u32, u32) {
    let s = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let digits: String = s.chars().filter(|c| c.is_ascii_digit() || *c == '.').collect();
    let mut it = digits.split('.').filter(|x| !x.is_empty()).map(|x| x.parse::<u32>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0))
}

#[tauri::command]
pub fn find_blender() -> Option<String> {
    let mut found: Vec<(u32, u32, PathBuf)> = Vec::new();
    let mut roots: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Ok(p) = std::env::var(var) { roots.push(PathBuf::from(p).join("Blender Foundation")); }
    }
    if let Ok(p) = std::env::var("LOCALAPPDATA") { roots.push(PathBuf::from(p).join("Programs")); }
    for root in &roots {
        if let Ok(rd) = std::fs::read_dir(root) {
            for e in rd.flatten() {
                let dir = e.path();
                let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
                if !name.starts_with("blender") { continue; }
                let exe = dir.join("blender.exe");
                if is_blender_exe(&exe) { let (a, b) = version_of(&dir); found.push((a, b, exe)); }
            }
        }
    }
    // Steam
    for base in [r"C:\Program Files (x86)\Steam\steamapps\common\Blender", r"C:\Program Files\Steam\steamapps\common\Blender"] {
        let exe = Path::new(base).join("blender.exe");
        if is_blender_exe(&exe) { found.push((0, 0, exe)); }
    }
    // macOS / Linux
    for p in ["/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender"] {
        let exe = PathBuf::from(p);
        if exe.is_file() { found.push((0, 0, exe)); }
    }
    found.sort_by(|a, b| (b.0, b.1).cmp(&(a.0, a.1)));
    found.into_iter().next().map(|f| f.2.to_string_lossy().into_owned())
}

fn run_export(blender: &str, input: &str, output: &str) -> Result<(), String> {
    let exe = Path::new(blender);
    let name = exe.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
    if !(name.starts_with("blender") && exe.is_file()) {
        return Err("Это не программа Blender".into());
    }
    let src = Path::new(input);
    if !src.is_file() { return Err("Файл не найден".into()); }
    if !output.to_ascii_lowercase().ends_with(".glb") { return Err("Ожидался путь к .glb".into()); }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();

    let mut cmd = Command::new(exe);
    match ext.as_str() {
        "blend" => { cmd.args(["-b", input, "--factory-startup", "--python-expr", EXPORT_BLEND, "--", output]); }
        "abc" => { cmd.args(["-b", "--factory-startup", "--python-expr", EXPORT_ABC, "--", input, output]); }
        _ => return Err("Через Blender открываются только .blend и .abc".into()),
    }
    // output is not read: a full pipe would block Blender
    cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashes up
    }
    let _ = std::fs::remove_file(output);
    let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить Blender: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > TIMEOUT {
                    let _ = child.kill();
                    return Err("Blender не ответил за 3 минуты".into());
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    if Path::new(output).is_file() { Ok(()) } else { Err("Blender не сохранил сцену: возможно, в ней нет видимых объектов".into()) }
}

#[tauri::command]
pub async fn blender_to_glb(blender: String, input: String, output: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_export(&blender, &input, &output))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn blender_uv(blender: String, input: String, output: String, angle: f64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_uv(&blender, &input, &output, angle))
        .await
        .map_err(|e| e.to_string())?
}

// Returns the script's counts as JSON ({"meshes":…, "seams":…}).
fn run_uv(blender: &str, input: &str, output: &str, angle: f64) -> Result<String, String> {
    let exe = Path::new(blender);
    let name = exe.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
    if !(name.starts_with("blender") && exe.is_file()) {
        return Err("Это не программа Blender".into());
    }
    let src = Path::new(input);
    if !src.is_file() { return Err("Файл не найден".into()); }
    if !output.to_ascii_lowercase().ends_with(".glb") { return Err("Ожидался путь к .glb".into()); }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !UV_EXT.contains(&ext.as_str()) { return Err("Этот формат Blender не открывает".into()); }
    let angle = if angle.is_finite() { angle.clamp(10.0, 120.0) } else { 66.0 };
    let report = format!("{output}.json");
    let _ = std::fs::remove_file(output);
    let _ = std::fs::remove_file(&report);
    let mut cmd = Command::new(exe);
    cmd.args(["-b", "--factory-startup", "--python-expr", SMART_UV, "--", input, output, &angle.to_string()]);
    cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить Blender: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > Duration::from_secs(600) {
                    let _ = child.kill();
                    return Err("Blender не справился за 10 минут".into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    let counts = std::fs::read_to_string(&report).unwrap_or_else(|_| "{}".into());
    let _ = std::fs::remove_file(&report);
    if Path::new(output).is_file() { Ok(counts) } else { Err("Blender не развернул модель: возможно, в ней нет мешей".into()) }
}
