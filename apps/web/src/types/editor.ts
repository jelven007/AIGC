/** 编辑工程的共享数据类型；组件与页面共同依赖这一层。 */
export interface TrackItem {
  id: string;
  trackId: string;
  name: string;
  start: number;
  duration: number;
  type: 'video' | 'audio' | 'text' | 'image';
  url?: string;
  scale?: number;
  opacity?: number;
  volume?: number;
  speed?: number;
  sourceStart?: number;
  hidden?: boolean;
  locked?: boolean;
  fontStyle?: any;
  keyframes?: { time: number; property: string; value: number }[];
  x?: number;
  y?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  filter?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  mute?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  pan?: number;
  denoise?: string;
  reverb?: string;
  pitch?: number;
  eqBands?: Record<string, number>;
  echo?: number;
  voiceEffect?: 'none' | 'robot';
  text?: string;
  fontSize?: number;
  fontColor?: string;
  fontFamily?: string;
  strokeColor?: string;
  strokeWidth?: number;
  bgColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  isBold?: boolean;
  isItalic?: boolean;
  animation?: string;
  entrance?: string;
  exit?: string;
}

export interface PipSettings {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  blendMode: string;
}

export interface PipLayer {
  id: string;
  name: string;
  url?: string;
  type?: 'video' | 'image';
  visible: boolean;
  locked: boolean;
}
