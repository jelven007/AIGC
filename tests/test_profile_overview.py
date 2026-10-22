"""真实PG验证概览完整聚合、时区、本人范围与头像生命周期。"""
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class ProfileTest(unittest.TestCase):
    as_user = finance.FinanceTest.as_user
    as_service = finance.FinanceTest.as_service

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)

    def overview(self, zone="UTC"):
        return json.loads(sql(self.as_user(f"SELECT get_my_profile_overview('{zone}')")).stdout)

    def test_complete_aggregation_and_current_owner_despite_admin_visibility(self):
        sql(f"""INSERT INTO video_projects(user_id,title,status,video_url,created_at)
          SELECT '{self.user}','本人项目','completed','https://valid.example/media.mp4',now() FROM generate_series(1,1105);
          INSERT INTO video_projects(user_id,title,status) VALUES('{self.user}','缺成片','completed'),('{self.other}','他人项目','draft');
          INSERT INTO materials(user_id,name,type,url) VALUES('{self.user}','本人图','image','https://valid.example/own.jpg'),
            ('{self.other}','他人图','image','https://valid.example/other.jpg');
          INSERT INTO products(user_id,name,category) VALUES('{self.user}','本人商品','其他'),('{self.other}','他人商品','其他');
          INSERT INTO publish_tasks(user_id,project_id,platform,status)
            SELECT '{self.user}',id,'douyin','published' FROM video_projects WHERE user_id='{self.user}' LIMIT 2;
          INSERT INTO publish_tasks(user_id,project_id,platform,status)
            SELECT '{self.user}',id,'douyin','moderating' FROM video_projects WHERE user_id='{self.user}' LIMIT 3;
          UPDATE auth.users SET raw_app_meta_data='{{"role":"admin"}}' WHERE id='{self.user}';""")
        data = self.overview()
        self.assertEqual({key: data[key] for key in ("videos", "completed", "materials", "products", "published")},
                         dict(videos=1106, completed=1105, materials=1, products=1, published=2))
        self.assertEqual(len(data["activity"]), 30)
        self.assertEqual(sum(day["count"] for day in data["activity"]), 1106)

    def test_timezone_boundaries_zero_days_and_future_records(self):
        sql(f"""INSERT INTO video_projects(user_id,title,created_at) VALUES
          ('{self.user}','本地首日',((now() AT TIME ZONE 'Asia/Shanghai')::date-29)::timestamp AT TIME ZONE 'Asia/Shanghai'),
          ('{self.user}','过期',(((now() AT TIME ZONE 'Asia/Shanghai')::date-29)::timestamp AT TIME ZONE 'Asia/Shanghai')-interval '1 second'),
          ('{self.user}','未来',((now() AT TIME ZONE 'Asia/Shanghai')::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai');""")
        data = self.overview("Asia/Shanghai")
        self.assertEqual(data["activity"][0]["count"], 1)
        self.assertEqual(sum(day["count"] for day in data["activity"]), 1)
        self.assertEqual(data["timezone"], "Asia/Shanghai")
        self.assertNotEqual(sql(self.as_user("SELECT get_my_profile_overview('invalid')"), fail=False).returncode, 0)

    def test_auth_required_and_schema_probe_service_only(self):
        self.assertNotEqual(sql("SET ROLE anon; SELECT get_my_profile_overview()", fail=False).returncode, 0)
        self.assertNotEqual(sql("SET ROLE authenticated; SELECT get_my_profile_overview()", fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user("SELECT profile_overview_schema_ready()"), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_service("SELECT profile_overview_schema_ready()")).stdout.strip(), "t")
        sql("ALTER TABLE profiles DISABLE TRIGGER lifecycle_media_refs")
        self.assertEqual(sql(self.as_service("SELECT profile_overview_schema_ready()")).stdout.strip(), "f")
        sql("ALTER TABLE profiles ENABLE TRIGGER lifecycle_media_refs")

    def test_avatar_protects_material_until_reference_is_removed(self):
        path = f"{self.user}/uploads/{uuid.uuid4()}.png"
        url = f"https://db.example/storage/v1/object/authenticated/materials/{path}"
        mid = str(uuid.uuid4())
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('materials','{path}','{{"size":10,"mimetype":"image/png"}}');
          INSERT INTO materials(id,user_id,name,type,url) VALUES('{mid}','{self.user}','头像','image','{url}');
          UPDATE profiles SET avatar_url='{url}' WHERE id='{self.user}';""")
        self.assertEqual(sql(f"SELECT count(*) FROM media_references WHERE source_table='profiles' AND source_id='{self.user}'").stdout.strip(), "1")
        deletion = self.as_service(f"SELECT delete_owned_material('{self.user}','{mid}','materials','{path}')")
        self.assertNotEqual(sql(deletion, fail=False).returncode, 0)
        sql(self.as_user("UPDATE profiles SET avatar_url=NULL WHERE id=auth.uid()"))
        sql(deletion)
        self.assertEqual(sql(f"SELECT count(*) FROM media_deletions WHERE path='{path}'").stdout.strip(), "1")
        self.assertNotEqual(sql(self.as_user(f"UPDATE profiles SET avatar_url='{url}' WHERE id=auth.uid()"), fail=False).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
