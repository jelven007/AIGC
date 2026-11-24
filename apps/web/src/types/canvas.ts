export type CanvasNodeType = 'text' | 'image' | 'video' | 'audio' | 'group';
export interface CanvasTask {
  request_key: string;
  jobId?: string;
  status: string;
  progress?: number;
  error?: string;
}
export interface CanvasNodeData extends Record<string, unknown> {
  name: string;
  text?: string;
  prompt?: string;
  url?: string;
  materialId?: string;
  size?: string;
  quality?: string;
  task?: CanvasTask;
}
export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: CanvasNodeData;
  parentId?: string;
  extent?: 'parent';
  width?: number;
  height?: number;
  selected?: boolean;
  dragging?: boolean;
  measured?: { width?: number; height?: number };
  style?: Record<string, string | number>;
}
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  selected?: boolean;
}
export interface CanvasDocument {
  schemaVersion: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
}
export interface CanvasProject {
  id: string;
  user_id: string;
  title: string;
  document: CanvasDocument;
  revision: number;
  created_at: string;
  updated_at: string;
}
