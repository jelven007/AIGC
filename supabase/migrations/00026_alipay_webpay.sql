-- 00026_alipay_webpay.sql
-- 支付宝 AI 网页应用收款（alipay.trade.page.pay）网站支付集成：
-- 1) orders 表扩展支付渠道与支付宝交易号/退款累计字段；
-- 2) 新增 alipay_notify_events 异步通知事件表（持久化幂等，配合 notify_id/trade_no/trade_status 唯一键）；
-- 3) 新增 alipay_refunds 退款请求表（out_request_no 复用与累计退款金额校验，防重复退款）。
-- 注意：托管 Supabase 上 git push 不会自动应用迁移，需在 SQL Editor 手动执行本文件。

-- ── orders 扩展 ─────────────────────────────────────────────────────────────
ALTER TABLE "public"."orders"
  ADD COLUMN IF NOT EXISTS "pay_channel" text NOT NULL DEFAULT 'wechat',
  ADD COLUMN IF NOT EXISTS "alipay_trade_no" text,
  ADD COLUMN IF NOT EXISTS "refunded_amount" numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN "public"."orders"."pay_channel" IS '支付渠道：wechat / alipay';
COMMENT ON COLUMN "public"."orders"."alipay_trade_no" IS '支付宝交易号（trade_no）';
COMMENT ON COLUMN "public"."orders"."refunded_amount" IS '已成功退款累计金额（元），用于退款前累计校验';

-- ── 异步通知事件表（幂等） ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."alipay_notify_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "notify_id" text NOT NULL,
    "trade_no" text,
    "out_trade_no" text NOT NULL,
    "trade_status" text NOT NULL,
    "notify_type" text,
    "total_amount" text,
    "out_biz_no" text,
    "gmt_refund" text,
    "refund_fee" text,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "uq_alipay_notify_event" UNIQUE ("notify_id", "trade_no", "trade_status")
);

COMMENT ON TABLE "public"."alipay_notify_events" IS '支付宝异步通知事件去重表：重复通知命中唯一键即跳过业务处理';

-- 仅 service role 访问：开启 RLS 且不建任何策略
ALTER TABLE "public"."alipay_notify_events" ENABLE ROW LEVEL SECURITY;

-- ── 退款请求表（out_request_no 幂等与累计校验） ──────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."alipay_refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "order_id" "uuid" NOT NULL REFERENCES "public"."orders"("id"),
    "out_trade_no" text NOT NULL,
    "out_request_no" text NOT NULL,
    "refund_amount" numeric(12,2) NOT NULL,
    "refund_reason" text,
    "status" text NOT NULL DEFAULT 'init',
    "fund_change" text,
    "alipay_trade_no" text,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "uq_alipay_refund_request" UNIQUE ("out_request_no"),
    CONSTRAINT "alipay_refunds_status_check" CHECK ("status" = ANY (ARRAY['init'::text, 'requested'::text, 'success'::text, 'unknown'::text]))
);

COMMENT ON TABLE "public"."alipay_refunds" IS '支付宝退款请求表：新退款生成新 out_request_no；网络异常重试必须复用原 out_request_no';
COMMENT ON COLUMN "public"."alipay_refunds"."status" IS 'init=已落库未发出 / requested=已发出待确认 / success=退款成功 / unknown=结果待查询确认';

CREATE INDEX IF NOT EXISTS "idx_alipay_refunds_order" ON "public"."alipay_refunds" ("order_id");

ALTER TABLE "public"."alipay_refunds" ENABLE ROW LEVEL SECURITY;
