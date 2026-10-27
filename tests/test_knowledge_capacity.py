"""精确余弦、引用/版本隔离、失效和稳定并列排序的真实PG回归。"""
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class KnowledgeCapacityTest(unittest.TestCase):
    setUp = finance.FinanceTest.setUp
    as_service = finance.FinanceTest.as_service

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def fixture(self):
        version = str(uuid.uuid4())
        entries = sorted(str(uuid.uuid4()) for _ in range(3))
        job = str(uuid.uuid4())
        sql(f"""
          INSERT INTO model_configs(slot) VALUES('embedding.primary') ON CONFLICT DO NOTHING;
          INSERT INTO model_config_versions(id,slot,settings) VALUES('{version}','embedding.primary','{{}}');
          INSERT INTO production_jobs(id,user_id,request_key,kind,payload,status,model_config_version_id)
            VALUES('{job}','{self.user}','{uuid.uuid4()}','knowledge_index','{{}}','completed','{version}');
        """)
        for entry in entries:
            sql(f"""INSERT INTO knowledge_entries(id,user_id,title,content)
              VALUES('{entry}','{self.user}','精确检索正文','{{"text":"事实"}}');
              INSERT INTO knowledge_chunks(entry_id,user_id,content_hash,version_id,ordinal,content,embedding,job_id)
              SELECT id,user_id,content_hash,'{version}',c.ordinal,c.content,c.embedding,'{job}' FROM knowledge_entries
              CROSS JOIN (VALUES (0,'首块',ARRAY[3.,4.,0.]),(1,'最佳块',ARRAY[1.,0.,0.]),
                (2,'同分后块',ARRAY[2.,0.,0.]),(3,'不相关块',ARRAY[0.,1.,0.])) c(ordinal,content,embedding)
              WHERE id='{entry}';""")
        return version, entries

    def search(self, version, vector="ARRAY[1.,0.,0.]", limit="5", user=None, fail=True):
        result = sql(self.as_service(f"SELECT search_knowledge_vectors('{user or self.user}','{version}',{vector},{limit});"), fail)
        return json.loads(result.stdout) if fail else result

    def test_generated_norm_and_exact_stable_best_chunk(self):
        version, entries = self.fixture()
        norms = sql(f"SELECT DISTINCT embedding_norm FROM knowledge_chunks WHERE version_id='{version}' ORDER BY 1").stdout.splitlines()
        self.assertEqual(norms, ["1", "2", "5"])
        for _ in range(3):
            hits = self.search(version, limit="2")
            self.assertEqual([hit["entry_id"] for hit in hits], entries[:2])
            self.assertTrue(all(hit["content"] == "最佳块" and hit["similarity"] == 1 for hit in hits))
        hits = self.search(version, "ARRAY[0.,1.,0.]")
        self.assertTrue(all(hit["content"] == "不相关块" and hit["similarity"] == 1 for hit in hits))

    def test_current_hash_owner_version_and_dimensions_are_required(self):
        version, entries = self.fixture()
        self.assertEqual(self.search(version, user=self.other), [])
        self.assertEqual(self.search(str(uuid.uuid4())), [])
        self.assertEqual(self.search(version, "ARRAY[1.,0.]"), [])
        sql(f"""UPDATE knowledge_entries SET title='更新后的事实' WHERE id='{entries[0]}';
          DELETE FROM knowledge_entries WHERE id='{entries[1]}';""")
        self.assertEqual([hit["entry_id"] for hit in self.search(version)], entries[2:])
        for command in ("SELECT * FROM knowledge_chunks",
                        f"SELECT search_knowledge_vectors('{self.user}','{version}',ARRAY[1.,0.,0.],5)"):
            denied = sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{self.user}'; {command}", False)
            self.assertNotEqual(denied.returncode, 0)

    def test_invalid_and_null_limits_reject_before_search(self):
        version, _ = self.fixture()
        for limit in ("NULL", "0", "11"):
            self.assertNotEqual(self.search(version, limit=limit, fail=False).returncode, 0)
        for vector in ("NULL", "ARRAY[0.,0.,0.]", "ARRAY[NULL,1.,0.]", "ARRAY['NaN'::float8,1.,0.]",
                       "ARRAY[[1.,0.],[0.,1.]]"):
            self.assertNotEqual(self.search(version, vector=vector, fail=False).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
