import React from "react";
import GlassCard from "./ui/GlassCard";
interface Testimonial {
  name: string;
  role: string;
  content: string;
  platform: string;
  metrics: string;
  avatar: string;
}
const testimonials: Testimonial[] = [{
  name: "张明轩",
  role: "科技博主",
  content: "借助本平台，我能够用有效的钩子构建我的视频。结果：我的留存率提高了24%，收入也随之增长！",
  platform: "抖音",
  metrics: "观看时长+38%",
  avatar: "张"
}, {
  name: "李雅晴",
  role: "生活方式内容创作者",
  content: "AI为我的TikTok内容建议了一个我从未想过要探索的原创角度。我的参与率爆炸式增长，我再也离不开它了！",
  platform: "TikTok",
  metrics: "一个月内300万+观看",
  avatar: "李"
}, {
  name: "王商杰",
  role: "商业教练",
  content: "我过去花费数小时编写脚本。该系统为我节省了宝贵时间，同时让我的视频更加动态和引人入胜。",
  platform: "Instagram",
  metrics: "3个月内粉丝+64%",
  avatar: "王"
}];
const TestimonialSection: React.FC = () => {
  return <section id="testimonials" className="section-padding bg-scriptgenius-white">
      <div className="container-custom">
        <div className="text-center mb-12">
          <span className="px-3 py-1 text-sm font-medium text-scriptgenius-blue bg-scriptgenius-blue/10 rounded-full mb-3 inline-block">
            用户评价
          </span>
          <h2 className="heading-2 mb-4">
            提升<span className="text-gradient">表现</span>的创作者
          </h2>
          <p className="text-lg text-scriptgenius-black/70 max-w-2xl mx-auto">
            了解像您一样的创作者如何通过本系统转变内容并增加受众
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => <GlassCard key={index} className="h-full flex flex-col" hover="lift">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className="w-12 h-12 rounded-full bg-scriptgenius-blue text-white flex items-center justify-center font-medium text-lg mr-3">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <h4 className="font-semibold text-scriptgenius-black">
                      {testimonial.name}
                    </h4>
                    <p className="text-sm text-scriptgenius-black/60">
                      {testimonial.role}
                    </p>
                  </div>
                </div>
                
              </div>
              
              <div className="flex-1">
                <p className="text-scriptgenius-black/80 mb-4 italic">
                  "{testimonial.content}"
                </p>
              </div>
              
              <div className="mt-auto pt-4 border-t border-gray-100">
                <div className="flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm font-medium text-green-600">
                    {testimonial.metrics}
                  </span>
                </div>
              </div>
            </GlassCard>)}
        </div>
        
      </div>
    </section>;
};
export default TestimonialSection;