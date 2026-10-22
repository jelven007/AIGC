"""实际PostgreSQL验证上传原请求、存储证据、并发、权属与删除重放。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class MaterialTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        self.key = str(uuid.uuid4())
        self.path = f"{self.user}/uploads/{self.key}.wav"
        self.input = {"name": "自有音轨", "type": "audio", "extension": "wav", "content_hash": "a" * 64,
                      "size": 4000, "mime": "audio/wav", "source": "recording", "rights_confirmed": True,
                      "duration_sec": 2.5, "path": self.path,
                      "url": f"https://db.example/storage/v1/object/authenticated/materials/{self.path}"}

    def object(self, size=4000, mime="audio/wav"):
        metadata = json.dumps({"size": size, "mimetype": mime})
        sql(f"INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('materials','{self.path}','{metadata}')")

    def register(self, data=None, user=None, fail=True):
        encoded = json.dumps(data or self.input, ensure_ascii=False).replace("'", "''")
        return sql(self.as_service(f"SELECT register_material_upload('{user or self.user}','{self.key}','{encoded}');"), fail=fail)

    def test_concurrent_original_registration_has_one_material_and_receipt(self):
        self.object()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda _: json.loads(self.register().stdout), range(5)))
        self.assertEqual(len({item["material"]["id"] for item in results}), 1)
        self.assertEqual(sql(f"SELECT count(*) FROM material_upload_receipts WHERE user_id='{self.user}'").stdout.strip(), "1")
        self.assertEqual(results[0]["material"]["duration_sec"], 2.5)
        self.assertEqual(results[0]["material"]["tags"], ["自有录音"])
        self.assertNotEqual(self.register({**self.input, "name": "另一音轨"}, fail=False).returncode, 0)

    def test_missing_upload_and_metadata_mismatch_never_create_rows(self):
        self.assertNotEqual(self.register(fail=False).returncode, 0)
        self.object(size=3999)
        self.assertNotEqual(self.register(fail=False).returncode, 0)
        sql(f"""UPDATE storage.objects SET metadata='{{"size":4000,"mimetype":"video/mp4"}}' WHERE name='{self.path}'""")
        self.assertNotEqual(self.register(fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM materials WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM material_upload_receipts WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_owner_consent_path_and_invalid_duration_rejected(self):
        self.object()
        for changes in ({"rights_confirmed": False}, {"rights_confirmed": None}, {"type": None}, {"name": None},
                        {"path": f"{self.other}/foreign.wav"}, {"duration_sec": 0}, {"duration_sec": None},
                        {"size": 1.5}, {"content_hash": "invalid"}, {"source": "unlicensed"}):
            self.assertNotEqual(self.register({**self.input, **changes}, fail=False).returncode, 0, changes)
        self.assertNotEqual(self.register(user=self.other, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM materials WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_delete_preserves_tombstone_and_cannot_revive_uploaded_media(self):
        self.object()
        material = json.loads(self.register().stdout)["material"]["id"]
        sql(self.as_service(f"SELECT delete_owned_material('{self.user}','{material}','materials','{self.path}')"))
        restored = json.loads(self.register().stdout)
        self.assertTrue(restored["deleted"])
        self.assertEqual(sql(f"SELECT count(*) FROM materials WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM media_deletions WHERE path='{self.path}'").stdout.strip(), "1")

    def test_registration_function_and_receipts_have_no_user_privilege_bypass(self):
        self.object()
        self.register()
        for statement in ("SELECT register_material_upload(NULL,NULL,'{}')",
                          f"UPDATE material_upload_receipts SET material_id=NULL WHERE user_id='{self.user}'",
                          f"DELETE FROM material_upload_receipts WHERE user_id='{self.user}'"):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_user("SELECT count(*) FROM material_upload_receipts")).stdout.strip(), "1")
        self.assertEqual(sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{self.other}'; "
                             "SELECT count(*) FROM material_upload_receipts").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
