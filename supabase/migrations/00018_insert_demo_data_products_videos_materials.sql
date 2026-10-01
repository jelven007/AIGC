
DO $$
DECLARE
  demo_uid uuid := '7d58d08f-8aa3-43f5-a30f-b7495d59d147';
BEGIN

-- ── 示例商品 ─────────────────────────────────────────────────────────────
INSERT INTO public.products (
  user_id, name, category, sub_category, description,
  selling_points, ai_selling_points, original_price, sale_price,
  stock, specs, images, cover_image, status, sales_count,
  target_language, target_platform
) VALUES
(
  demo_uid, '春夏仙气连衣裙', '服装配饰', '连衣裙',
  '轻盈薄纱面料，显瘦A字裙摆，仙气飘飘的约会首选款，多色可选。',
  ARRAY['纯棉透气','显瘦A字版型','多色可选','免烫好打理'],
  ARRAY['穿上这条裙子，美到让人挪不开眼！','夏日约会神器，轻盈飘逸超减龄','仙气十足，拍照出片率极高'],
  299, 179, 856,
  '[{"name":"颜色","value":"白色/粉色/蓝色"},{"name":"尺码","value":"S/M/L/XL"}]'::jsonb,
  ARRAY['https://miaoda-image.cdn.bcebos.com/img/corpus/574d7ba9eb25407fb5d620738c889a15.jpg'],
  'https://miaoda-image.cdn.bcebos.com/img/corpus/574d7ba9eb25407fb5d620738c889a15.jpg',
  'active', 2341, 'zh', 'douyin'
),
(
  demo_uid, '主动降噪无线耳机 Pro', '数码电器', '耳机',
  '40dB主动降噪，30小时续航，Hi-Fi音质，通勤学习必备神器。',
  ARRAY['40dB主动降噪','30h超长续航','Hi-Fi音质','快充10分钟听3小时'],
  ARRAY['通勤路上开启降噪，立刻进入高效状态','一次充电听整整一天，出差无忧','音质比同价位提升两个档次'],
  799, 499, 423,
  '[{"name":"颜色","value":"曜石黑/珍珠白/星云蓝"},{"name":"连接","value":"蓝牙5.3"}]'::jsonb,
  ARRAY['https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_36d53a2c-dba0-4693-947c-3a95e0f4684f.jpg'],
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_36d53a2c-dba0-4693-947c-3a95e0f4684f.jpg',
  'active', 1876, 'zh', 'douyin'
),
(
  demo_uid, '玻尿酸深层保湿面霜', '美妆护肤', '面霜',
  '添加5重玻尿酸+烟酰胺，72h锁水保湿，敏感肌可用，轻薄不油腻。',
  ARRAY['5重玻尿酸','72h锁水保湿','敏感肌友好','油皮也爱用'],
  ARRAY['早晚各一次，两周肉眼可见嫩滑','敏感肌也能放心用，温和不刺激','一瓶解决干燥暗沉细纹三大问题'],
  268, 158, 1204,
  '[{"name":"规格","value":"50ml/100ml"},{"name":"适合肤质","value":"所有肤质"}]'::jsonb,
  ARRAY['https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_3c5358b7-3833-485e-a51a-376eea98ac18.jpg'],
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_3c5358b7-3833-485e-a51a-376eea98ac18.jpg',
  'active', 5632, 'zh', 'douyin'
),
(
  demo_uid, '竞速碳纤维跑步鞋', '运动户外', '跑鞋',
  '超轻碳板支撑，回弹减震中底，马拉松级别配置，日常跑步的速度升级。',
  ARRAY['碳纤维板支撑','超轻190g','42km马拉松配置','透气网面鞋身'],
  ARRAY['穿上它，感觉自己在飞！','比普通跑鞋快10%，数据说话','马拉松选手同款，平民价格买专业装备'],
  1299, 899, 312,
  '[{"name":"颜色","value":"黑橙/白蓝/全黑"},{"name":"尺码","value":"38-46"}]'::jsonb,
  ARRAY['https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_20ed12af-c9e6-44bc-ac20-502c2f68466d.jpg'],
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_20ed12af-c9e6-44bc-ac20-502c2f68466d.jpg',
  'active', 987, 'zh', 'tiktok'
),
(
  demo_uid, '智能健康手表 S9', '数码电器', '智能手表',
  '心率血氧监测，7天超长续航，100+运动模式，NFC支付，轻薄时尚设计。',
  ARRAY['24h心率血氧监测','7天长续航','100+运动模式','NFC刷卡支付'],
  ARRAY['早睡早起，它帮你分析每晚睡眠质量','跑步游泳都能戴，IP68防水','一块手表替代10种健康仪器'],
  1099, 699, 542,
  '[{"name":"表盘","value":"46mm/42mm"},{"name":"表带","value":"硅胶/皮革/金属"}]'::jsonb,
  ARRAY['https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_f630155c-927a-44cd-83a6-b289fa885967.jpg'],
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_f630155c-927a-44cd-83a6-b289fa885967.jpg',
  'active', 1543, 'zh', 'douyin'
),
(
  demo_uid, '316L不锈钢真空保温杯', '家居用品', '水杯',
  '316L食品级不锈钢，12h保温保冷，磁吸盖一键开合，大口径易清洗。',
  ARRAY['316L食品级钢','12h保温保冷','磁吸一键开合','500ml大容量'],
  ARRAY['夏天冰饮12小时不化，太爽了！','到公司咖啡还是烫的','颜值高到愿意每天带出门'],
  199, 129, 2876,
  '[{"name":"颜色","value":"哑光黑/樱花粉/森林绿/星空蓝"},{"name":"容量","value":"350ml/500ml"}]'::jsonb,
  ARRAY['https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_880b4ffc-93f3-4cca-a86d-a278f8b2ce75.jpg'],
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_880b4ffc-93f3-4cca-a86d-a278f8b2ce75.jpg',
  'active', 8921, 'zh', 'douyin'
),
(
  demo_uid, '天然有机草莓礼盒', '食品饮料', '新鲜水果',
  '丹东99草莓，单颗重达30g+，酸甜汁水充盈，礼盒精装可直接送礼。',
  ARRAY['丹东顶级产区','单颗30g+超大果','当天采摘急冻','精美礼盒包装'],
  ARRAY['吃了就回不去普通草莓！大颗多汁！','颜值和口感双爆棚','第一口就爱上，酸甜比例完美'],
  168, 128, 650,
  '[{"name":"规格","value":"500g/1kg/2kg礼盒"},{"name":"产地","value":"丹东东港"}]'::jsonb,
  ARRAY['https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_80c57f5b-0b2b-4f3f-952c-1e83be9f761c.jpg'],
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_80c57f5b-0b2b-4f3f-952c-1e83be9f761c.jpg',
  'active', 3254, 'zh', 'douyin'
),
(
  demo_uid, '专业瑜伽垫防滑加厚', '运动户外', '瑜伽用品',
  '天然橡胶底层防滑，TPE环保面层，8mm加厚缓震，双面防滑纹路，附赠收纳绑带。',
  ARRAY['天然橡胶底防滑','TPE环保材质','8mm加厚缓震','183×68cm大尺寸'],
  ARRAY['终于找到不打滑的瑜伽垫了！','8mm厚度跪着膝盖不疼','颜值超高，铺在地上舍不得踩'],
  298, 198, 734,
  '[{"name":"颜色","value":"深空灰/薰衣草紫/翠绿/珊瑚橙"},{"name":"厚度","value":"6mm/8mm/10mm"}]'::jsonb,
  ARRAY['https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_33bf6284-b62b-4edd-97b9-b8cca25348b2.jpg'],
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_33bf6284-b62b-4edd-97b9-b8cca25348b2.jpg',
  'active', 2109, 'zh', 'douyin'
);

-- ── 示例视频项目 ──────────────────────────────────────────────────────────
INSERT INTO public.video_projects (
  user_id, title, status, video_style, duration,
  resolution, progress, storyboard, materials,
  predicted_completion_rate, predicted_click_rate,
  video_url, thumbnail_url
) VALUES
(
  demo_uid, '保湿面霜春日焕肤种草视频', 'completed',
  '清新自然', 30, '1080x1920', 100,
  '[{"id":"s1","index":1,"scene":"产品特写","description":"玻尿酸面霜缓缓涂抹，水润光泽感十足","duration":5},{"id":"s2","index":2,"scene":"使用过程","description":"模特轻拍面霜，快速吸收，肌肤水润发光","duration":8}]'::jsonb,
  '[]'::jsonb, 72.5, 8.3, NULL,
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_3c5358b7-3833-485e-a51a-376eea98ac18.jpg'
),
(
  demo_uid, '无线耳机沉浸体验测评', 'completed',
  '科技简约', 45, '1080x1920', 100,
  '[{"id":"s1","index":1,"scene":"产品开箱","description":"高质感包装缓缓打开，耳机质感特写","duration":6},{"id":"s2","index":2,"scene":"佩戴展示","description":"模特戴上耳机，沉浸享受音乐场景","duration":10}]'::jsonb,
  '[]'::jsonb, 68.2, 6.9, NULL,
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_36d53a2c-dba0-4693-947c-3a95e0f4684f.jpg'
),
(
  demo_uid, '跑步鞋碳板测试挑战', 'completed',
  '运动激情', 60, '1080x1920', 100,
  '[{"id":"s1","index":1,"scene":"产品展示","description":"碳纤维板结构拆解特写","duration":5},{"id":"s2","index":2,"scene":"实测场景","description":"穿着跑步鞋在操场冲刺，脚步轻盈","duration":15}]'::jsonb,
  '[]'::jsonb, 81.4, 11.2, NULL,
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_20ed12af-c9e6-44bc-ac20-502c2f68466d.jpg'
),
(
  demo_uid, '智能手表一周健康打卡', 'processing',
  '生活记录', 45, '1080x1920', 65,
  '[{"id":"s1","index":1,"scene":"晨跑监测","description":"早晨跑步心率实时显示画面","duration":8},{"id":"s2","index":2,"scene":"睡眠数据","description":"手表睡眠质量报告截图动画","duration":7}]'::jsonb,
  '[]'::jsonb, NULL, NULL, NULL, NULL
),
(
  demo_uid, '保温杯户外露营vlog', 'completed',
  '生活美学', 35, '1080x1920', 100,
  '[{"id":"s1","index":1,"scene":"露营场景","description":"山野露营，保温杯配热咖啡的惬意画面","duration":8},{"id":"s2","index":2,"scene":"保温效果演示","description":"冰块放入杯中，12小时后仍有冰块对比","duration":6}]'::jsonb,
  '[]'::jsonb, 75.8, 9.1, NULL,
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_880b4ffc-93f3-4cca-a86d-a278f8b2ce75.jpg'
),
(
  demo_uid, '草莓礼盒开箱测评', 'completed',
  '美食探店', 30, '1080x1920', 100,
  '[{"id":"s1","index":1,"scene":"礼盒开箱","description":"精美礼盒打开瞬间，红润草莓密密排列","duration":5},{"id":"s2","index":2,"scene":"品尝反应","description":"咬下大颗草莓，汁水四溢慢镜头","duration":8}]'::jsonb,
  '[]'::jsonb, 88.6, 14.3, NULL,
  'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_80c57f5b-0b2b-4f3f-952c-1e83be9f761c.jpg'
),
(
  demo_uid, '瑜伽垫晨间练习日常', 'draft',
  '清晨治愈', 40, '1080x1920', 0,
  '[]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL
),
(
  demo_uid, '连衣裙夏日穿搭合集', 'failed',
  '时尚穿搭', 50, '1080x1920', 0,
  '[{"id":"s1","index":1,"scene":"穿搭展示","description":"多套连衣裙搭配方案轮播","duration":10},{"id":"s2","index":2,"scene":"街拍场景","description":"在商业街实拍，展示连衣裙飘逸效果","duration":12}]'::jsonb,
  '[]'::jsonb, NULL, NULL, NULL,
  'https://miaoda-image.cdn.bcebos.com/img/corpus/574d7ba9eb25407fb5d620738c889a15.jpg'
);

-- ── 示例素材 ──────────────────────────────────────────────────────────────
INSERT INTO public.materials (user_id, name, type, url, size, width, height) VALUES
(demo_uid, '面霜产品白底图.jpg', 'image', 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_3c5358b7-3833-485e-a51a-376eea98ac18.jpg', 245760, 1080, 1080),
(demo_uid, '无线耳机产品图.jpg', 'image', 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_36d53a2c-dba0-4693-947c-3a95e0f4684f.jpg', 312800, 1080, 1080),
(demo_uid, '跑步鞋正侧面图.jpg', 'image', 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_20ed12af-c9e6-44bc-ac20-502c2f68466d.jpg', 289400, 1080, 1080),
(demo_uid, '智能手表展示图.jpg', 'image', 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_f630155c-927a-44cd-83a6-b289fa885967.jpg', 198600, 1080, 1080),
(demo_uid, '保温杯生活场景图.jpg', 'image', 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_880b4ffc-93f3-4cca-a86d-a278f8b2ce75.jpg', 276300, 1080, 1080),
(demo_uid, '草莓礼盒开箱封面.jpg', 'image', 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_80c57f5b-0b2b-4f3f-952c-1e83be9f761c.jpg', 334200, 1080, 1080),
(demo_uid, '瑜伽垫铺开全景图.jpg', 'image', 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_33bf6284-b62b-4edd-97b9-b8cca25348b2.jpg', 221500, 1920, 1080),
(demo_uid, '连衣裙穿搭主图.jpg', 'image', 'https://miaoda-image.cdn.bcebos.com/img/corpus/574d7ba9eb25407fb5d620738c889a15.jpg', 258900, 1080, 1350);

END $$;
