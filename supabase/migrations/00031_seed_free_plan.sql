-- 新环境必须有免费套餐，否则 handle_new_user 无法完成原子初始化。
-- 只补缺失的免费套餐，不调整已有套餐价格或权益。
INSERT INTO public.plans(name,level,price,credits,features,limits)
SELECT '免费版',0,0,20,
  '["注册赠送20积分","商品与视频任务管理"]'::jsonb,
  '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.plans WHERE name='免费版' AND price=0
);
