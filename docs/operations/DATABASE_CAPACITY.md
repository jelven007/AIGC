# 数据库容量、执行计划和锁路径

`scripts/measure_database.py` 创建专用 PG16 容器，应用真实生产迁移和隔离 Auth/Storage 基础结构，结束后删除自身容器。没有目标连接参数。容器限定 2CPU/2GiB；数据种子、账号/条目/分块 UUID、向量公式固定。保持商品 2,000/账号、知识 200/账号、24块/条目和1,536维的真实约束，通过1、5、10个账号扩大总量，不禁用容量触发器。

```sh
python3 scripts/measure_database.py --through 65 --repeats 20 \
  --output .volcengine-build/database-before.json
python3 scripts/measure_database.py --through 66 --repeats 20 \
  --output .volcengine-build/database-after.json
python3 tests/test_knowledge_capacity.py
python3 tests/test_knowledge.py
node --test tests/product_pagination.test.mjs
```

输出目录需已存在，工具拒绝覆盖旧证据。正式比较串行运行，不同时构建、执行其他数据库或浏览器测试。每组报告保存实际行数、表/索引/TOAST空间、每新增账号的写入墙钟时间、全部迁移摘要、数据库版本/镜像ID、每个SQL的`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)`、首样本和后续20个样本。P95采用nearest-rank；20个温缓存样本只能说明此夹具的SQL时间，不代表生产P95、API端到端延迟或冷启动。

首轮00065测量发现：商品本人列表、1,900条深页、包含搜索和精确计数均低于1ms，知识目录低于4ms；满额账号知识检索约1.16–1.27秒，单次余弦评分扫描约0.65–0.68秒。范数重复求和以及评分在过滤/排序中重复计算是此数据下的主要成本。首轮有短时间并行的PG回归，最终结论以随后独占、20样本复测为准；旧报告保留，不改写历史。

`00066`保留精确float8余弦和既有owner、配置版本、维度及正文hash过滤。分块写入时生成范数，查询向量范数只计算一次，`MATERIALIZED`评分只执行一次；每个条目选最佳分块，并用ordinal和entry UUID稳定并列排序。空limit在扫描前拒绝。首次候选P95为430.682ms，随后同镜像、完整规模20样本复测如下：

| 账号数 | 商品 / 知识 / 分块 | 00065检索P95 | 00066检索P95 | 当前目录P95 |
| --- | --- | --- | --- | --- |
| 1 | 2,000 / 200 / 4,800 | 1,151.539ms | 459.841ms | 3.325ms |
| 5 | 10,000 / 1,000 / 24,000 | 1,150.699ms | 424.041ms | 3.542ms |
| 10 | 20,000 / 2,000 / 48,000 | 1,151.746ms | 428.979ms | 3.874ms |

三组检索均满足此本地500ms预算，降幅约60%–63%。普通商品SQL最大P95为0.755ms；1,900条深页和等价游标分别0.517/0.244ms，没有新增索引。每个新增账号整批写入（商品、条目、分块）的墙钟中位数3.9665→4.3085秒，约增加8.6%；这是混合写入和容量触发器的总成本，不能分解为单条向量插入成本。48,000分块的表/索引/TOAST总空间677,683,200→677,961,728字节；物理分配和压缩波动不作为精确每行新增字节的推导。详情和原证据文件名见[实施台账](../archive/reviews/OPTIMIZATION_IMPLEMENTATION_20261027.md)。

此轮未增加向量、trigram或新的产品索引。已有`(user_id,created_at DESC)`索引能先限定本人最多2,000行，本地查询已低于200ms预算；不能从全库账号数增加推导需要索引更多文本列。两条同定义产品索引仍保留，删除的写入收益和其他目标依赖尚未建立证据。未来精确检索在真实目标超预算后再核验pgvector版本、模型维度、引用一致性和召回，不把当前本地SQL结果视为扩展可用性证明。

商品`list`增加可选`pagination:"cursor"`，仅支持`created_at DESC,id ASC`；时间戳完整保留微秒。首次返回`total`和`next_cursor`，后续页返回`total:null`及下一游标，避免反复计数。价格等排序继续使用原OFFSET接口。批量页面按游标读取最近两页/200条，首读后新增较新商品不会导致后页重复；删除旧行和修改筛选会改变集合，重新开始分页才能看到新集合。游标不能承载授权，所有查询仍按服务端认证UID过滤。

报告的`function_graph`来自真实`pg_proc`，包含每个SQL/PLpgSQL函数的签名、ACL、SECURITY DEFINER、配置、可识别的函数调用和锁语句顺序。它是静态线索；动态SQL、分支及并发交叉需结合资金/团队回归验证。当前保留的关键路径为：

| 入口 | 锁路径与调用 |
| --- | --- |
| `deduct_credits` | 套餐行 → `team-user`事务锁 → `workload-user`事务锁 → 团队行 → `deduct_credits_before_ops` |
| `create_video_job` | 套餐行 → 模型配置共享锁 → 原创建包装 → 原积分入口 |
| `create_production_job` | 保留按kind的原包装；图片入口锁套餐、模型/价格后进入已验证创建链 |
| `finalize_paid_order` | 按订单读取账号 → 套餐行 → 订单行 → 原支付/权益处理 |
| `refund_credit_charge` | 套餐行 → 原积分流水行；仅追加原流水补偿 |
| `apply_cash_refund` | 按原退款/订单读取账号 → 套餐行 → 订单行 → 原退款行 |
| `update_production_job` | 按kind进入现有包装；任务/套餐/知识/媒体引用路径保留原顺序和fencing |

容量工具还真正持有套餐锁，让另一个连接调用原`deduct_credits`。记录`pg_blocking_pids`、等待类型和事务锁；释放后原入口完成一笔扣费。此用例证明该等待路径，不代表全部业务不存在死锁。继续运行原资金、现金退款、团队、运营及队列并发回归；此轮没有重写财务包装，也没有删除内部函数。

在生产目标测量时，应明确硬件、账号分布、活跃/UNKNOWN任务比例、数据库缓存、连接池和并发，并另外采集API P95、最老队列等待、死锁、VACUUM/死行及实际RPO/RTO。不能直接把此隔离夹具放入生产库。
