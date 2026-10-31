"""按宿主、媒体和MCP依赖运行全部Python回归，去重被其他模块导入的基类。"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
MEDIA = {
    "test_analysis_media", "test_batch_pipeline_media", "test_edit_media",
    "test_editor_audio", "test_render", "test_self_hosted_egress",
    "test_worker_egress", "test_worker_resources",
}
MCP = {"test_mcp_backend"}


def flatten(suite):
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from flatten(test)
        else:
            yield test


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", choices=("host", "media", "mcp"), required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--module")
    args = parser.parse_args()
    output = Path(args.output_dir)
    if not output.is_dir():
        raise RuntimeError("回执父目录必须已存在")
    if args.group == "host" and not args.module:
        for image in ("postgres:16", "shoproai-backup:local"):
            subprocess.run(["docker", "image", "inspect", image], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, check=True, timeout=15)
        modules = sorted(path.stem for path in (ROOT / "tests").glob("test_*.py")
                         if path.stem not in MEDIA | MCP)
        module_output = output / "host-modules"
        module_output.mkdir(mode=0o700, exist_ok=True)
        started = time.monotonic()

        def run_module(module):
            subprocess.run([sys.executable, str(Path(__file__).resolve()), "--group", "host",
                            "--module", module, "--output-dir", str(module_output)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
            report = json.loads((module_output / ("python-" + module + ".json")).read_text())
            print(json.dumps({"module": module, "passed": report["passed"], "tests": report["tests"]}),
                  flush=True)
            return report

        with ThreadPoolExecutor(max_workers=6) as executor:
            reports = list(executor.map(run_module, modules))
        summary = {"group": "host", "passed": all(value["passed"] for value in reports),
                   **{key: sum(value[key] for value in reports)
                      for key in ("tests", "failures", "errors", "skipped")},
                   "modules": len(reports), "seconds": round(time.monotonic() - started, 2),
                   "failure_details": [detail for value in reports for detail in value["failure_details"]]}
        report = output / "python-host.json"
        report.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        report.chmod(0o600)
        print(json.dumps(summary, ensure_ascii=False))
        raise SystemExit(0 if summary["passed"] else 1)
    loader, tests, seen = unittest.TestLoader(), [], set()
    for path in sorted((ROOT / "tests").glob("test_*.py")):
        group = "media" if path.stem in MEDIA else "mcp" if path.stem in MCP else "host"
        if group != args.group:
            continue
        if args.module and path.stem != args.module:
            continue
        for test in flatten(loader.discover(str(ROOT / "tests"), pattern=path.name)):
            if test.__class__.__module__ not in (path.stem, "unittest.loader"):
                continue
            if test.id() not in seen:
                seen.add(test.id())
                tests.append(test)
    started = time.monotonic()
    label = args.module or args.group
    log = output / ("python-" + label + ".log")
    with log.open("w") as stream:
        log.chmod(0o600)
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.TestSuite(tests))
    summary = {
        "group": args.group, "passed": result.wasSuccessful(), "tests": result.testsRun,
        "failures": len(result.failures), "errors": len(result.errors), "skipped": len(result.skipped),
        "seconds": round(time.monotonic() - started, 2),
        "failure_details": [{"test": test.id(), "traceback": trace}
                            for test, trace in [*result.failures, *result.errors]],
    }
    report = output / ("python-" + label + ".json")
    report.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    report.chmod(0o600)
    print(json.dumps(summary, ensure_ascii=False))
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
