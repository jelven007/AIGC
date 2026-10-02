import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 作品标题统一生成规则：以用户提交生成任务时输入的提示词为准，
 * 压缩多余空白并截断为稳定摘要；提示词为空时兜底为明确的默认标题（严禁使用模型名称）。
 */
export function makeWorkTitle(promptText: string | null | undefined, fallback = '未命名作品'): string {
  const collapsed = String(promptText ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) return fallback
  return collapsed.length > 60 ? `${collapsed.slice(0, 60)}…` : collapsed
}
