import { handleCashTradeOps } from '../_shared/cash-trade-ops.ts';
export const handleAlipayTradeOps = (req: Request) => handleCashTradeOps(req, 'alipay');
Deno.serve(handleAlipayTradeOps);
