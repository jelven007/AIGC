export interface TextMessage { role: string; content: string }

/** 服务端 OpenAI 兼容接口；方舟模型 ID 必须来自用户已开通的模型或推理接入点。 */
export function textProviderConfig() {
  const arkKey = Deno.env.get('ARK_API_KEY');
  const apiKey = arkKey || Deno.env.get('GLM_API_KEY') || Deno.env.get('DEEPSEEK_API_KEY');
  const base = (arkKey
    ? Deno.env.get('ARK_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3'
    : Deno.env.get('GLM_API_KEY')
      ? `${(Deno.env.get('GLM_BASE_URL') || 'https://www.sophnet.com/api/open-apis').replace(/\/+$/, '')}/v1`
      : Deno.env.get('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = arkKey ? Deno.env.get('ARK_TEXT_MODEL')
    : Deno.env.get('GLM_API_KEY') ? Deno.env.get('GLM_MODEL') || 'glm-5.3-flash'
      : Deno.env.get('DEEPSEEK_MODEL') || 'deepseek-chat';
  if (!apiKey || !model) throw new Error('请在服务端配置 ARK_API_KEY 和 ARK_TEXT_MODEL');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('文本模型地址必须使用 HTTPS');
  return { apiKey, model, url: `${base}/chat/completions` };
}

export async function requestTextModel(
  messages: TextMessage[],
  options: { stream?: boolean; temperature?: number; max_tokens?: number } = {},
) {
  const config = textProviderConfig();
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, stream: options.stream ?? false,
      temperature: options.temperature ?? 0.7, max_tokens: options.max_tokens ?? 4096 }),
    signal: AbortSignal.timeout(90_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`文本模型返回 HTTP ${response.status}`);
  return response;
}

export async function generateText(messages: TextMessage[]): Promise<string> {
  const response = await requestTextModel(messages);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('文本模型未返回正文');
  return text;
}
