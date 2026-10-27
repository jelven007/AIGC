"""含真实旧知识数据的00065→后续迁移，保留旧向量/来源与权限。"""
import json
import unittest
import uuid
import test_finance as finance


class DatabaseUpgradeTest(unittest.TestCase):
    @classmethod
    def before_migration(cls, migration):
        if not migration.name.startswith("00066_"):
            return
        cls.user, cls.version, cls.entry, cls.job = (str(uuid.uuid4()) for _ in range(4))
        finance.sql(f"""
          INSERT INTO plans(name,price,credits,level) VALUES('旧库夹具',0,100,0);
          INSERT INTO auth.users(id,email) VALUES('{cls.user}','upgrade@fixture.example');
          INSERT INTO model_configs(slot) VALUES('embedding.primary') ON CONFLICT DO NOTHING;
          INSERT INTO model_config_versions(id,slot,settings) VALUES('{cls.version}','embedding.primary','{{}}');
          INSERT INTO knowledge_entries(id,user_id,title,content)
            VALUES('{cls.entry}','{cls.user}','历史知识正文','{{"text":"历史事实"}}');
          INSERT INTO production_jobs(id,user_id,request_key,kind,payload,status,model_config_version_id)
            VALUES('{cls.job}','{cls.user}','{uuid.uuid4()}','knowledge_index','{{}}','completed','{cls.version}');
          INSERT INTO knowledge_chunks(entry_id,user_id,content_hash,version_id,ordinal,content,embedding,job_id)
          SELECT id,user_id,content_hash,'{cls.version}',0,'历史最佳块',ARRAY[3.,4.,0.],'{cls.job}'
            FROM knowledge_entries WHERE id='{cls.entry}';
          INSERT INTO knowledge_chunks(entry_id,user_id,content_hash,version_id,ordinal,content,embedding,job_id)
          SELECT id,user_id,content_hash,'{cls.version}',1,'历史另一块',ARRAY[1.,0.,0.],'{cls.job}'
            FROM knowledge_entries WHERE id='{cls.entry}';
        """)
        cls.before = json.loads(finance.sql(
            f"SELECT search_knowledge_vectors('{cls.user}','{cls.version}',ARRAY[0.,1.,0.],5)").stdout)

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def test_old_rows_backfill_and_original_references_survive(self):
        after = json.loads(finance.sql(
            f"SELECT search_knowledge_vectors('{self.user}','{self.version}',ARRAY[0.,1.,0.],5)").stdout)
        self.assertEqual(after, self.before)
        self.assertEqual(finance.sql(
            f"SELECT embedding_norm FROM knowledge_chunks WHERE entry_id='{self.entry}' ORDER BY ordinal").stdout.splitlines(), ["5", "1"])
        self.assertEqual(finance.sql(
            f"SELECT count(*) FROM knowledge_chunks WHERE job_id='{self.job}' AND version_id='{self.version}'").stdout.strip(), "2")
        denied = finance.sql(f"SET ROLE authenticated; SELECT search_knowledge_vectors('{self.user}','{self.version}',ARRAY[1.,0.,0.],5)", False)
        self.assertNotEqual(denied.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
