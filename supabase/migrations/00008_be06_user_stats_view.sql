
-- BE-06: 用户统计视图（Dashboard 聚合数据）
CREATE OR REPLACE VIEW user_stats AS
SELECT
  p.id                                          AS user_id,
  p.username,
  COUNT(DISTINCT vp.id)                         AS total_projects,
  COUNT(DISTINCT CASE WHEN vp.status='completed' THEN vp.id END) AS completed_projects,
  COUNT(DISTINCT pr.id)                         AS total_products,
  COUNT(DISTINCT s.id)                          AS total_scripts,
  COUNT(DISTINCT sa.id)                         AS total_style_analyses,
  COUNT(DISTINCT m.id)                          AS total_materials,
  COALESCE(SUM(CASE WHEN cl.type='deduct' THEN ABS(cl.amount) END), 0) AS total_credits_used,
  p.created_at
FROM profiles p
LEFT JOIN video_projects vp ON vp.user_id = p.id
LEFT JOIN products pr       ON pr.user_id  = p.id
LEFT JOIN scripts s         ON s.user_id   = p.id
LEFT JOIN style_analyses sa ON sa.user_id  = p.id
LEFT JOIN materials m       ON m.user_id   = p.id
LEFT JOIN credit_logs cl    ON cl.user_id  = p.id
GROUP BY p.id, p.username, p.created_at;

CREATE OR REPLACE FUNCTION can_view_own_stats(stat_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT stat_user_id = auth.uid();
$$;
