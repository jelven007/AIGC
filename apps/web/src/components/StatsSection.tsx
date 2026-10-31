
import React from 'react';
import { Clock, TrendingUp, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import GlassCard from './ui/GlassCard';

const stats = [
  {
    icon: <Clock className="w-8 h-8" />,
    value: "90%",
    label: "节省时间",
    description: "创作者可节省高达90%的脚本创作时间",
  },
  {
    icon: <TrendingUp className="w-8 h-8" />,
    value: "3.2×",
    label: "观看时长提升",
    description: "AI生成的脚本平均提升观看时长",
  },
  {
    icon: <Users className="w-8 h-8" />,
    value: "10K+",
    label: "满意创作者",
    description: "超过1万名创作者每周使用本平台",
  },
];

const StatsSection = () => {
  return (
    <section className="py-16 relative overflow-hidden">
      <div className="absolute inset-0 bg-scriptgenius-blue/5 skew-y-3 transform -translate-y-1/2"></div>
      
      <div className="container-custom relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {stats.map((stat, index) => (
            <GlassCard 
              key={index}
              className={cn(
                "p-8 flex flex-col items-center text-center",
                index === 1 ? "md:-mt-8" : ""
              )}
            >
              <div className="bg-scriptgenius-blue/10 p-3 rounded-full mb-4 text-scriptgenius-blue">
                {stat.icon}
              </div>
              
              <div className="text-4xl font-bold mb-2 text-scriptgenius-blue">
                {stat.value}
              </div>
              
              <div className="text-lg font-semibold mb-3">
                {stat.label}
              </div>
              
              <p className="text-scriptgenius-black/70">
                {stat.description}
              </p>
            </GlassCard>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
