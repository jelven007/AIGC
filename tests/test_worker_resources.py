"""实际Worker任务路径：重复素材、磁盘故障、停止与原租约恢复。"""
import hashlib
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/media-worker"))
import main as worker
from render import RenderError


class Reply:
    status_code = 200
    headers = {}

    def __init__(self, chunks):
        self.chunks = chunks

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_content(self, _):
        yield from self.chunks


class WorkerResourcesTest(unittest.TestCase):
    def test_same_signed_storage_object_downloaded_once_and_hashed(self):
        with tempfile.TemporaryDirectory() as folder:
            if not hasattr(worker, "TaskWorkspace"):
                self.fail("Worker缺少单任务下载缓存及空间预算")
            with patch.dict(os.environ, {"SUPABASE_URL": "https://db.example"}), patch.object(worker, "safe_url", lambda value: value), patch.object(worker.requests, "get", return_value=Reply([b"actual media"])) as get:
                workspace = worker.TaskWorkspace(Path(folder), worker.safe_url)
                first = workspace.fetch("https://db.example/storage/v1/object/sign/materials/a/video?token=one")
                second = workspace.fetch("https://db.example/storage/v1/object/sign/materials/a/video?token=two")
                self.assertEqual(first, second)
                self.assertEqual(get.call_count, 1)
                self.assertEqual(first.name, hashlib.sha256(b"actual media").hexdigest())
                self.assertEqual(workspace.input_bytes, len(b"actual media"))
                other = worker.TaskWorkspace(Path(folder) / "other-task", worker.safe_url)
                other.fetch("https://db.example/storage/v1/object/sign/materials/a/video?token=one")
                self.assertEqual(get.call_count, 2)

    def test_distinct_external_query_is_not_treated_as_same_object(self):
        with tempfile.TemporaryDirectory() as folder:
            if not hasattr(worker, "TaskWorkspace"):
                self.fail("Worker缺少单任务下载缓存")
            with patch.object(worker, "safe_url", lambda value: value), patch.object(worker.requests, "get", side_effect=[Reply([b"one"]), Reply([b"two"])]):
                workspace = worker.TaskWorkspace(Path(folder), worker.safe_url)
                self.assertNotEqual(workspace.fetch("https://media.example/video?id=1"),
                                    workspace.fetch("https://media.example/video?id=2"))

    def test_external_storage_shaped_path_preserves_query_and_distinct_content(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"SUPABASE_URL": "https://db.example"}):
            with patch.object(worker.requests, "get", side_effect=[Reply([b"one"]), Reply([b"two"])]) as get:
                workspace = worker.TaskWorkspace(Path(folder), lambda value: value)
                self.assertNotEqual(workspace.fetch("https://other.example/storage/v1/object/sign/materials/a/video?token=one"),
                                    workspace.fetch("https://other.example/storage/v1/object/sign/materials/a/video?token=two"))
                self.assertEqual(get.call_count, 2)

    def test_download_stops_before_network_when_cancelled(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(worker, "safe_url", lambda value: value), patch.object(worker.requests, "get", return_value=Reply([b"one"])) as get:
            with self.assertRaisesRegex(RenderError, "停止"):
                worker.download("https://media.example/video", Path(folder) / "input", cancelled=lambda: True)
            get.assert_not_called()

    def test_download_removes_partial_file_on_size_or_space_failure(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(worker, "safe_url", lambda value: value), patch.object(worker.requests, "get", return_value=Reply([b"123", b"456"])):
            target = Path(folder) / "input"
            with self.assertRaises(RenderError):
                worker.download("https://media.example/video", target, max_bytes=5)
            self.assertFalse(target.exists(), "超量下载不能留下未核验素材")
            if not hasattr(worker, "TaskWorkspace"):
                self.fail("Worker缺少输入/输出预留空间")
            from task_workspace import disk_usage
            with patch("task_workspace.disk_usage", return_value=disk_usage(folder)._replace(free=1)):
                with self.assertRaisesRegex(RenderError, "空间"):
                    worker.TaskWorkspace(Path(folder), worker.safe_url).fetch("https://media.example/video")
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_workspace_reserves_outputs_masks_and_counts_unique_inodes(self):
        with tempfile.TemporaryDirectory() as folder:
            if not hasattr(worker, "TaskWorkspace"):
                self.fail("Worker缺少完整任务预算")
            workspace = worker.TaskWorkspace(Path(folder), lambda value: value, output_reserve=7, mask_reserve=5,
                                             max_bytes=32, minimum_free=1)
            (Path(folder) / "source").write_bytes(b"x" * 10)
            os.link(Path(folder) / "source", Path(folder) / "alias")
            workspace.check(reserve=True)
            (Path(folder) / "mask").write_bytes(b"x" * 12)
            with self.assertRaisesRegex(RenderError, "预算"):
                workspace.check(reserve=True)
            workspace.check()
            (Path(folder) / "output").write_bytes(b"x" * 11)
            with self.assertRaisesRegex(RenderError, "预算"):
                workspace.check()

    def test_masks_are_stopped_at_combined_limit_during_encoding(self):
        with tempfile.TemporaryDirectory() as folder:
            workspace = worker.TaskWorkspace(Path(folder), lambda value: value, output_reserve=0, minimum_free=0)
            for index in range(2):
                with (Path(folder) / f"person-{index}.mkv").open("wb") as file:
                    file.truncate(400 * 1024 * 1024)
            with self.assertRaisesRegex(RenderError, "蒙版"):
                workspace.check()

    def test_shutdown_after_upload_never_reports_known_failure_or_changes_lease(self):
        if not hasattr(worker, "process_job"):
            self.fail("Worker任务执行和未知结案尚未分离")
        stop, events = threading.Event(), []
        job = {"id": "original-job", "lease_token": "original-lease", "kind": "render",
               "payload": {"tracks": []}}
        reply = {"job": job, "outputs": [{"name": "output.mp4", "url": "https://db.example/output", "type": "video/mp4"}]}
        with tempfile.TemporaryDirectory() as folder:
            def rendered(_spec, _files, directory, *_args, **_kwargs):
                output = directory / "output.mp4"; output.write_bytes(b"result")
                thumbnail = directory / "thumbnail.jpg"; thumbnail.write_bytes(b"picture")
                return {"file": output, "thumbnail": thumbnail, "size": 6, "duration": 1, "resolution": "1280x720"}

            def uploaded(*_args, **_kwargs):
                stop.set()
                raise worker.requests.Timeout("signed-secret-url")

            def api(body):
                events.append(body)
                return {"ok": True}

            with patch.object(worker, "render", rendered), patch.object(worker, "safe_url", lambda value: value), patch.object(worker.requests, "put", uploaded):
                with self.assertRaises(RenderError) as error:
                    worker.process_job(reply, api, stop, Path(folder))
                worker.report_job_error(api, job, error.exception)
            self.assertEqual([event["action"] for event in events], ["retry"])
            self.assertEqual(events[0]["job_id"], job["id"])
            self.assertEqual(events[0]["lease_token"], job["lease_token"])
            self.assertNotIn("secret", events[0]["data"]["error"])
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_health_rejects_stopped_stale_and_reports_active_job_without_secrets(self):
        if not hasattr(worker, "WorkerHealth"):
            self.fail("Worker缺少持续健康状态")
        with tempfile.TemporaryDirectory() as folder:
            health = worker.WorkerHealth(Path(folder) / "state.json")
            health.write("idle")
            self.assertTrue(health.healthy())
            health.write("active", job={"id": "job", "lease_token": "token-not-for-health"})
            self.assertNotIn("token", health.path.read_text())
            with patch("health.time.time", return_value=time.time() + 100):
                self.assertFalse(health.healthy())
            health.write("stopped")
            self.assertFalse(health.healthy())

    def test_media_subprocess_is_killed_when_workspace_budget_is_exceeded(self):
        from edit_analysis import run_media
        with tempfile.TemporaryDirectory() as folder:
            if not hasattr(worker, "TaskWorkspace"):
                self.fail("Worker缺少执行期预算")
            workspace = worker.TaskWorkspace(Path(folder), lambda value: value, output_reserve=0,
                                             max_bytes=8, minimum_free=0)
            pid = Path(folder) / "pid"
            command = [sys.executable, "-c",
                       "import os,time,pathlib; pathlib.Path('pid').write_text(str(os.getpid())); pathlib.Path('out').write_bytes(b'x'*32); time.sleep(30)"]
            old = os.getcwd()
            try:
                os.chdir(folder)
                with self.assertRaisesRegex(RenderError, "预算"):
                    run_media(command, lambda: False, budget=workspace)
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(pid.read_text()), 0)
            finally:
                os.chdir(old)

    def test_stalled_mask_encoder_can_be_cancelled_without_blocking(self):
        import person_mask
        if not hasattr(person_mask, "write_frame"):
            self.fail("人物蒙版编码器写入没有取消/空间检查")
        read_fd, write_fd = os.pipe()
        self.addCleanup(lambda: os.close(read_fd))
        self.addCleanup(lambda: os.close(write_fd))
        started = time.monotonic()
        with self.assertRaisesRegex(RenderError, "停止"):
            person_mask.write_frame(write_fd, b"x" * (4 * 1024 * 1024),
                                    lambda: time.monotonic() - started > .2, lambda: None, 2)
        self.assertLess(time.monotonic() - started, 2)

    def test_restart_cleans_only_orphans_and_refuses_another_worker(self):
        if not hasattr(worker, "exclusive_workspace"):
            self.fail("Worker重启没有隔离锁与残留清理")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            orphan = root / "shopro-render-old"; orphan.mkdir()
            (orphan / "input").write_bytes(b"private input")
            (root / "unrelated").write_bytes(b"keep")
            with worker.exclusive_workspace(root):
                self.assertFalse(orphan.exists())
                self.assertEqual((root / "unrelated").read_bytes(), b"keep")
                active = root / "shopro-render-active"; active.mkdir()
                with self.assertRaisesRegex(RenderError, "占用"):
                    with worker.exclusive_workspace(root):
                        pass
                self.assertTrue(active.exists(), "另一Worker不能清理活跃任务")

    def test_replicas_share_volume_without_lock_conflict_or_deleting_live_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            with worker.exclusive_replica_workspace(folder, "container-one") as first:
                active = first / "shopro-render-active"; active.mkdir()
                (active / "input").write_bytes(b"tenant-one")
                with worker.exclusive_replica_workspace(folder, "container-two") as second:
                    self.assertNotEqual(first, second)
                    self.assertEqual((active / "input").read_bytes(), b"tenant-one")
                    with self.assertRaisesRegex(RenderError, "占用"):
                        with worker.exclusive_replica_workspace(folder, "container-one"):
                            pass
                orphan = second / "shopro-render-crashed"; orphan.mkdir()
                (orphan / "input").write_bytes(b"private orphan")
                with worker.exclusive_replica_workspace(folder, "../../replacement") as replacement:
                    self.assertTrue(replacement.is_relative_to(Path(folder)))
                    self.assertFalse(orphan.exists(), "重建容器须回收退出副本的残留素材")
                    self.assertTrue(active.exists(), "回收不能删除另一个副本的活跃任务")

    def test_real_sigterm_returns_original_lease_to_retry_and_cleans_task(self):
        if not hasattr(worker, "exclusive_workspace"):
            self.fail("Worker缺少可验证的退出/重启生命周期")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "secret").write_text("s" * 40)
            code = """
import json,os,sys,time
import main as worker
worker.safe_url = lambda value: value
class Response:
    status_code = 200
    def __init__(self, body): self.body = body
    def json(self): return self.body
def api(_url, json, **kwargs):
    if json['action'] == 'claim':
        return Response({'job': {'id': 'original', 'lease_token': 'lease', 'kind': 'render', 'payload': {'tracks': []}}, 'outputs': []})
    print('EVENT '+__import__('json').dumps(json), flush=True)
    return Response({'ok': True})
def render(_spec,_files,directory,*args,**kwargs):
    (directory/'partial').write_bytes(b'private')
    print('READY', flush=True)
    while not kwargs['cancelled'](): time.sleep(.01)
    raise worker.RenderError('任务已停止')
worker.requests.post = api
class Client:
    post = staticmethod(api)
    get = staticmethod(worker.requests.get)
    put = staticmethod(worker.requests.put)
    def validate_upload(self, value): return value
    def close(self): pass
worker.EgressClient = lambda *_: Client()
worker.render = render
sys.exit(worker.main())
"""
            process = subprocess.Popen([sys.executable, "-u", "-c", code],
                cwd=Path(worker.__file__).parent, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                env={**os.environ, "SUPABASE_URL": "https://db.example", "RENDER_WORKER_SECRET_FILE": str(root / "secret"),
                     "RENDER_WORKSPACE_DIR": str(root / "work"), "RENDER_HEALTH_FILE": str(root / "health.json")})
            try:
                ready = process.stdout.readline().strip()
                if ready != "READY":
                    stdout, stderr = process.communicate(timeout=10)
                    self.fail(f"Worker未启动：{ready} {stdout} {stderr}")
                process.send_signal(signal.SIGTERM)
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0, stderr)
                self.assertIn('"action": "retry"', stdout)
                self.assertIn('"job_id": "original"', stdout)
                self.assertIn('"lease_token": "lease"', stdout)
                self.assertNotIn('"action": "failed"', stdout)
                self.assertEqual(list((root / "work").glob("shopro-render-*")), [])
                self.assertFalse(worker.WorkerHealth(root / "health.json").healthy())
            finally:
                if process.poll() is None:
                    process.kill(); process.wait()

    def test_upload_stream_checks_stop_between_chunks(self):
        stop = threading.Event()
        chunks = []
        job = {"id": "original", "lease_token": "lease", "kind": "render", "payload": {"tracks": []}}
        reply = {"job": job, "outputs": [{"name": "output.mp4", "url": "https://db.example/output", "type": "video/mp4"}]}
        with tempfile.TemporaryDirectory() as folder:
            def rendered(_spec, _files, directory, *_args, **_kwargs):
                output = directory / "output.mp4"; output.write_bytes(b"result")
                return {"file": output, "thumbnail": output, "size": 6, "duration": 1, "resolution": "1280x720"}
            def uploaded(_url, data, **_kwargs):
                chunks.append(data.read(3))
                stop.set()
                chunks.append(data.read(3))
                raise worker.requests.Timeout()
            with patch.object(worker, "render", rendered), patch.object(worker, "safe_url", lambda value: value), patch.object(worker.requests, "put", uploaded):
                with self.assertRaises(RenderError):
                    worker.process_job(reply, lambda _: {"ok": True}, stop, Path(folder))
            self.assertEqual(chunks, [b"res"], "停止后不能继续读取下一个上传块")


if __name__ == "__main__":
    unittest.main(verbosity=2)
