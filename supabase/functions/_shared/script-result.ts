/** 同步生成与离线评估共用纯输出契约；不依赖平台、密钥或模型客户端。 */
export function parseScriptResult(content: string) {
  const text = (value: unknown, max: number): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('模型返回文本字段不正确');
    return value.trim();
  };
  if (typeof content !== 'string' || !content.trim() || content.length > 100000) throw new Error('模型脚本正文不正确');
  const json = content.match(/```json\s*([\s\S]*?)```/), prompt = content.match(/```prompt\s*([\s\S]*?)```/);
  if (!json || !prompt) throw new Error('模型缺少脚本场景或AIGC提示词');
  let scenes: any;
  try { scenes = JSON.parse(json[1]); } catch { throw new Error('模型脚本JSON不正确'); }
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > 50) throw new Error('脚本场景数不正确');
  scenes = scenes.map((scene: any, index: number) => {
    if (!scene || scene.order !== index + 1 || !Number.isInteger(scene.duration)
      || scene.duration < 1 || scene.duration > 120
      || !['selling_point', 'pain_point', 'hook', 'cta'].includes(scene.layer)) throw new Error('脚本场景顺序、时长或分层不正确');
    return { ...scene, scene: text(scene.scene, 8000), visual: text(scene.visual, 8000),
      dialogue: text(scene.dialogue, 8000), prompt: text(scene.prompt, 8000) };
  });
  return { scenes, prompt_text: text(prompt[1], 12000), full_content: content };
}
