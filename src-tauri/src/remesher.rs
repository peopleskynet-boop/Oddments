// AutoRemesher bridge: runs the bundled autoremesher.exe (github.com/huxingyi/autoremesher, MIT) in its
// headless mode — no window of its own. Oddments shows the settings, the progress and the result in its
// own interface. The executable ships with the installer (resources/autoremesher, put there by CI);
// only a program named autoremesher(.exe) is started, only with OBJ in and OBJ out.
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const TIMEOUT: Duration = Duration::from_secs(600);

fn is_remesher_exe(p: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
    (name == "autoremesher.exe" || name == "autoremesher") && p.is_file()
}

// The copy that ships with Oddments, if this build has one.
fn bundled(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?;
    for rel in ["resources/autoremesher/autoremesher.exe", "autoremesher/autoremesher.exe", "resources/autoremesher/autoremesher"] {
        let p = dir.join(rel);
        if is_remesher_exe(&p) { return Some(p); }
    }
    None
}

#[tauri::command]
pub fn find_remesher(app: AppHandle) -> Option<String> {
    bundled(&app).map(|p| p.to_string_lossy().into_owned())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemeshParams {
    target_quads: u32,
    sharp_edge: f32,
    adaptivity: f32,
    anisotropy: f32,
    edge_scaling: f32,
}

#[derive(serde::Serialize)]
pub struct RemeshStats { quads: u32, non_quads: u32, vertices: u32, seconds: f32 }

fn report_num(text: &str, key: &str) -> f32 {
    text.lines()
        .find_map(|l| l.trim().strip_prefix(key).map(|v| v.trim().split_whitespace().next().unwrap_or("0").parse::<f32>().unwrap_or(0.0)))
        .unwrap_or(0.0)
}

fn run(app: &AppHandle, exe: &str, input: &str, output: &str, p: &RemeshParams) -> Result<RemeshStats, String> {
    let exe = Path::new(exe);
    if !is_remesher_exe(exe) { return Err("Это не AutoRemesher".into()); }
    if !Path::new(input).is_file() { return Err("Файл модели не найден".into()); }
    let lower = output.to_ascii_lowercase();
    if !input.to_ascii_lowercase().ends_with(".obj") || !lower.ends_with(".obj") { return Err("Ремешер работает с файлами .obj".into()); }
    let report = format!("{}.report.txt", &output[..output.len() - 4]);
    let _ = std::fs::remove_file(output);
    let _ = std::fs::remove_file(&report);

    let mut cmd = Command::new(exe);
    cmd.args([
        "--input", input, "--output", output, "--report", &report,
        "--target-quads", &p.target_quads.clamp(50, 500_000).to_string(),
        "--sharp-edge", &p.sharp_edge.clamp(30.0, 180.0).to_string(),
        "--adaptivity", &p.adaptivity.clamp(0.0, 1.0).to_string(),
        "--anisotropy", &p.anisotropy.clamp(0.0, 1.0).to_string(),
        "--edge-scaling", &p.edge_scaling.clamp(1.0, 4.0).to_string(),
    ]);
    if let Some(dir) = exe.parent() { cmd.current_dir(dir); } // its Qt and TBB DLLs live next to it
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить AutoRemesher: {e}"))?;
    // progress lines look like "37% done. Remeshing uniformly": passed on to the window
    if let Some(out) = child.stdout.take() {
        let app2 = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if let Some((pct, rest)) = line.split_once("% done.") {
                    if let Ok(v) = pct.trim().parse::<u32>() {
                        let _ = app2.emit("perch-remesh-progress", (v, rest.trim().to_string()));
                    }
                }
            }
        });
    }
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > TIMEOUT {
                    let _ = child.kill();
                    return Err("AutoRemesher не уложился в 10 минут — попробуйте меньше квадов".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    if !Path::new(output).is_file() { return Err("AutoRemesher не сохранил результат: возможно, у модели нет поверхности".into()); }
    let text = std::fs::read_to_string(&report).unwrap_or_default();
    let _ = std::fs::remove_file(&report);
    Ok(RemeshStats {
        quads: report_num(&text, "Quads:") as u32,
        non_quads: report_num(&text, "Non-quads:") as u32,
        vertices: report_num(&text, "Vertices:") as u32,
        seconds: report_num(&text, "Total time:"),
    })
}

#[tauri::command]
pub async fn autoremesh(app: AppHandle, exe: String, input: String, output: String, params: RemeshParams) -> Result<RemeshStats, String> {
    tauri::async_runtime::spawn_blocking(move || run(&app, &exe, &input, &output, &params))
        .await
        .map_err(|e| e.to_string())?
}
