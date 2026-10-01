
import React, { useState } from "react";
import GlassCard from "./ui/GlassCard";
import MagneticButton from "./ui/MagneticButton";
import { cn } from "@/lib/utils";

interface PricingPlan {
  name: string;
  price: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  buttonText: string;
}

const pricingPlans: PricingPlan[] = [
  {
    name: "免费版",
    price: "¥0",
    description: "适合新手开始和测试平台",
    features: [
      "每月3个脚本",
      "基础标题建议",
      "脚本时长限制5分钟",
      "邮件支持",
    ],
    buttonText: "免费开始",
  },
  {
    name: "专业版",
    price: "¥69",
    description: "适合想要优化内容的常规创作者",
    features: [
      "无限脚本",
      "SEO优化标题",
      "病毒式话题建议",
      "脚本最长15分钟",
      "可定制脚本结构",
      "优先支持",
    ],
    highlighted: true,
    buttonText: "免费试用专业版7天",
  },
  {
    name: "高级版",
    price: "¥139",
    description: "专业创作者的完整解决方案",
    features: [
      "包含专业版所有功能",
      "高级AI精细化每一行",
      "视频拍摄计划建议",
      "内容创意生成",
      "细分领域趋势分析",
      "专属支持和指导",
      "API集成到您的工具",
    ],
    buttonText: "开始使用高级版",
  },
];

const PricingSection: React.FC = () => {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");

  return (
    <section id="pricing" className="section-padding relative bg-gray-50">
      <div className="absolute inset-0 opacity-30 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-scriptgenius-blue/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-scriptgenius-blue/10 rounded-full blur-3xl"></div>
      </div>
      
      <div className="container-custom relative z-10">
        <div className="text-center mb-12">
          <span className="px-3 py-1 text-sm font-medium text-scriptgenius-blue bg-scriptgenius-blue/10 rounded-full mb-3 inline-block">
            透明定价
          </span>
          <h2 className="heading-2 mb-4">
            选择适合您<span className="text-gradient">需求</span>的计划
          </h2>
          <p className="text-lg text-scriptgenius-black/70 max-w-2xl mx-auto mb-8">
            为各类创作者提供灵活选择，从新手到专业人员
          </p>
          
          <div className="inline-flex items-center p-1 bg-gray-100 rounded-lg mb-8">
            <button
              onClick={() => setBillingPeriod("monthly")}
              className={cn(
                "px-4 py-2 rounded-md transition-all duration-300",
                billingPeriod === "monthly"
                  ? "bg-white shadow-sm text-scriptgenius-black"
                  : "text-scriptgenius-black/60 hover:text-scriptgenius-black"
              )}
            >
              月付
            </button>
            <button
              onClick={() => setBillingPeriod("yearly")}
              className={cn(
                "px-4 py-2 rounded-md transition-all duration-300 flex items-center",
                billingPeriod === "yearly"
                  ? "bg-white shadow-sm text-scriptgenius-black"
                  : "text-scriptgenius-black/60 hover:text-scriptgenius-black"
              )}
            >
              <span>年付</span>
              <span className="ml-2 bg-green-100 text-green-700 text-xs py-0.5 px-1.5 rounded-full">
                -20%
              </span>
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {pricingPlans.map((plan, index) => (
            <div
              key={index}
              className={cn(
                "relative transform transition-all duration-500",
                plan.highlighted ? "md:-translate-y-4" : ""
              )}
            >
              {plan.highlighted && (
                <div className="absolute -top-4 left-0 right-0 flex justify-center">
                  <div className="bg-scriptgenius-blue text-white text-xs font-semibold px-3 py-1 rounded-full shadow-blue">
                    最受欢迎
                  </div>
                </div>
              )}
              
              <GlassCard
                className="h-full flex flex-col"
                variant={plan.highlighted ? "blue" : "default"}
                hover="lift"
              >
                <div className="mb-6">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  <div className="mt-3 mb-2">
                    <span className="text-3xl font-bold">
                      {billingPeriod === "yearly"
                        ? `¥${Math.round(parseInt(plan.price.replace('¥', '')) * 0.8)}`
                        : plan.price}
                    </span>
                    <span className="text-scriptgenius-black/60 ml-1">
                      /月
                    </span>
                  </div>
                  <p className="text-sm text-scriptgenius-black/60">
                    {plan.description}
                  </p>
                </div>
                
                <div className="flex-1">
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                
                <MagneticButton
                  className={cn(
                    "w-full",
                    plan.highlighted
                      ? "button-primary"
                      : "button-secondary"
                  )}
                  onClick={() => {
                    document.getElementById('contact')?.scrollIntoView({ 
                      behavior: 'smooth',
                      block: 'start'
                    });
                  }}
                >
                  {plan.buttonText}
                </MagneticButton>
              </GlassCard>
            </div>
          ))}
        </div>
        
        <div className="mt-16 max-w-3xl mx-auto text-center">
          <GlassCard className="bg-gradient-to-r from-scriptgenius-blue/5 to-scriptgenius-blue/10">
            <h3 className="text-xl font-semibold mb-3">
              需要定制解决方案？
            </h3>
            <p className="text-scriptgenius-black/70 mb-4">
              联系我们，为您的企业或创作机构量身定制专属方案。
            </p>
            <a
              href="#contact"
              className="button-primary inline-flex"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('contact')?.scrollIntoView({ 
                  behavior: 'smooth',
                  block: 'start'
                });
              }}
            >
              联系商务团队
            </a>
          </GlassCard>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
