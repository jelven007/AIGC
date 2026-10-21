"""在隔离 PostgreSQL 执行迁移、权限、并发邀请和持久化清理回归。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class AccessControlTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)
        sql("""GRANT USAGE ON SCHEMA storage TO anon,authenticated;
          GRANT SELECT,INSERT,DELETE ON storage.objects TO anon,authenticated;
          ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;""")

    def setUp(self):
        finance.FinanceTest.setUp(self)

    def team_action(self, action, data, user=None, fail=True):
        encoded = json.dumps(data).replace("'", "''")
        return sql(self.as_service(
            f"SELECT manage_team('{user or self.user}','{action}','{encoded}');"), fail=fail)

    def create_team(self):
        return json.loads(self.team_action("create", {"name": "生产团队"}).stdout)["id"]

    def test_api_key_scope_expiry_revocation_and_concurrent_rate(self):
        key = str(uuid.uuid4())
        digest = uuid.uuid4().hex
        sql(f"""INSERT INTO api_keys(id,user_id,name,key_hash,key_prefix,scopes,rate_limit,issuance_version,expires_at)
          VALUES('{key}','{self.user}','key','{digest}','ak_live_',ARRAY['video:read'],3,1,now()+interval '1 day');""")
        consume = lambda scope="video:read": self.as_service(
            f"SELECT consume_api_key('{digest}','{scope}','/video-jobs');")
        denied = json.loads(sql(consume("video:create")).stdout)
        self.assertEqual(denied["status"], 403)
        self.assertEqual(sql(f"SELECT total_calls FROM api_keys WHERE id='{key}'").stdout.strip(), "0")
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: json.loads(sql(consume()).stdout), range(6)))
        self.assertEqual(sum("user_id" in item for item in results), 3)
        self.assertEqual(sum(item.get("status") == 429 for item in results), 3)
        self.assertEqual(sql(f"SELECT count(*) FROM api_call_logs WHERE api_key_id='{key}'").stdout.strip(), "3")
        for update in ("is_active=false", "is_active=true,expires_at=now()-interval '1 minute'", "expires_at=NULL,issuance_version=0"):
            sql(f"UPDATE api_keys SET {update} WHERE id='{key}'")
            self.assertEqual(json.loads(sql(consume()).stdout)["status"], 401)
        for statement in ("SELECT key_hash FROM api_keys", f"UPDATE api_keys SET rate_limit=999 WHERE id='{key}'",
                          f"SELECT consume_api_key('{digest}','video:read','/video-jobs')"):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)

    def test_new_mcp_scopes_are_independent_and_account_bound(self):
        key, digest = str(uuid.uuid4()), uuid.uuid4().hex
        scopes = ["knowledge:read", "knowledge:write", "intelligence:read", "intelligence:write",
                  "publish:read", "metrics:sync"]
        values = ",".join("'" + scope + "'" for scope in scopes)
        sql(f"""INSERT INTO api_keys(id,user_id,name,key_hash,key_prefix,scopes,rate_limit,issuance_version,expires_at)
          VALUES('{key}','{self.user}','MCP','{digest}','ak_live_',ARRAY[{values}],100,1,now()+interval '1 day')""")
        for scope in scopes:
            result = json.loads(sql(self.as_service(f"SELECT consume_api_key('{digest}','{scope}','/mcp')")).stdout)
            self.assertEqual(result["user_id"], self.user)
            self.assertEqual(result["key_id"], key)
        for scope in ["publish:create", "metrics:read", "admin:*", "knowledge:delete"]:
            result = json.loads(sql(self.as_service(f"SELECT consume_api_key('{digest}','{scope}','/mcp')")).stdout)
            self.assertEqual(result["status"], 403)
        self.assertEqual(sql(f"SELECT total_calls FROM api_keys WHERE id='{key}'").stdout.strip(), "6")
        sql(f"UPDATE api_keys SET is_active=false WHERE id='{key}'")
        self.assertEqual(json.loads(sql(self.as_service(
            f"SELECT consume_api_key('{digest}','knowledge:write','/mcp')")).stdout)["status"], 401)

    def test_team_transaction_invitation_email_capacity_and_replay(self):
        team = self.create_team()
        self.assertEqual(sql(f"SELECT count(*) FROM team_members WHERE team_id='{team}' AND role='owner'").stdout.strip(), "1")
        invite = json.loads(self.team_action("invite", {"team_id": team, "email": "SAME@OTHER.EXAMPLE", "role": "editor"}).stdout)
        self.assertNotEqual(self.team_action("accept", {"token": invite["token"]}, fail=False).returncode, 0)
        accepted = json.loads(self.team_action("accept", {"token": invite["token"]}, user=self.other).stdout)
        self.assertEqual(accepted["id"], team)
        self.team_action("accept", {"token": invite["token"]}, user=self.other)
        self.assertEqual(sql(f"SELECT count(*) FROM team_members WHERE team_id='{team}'").stdout.strip(), "2")
        member = sql(f"SELECT id FROM team_members WHERE team_id='{team}' AND user_id='{self.other}'").stdout.strip()
        self.assertNotEqual(self.team_action("role", {"team_id": team, "member_id": member, "role": "viewer"}, user=self.other, fail=False).returncode, 0)
        self.team_action("remove", {"team_id": team, "member_id": member})
        self.assertNotEqual(self.team_action("accept", {"token": invite["token"]}, user=self.other, fail=False).returncode, 0)
        sql(f"UPDATE teams SET max_members=1 WHERE id='{team}'")
        next_invite = json.loads(self.team_action("invite", {"team_id": team, "email": "same@other.example", "role": "viewer"}).stdout)
        self.assertNotEqual(self.team_action("accept", {"token": next_invite["token"]}, user=self.other, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT accepted_at IS NULL FROM team_invitations WHERE token='{next_invite['token']}'").stdout.strip(), "t")
        self.assertNotEqual(sql(self.as_user(f"INSERT INTO team_members(team_id,user_id,role) VALUES('{team}','{self.other}','owner')"), fail=False).returncode, 0)

    def test_parallel_team_creation_has_one_owner_and_no_orphan_team(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.team_action("create", {"name": "并发"}, fail=False), range(4)))
        self.assertEqual(sum(result.returncode == 0 for result in results), 1)
        self.assertEqual(sql(f"SELECT count(*) FROM teams WHERE owner_id='{self.user}'").stdout.strip(), "1")

    def test_team_storage_revocation_and_avatar_isolation(self):
        team = self.create_team()
        sql(f"""INSERT INTO team_members(team_id,user_id,role) VALUES('{team}','{self.other}','viewer');
          INSERT INTO storage.objects(bucket_id,name) VALUES('materials','{self.user}/shared.png');
          INSERT INTO materials(user_id,name,type,url) VALUES('{self.user}','共享','image',
            'https://db.example/storage/v1/object/authenticated/materials/{self.user}/shared.png');
          INSERT INTO team_asset_shares(material_id,team_id,owner_id,bucket,path)
            SELECT id,'{team}','{self.user}','materials','{self.user}/shared.png' FROM materials WHERE user_id='{self.user}';
          INSERT INTO avatars(user_id,name,preview_image) VALUES('{self.user}','私有头像','private');""")
        as_other = lambda statement: f"SET ROLE authenticated; SET request.jwt.claim.sub='{self.other}'; SET request.jwt.claim.role='authenticated'; {statement}"
        self.assertEqual(sql(as_other(f"SELECT can_read_media('{self.other}','materials','{self.user}/shared.png')")).stdout.strip(), "t")
        self.assertEqual(sql(as_other(f"SELECT count(*) FROM storage.objects WHERE name='{self.user}/shared.png'")).stdout.strip(), "1")
        self.assertEqual(sql(as_other(f"SELECT count(*) FROM materials WHERE user_id='{self.user}'")).stdout.strip(), "1")
        self.assertEqual(sql(as_other(f"SELECT count(*) FROM avatars WHERE user_id='{self.user}'")).stdout.strip(), "0")
        self.assertEqual(sql(as_other(f"SELECT can_read_media('{self.user}','materials','{self.user}/shared.png')")).stdout.strip(), "f")
        sql(f"UPDATE team_members SET status='removed' WHERE team_id='{team}' AND user_id='{self.other}'")
        self.assertEqual(sql(as_other(f"SELECT count(*) FROM storage.objects WHERE name='{self.user}/shared.png'")).stdout.strip(), "0")
        self.assertEqual(sql(as_other(f"SELECT count(*) FROM materials WHERE user_id='{self.user}'")).stdout.strip(), "0")
        self.assertNotEqual(sql(as_other(f"INSERT INTO avatars(user_id,name) VALUES('{self.user}','伪造')"), fail=False).returncode, 0)

    def test_material_delete_transaction_cleanup_claim_and_references(self):
        material = str(uuid.uuid4())
        path = f"{self.user}/商品 图.png"
        url = f"https://db.example/storage/v1/object/authenticated/materials/{path}"
        sql(f"INSERT INTO materials(id,user_id,name,type,url) VALUES('{material}','{self.user}','商品','image','{url}')")
        delete = self.as_service(f"SELECT delete_owned_material('{self.user}','{material}','materials','{path}')")
        sql(f"INSERT INTO avatars(user_id,name,preview_image) VALUES('{self.user}','形象','{url}')")
        self.assertNotEqual(sql(delete, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM media_deletions WHERE path='{path}'").stdout.strip(), "0")
        sql(f"DELETE FROM avatars WHERE user_id='{self.user}'")
        sql(delete)
        self.assertEqual(sql(f"SELECT count(*) FROM materials WHERE id='{material}'").stdout.strip(), "0")
        self.assertEqual(sql(self.as_user(f"SELECT can_read_media('{self.user}','materials','{path}')")).stdout.strip(), "f")
        self.assertEqual(sql(self.as_user(f"SELECT can_upload_media('{self.user}','materials','{path}')")).stdout.strip(), "f")
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            claims = list(pool.map(lambda _: json.loads(sql(self.as_service("SELECT claim_media_deletions()")).stdout), range(3)))
        matching = [item for group in claims for item in group if item["path"] == path]
        self.assertEqual(len(matching), 1)
        sql(f"UPDATE media_deletions SET next_run_at=now()-interval '1 second' WHERE path='{path}'")
        recovered = json.loads(sql(self.as_service("SELECT claim_media_deletions()")).stdout)
        self.assertEqual(next(item for item in recovered if item["path"] == path)["attempts"], 2)
        sql(f"UPDATE media_deletions SET completed_at=now() WHERE path='{path}'")
        self.assertEqual(sql(self.as_user(f"SELECT can_upload_media('{self.user}','materials','{path}')")).stdout.strip(), "f")


if __name__ == "__main__":
    unittest.main(verbosity=2)
