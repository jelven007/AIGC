
import React from 'react';
import { ArrowRight, Lightbulb, Edit3, Sparkles } from 'lucide-react';
import GlassCard from './ui/GlassCard';

const steps = [
  {
    icon: <Lightbulb className="w-10 h-10 text-scriptgenius-blue" />,
    title: "提供您的想法",
    description: "只需输入您的视频创意，选择平台、语调和期望时长。",
  },
  {
    icon: <Sparkles className="w-10 h-10 text-scriptgenius-blue" />,
    title: "AI生成您的脚本",
    description: "我们的先进算法分析趋势，创建优化脚本以最大化互动效果。",
  },
  {
    icon: <Edit3 className="w-10 h-10 text-scriptgenius-blue" />,
    title: "随意定制",
    description: "修改您的脚本，更改语调或调整细节，完善您的内容。",
  },
];

const HowItWorksSection = () => {
  return (
    <section className="section-padding relative">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="heading-2 mb-4">
            <span className="text-gradient">如何使用</span>？
          </h2>
          <p className="text-lg text-scriptgenius-black/70 max-w-2xl mx-auto">
            一个简单高效的流程，几秒钟内创造引人入胜的脚本
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((step, index) => (
            <div 
              key={index} 
              className="relative"
            >
              <GlassCard 
                className="h-full flex flex-col items-center text-center p-8"
                hover="lift"
              >
                <div className="bg-scriptgenius-blue/10 p-4 rounded-full mb-6">
                  {step.icon}
                </div>
                <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                <p className="text-scriptgenius-black/70">{step.description}</p>
              </GlassCard>
              
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 right-0 transform translate-x-1/2 -translate-y-1/2 z-10">
                  <ArrowRight className="w-8 h-8 text-scriptgenius-blue" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
