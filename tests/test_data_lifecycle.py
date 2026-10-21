"""真实 PostgreSQL：媒体引用/TTL、清理租约、声纹撤销、知识副本与退款竞争。"""
import concurrent.futures
import json
import unittest
import uuid
from urllib.parse import quote
import test_finance as finance
import test_media_jobs as media

sql = finance.sql


class DataLifecycleTest(media.MediaJobsTest):
    def setUp(self):
        super().setUp()
        sql("UPDATE voice_deletions SET next_run_at=now()+interval '1 day' WHERE completed_at IS NULL")

    def object(self, name, old=True):
        path = f"{self.user}/{name}"
        age = "now()-interval '2 days'" if old else "now()"
        sql(f"""INSERT INTO storage.objects(bucket_id,name,created_at,updated_at)
          VALUES('materials','{path}',{age},{age})""")
        return path, f"https://db.example/storage/v1/object/authenticated/materials/{quote(path)}"

    def queue(self, path):
        sql(self.as_service("SELECT enqueue_expired_media()"))
        return sql(f"SELECT id FROM media_deletions WHERE path='{path}'").stdout.strip()

    def test_orphans_expire_but_saved_nested_and_unknown_references_survive(self):
        orphan, _ = self.object("media-inputs/orphan.wav")
        recent, _ = self.object("imports/recent.png", old=False)
        saved, url = self.object("products/中文 图.png")
        sql(f"""INSERT INTO products(user_id,name,category,images) VALUES('{self.user}','真实商品','测试',ARRAY['{url}'])""")
        active, active_url = self.object("analysis/frame-0.jpg")
        job = json.loads(sql(self.statement("asr", {"audio_url": active_url, "filename": "voice.wav"})).stdout)
        sql(f"UPDATE production_jobs SET status='unknown',evidence='{{\"frame\":\"{active_url}\"}}' WHERE id='{job['id']}'")
        self.assertTrue(self.queue(orphan))
        for path in (recent, saved, active):
            self.assertFalse(sql(f"SELECT id FROM media_deletions WHERE path='{path}'").stdout.strip())
        sql(f"UPDATE production_jobs SET status='failed',completed_at=now() WHERE id='{job['id']}'")
        self.assertTrue(self.queue(active))
        self.assertEqual(sql(f"SELECT count(*) FROM media_references WHERE path='{saved}'").stdout.strip(), "1")

    def test_deletion_tombstone_blocks_new_references_and_uploads(self):
        path, url = self.object("imports/expired.png")
        self.queue(path)
        self.assertNotEqual(sql(f"INSERT INTO materials(user_id,name,type,url) VALUES('{self.user}','旧图','image','{url}')", fail=False).returncode, 0)
        self.assertNotEqual(sql(f"UPDATE storage.objects SET updated_at=now() WHERE name='{path}'", fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM media_references WHERE path='{path}'").stdout.strip(), "0")
        sql("GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,DELETE ON storage.objects TO authenticated; ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY")
        sql(self.as_user(f"DELETE FROM storage.objects WHERE name='{path}'"))
        self.assertEqual(sql(f"SELECT count(*) FROM storage.objects WHERE name='{path}'").stdout.strip(), "1")

    def test_cleanup_lease_rejects_late_success_and_failure(self):
        path, _ = self.object("imports/lease.png")
        queued = self.queue(path)
        def claim():
            return json.loads(sql(self.as_service("SELECT claim_media_deletions()")).stdout)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            claims = [item for group in pool.map(lambda _: claim(), range(4)) for item in group if item["id"] == queued]
        self.assertEqual(len(claims), 1)
        old = claims[0]["lease_token"]
        sql(f"UPDATE media_deletions SET lease_until=now()-interval '1 second',next_run_at=now() WHERE id='{queued}'")
        new = next(item for item in claim() if item["id"] == queued)["lease_token"]
        for success in ("true", "false"):
            self.assertEqual(sql(self.as_service(f"SELECT finish_media_deletion('{queued}','{old}',{success})")).stdout.strip(), "f")
        self.assertEqual(sql(self.as_service(f"SELECT finish_media_deletion('{queued}','{new}',true)")).stdout.strip(), "t")

    def clone(self):
        job = self.production_claim(json.loads(sql(self.statement("voice_clone", {
            "name": "自有声音", "audio_url": "https://audio.example/sample.wav", "filename": "sample.wav", "consent": True})).stdout))
        result = json.loads(sql(self.production_event(job, "completed", {"voice_id": "private-provider-id", "requires_verification": False})).stdout)
        return result["result"]["voice_clone_id"]

    def revoke(self, clone, key=None):
        return self.as_service(f"SELECT revoke_voice_clone('{self.user}','{clone}','{key or uuid.uuid4()}')")

    def test_revoke_cancels_unsent_once_and_blocks_future_charge(self):
        clone = self.clone()
        payload = {**self.payload, "voice_clone_id": clone}
        statement = self.statement(payload=payload, version=self.versions["audio.voice_clone"])
        job = json.loads(sql(statement).stdout)
        revoke = self.revoke(clone)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: sql(revoke), range(4)))
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "cancelled")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{job['charge_id']}'").stdout.strip(), "1")
        self.assertEqual(json.loads(sql(statement).stdout)["id"], job["id"])
        self.assertNotEqual(sql(self.statement(payload=payload, version=self.versions["audio.voice_clone"]), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")
        self.assertNotEqual(sql(self.as_user(f"SELECT revoke_voice_clone('{self.user}','{clone}','{uuid.uuid4()}')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_service(f"SELECT revoke_voice_clone('{self.other}','{clone}','{uuid.uuid4()}')"), fail=False).returncode, 0)
        repeated_key = str(uuid.uuid4())
        sql(self.revoke(clone, repeated_key))
        other_clone = self.clone()
        self.assertNotEqual(sql(self.revoke(other_clone, repeated_key), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT revoked_at IS NULL FROM voice_clones WHERE id='{other_clone}'").stdout.strip(), "t")

    def test_unknown_voice_submission_delays_provider_delete_until_reconciled(self):
        clone = self.clone()
        job = self.production_claim(json.loads(sql(self.statement(payload={**self.payload, "voice_clone_id": clone},
            version=self.versions["audio.voice_clone"])).stdout))
        sql(self.production_event(job, "executing"))
        sql(self.production_event(job, "unknown", {"error": "原受理结果未知"}))
        sql(self.revoke(clone))
        claims = json.loads(sql(self.as_service("SELECT claim_voice_deletions()")).stdout)
        self.assertFalse(any(item["clone_id"] == clone for item in claims))
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "12")
        sql(self.as_service(f"SELECT reconcile_production_job('{job['id']}',NULL,'原供应商账单确认没有受理本次任务')"))
        recovered = self.production_claim(job)
        sql(self.production_event(recovered, "failed", recovered["resolution"]["data"]))
        item = next(item for item in json.loads(sql(self.as_service("SELECT claim_voice_deletions()")).stdout) if item["clone_id"] == clone)
        self.assertEqual(sql(self.as_service(f"SELECT finish_voice_deletion('{item['id']}','{item['lease_token']}',true)")).stdout.strip(), "t")
        self.assertEqual(sql(f"SELECT provider_voice_id,provider_deleted_at IS NOT NULL FROM voice_clones WHERE id='{clone}'").stdout.strip(), "|t")

    def knowledge(self):
        current = sql("SELECT current_version_id FROM model_configs WHERE slot='embedding.primary'").stdout.strip()
        version = sql(self.as_service(f"""SELECT save_model_config('embedding.primary',
          {"'"+current+"'" if current else "NULL"},'{{"model":"test"}}',true,'isolated','{self.other}',true)""")).stdout.strip()
        entry = sql(self.as_user("""INSERT INTO knowledge_entries(user_id,title,content,source_type)
          VALUES(auth.uid(),'需删除资料','{"text":"私有知识全文"}','prompt_edit') RETURNING id""")).stdout.strip()
        content_hash = sql(f"SELECT content_hash FROM knowledge_entries WHERE id='{entry}'").stdout.strip()
        return entry, version, content_hash

    def knowledge_job(self, entry, version, content_hash):
        return json.loads(sql(self.as_service(f"""SELECT create_knowledge_job('{self.user}','{uuid.uuid4()}','knowledge_index',
          '{{"entry_id":"{entry}","content_hash":"{content_hash}","confirmed_credit_cost":2}}','{version}')""")).stdout)

    def erase(self, entry):
        return sql(self.as_service(f"SELECT delete_knowledge_entry('{self.user}','{entry}')"))

    def test_knowledge_delete_scrubs_saved_and_late_query_sources(self):
        entry, version, content_hash = self.knowledge()
        job = self.production_claim(self.knowledge_job(entry, version, content_hash))
        sql(self.production_event(job, "checkpoint", {"texts": ["私有知识全文"], "vectors": [[1, 0]]}))
        sql(self.production_event(job, "completed", {"version_id": version, "chunks": [{"content": "私有知识全文", "embedding": [1, 0]}]}))
        query = json.loads(sql(self.as_service(f"""SELECT create_knowledge_job('{self.user}','{uuid.uuid4()}','knowledge_search',
          '{{"query":"查询","limit":5,"confirmed_credit_cost":1}}','{version}')""")).stdout)
        query = self.production_claim(query)
        source = {"entry_id": entry, "content_hash": content_hash, "title": "需删除资料", "content": "私有知识全文", "similarity": 1, "version_id": version}
        data = {"version_id": version, "query": "查询", "results": [source]}
        sql(self.production_event(query, "resolution", {"event": "completed", "data": data}))
        self.erase(entry)
        self.erase(entry)
        # 已在内存取得的旧结果也不能再次写入已删除正文。
        sql(self.production_event(query, "completed", data))
        self.assertNotIn("私有知识全文", sql(f"SELECT payload,evidence,resolution,result FROM production_jobs WHERE id IN ('{job['id']}','{query['id']}')").stdout)
        self.assertEqual(sql(f"SELECT count(*) FROM knowledge_chunks WHERE entry_id='{entry}'").stdout.strip(), "0")
        self.assertEqual(json.loads(sql(f"SELECT result->'results' FROM production_jobs WHERE id='{query['id']}'").stdout), [])
        self.assertNotEqual(sql(self.as_user(f"DELETE FROM knowledge_entries WHERE id='{entry}'"), fail=False).returncode, 0)

    def test_knowledge_erase_refunds_unsent_but_retains_unknown_original_charge(self):
        entry, version, content_hash = self.knowledge()
        first = self.knowledge_job(entry, version, content_hash)
        self.erase(entry)
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{first['id']}'").stdout.strip(), "cancelled")
        entry, version, content_hash = self.knowledge()
        second = self.production_claim(self.knowledge_job(entry, version, content_hash))
        sql(self.production_event(second, "executing"))
        self.erase(entry)
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{second['id']}'").stdout.strip(), "unknown")
        self.assertNotIn("私有知识全文", sql(f"SELECT payload,evidence,resolution FROM production_jobs WHERE id='{second['id']}'").stdout)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "2")
        self.assertNotEqual(sql(self.production_event(second, "checkpoint", {"texts": ["私有知识全文"], "vectors": [[1, 0]]}), fail=False).returncode, 0)

    def test_terminal_evidence_expires_without_touching_unknown_or_outputs(self):
        completed = self.production_claim(json.loads(sql(self.statement()).stdout))
        sql(self.production_event(completed, "checkpoint", {"audio_b64": "SUQzYXVkaW8=", "type": "audio/mpeg"}))
        _, url = self.object("media-jobs/output.mp3")
        sql(self.production_event(completed, "completed", {"url": url, "size": 100}))
        active = self.production_claim(json.loads(sql(self.statement()).stdout))
        sql(self.production_event(active, "checkpoint", {"audio_b64": "SUQz", "type": "audio/mpeg"}))
        sql(self.production_event(active, "unknown", {"error": "归档待核对"}))
        sql(f"UPDATE production_jobs SET completed_at=now()-interval '8 days' WHERE id IN ('{completed['id']}','{active['id']}')")
        sql(self.as_service("SELECT prune_job_evidence()"))
        self.assertEqual(sql(f"SELECT evidence IS NULL,resolution IS NULL FROM production_jobs WHERE id='{completed['id']}'").stdout.strip(), "t|t")
        self.assertEqual(sql(f"SELECT evidence IS NOT NULL FROM production_jobs WHERE id='{active['id']}'").stdout.strip(), "t")
        self.assertEqual(sql(f"SELECT count(*) FROM materials WHERE url='{url}'").stdout.strip(), "1")

    def test_deleted_output_retires_download_without_losing_charge_receipt(self):
        job = self.production_claim(json.loads(sql(self.statement()).stdout))
        path, url = self.object("media-jobs/deleted.mp3")
        sql(self.production_event(job, "completed", {"url": url, "size": 100}))
        material = sql(f"SELECT id FROM materials WHERE url='{url}'").stdout.strip()
        sql(self.as_service(f"SELECT delete_owned_material('{self.user}','{material}','materials','{path}')"))
        self.assertEqual(json.loads(sql(f"SELECT result FROM production_jobs WHERE id='{job['id']}'").stdout), {"media_deleted": True})
        self.assertEqual(sql(f"SELECT status,credit_cost FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "completed|2")

    def test_concurrent_reference_save_and_ttl_never_leave_deleted_live_asset(self):
        for index in range(3):
            path, url = self.object(f"imports/race-{index}.png")
            save = f"INSERT INTO materials(user_id,name,type,url) VALUES('{self.user}','并发图','image','{url}')"
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                saved = pool.submit(sql, save, False)
                pruned = pool.submit(sql, self.as_service("SELECT enqueue_expired_media()"))
                saved.result(); pruned.result()
            self.assertNotEqual(sql(f"""SELECT EXISTS(SELECT 1 FROM media_references WHERE path='{path}')
              AND EXISTS(SELECT 1 FROM media_deletions WHERE path='{path}')""").stdout.strip(), "t")


if __name__ == "__main__":
    unittest.main(verbosity=2)
