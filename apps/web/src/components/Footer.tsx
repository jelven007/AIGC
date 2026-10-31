import React from 'react';
import { cn } from '@/lib/utils';
const Footer = () => {
  return <footer className="bg-black/5 backdrop-blur-sm border-t border-white/10 py-8 mt-16">
    <div className="container-custom">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="col-span-1 md:col-span-2">
          <h3 className="text-xl font-bold mb-4 text-scriptgenius-blue">视频生成平台</h3>
          <p className="text-sm text-muted-foreground mb-4">从分镜脚本和 AI 视频生成，到素材剪辑、配音与作品发布，连接每一步创作。</p>

        </div>


      </div>
    </div>
  </footer>;
};
export default Footer;
