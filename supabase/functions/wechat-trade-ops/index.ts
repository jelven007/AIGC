import { handleCashTradeOps } from '../_shared/cash-trade-ops.ts';
export const handleWechatTradeOps = (req: Request) => handleCashTradeOps(req, 'wechat');
Deno.serve(handleWechatTradeOps);
