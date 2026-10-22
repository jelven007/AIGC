// 剪辑工程协议 v1：参数由业务 API 校验，FFmpeg Worker 二次校验。
import { RENDER_TRANSITIONS, RENDER_BLENDS } from './render-effects.ts';
export function validateRender(raw: Record<string, any>) {
  const number = (value: unknown, min: number, max: number, label: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}超出允许范围`);
  };
  if (raw.version !== 1 || !Array.isArray(raw.tracks) || raw.tracks.length < 1 || raw.tracks.length > 80) throw new Error('工程应包含1–80个轨道元素');
  number(raw.duration, 0.1, 600, '工程时长');
  if (![24, 25, 30, 60].includes(raw.fps) || ![720, 1080, 2160].includes(raw.height)
    || !['16:9', '9:16', '1:1', '4:3', '3:4', '4:5'].includes(raw.ratio)) throw new Error('输出规格不支持');
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 80) throw new Error('标题应为1–80字');
  if (raw.transition !== undefined && raw.transition !== 'none' && !RENDER_TRANSITIONS.some(effect => effect.id === raw.transition)) throw new Error('转场不支持');
  if (raw.transitionDuration !== undefined) number(raw.transitionDuration, .02, 2, '转场时长');
  const ids = new Set();
  for (const item of raw.tracks) {
    if (!item || !['video', 'image', 'audio', 'text'].includes(item.type) || typeof item.id !== 'string' || !item.id || item.id.length > 200 || ids.has(item.id)) throw new Error('轨道类型或标识不正确');
    ids.add(item.id);
    number(item.start, 0, raw.duration, '轨道开始时间');
    number(item.duration, 0.02, raw.duration, '轨道时长');
    if (item.start + item.duration > raw.duration + 0.05) throw new Error('轨道超出工程时长');
    if (item.type !== 'text' && (typeof item.url !== 'string' || !item.url.startsWith('https://') || item.url.length > 4096)) throw new Error('请先上传轨道素材');
    if (item.type === 'text' && (typeof item.text !== 'string' || !item.text || item.text.length > 2000)) throw new Error('字幕文本不正确');
    for (const [key, min, max] of [
      ['sourceStart', 0, 36000], ['speed', 0.25, 4], ['scale', 1, 400], ['opacity', 0, 100],
      ['x', -100, 200], ['y', -100, 200], ['rotation', -360, 360], ['volume', 0, 200],
      ['fadeIn', 0, 600], ['fadeOut', 0, 600], ['brightness', 0, 200], ['contrast', 0, 200],
      ['saturation', 0, 200], ['filterIntensity', 0, 100], ['fontSize', 8, 300], ['strokeWidth', 0, 20], ['pan', -100, 100], ['pitch', -12, 12], ['echo', 0, 100],
    ] as const) if (item[key] !== undefined) number(item[key], min, max, key);
    if (item.eqBands !== undefined) {
      if (!['audio', 'video'].includes(item.type) || !item.eqBands || typeof item.eqBands !== 'object' || Array.isArray(item.eqBands)) throw new Error('均衡器参数不正确');
      for (const [frequency, gain] of Object.entries(item.eqBands)) {
        if (!['32', '64', '125', '250', '500', '1000', '2000', '4000', '8000', '16000'].includes(frequency)) throw new Error('均衡器频段不支持');
        number(gain, -12, 12, '均衡器增益');
      }
    }
    if (item.voiceEffect !== undefined && !['none', 'robot'].includes(item.voiceEffect)
      || !['audio', 'video'].includes(item.type) && (item.voiceEffect || item.echo !== undefined)) throw new Error('音频效果不支持此轨道');
    if (item.denoise !== undefined && !['无降噪', '轻度去噪', '深度纯音'].includes(item.denoise)
      || item.reverb !== undefined && !['', '原声纯净', '录音棚', 'KTV沉浸', '大厅空间', '广播电台', '温暖剧场'].includes(item.reverb)) throw new Error('降噪或混响档位不支持');
    if ((item.fadeIn ?? 0) > item.duration || (item.fadeOut ?? 0) > item.duration) throw new Error('淡变时间不可超过轨道时长');
    if (item.layer !== undefined) number(item.layer, 0, 1000, '图层');
    if (item.blendMode !== undefined && !RENDER_BLENDS.some(mode => mode.id === item.blendMode)
      || item.blendMode && item.blendMode !== 'normal' && !['image', 'video'].includes(item.type)) throw new Error('混合模式不支持此轨道');
    if (item.chromaKey !== undefined) {
      const key = item.chromaKey;
      if (!['image', 'video'].includes(item.type) || !key || typeof key !== 'object'
        || typeof key.color !== 'string' || !/^#?[0-9a-f]{6}$/i.test(key.color)) throw new Error('色键颜色应为六位RGB颜色');
      number(key.similarity, .01, 1, '色键容差'); number(key.smoothness, 0, 1, '色键平滑');
    }
    if (item.personMask !== undefined) {
      const mask = item.personMask;
      if (!['image', 'video'].includes(item.type) || item.chromaKey !== undefined || !mask
        || mask.model !== 'pphumanseg-2023mar') throw new Error('人物分割模型或轨道不支持');
      number(mask.threshold, .1, .9, '人物分割阈值'); number(mask.feather, 0, 5, '人物边缘平滑');
    }
    if (item.keyframes && (!Array.isArray(item.keyframes) || item.keyframes.length > 100)) throw new Error('关键帧数量不支持');
    const ranges: Record<string, [number, number]> = { x: [-100, 200], y: [-100, 200], scale: [1, 400], opacity: [0, 100], rotation: [-360, 360], volume: [0, 200] };
    for (const frame of item.keyframes || []) {
      if (!frame || !['x', 'y', 'scale', 'opacity', 'rotation', 'volume'].includes(frame.property)) throw new Error('关键帧属性不支持');
      if (item.type === 'text' && !['x', 'y', 'opacity'].includes(frame.property)
        || item.type === 'audio' && frame.property !== 'volume'
        || item.type === 'image' && frame.property === 'volume') throw new Error('此轨道不支持所选关键帧属性');
      number(frame.time, 0, item.duration, '关键帧时间'); number(frame.value, ...ranges[frame.property], '关键帧值');
    }
    if (item.animation) throw new Error('请使用已接入的字幕入场/出场动画');
    if (item.entrance && !['ta1', 'ta2'].includes(item.entrance) || item.exit && !['ta5', 'ta6'].includes(item.exit)) throw new Error('字幕动画未接入成片渲染');
  }
  const main = raw.tracks.filter(item => ['video', 'image'].includes(item.type) && (item.trackId ?? 'video') === 'video')
    .sort((a, b) => a.start - b.start);
  if (raw.transition && raw.transition !== 'none' && main.some((item, index) => index > 0
    && main[index - 1].start + main[index - 1].duration > item.start + .001)) throw new Error('转场主轨不可重叠，请将叠加素材放入画中画轨');
  return raw;
}
