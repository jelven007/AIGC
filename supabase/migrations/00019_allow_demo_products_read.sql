-- 允许所有已登录用户查看演示商品数据（固定的 demo user_id）
CREATE POLICY "allow_read_demo_products"
  ON products
  FOR SELECT
  TO authenticated
  USING (user_id = '7d58d08f-8aa3-43f5-a30f-b7495d59d147'::uuid);