import React from "react";
import { cn } from "@/lib/utils";
import GlassCard from "./GlassCard";
interface ScriptCardProps {
  title: string;
  platform: "youtube" | "tiktok" | "instagram" | "douyin" | "xiaohongshu";
  duration: string;
  tone: string;
  content: string;
  className?: string;
  onEdit?: () => void;
  onRegenerate?: () => void;
}
const ScriptCard: React.FC<ScriptCardProps> = ({
  title,
  platform,
  duration,
  tone,
  content,
  className,
  onEdit,
  onRegenerate
}) => {
  const getPlatformIcon = () => {
    switch (platform) {
      case "youtube":
        return <svg className="w-5 h-5 fill-red-600" viewBox="0 0 24 24">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
          </svg>;
      case "tiktok":
      case "douyin":
        return <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.33 6.33 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z" fill="currentColor" />
          </svg>;
      case "instagram":
        return <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" fill="currentColor" />
          </svg>;
      case "xiaohongshu":
        return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="4" fill="#FF2442" />
            <path d="M8 10h8v1H8v-1zm0 2h8v1H8v-1zm0 2h6v1H8v-1z" fill="white" />
            <circle cx="7" cy="8" r="1" fill="white" />
          </svg>;
      default:
        return null;
    }
  };
  return <GlassCard className={cn("w-full max-w-2xl mx-auto", className)} variant="default" hover="lift">
      <div className="flex flex-col space-y-4">
        <div className="flex justify-between items-start">
          <h3 className="text-xl font-semibold text-scriptgenius-black">
            {title}
          </h3>
          <div className="flex items-center space-x-1 text-sm text-scriptgenius-blue bg-scriptgenius-blue/10 px-2 py-1 rounded-full">
            {getPlatformIcon()}
            <span className="capitalize">{platform}</span>
          </div>
        </div>

        

        <div className="mt-2 p-4 bg-white rounded-lg border border-gray-100 text-sm text-scriptgenius-black/80 leading-relaxed">
          {content}
        </div>

      </div>
    </GlassCard>;
};
export default ScriptCard;