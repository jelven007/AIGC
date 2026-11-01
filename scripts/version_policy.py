"""Compute and validate the repository's decimal three-part version sequence."""
import argparse
import json
from pathlib import Path
import re


def next_version(version):
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.[0-9]\.[0-9]", version):
        raise ValueError("版本须为无前缀的三段数字；第2、第3段范围为0至9")
    major, minor, patch = map(int, version.split("."))
    patch += 1
    if patch == 10:
        patch = 0
        minor += 1
    if minor == 10:
        minor = 0
        major += 1
    return f"{major}.{minor}.{patch}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("next", "check"))
    parser.add_argument("--previous")
    parser.add_argument("--current")
    args = parser.parse_args()
    current = args.current or json.loads(
        (Path(__file__).resolve().parents[1] / "package.json").read_text())["version"]
    try:
        if args.action == "next":
            print(next_version(current))
        else:
            if not args.previous:
                raise ValueError("校验递增须提供--previous")
            expected = next_version(args.previous)
            if current != expected:
                raise ValueError(f"下一版本必须为{expected}，实际为{current}")
            print(json.dumps({"passed": True, "previous": args.previous, "current": current}))
    except ValueError as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
