import React from 'react';
import { cn } from '@/lib/utils';
const Footer = () => {
  return <footer className="bg-black/5 backdrop-blur-sm border-t border-white/10 py-8 mt-16">
    <div className="container-custom">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="col-span-1 md:col-span-2">
          <h3 className="text-xl font-bold mb-4 text-scriptgenius-blue">Shopro-电商AIGC带货视频</h3>
          <p className="text-sm text-muted-foreground mb-4">为抖音，小红书快速生成优化脚本，借助我们的AI技术。</p>

        </div>


      </div>
    </div>
  </footer>;
};
export default Footer;