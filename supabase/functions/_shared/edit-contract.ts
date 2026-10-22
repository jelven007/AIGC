export interface EditSource {
  id: string; type: 'video' | 'audio'; url: string;
  start: number; duration: number; sourceStart: number; speed: number;
}
export interface EditRequest {
  mode: 'beats' | 'subtitles'; title: string; source: EditSource; confirmed_credit_cost: number;
}
export function editInput(raw: any): EditRequest {
  const finite = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const source = raw?.source;
  if (!raw || !['beats', 'subtitles'].includes(raw.mode)
    || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 80
    || !source || !['video', 'audio'].includes(source.type) || typeof source.id !== 'string'
    || !source.id || source.id.length > 200 || typeof source.url !== 'string'
    || !source.url.startsWith('https://') || source.url.length > 4096
    || !finite(source.start, 0, 600) || !finite(source.duration, .1, 600)
    || source.start + source.duration > 600 || !finite(source.sourceStart ?? 0, 0, 36000)
    || !finite(source.speed ?? 1, .25, 4)
    || !Number.isInteger(raw.confirmed_credit_cost) || raw.confirmed_credit_cost < 0
    || raw.confirmed_credit_cost > 100000) throw new Error('请选择已上传的音频或视频片段，并确认分析价格');
  return { mode: raw.mode, title: raw.title.trim(), source: { id: source.id, type: source.type, url: source.url,
    start: source.start, duration: source.duration, sourceStart: source.sourceStart ?? 0, speed: source.speed ?? 1 },
  confirmed_credit_cost: raw.confirmed_credit_cost };
}
export function editEvidence(raw: any, input: EditRequest) {
  if (!raw || !/^[a-f0-9]{64}$/.test(raw.source_hash)
    || typeof raw.duration !== 'number' || !Number.isFinite(raw.duration)
    || Math.abs(raw.duration - input.source.duration) > .05) throw new Error('音轨证据与原裁剪时长不匹配');
  if (input.mode === 'beats') {
    if (raw.algorithm !== 'spectral-flux-v1' || !Array.isArray(raw.beats) || raw.beats.length > 3000
      || typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1
      || raw.bpm !== null && (typeof raw.bpm !== 'number' || !Number.isFinite(raw.bpm) || raw.bpm < 40 || raw.bpm > 240)) {
      throw new Error('节拍检测结果不正确');
    }
    let previous = -1;
    for (const beat of raw.beats) {
      if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0 || beat >= raw.duration || beat <= previous) {
        throw new Error('节拍位置不正确');
      }
      previous = beat;
    }
    if (raw.beats.length < 8 && raw.bpm !== null) throw new Error('节拍数量不足以估计BPM');
  }
  return { duration: raw.duration, source_hash: raw.source_hash,
    ...(input.mode === 'beats' ? { algorithm: raw.algorithm, beats: raw.beats, confidence: raw.confidence, bpm: raw.bpm } : {}) };
}
