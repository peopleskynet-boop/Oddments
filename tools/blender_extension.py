"""Builds the Blender add-on (integrations/blender/perch_blender.py) as a Blender extension package.

    python tools/blender_extension.py [--blender PATH] [--repo]

- stages dist-blender/stage/oddments/: __init__.py (the add-on) and blender_manifest.toml (version taken from
  bl_info, the repository's manifest is updated to match);
- runs `blender --command extension build` and `validate` -> dist-blender/oddments-<version>.zip;
- --repo: also writes a self-hosted extension repository (dist-blender/repo/index.json + the zip) with
  `blender --command extension server-generate`: put that folder on any https host and add its index.json URL in
  Blender: Preferences > Get Extensions > Repositories > + > Add Remote Repository.

Blender: --blender, the BLENDER environment variable, or the newest one in the usual install folders.
Messages are plain ASCII on purpose (the script runs in any console locale).
"""
import argparse
import glob
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "integrations", "blender")
OUT = os.path.join(ROOT, "dist-blender")


def find_blender(given):
    if given:
        return given
    if os.environ.get("BLENDER"):
        return os.environ["BLENDER"]
    pats = [r"C:\Program Files\Blender Foundation\Blender *\blender.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Blender Foundation\Blender *\blender.exe"),
            "/Applications/Blender*.app/Contents/MacOS/Blender", "/usr/bin/blender"]
    found = [p for pat in pats for p in glob.glob(pat)]

    def ver(p):
        m = re.search(r"(\d+)\.(\d+)", p)
        return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
    if not found:
        sys.exit("Blender not found: pass --blender or set BLENDER")
    return max(found, key=ver)


def addon_version():
    with open(os.path.join(SRC, "perch_blender.py"), encoding="utf-8") as f:
        m = re.search(r'"version":\s*\((\d+),\s*(\d+),\s*(\d+)\)', f.read())
    if not m:
        sys.exit("bl_info version not found in perch_blender.py")
    return ".".join(m.groups())


def sync_manifest(version):
    path = os.path.join(SRC, "blender_manifest.toml")
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    new = re.sub(r'(?m)^version = "[^"]*"', 'version = "%s"' % version, text, count=1)
    if new != text:
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(new)
        print("manifest version set to", version)
    return path


def run(cmd):
    print(">", " ".join('"%s"' % c if " " in c else c for c in cmd))
    r = subprocess.run(cmd)
    if r.returncode:
        sys.exit("failed: exit code %d" % r.returncode)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blender")
    ap.add_argument("--repo", action="store_true")
    a = ap.parse_args()
    blender = find_blender(a.blender)
    version = addon_version()
    manifest = sync_manifest(version)

    stage = os.path.join(OUT, "stage", "oddments")
    shutil.rmtree(os.path.join(OUT, "stage"), ignore_errors=True)
    os.makedirs(stage)
    shutil.copyfile(os.path.join(SRC, "perch_blender.py"), os.path.join(stage, "__init__.py"))
    shutil.copyfile(manifest, os.path.join(stage, "blender_manifest.toml"))

    run([blender, "--factory-startup", "--command", "extension", "build", "--source-dir", stage, "--output-dir", OUT])
    zips = sorted(glob.glob(os.path.join(OUT, "oddments-%s*.zip" % version)))
    if not zips:
        sys.exit("no package built")
    pkg = zips[-1]
    run([blender, "--factory-startup", "--command", "extension", "validate", pkg])
    print("package:", pkg)

    if a.repo:
        repo = os.path.join(OUT, "repo")
        os.makedirs(repo, exist_ok=True)
        for old in glob.glob(os.path.join(repo, "oddments-*.zip")):
            os.remove(old)
        shutil.copyfile(pkg, os.path.join(repo, os.path.basename(pkg)))
        run([blender, "--factory-startup", "--command", "extension", "server-generate", "--repo-dir", repo])
        print("repository:", os.path.join(repo, "index.json"))


if __name__ == "__main__":
    main()
