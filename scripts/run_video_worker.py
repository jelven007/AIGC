"""定时任务入口：标准库调用执行器，不输出密钥；一次运行后退出。"""
import concurrent.futures
import json
import os
import sys
import urllib.error
import urllib.request


def main():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("VIDEO_WORKER_SECRET", "")
    if not url.startswith("https://") or not secret:
        print("请配置 HTTPS SUPABASE_URL 和 VIDEO_WORKER_SECRET", file=sys.stderr)
        return 1
    concurrency = int(os.environ.get("VIDEO_WORKER_CONCURRENCY", "4"))
    if not 1 <= concurrency <= 8:
        print("VIDEO_WORKER_CONCURRENCY 应为 1–8", file=sys.stderr)
        return 1

    def run(_):
        request = urllib.request.Request(
            url + "/functions/v1/video-job-worker", method="POST", data=b"{}",
            headers={"Authorization": "Bearer " + secret, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=150) as response:
                return json.load(response).get("processed", 0), False
        except (urllib.error.URLError, TimeoutError):
            return 0, True

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        results = list(pool.map(run, range(concurrency)))
    errors = sum(error for _, error in results)
    print(json.dumps({"processed": sum(count for count, _ in results), "errors": errors}))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
