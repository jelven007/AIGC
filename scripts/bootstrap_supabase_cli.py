"""安装固定官方Supabase CLI；镜像包需通过预先固定的SHA-512校验。"""
import base64
import hashlib
import io
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = "2.122.0"
INTEGRITY = "EsEGKIySkCXJZrywL4Q+wELyhD3NHVrpWXIVDtF3GdymTsjtV8FWPpzy2olzAOZlBrT4CmfNChFNtldnVKDtZg=="
URL = f"https://registry.npmmirror.com/@supabase/cli-darwin-arm64/-/cli-darwin-arm64-{VERSION}.tgz"
DIRECTORY = ROOT / ".supabase-tools" / VERSION


def main():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError(f"此引导器固定macOS arm64；其他平台请安装官方supabase@{VERSION}")
    executable = DIRECTORY / "supabase"
    if not executable.exists():
        with urllib.request.urlopen(URL, timeout=60) as response:
            raw = response.read(80 * 1024 * 1024 + 1)
        if len(raw) > 80 * 1024 * 1024 or base64.b64encode(hashlib.sha512(raw).digest()).decode() != INTEGRITY:
            raise RuntimeError("官方CLI包摘要不匹配")
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
            files = {Path(m.name).name: m for m in archive.getmembers()
                     if m.isfile() and Path(m.name).name in ("supabase", "supabase-go")}
            if set(files) != {"supabase", "supabase-go"}:
                raise RuntimeError("官方CLI包结构不匹配")
            DIRECTORY.mkdir(parents=True, exist_ok=True)
            for name in ("supabase-go", "supabase"):
                target = DIRECTORY / name
                target.write_bytes(archive.extractfile(files[name]).read())
                target.chmod(0o700)
    result = subprocess.run([str(executable), "--version"], capture_output=True, text=True, timeout=20, check=True)
    if result.stdout.strip() != VERSION:
        raise RuntimeError("官方CLI版本不匹配")
    print(f"官方Supabase CLI {VERSION}：{executable}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, RuntimeError) else f"官方CLI安装/启动失败：{type(error).__name__}")
        raise SystemExit(1)
