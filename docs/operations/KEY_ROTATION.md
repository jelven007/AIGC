# 历史密钥轮换与 Worker 出口

本地基线：2026-10-27。模型、发布平台与数据回传共用 AES-256-GCM，但各用途独立绑定 AAD。新密文格式为 `v2.key_id.base64(iv).base64(payload)`，AAD 是紧凑 UTF-8 JSON `["v2",key_id,context]`。原两段密文继续使用原 context，不原地修改不可变版本、历史任务或平台快照。

## 目录与轮换

`MODEL_CONFIG_KEYRING` 为服务端 Secret，内容如下；示例中的说明文字必须替换为真实64位hex。ID为1–64位字母/数字/下划线/连字符，最多16个键。

```json
{
  "active_key_id": "current",
  "legacy_key_id": "legacy",
  "keys": {
    "legacy": "原MODEL_CONFIG_ENCRYPTION_KEY的64位hex",
    "current": "新独立生成的64位hex"
  }
}
```

未配置目录时，单主密钥同时作为活动与旧键，新密文标记 `v2.legacy`。从此模式迁移时必须保留名为`legacy`的条目。已有两段密文按`legacy_key_id`指定的键读取；没有旧格式数据才可显式设为null。新格式只使用原ID，缺失ID、用途/ID/密文篡改均拒绝，不尝试其他键。

1. 在凭据系统建立完整目录，活动ID暂时仍为原ID。同步到所有Edge实例，确认原模型任务、旧平台连接、OAuth状态和数据回传仍可读取。
2. 将与待发布目录相同的JSON保存为0600文件，在备份配置`secrets.model_keyring`指向它。仍备份单主密钥时，`model_master_key`须等于目录声明的legacy键；不再使用单键可移除这一配置项。归档加密键单独保管。
3. 使用只读数据库连接执行以下命令。预检为REPEATABLE READ，只流式验证所有历史模型版本、平台应用、连接token与app_snapshot、过期/已用OAuth app_snapshot及停用measurement_sources，不返回明文或密文。

   ```sh
   python scripts/backup_restore.py key-preflight --config /run/backup/config.json
   ```

4. 备份、verify并向空隔离环境restore，核对回执`credentials_checked`、完整目录文件、原UUID/扣费与unknown状态。只有预检和恢复通过后才把活动ID切为新ID，所有服务实例使用同一完整目录。
5. 后续新保存配置与token刷新使用活动ID，原任务继续解密原ID。旧键还可能被历史版本、快照、归档引用，不能仅因当前模型切换就删除。此工具不自动退役键或重写历史数据；目录上限前须按凭据管理与历史保留政策规划归档生命周期。

`keyring_interop.mjs`直接使用实际Edge加密函数和Python解密/反向加密，校验新旧格式、Unicode AAD与篡改；`test_backup_restore.py`在双PG16验证完整目录、8条跨用途凭据和原未知任务。它们是本地证据，不证明真实供应商轮换已经接受。

## Worker 可信出口

FFmpeg Worker默认只接受`SUPABASE_URL`原项目域名；外部素材CDN须在`RENDER_MEDIA_HOSTS`逐项列出完整域名，用逗号分隔。没有通配符。上传与带租约密钥的API请求仅允许原项目域名。轮换CDN时先补入经核对的新域名，旧任务仍引用的域名须继续保留。

请求要求HTTPS/443、证书校验、原域名Host/SNI；不使用环境代理，不跟随重定向。新连接先检查全部DNS答案为公网地址，再用核验过的数字地址连接，避免校验后重新解析原域名；内网、保留地址、IPv4映射IPv6及空DNS答案拒绝。域名或连接策略错误不打印签名URL。

ECS安全组/主机防火墙应限制Worker出站至可信后端、明确CDN的443和指定DNS解析器；独立维护/模型调用服务使用自身必需的供应商列表。应用域名策略不能替代宿主防火墙。此实现没有允许内网的生产开关；本地TLS演练只在测试进程把核验后的socket接到隔离服务，实际校验证书、Host/SNI及拒绝重定向。

复核：`node --test tests/keyring.test.mjs`、`node tests/keyring_interop.mjs`、`python tests/test_backup_restore.py`、镜像内`python tests/test_worker_egress.py`和`python tests/test_worker_resources.py`。媒体磁盘与执行窗口见 [资源边界](MEDIA_WORKER_RESOURCES.md)。
