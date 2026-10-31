"""一次性目录迁移：先核验完整清单，再移动；文档链接随位置重新计算。

只对 63ff099 基线运行一次。源码 import 修改另用补丁审阅。
python3 tools/migrations/reorganize_20261030.py --baseline BASELINE --apply
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
PAGE_GROUPS = {
    "auth": "LoginPage ResetPasswordPage",
    "marketing": "Index LandingPage",
    "workspace": "HomePage DashboardPage AiToolboxPage NotificationsPage PersonalizePage",
    "catalog": "ProductsPage ProductSelectionPage",
    "production": (
        "AvatarsPage BatchCreatePage EmotionAnalysisPage ExportFormatsPage LiveHighlightPage "
        "MaterialsPage MultiLangPage PromptTemplatesPage PublishPage ScriptPage StyleCopyPage "
        "TaskQueuePage TemplatesPage VideoCreatePage VideoEditPage WorksPage"
    ),
    "intelligence": "CompetitorPage TrendingPatternsPage",
    "analytics": "ABTestPage AnalyticsPage DataDashboardPage DataFeedbackPage",
    "knowledge": "KnowledgePage LLMCachePage",
    "account": "ActivitiesPage InvitePage ProfilePage TeamSpacePage",
    "billing": "AlipayReturnPage CreditsPage OrderDetailPage",
    "operations": "OperationsPage SupportPage",
    "settings": "ModelSettingsPage OpenAPIPage",
    "system": "NotFound",
}
DOC_GROUPS = {
    "architecture": "TECHNICAL_ARCHITECTURE.md 后端.md",
    "development": "API_AND_DATA.md DEVELOPMENT_GUIDE.md MODEL_SETTINGS.md",
    "testing": "TEST_PLAN.md",
    "operations": (
        "ALERT_DELIVERY.md BACKUP_RECOVERY.md DATABASE_CAPACITY.md KEY_ROTATION.md "
        "MEDIA_WORKER_RESOURCES.md OPERATIONS_GUIDE.md RUNBOOK.md VIDEO_SCHEDULER.md "
        "WORKER_SCHEDULING.md"
    ),
    "releases": (
        "DEPLOYMENT_AIGCP.md RELEASE_ACCEPTANCE.md REPRODUCIBLE_RELEASE.md VERSION_MANAGEMENT.md "
        "VOLCENGINE_DEPLOYMENT.md"
    ),
    "archive/reviews": (
        "ARCHITECTURE_REVIEW_20261021.md FUNCTION_COVERAGE_REVIEW_20261021.md "
        "PROJECT_ANALYSIS_OPTIMIZATION_20261025.md OPTIMIZATION_IMPLEMENTATION_20261027.md "
        "RELEASE_BASELINE_20261022.md TEST_REPORT_20261021.md TEST_REPORT_20261022.md"
    ),
}
DIRECTORIES = {
    "backend": "archive/legacy-backend",
    "api": "archive/legacy-api",
    "scratch": "archive/experiments",
    "doc": "docs/archive/early-research",
    "docs/ok": "docs/archive/presentations",
    "skill-creator": "tools/skill-creator",
}
ROOT_DOCS = {
    "PRD.md": "docs/archive/early-research/ROOT_PRD.md",
    "AL付支付宝对接.md": "docs/archive/early-research/AL付支付宝对接.md",
    "加分.md": "docs/archive/early-research/加分.md",
    "评分.md": "docs/archive/early-research/评分.md",
    "系统架构与测试汇总.md": "docs/archive/early-research/系统架构与测试汇总.md",
    "write_bp.js": "tools/documents/write_bp.js",
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plan(files):
    moves = dict(ROOT_DOCS)
    for group, names in PAGE_GROUPS.items():
        for name in names.split():
            moves[f"src/pages/{name}.tsx"] = f"src/pages/{group}/{name}.tsx"
    for group, names in DOC_GROUPS.items():
        for name in names.split():
            moves[f"docs/{name}"] = f"docs/{group}/{name}"
    for old in files:
        if old.startswith("docs/ITERATION_"):
            moves[old] = old.replace("docs/", "docs/archive/iterations/", 1)
        for source, destination in DIRECTORIES.items():
            if old.startswith(source + "/"):
                moves[old] = destination + old[len(source):]
    return moves


def relocate_links(text, old, new, moves):
    def rewrite(match):
        target = match.group(1)
        if re.match(r"^(?:[a-zA-Z][\w+.-]*:|#|/)", target):
            return match.group(0)
        path, mark, anchor = target.partition("#")
        resolved = os.path.normpath(str(Path(old).parent / unquote(path)))
        replacement = moves.get(resolved, resolved)
        relative = os.path.relpath(replacement, Path(new).parent)
        return match.group(0).replace(target, relative + (mark + anchor if mark else ""), 1)
    # 普通 Markdown 链接和图片；锚点/外部链接保持原样。
    text = re.sub(r"\]\(([^()\s]+)\)", rewrite, text)
    for source, destination in sorted(moves.items(), key=lambda item: -len(item[0])):
        # 代码块内完整仓库路径同步；不重写历史叙述中的短文件名。
        text = text.replace(f"`{source}`", f"`{destination}`")
    return text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    baseline = json.loads(Path(args.baseline).read_text())
    if baseline["git_sha"] != subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip():
        raise SystemExit("HEAD 与迁移基线不一致")
    files = baseline["files"]
    moves = plan(files)
    for source, destination in moves.items():
        if source not in files or sha(ROOT / source) != files[source]:
            raise SystemExit(f"源文件不符：{source}")
        if (ROOT / destination).exists():
            raise SystemExit(f"目标已存在：{destination}")
    pages = {p for p in files if p.startswith("src/pages/")}
    if pages != {p for p in moves if p.startswith("src/pages/")}:
        raise SystemExit("页面清单未完整覆盖")
    if len(set(moves.values())) != len(moves):
        raise SystemExit("目标路径冲突")
    markdown = {p: (ROOT / p).read_text() for p in files if p.endswith(".md")}
    print(json.dumps({"moves": len(moves), "pages": len(pages), "apply": args.apply}))
    if not args.apply:
        return
    # 整目录迁移也保留其中未跟踪/忽略的历史材料，不删除任何实物。
    for source, destination in DIRECTORIES.items():
        (ROOT / destination).parent.mkdir(parents=True, exist_ok=True)
        (ROOT / source).rename(ROOT / destination)
    for source, destination in moves.items():
        if any(source.startswith(directory + "/") for directory in DIRECTORIES):
            continue
        (ROOT / destination).parent.mkdir(parents=True, exist_ok=True)
        (ROOT / source).rename(ROOT / destination)
    links_changed = []
    for old, text in markdown.items():
        new = moves.get(old, old)
        updated = relocate_links(text, old, new, moves)
        if updated != text:
            (ROOT / new).write_text(updated)
            links_changed.append(new)
    for directory in ("src/pages", "docs", "docs/archive"):
        for path in sorted((ROOT / directory).rglob("*"), reverse=True):
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()
    destination = ROOT / "docs/development/directory-migration-20261030.json"
    destination.write_text(json.dumps({
        "schema_version": 1,
        "baseline_git_sha": baseline["git_sha"],
        "moves": {
            old: {"path": new, "before_sha256": files[old], "after_sha256": sha(ROOT / new)}
            for old, new in sorted(moves.items())
        },
        "relocated_markdown_links": sorted(links_changed),
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"迁移完成：{len(moves)} 文件；文档相对链接重算 {len(links_changed)} 文件")


if __name__ == "__main__":
    main()
