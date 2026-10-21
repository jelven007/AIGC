"""真实PostgreSQL知识检索、正文失效、租约与资金验证。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance
sql = finance.sql


class KnowledgeTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        current = sql("SELECT current_version_id FROM model_configs WHERE slot='embedding.primary'").stdout.strip()
        self.version = sql(self.as_service(f"""SELECT save_model_config('embedding.primary',
          {"'"+current+"'" if current else "NULL"},'{{"model":"test-embedding"}}',true,'isolated','{self.other}',true)""")).stdout.strip()
        self.entry = sql(self.as_user("""INSERT INTO knowledge_entries(user_id,title,content,source_type)
          VALUES(auth.uid(),'真实温和洁面话术','{"text":"只依据实验材料描述温和洁面"}','prompt_edit') RETURNING id""")).stdout.strip()
        self.content_hash = sql(f"SELECT content_hash FROM knowledge_entries WHERE id='{self.entry}'").stdout.strip()
        self.input = {"entry_id": self.entry, "content_hash": self.content_hash, "confirmed_credit_cost": 2}

    def create(self, kind="knowledge_index", request=None, key=None, version=None, fail=True):
        body = json.dumps(request or self.input).replace("'", "''")
        return sql(self.as_service(f"""SELECT create_knowledge_job('{self.user}','{key or uuid.uuid4()}',
          '{kind}','{body}','{version or self.version}')"""), fail)

    def claim(self, job, kind="knowledge_index"):
        value = sql(self.as_service(f"SELECT claim_production_job('{kind}','{job}')")).stdout.strip()
        return json.loads(value) if value else None

    def finish_index(self, job, lease, vector=None, fail=True):
        body = json.dumps({"version_id": self.version, "chunks": [
            {"content": "只依据实验材料描述温和洁面", "embedding": vector or [1, 0, 0]}]}).replace("'", "''")
        return sql(self.as_service(f"SELECT update_production_job('{job}','{lease}','completed','{body}')"), fail)

    def indexed(self):
        job = json.loads(self.create().stdout)["id"]
        claimed = self.claim(job)
        self.finish_index(job, claimed["lease_token"])
        return job

    def test_owner_and_vector_writes_are_restricted(self):
        for command in ("SELECT * FROM knowledge_chunks", f"UPDATE knowledge_entries SET content_hash='forged' WHERE id='{self.entry}'",
                        f"UPDATE knowledge_entries SET is_applied=true WHERE id='{self.entry}'",
                        f"SELECT search_knowledge_vectors('{self.other}','{self.version}',ARRAY[1.,0.,0.],5)"):
            self.assertNotEqual(sql(self.as_user(command), fail=False).returncode, 0)
        forged = {**self.input, "entry_id": str(uuid.uuid4())}
        self.assertNotEqual(self.create(request=forged, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_same_request_serializes_one_charge_and_conflict_rejects(self):
        key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            jobs = [json.loads(result.stdout) for result in pool.map(lambda _: self.create(key=key), range(5))]
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "2")
        self.assertNotEqual(self.create(key=key, request={**self.input, "confirmed_credit_cost": 3}, fail=False).returncode, 0)
        self.assertNotEqual(self.create(fail=False).returncode, 0)  # 同文档活跃任务
        sql("UPDATE model_configs SET enabled=false WHERE slot='embedding.primary'")
        self.assertEqual(json.loads(self.create(key=key).stdout)["id"], jobs[0]["id"])

    def test_real_cosine_search_version_owner_and_edit_invalidation(self):
        self.indexed()
        query = lambda user, version=self.version: json.loads(sql(self.as_service(
            f"SELECT search_knowledge_vectors('{user}','{version}',ARRAY[1.,0.,0.],5)")).stdout)
        hits = query(self.user)
        self.assertEqual(hits[0]["entry_id"], self.entry)
        self.assertAlmostEqual(hits[0]["similarity"], 1)
        self.assertEqual(query(self.other), [])
        self.assertEqual(query(self.user, str(uuid.uuid4())), [])
        sql(self.as_user(f"""UPDATE knowledge_entries SET content='{{"text":"新正文"}}' WHERE id='{self.entry}'"""))
        self.assertEqual(query(self.user), [])
        catalog = json.loads(sql(self.as_service(f"SELECT read_knowledge_catalog('{self.user}')")).stdout)
        self.assertFalse(catalog[0]["indexed"])

    def test_stale_completion_and_invalid_vector_roll_back(self):
        job = json.loads(self.create().stdout)["id"]
        claimed = self.claim(job)
        for vector in ([0, 0, 0], [None, 1, 0], [1000000, 1, 0]):
            self.assertNotEqual(self.finish_index(job, claimed["lease_token"], vector, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM knowledge_chunks WHERE entry_id='{self.entry}'").stdout.strip(), "0")
        sql(self.as_user(f"""UPDATE knowledge_entries SET title='修改后的标题' WHERE id='{self.entry}'"""))
        self.assertNotEqual(self.finish_index(job, claimed["lease_token"], fail=False).returncode, 0)
        sql(self.as_service(f"""SELECT update_production_job('{job}','{claimed["lease_token"]}','failed','{{"error":"正文已更新"}}')"""))
        sql(self.as_service(f"""SELECT update_production_job('{job}','{claimed["lease_token"]}','failed','{{"error":"重复回执"}}')"""))
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id IS NOT NULL AND user_id='{self.user}'").stdout.strip(), "1")

    def test_expired_executing_lease_stops_paid_replay(self):
        job = json.loads(self.create().stdout)["id"]
        claimed = self.claim(job)
        sql(self.as_service(f"""SELECT update_production_job('{job}','{claimed["lease_token"]}','executing')"""))
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{job}'")
        self.assertIsNone(self.claim(job))
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job}'").stdout.strip(), "unknown")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "2")

    def test_price_and_queue_rejections_do_not_charge(self):
        self.assertNotEqual(self.create(request={**self.input, "confirmed_credit_cost": 0}, fail=False).returncode, 0)
        for _ in range(4):
            self.create("knowledge_search", {"query": "温和洁面", "limit": 5, "confirmed_credit_cost": 1})
        self.assertNotEqual(self.create(fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "4")

    def test_context_only_uses_current_documents_and_restricts_task_owner(self):
        self.indexed()
        job = json.loads(self.create("knowledge_search", {"query": "温和洁面", "limit": 5, "confirmed_credit_cost": 1}).stdout)["id"]
        claim = self.claim(job, "knowledge_search")
        results = json.loads(sql(self.as_service(f"SELECT search_knowledge_vectors('{self.user}','{self.version}',ARRAY[1.,0.,0.],5)")).stdout)
        body = json.dumps({"version_id": self.version, "query": "温和洁面", "results": results}).replace("'", "''")
        sql(self.as_service(f"""SELECT update_production_job('{job}','{claim["lease_token"]}','completed','{body}')"""))
        context = lambda: json.loads(sql(self.as_service(f"SELECT read_knowledge_context('{self.user}','{job}')")).stdout)
        self.assertEqual(len(context()["sources"]), 1)
        self.assertNotEqual(sql(self.as_service(f"SELECT read_knowledge_context('{self.other}','{job}')"), fail=False).returncode, 0)
        sql(self.as_service(f"SELECT delete_knowledge_entry('{self.user}','{self.entry}')"))
        self.assertEqual(context()["sources"], [])
        self.assertEqual(sql(f"SELECT count(*) FROM knowledge_chunks WHERE entry_id='{self.entry}'").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
