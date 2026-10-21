"""执行真实PG：签名后写入事务、实验分组、漏斗、版本和报告隔离。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance
sql = finance.sql


class MeasurementTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        self.source, self.project, self.second = map(str, (uuid.uuid4(), uuid.uuid4(), uuid.uuid4()))
        sql(f"""INSERT INTO video_projects(id,user_id,title,status) VALUES
          ('{self.project}','{self.user}','A版本','completed'),('{self.second}','{self.user}','B版本','completed');""")
        data = json.dumps({"action": "create", "id": self.source, "name": "授权广告数据", "authorization_reference": "测试合同授权编号0001",
                           "key_ciphertext": "encrypted-test-key", "key_digest": "a"*64})
        sql(self.as_service(f"SELECT manage_measurement_source('{self.other}','{self.user}','{data}')"))
        self.spec = {"request_key": str(uuid.uuid4()), "source_id": self.source, "title": "预注册实验", "primary_metric": "ctr", "planned_sample": 100,
                     "ends_at": sql("SELECT to_json(now()+interval '7 days')").stdout.strip().strip('"'),
                     "variants": [{"title": "A", "project_id": self.project}, {"title": "B", "project_id": self.second}]}

    def create(self, spec=None, fail=True):
        value = json.dumps(spec or self.spec).replace("'", "''")
        return sql(self.as_service(f"SELECT manage_content_experiment('{self.user}','create','{value}')"), fail)

    def ingest(self, body, key=None, digest="a"*64, fail=True):
        value = json.dumps(body).replace("'", "''")
        return sql(self.as_service(f"SELECT ingest_measurement('{self.source}','{key or uuid.uuid4()}','{digest}','{value}')"), fail)

    def row(self, **updates):
        return {"project_id": self.project, "dataset_key": "campaign-01", "business_date": sql("SELECT current_date").stdout.strip(),
                "revision": 1, "currency": "CNY", "impressions": 1000, "clicks": 100, "conversions": 10,
                "spend_minor": 5000, "gmv_minor": 15000, "refunds_minor": 1000,
                "observed_at": sql("SELECT to_json(now())").stdout.strip().strip('"'), **updates}

    def test_source_and_measurement_write_are_restricted(self):
        for statement in ("SELECT * FROM measurement_sources", "SELECT * FROM content_experiment_units",
                          f"SELECT ingest_measurement('{self.source}','{uuid.uuid4()}','{'a'*64}','{{}}')",
                          "UPDATE ab_test_variants SET impressions=100000"):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_service(f"SELECT manage_measurement_source('{self.user}','{self.user}','{{}}')"), fail=False).returncode, 0)

    def test_source_registration_replay_keeps_key_and_disable_is_final(self):
        data = {"action": "create", "id": self.source, "name": "授权广告数据", "authorization_reference": "测试合同授权编号0001",
                "key_ciphertext": "new-encryption-same-key", "key_digest": "a"*64}
        command = lambda value: self.as_service(f"SELECT manage_measurement_source('{self.other}','{self.user}','{json.dumps(value)}')")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            responses = [json.loads(result.stdout) for result in pool.map(lambda _: sql(command(data)), range(4))]
        self.assertTrue(all("key_ciphertext" not in item and "key_digest" not in item for item in responses))
        self.assertEqual(sql(f"SELECT key_ciphertext FROM measurement_sources WHERE id='{self.source}'").stdout.strip(), "encrypted-test-key")
        self.assertEqual(sql(f"SELECT count(*) FROM audit_logs WHERE record_id='{self.source}'").stdout.strip(), "1")
        self.assertNotEqual(sql(command({**data, "key_digest": "b"*64}), fail=False).returncode, 0)
        sql(command({"action": "disable", "id": self.source}))
        self.assertFalse(json.loads(sql(command(data)).stdout)["enabled"])
        self.assertNotEqual(self.ingest({"action": "daily", "rows": [self.row()]}, fail=False).returncode, 0)

    def test_concurrent_same_request_is_one_snapshot_and_conflict_rejected(self):
        body, key = {"action": "daily", "rows": [self.row()]}, str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.ingest(body, key), range(4)))
        self.assertTrue(all(json.loads(result.stdout)["accepted"] == 1 for result in results))
        self.assertEqual(sql(f"SELECT count(*) FROM delivery_measurements WHERE source_id='{self.source}'").stdout.strip(), "1")
        self.assertEqual(sql(f"SELECT count(*) FROM measurement_receipts WHERE source_id='{self.source}'").stdout.strip(), "1")
        self.assertNotEqual(self.ingest(body, key, "b"*64, False).returncode, 0)
        self.assertNotEqual(self.ingest(body, fail=False).returncode, 0)
        self.ingest({"action": "daily", "rows": [self.row(revision=2, impressions=2000)]})
        self.assertEqual(sql(f"SELECT impressions FROM delivery_measurements WHERE source_id='{self.source}'").stdout.strip(), "2000")

    def test_batch_failure_rolls_back_and_missing_not_zero(self):
        self.assertNotEqual(self.ingest({"action": "daily", "rows": [self.row(), self.row(dataset_key="invalid", clicks=1001)]}, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM delivery_measurements WHERE source_id='{self.source}'").stdout.strip(), "0")
        self.ingest({"action": "daily", "rows": [self.row(), self.row(dataset_key="missing", impressions=None)]})
        report = json.loads(sql(self.as_service(f"SELECT read_measurement_report('{self.user}',now()-interval '30 days')")).stdout)
        self.assertIsNone(report["delivery"][0]["impressions"])
        self.assertEqual(report["delivery"][0]["clicks"], 200)
        other = json.loads(sql(self.as_service(f"SELECT read_measurement_report('{self.other}',now()-interval '30 days')")).stdout)
        self.assertEqual(other["delivery"], [])
        self.assertNotEqual(self.ingest({"action": "daily", "rows": [self.row(dataset_key="other", project_id=str(uuid.uuid4()))]}, fail=False).returncode, 0)

    def test_experiment_creation_and_assignment_are_idempotent(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            experiments = [json.loads(result.stdout) for result in pool.map(lambda _: self.create(), range(4))]
        self.assertEqual(len({e["id"] for e in experiments}), 1)
        exp = experiments[0]["id"]
        changed = {**self.spec, "planned_sample": 200}
        self.assertNotEqual(self.create(changed, fail=False).returncode, 0)
        sql(self.as_service(f"SELECT manage_content_experiment('{self.user}','start','{{\"id\":\"{exp}\"}}')"))
        body = {"action": "assign", "experiment_id": exp, "unit_hash": "f"*64}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            assignments = [json.loads(result.stdout) for result in pool.map(lambda _: self.ingest(body), range(4))]
        self.assertEqual(len({a["variant_id"] for a in assignments}), 1)
        self.assertEqual(sql(f"SELECT count(*) FROM content_experiment_units WHERE experiment_id='{exp}'").stdout.strip(), "1")
        self.assertNotEqual(sql(self.as_service(f"SELECT manage_content_experiment('{self.other}','close','{{\"id\":\"{exp}\"}}')"), fail=False).returncode, 0)

    def test_experiment_funnel_deduplicates_and_early_close_rejects(self):
        exp = json.loads(self.create().stdout)["id"]
        sql(self.as_service(f"SELECT manage_content_experiment('{self.user}','start','{{\"id\":\"{exp}\"}}')"))
        self.ingest({"action": "assign", "experiment_id": exp, "unit_hash": "f"*64})
        time = sql("SELECT to_json(now())").stdout.strip().strip('"')
        event = lambda kind: {"unit_hash": "f"*64, "type": kind, "occurred_at": time}
        self.assertNotEqual(self.ingest({"action": "events", "experiment_id": exp, "events": [event("conversion")]}, fail=False).returncode, 0)
        for _ in range(3):
            self.ingest({"action": "events", "experiment_id": exp, "events": [event("exposure"), event("click"), event("conversion")]})
        results = json.loads(sql(self.as_service(f"SELECT read_content_experiments('{self.user}')")).stdout)
        self.assertEqual(sum(v["impressions"] for v in results[0]["variants"]), 1)
        self.assertEqual(sum(v["conversions"] for v in results[0]["variants"]), 1)
        self.assertNotEqual(sql(self.as_service(f"SELECT manage_content_experiment('{self.user}','close','{{\"id\":\"{exp}\"}}')"), fail=False).returncode, 0)
        sql(f"UPDATE content_experiments SET ends_at=now()-interval '25 hours' WHERE id='{exp}'")
        sql(self.as_service(f"SELECT manage_content_experiment('{self.user}','close','{{\"id\":\"{exp}\"}}')"))
        self.assertNotEqual(self.ingest({"action": "assign", "experiment_id": exp, "unit_hash": "e"*64}, fail=False).returncode, 0)

    def test_natural_report_deduplicates_snapshots_and_filters_project(self):
        for views in (100, 200):
            task = str(uuid.uuid4())
            sql(f"""INSERT INTO publish_tasks(id,user_id,project_id,platform,status,platform_video_id,published_at)
              VALUES('{task}','{self.user}','{self.project}','douyin','published','same-video',now());""")
            sql(self.as_service(f"SELECT save_platform_metrics('{task}','{{\"view_count\":{views},\"like_count\":0}}')"))
        report = json.loads(sql(self.as_service(f"SELECT read_measurement_report('{self.user}',now()-interval '30 days','{self.project}')")).stdout)
        self.assertEqual(len(report["natural"]), 1)
        self.assertEqual(report["natural"][0]["view_count"], 200)
        self.assertEqual(report["natural"][0]["like_count"], 0)
        self.assertEqual(report["project_count"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
