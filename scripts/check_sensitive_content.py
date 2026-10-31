"""Fail public-source gates on private literals; redact readable operator reports."""
import argparse
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", ".local", "node_modules", ".vite_cache", ".venv", ".screenshots",
        "node-v24.14.0-darwin-arm64", "deno-runtime", "byted-native", "package",
        "model-assets", "__pycache__", ".volcengine-build", ".supabase-build", "dist"}
READABLE = {".md", ".html", ".json", ".txt", ".csv", ".log", ".yaml", ".yml", ".xml", ".svg"}
SOURCE = {".py", ".ts", ".tsx", ".js", ".mjs", ".sh"}


def readable_files(root):
    for parent, directories, names in os.walk(root):
        directories[:] = [name for name in directories if name not in SKIP]
        for name in names:
            path = Path(parent) / name
            if path.is_symlink() or path.stat().st_size > 10_000_000:
                continue
            if path.suffix in READABLE | SOURCE:
                yield path


def private_literals(identity):
    # Default values come only from the operator's private input, never this code.
    values = [identity["email"], identity["password"]]
    return values


def violations(text, values):
    result = [name for name, value in enumerate(values) if value and value in text]
    if re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", text):
        result.append("private-key")
    if re.search(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}", text):
        result.append("jwt")
    return result


def redact_report(text, identity, extra=()):
    for value in (*private_literals(identity), *extra):
        if value:
            text = text.replace(value, "[已脱敏]")
    text = re.sub(r"(?<![\w./-])" + re.escape(identity["username"]) + r"(?![\w./-])", "[管理员账号]", text,
                  flags=re.IGNORECASE)
    text = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
                  "[记录标识已脱敏]", text, flags=re.IGNORECASE)
    text = re.sub(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}",
                  "[凭据已脱敏]", text)
    return text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-config")
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--redact-documents", action="store_true")
    parser.add_argument("--extra-private", action="append", default=[])
    args = parser.parse_args()
    identity = None
    if args.private_config:
        from initial_admin import read_initial_admin
        identity = read_initial_admin(args.private_config)
    root = Path(args.root).resolve()
    values = private_literals(identity) if identity else []
    matches, changed, count = [], 0, 0
    for path in readable_files(root):
        count += 1
        text = path.read_text(errors="replace")
        if args.redact_documents and identity:
            # Only reports/docs; executable configuration and source are handled explicitly.
            if path.suffix == ".md" or (path.parent == root and path.suffix in READABLE):
                safe = redact_report(text, identity, args.extra_private)
                safe = safe.replace("https://[已脱敏]", "https://ecs.example.com")
                # Infrastructure examples remain usable without real machine addresses.
                safe = safe.replace("192.168.0.57", "${ECS_PRIVATE_IP}")
                if safe != text:
                    path.write_text(safe)
                    changed += 1
                    text = safe
        found = violations(text, values)
        if found:
            matches.append({"path": str(path.relative_to(root)), "kinds": found})
    print(json.dumps({"passed": not matches, "files": count,
                      "redacted_documents": changed, "findings": matches}, ensure_ascii=False))
    raise SystemExit(bool(matches))


if __name__ == "__main__":
    main()
