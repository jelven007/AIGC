"""画布工程在隔离 PostgreSQL 中验证权限、并发版本和媒体引用。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance


class CanvasProjectTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        self.owner, self.other, self.project = [str(uuid.uuid4()) for _ in range(3)]
        finance.sql(f"INSERT INTO auth.users(id,email) VALUES ('{self.owner}','canvas@test.example'),('{self.other}','other@canvas.example');")
        self.document = {"schemaVersion": 1, "nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}

    def actor(self, statement, actor=None):
        return f"SET ROLE authenticated; SET request.jwt.claim.sub='{actor or self.owner}'; SET request.jwt.claim.role='authenticated'; " + statement

    def create(self, document=None):
        return self.actor(f"SELECT create_canvas_project('{self.project}','画布','{json.dumps(document or self.document)}');")

    def test_create_idempotency_and_account_isolation(self):
        first = json.loads(finance.sql(self.create()).stdout)
        second = json.loads(finance.sql(self.create()).stdout)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["revision"], 1)
        self.assertEqual(finance.sql(self.actor("SELECT count(*) FROM canvas_projects;", self.other)).stdout.strip(), "0")
        self.assertNotEqual(finance.sql(self.actor(f"SELECT create_canvas_project('{self.project}','劫持','{json.dumps(self.document)}');", self.other), False).returncode, 0)
        self.assertNotEqual(finance.sql("SET ROLE anon; SELECT * FROM canvas_projects;", False).returncode, 0)

    def test_parallel_save_has_one_winner_and_same_request_recovers(self):
        finance.sql(self.create())
        def save(title):
            return finance.sql(self.actor(f"SELECT save_canvas_project('{self.project}',1,'{title}','{json.dumps(self.document)}');"), False)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(save, ["版本A", "版本B"]))
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        winner = json.loads(next(r.stdout for r in results if r.returncode == 0))
        recovered = json.loads(finance.sql(self.actor(f"SELECT save_canvas_project('{self.project}',1,'{winner['title']}','{json.dumps(self.document)}');")).stdout)
        self.assertEqual(recovered["revision"], 2)
        self.assertNotEqual(finance.sql(self.actor(f"UPDATE canvas_projects SET revision=999 WHERE id='{self.project}';"), False).returncode, 0)

    def test_media_references_protect_owned_files_and_delete_releases_only_reference(self):
        document = {**self.document, "nodes": [{"id": "image", "type": "image", "position": {"x": 0, "y": 0},
            "data": {"name": "原图", "url": f"https://db.example/storage/v1/object/authenticated/materials/{self.owner}/a.png"}}]}
        finance.sql(self.create(document))
        self.assertEqual(finance.sql(f"SELECT count(*) FROM media_references WHERE source_table='canvas_projects' AND source_id='{self.project}';").stdout.strip(), "1")
        finance.sql(self.actor(f"DELETE FROM canvas_projects WHERE id='{self.project}';"))
        self.assertEqual(finance.sql(f"SELECT count(*) FROM media_references WHERE source_id='{self.project}';").stdout.strip(), "0")
        document["nodes"][0]["data"]["url"] = f"https://db.example/storage/v1/object/authenticated/materials/{self.other}/a.png"
        self.assertNotEqual(finance.sql(self.create(document), False).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
