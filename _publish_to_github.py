# -*- coding: utf-8 -*-
"""把 jumeng-canvas-opensource 同步到 GitHub Jumeng-Canvas-Local-Client/main。"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SRC = Path(r"d:\huabu_fuben\jumengai_comfyUI\ai_read\jumeng-canvas-opensource")
REPO = "https://github.com/lkw2731938298/Jumeng-Canvas-Local-Client.git"
NEW_VERSION = "0.1.4"

SKIP_DIR_NAMES = {
    "node_modules",
    ".next",
    ".next-diag",
    "data",
    ".git",
    "runtime",
    "__pycache__",
    ".turbo",
}
SKIP_FILE_SUFFIXES = {".log", ".tsbuildinfo"}
SKIP_FILE_NAMES = {".DS_Store", "Thumbs.db"}


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print("$", " ".join(cmd))
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=check)


def should_skip_dir(name: str) -> bool:
    return name in SKIP_DIR_NAMES or name.startswith(".git")


def copy_tree(src: Path, dst: Path) -> int:
    # 清空目标（保留 .git）
    for child in list(dst.iterdir()):
        if child.name == ".git":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    count = 0
    for path in src.rglob("*"):
        rel = path.relative_to(src)
        parts = rel.parts
        if any(should_skip_dir(p) for p in parts):
            continue
        if path.is_dir():
            continue
        if path.name in SKIP_FILE_NAMES:
            continue
        if path.suffix in SKIP_FILE_SUFFIXES:
            continue
        if path.name.startswith(".env") and not path.name.endswith(".example") and ".example." not in path.name:
            # 允许 *.example.env；跳过真实 .env
            if path.name == ".env" or path.name.endswith(".local"):
                continue
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        count += 1
    return count


def bump_version(root: Path, version: str) -> None:
    pkg = root / "package.json"
    data = json.loads(pkg.read_text(encoding="utf-8"))
    old = data.get("version")
    data["version"] = version
    pkg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"version {old} -> {version}")
    web_pkg = root / "packages" / "web" / "package.json"
    if web_pkg.is_file():
        w = json.loads(web_pkg.read_text(encoding="utf-8"))
        if "version" in w:
            w["version"] = version
            web_pkg.write_text(json.dumps(w, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print("also bumped packages/web/package.json")


def main() -> int:
    if not SRC.is_dir():
        raise SystemExit(f"missing source {SRC}")

    work = Path(tempfile.mkdtemp(prefix="jumeng-local-gh-"))
    print("work=", work)
    run(["git", "clone", "--depth", "1", "-b", "main", REPO, str(work / "repo")])
    repo = work / "repo"

    n = copy_tree(SRC, repo)
    print(f"copied {n} files")
    bump_version(repo, NEW_VERSION)

    # 确认素材库文件在
    ml = repo / "packages" / "web" / "src" / "lib" / "api" / "materialLibrary.ts"
    if not ml.is_file():
        raise SystemExit("materialLibrary.ts missing after copy")
    text = ml.read_text(encoding="utf-8")
    if "www.jumeng.vip/api/v1/material-library" not in text:
        raise SystemExit("material library API URL missing")

    run(["git", "status", "-sb"], cwd=repo)
    run(["git", "add", "-A"], cwd=repo)
    # 若无变更则退出
    st = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=str(repo))
    if st.returncode == 0:
        print("no changes to commit")
        return 0

    msg = (
        f"release {NEW_VERSION}: platform material library public API + infinite canvas naming sync\n\n"
        "- Fetch materials from https://www.jumeng.vip/api/v1/material-library\n"
        "- Keep remote media URLs when placing nodes on the local canvas\n"
    )
    run(["git", "commit", "-m", msg], cwd=repo)
    run(["git", "push", "origin", "main"], cwd=repo)
    run(["git", "log", "-1", "--oneline"], cwd=repo)
    print("[done]", REPO, "main", NEW_VERSION)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
