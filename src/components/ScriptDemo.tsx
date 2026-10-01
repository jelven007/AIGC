
import React, { useState } from "react";
import GlassCard from "./ui/GlassCard";
import ScriptCard from "./ui/ScriptCard";
import { 
  TikTokIcon, 
  XiaohongshuIcon, 
  RocketIcon 
} from "@/assets/icons";
import MagneticButton from "./ui/MagneticButton";
import { motion } from "framer-motion";
import { toast } from "sonner";

const platformOptions = [
  {
    id: "douyin",
    name: "抖音",
    icon: <TikTokIcon className="w-5 h-5" />,
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    icon: <XiaohongshuIcon className="w-5 h-5 text-red-500" />,
  },
];

const toneOptions = [
  { id: "inspirant", name: "励志" },
  { id: "drole", name: "幽默" },
  { id: "educatif", name: "教育" },
  { id: "controverse", name: "争议" },
  { id: "epique", name: "史诗" },
  { id: "narratif", name: "叙事" },
];

const styleOptions = [
  { id: "standard", name: "标准" },
  { id: "storytelling", name: "故事叙述" },
  { id: "disruptif", name: "颠覆性" },
  { id: "avant-garde", name: "前卫" },
  { id: "cinématique", name: "电影风格" },
];

const durationOptions = [
  { id: "30s", name: "30秒" },
  { id: "1min", name: "1分钟" },
  { id: "5min", name: "5分钟" },
  { id: "10min", name: "10分钟" },
];

const generateScriptContent = (topic: string, tone: string, style: string, duration: string, targetAudience: string, platform: string) => {
  const topics = {
    default: "神秘科技",
    tech: "未来科技",
    lifestyle: "生活方式",
    business: "商业秘密",
    health: "健康奥秘",
    education: "学习技巧"
  };

  const tones = {
    inspirant: {
      opening: "🔥 准备好改变你的人生了吗？",
      hook: "今天我要告诉你一个秘密，它将彻底改变你对",
      ending: "记住：成功者从不等待，他们创造机会！"
    },
    drole: {
      opening: "😂 你绝对不会相信我刚发现了什么...",
      hook: "如果有人告诉我这个关于",
      ending: "现在你知道了这个秘密，别忘了分享给朋友们！"
    },
    educatif: {
      opening: "📚 今天让我们深入了解一个重要话题：",
      hook: "研究表明，很少有人真正理解",
      ending: "希望这些知识能帮助你在生活中取得更好的成果。"
    },
    controverse: {
      opening: "⚡ 警告：这个视频可能会颠覆你的认知！",
      hook: "大多数人不知道的真相是，关于",
      ending: "真相就在那里，但不是每个人都准备好接受它。"
    },
    epique: {
      opening: "🎬 【史诗级揭秘】想象一个世界...",
      hook: "在历史的转折点，我们见证了",
      ending: "这就是我们这个时代的史诗故事！"
    },
    narratif: {
      opening: "📖 让我告诉你一个真实的故事...",
      hook: "故事开始于一个普通的日子，当时没人知道",
      ending: "这个故事告诉我们，有时现实比小说更精彩。"
    }
  };

  const styles = {
    standard: {
      structure: "简单直接的叙述方式",
      visual: "【清晰展示】",
      transition: "接下来"
    },
    storytelling: {
      structure: "引人入胜的故事叙述",
      visual: "【镜头切换到...】",
      transition: "故事的转折点来了..."
    },
    disruptif: {
      structure: "颠覆性的观点展示",
      visual: "【震撼画面】",
      transition: "但真相是..."
    },
    "avant-garde": {
      structure: "前卫实验性叙述",
      visual: "【艺术化呈现】",
      transition: "【戏剧性停顿】现在..."
    },
    "cinématique": {
      structure: "电影级叙述风格",
      visual: "【电影级镜头】",
      transition: "【背景音乐渐强】"
    }
  };

  const currentTone = tones[tone as keyof typeof tones] || tones.inspirant;
  const currentStyle = styles[style as keyof typeof styles] || styles.standard;
  
  const topicText = topic || "改变生活的秘密";
  const audienceText = targetAudience || "追求成功的人们";

  const durations = {
    "30s": {
      sections: 2,
      detail: "精简版",
      tips: "2个关键要点"
    },
    "1min": {
      sections: 3,
      detail: "完整版",
      tips: "3个实用技巧"
    },
    "5min": {
      sections: 5,
      detail: "深度解析版",
      tips: "5个详细步骤"
    },
    "10min": {
      sections: 7,
      detail: "全面指南版",
      tips: "7个完整策略"
    }
  };

  const currentDuration = durations[duration as keyof typeof durations] || durations["5min"];

  return `${currentStyle.visual} ${currentTone.opening}

👁️ 视觉钩子：
${currentTone.hook}${topicText}的看法。今天我将为${audienceText}揭示${currentDuration.tips}。

🧠 核心内容（${currentDuration.detail}）：
第一个秘密：${currentStyle.structure}
${currentStyle.visual}深入分析${topicText}的核心原理，这个方法已经帮助无数人改变了他们的生活轨迹。

${currentStyle.transition}

第二个关键点：实用性策略
${currentStyle.visual}我将展示如何将这些理论转化为实际行动。很多${audienceText}都因为掌握了这个方法而获得了意想不到的成功。

${currentDuration.sections >= 3 ? `
${currentStyle.transition}

第三个重点：避免常见误区
${currentStyle.visual}大多数人在尝试${topicText}时都会犯这些错误。了解这些陷阱能让你少走很多弯路。
` : ''}

${currentDuration.sections >= 5 ? `
${currentStyle.transition}

第四个洞察：进阶技巧
${currentStyle.visual}这是只有1%的人知道的高级方法。掌握这个技巧后，你将超越95%的竞争者。

${currentStyle.transition}

第五个秘密：持续成长
${currentStyle.visual}成功不是终点，而是一个持续的过程。这个方法将确保你能够持续改进和成长。
` : ''}

${currentDuration.sections >= 7 ? `
${currentStyle.transition}

第六个策略：建立系统
${currentStyle.visual}创建一个可重复的系统，让成功变成习惯而不是偶然。

${currentStyle.transition}

第七个境界：影响他人
${currentStyle.visual}当你掌握了这些方法，你不仅能改变自己，还能影响身边的人。
` : ''}

💫 启发性结论：
${currentTone.ending}

🚀 行动号召：
如果这个视频对你有帮助，记得点赞收藏！在评论区告诉我你最想了解的话题，我会制作更多有价值的内容。

✅ 优化标题建议：
- "${topicText}的${currentDuration.tips}，${audienceText}必看！"
- "我发现了${topicText}的终极秘密（改变人生）"
- "${topicText}：${audienceText}都在用的成功方法"

#${topicText.replace(/\s/g, '')} #成功秘诀 #生活技巧 #个人成长`;
};

const ScriptDemo: React.FC = () => {
  const [platform, setPlatform] = useState("douyin");
  const [tone, setTone] = useState("inspirant");
  const [style, setStyle] = useState("avant-garde");
  const [duration, setDuration] = useState("5min");
  const [topic, setTopic] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [scriptGenerated, setScriptGenerated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [generatedContent, setGeneratedContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const generateScript = () => {
    if (topic.trim() === "") return;
    
    setIsLoading(true);
    
    // Simulate IA processing with more realistic timing
    setTimeout(() => {
      const newContent = generateScriptContent(topic, tone, style, duration, targetAudience, platform);
      setGeneratedContent(newContent);
      setScriptGenerated(true);
      setIsLoading(false);
    }, 2500);
  };

  const handleEdit = () => {
    setIsEditing(!isEditing);
    if (!isEditing) {
      toast.success("进入编辑模式");
    } else {
      toast.success("保存修改成功");
    }
  };

  const handleRegenerate = () => {
    setIsLoading(true);
    toast.loading("正在重新生成脚本...");
    
    setTimeout(() => {
      const newContent = generateScriptContent(topic, tone, style, duration, targetAudience, platform);
      setGeneratedContent(newContent);
      setIsLoading(false);
      toast.success("脚本重新生成完成!");
    }, 2000);
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <section id="demo" className="section-padding relative">
      <div className="container-custom">
        <div className="text-center mb-12">
          <motion.h2 
            className="heading-2 mb-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            颠覆性<span className="text-gradient">AI</span>打造卓越脚本
          </motion.h2>
          <motion.p 
            className="text-lg text-scriptgenius-black/70 max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            我们的尖端AI分析新兴趋势，创造前卫脚本，以独特难忘的风格吸引您的受众。
          </motion.p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <motion.div 
            className="lg:col-span-5"
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
          >
            <GlassCard className="h-full backdrop-blur-xl">
              <motion.h3 
                className="text-xl font-semibold mb-6"
                variants={item}
              >
                创建卓越脚本
              </motion.h3>

              <div className="space-y-6">
                <motion.div variants={item}>
                  <label className="block text-sm font-medium text-scriptgenius-black mb-2">
                    视频平台
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {platformOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setPlatform(option.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-all hover:scale-105 ${
                          platform === option.id
                            ? "bg-scriptgenius-blue text-white"
                            : "bg-gray-100 text-scriptgenius-black hover:bg-gray-200"
                        }`}
                      >
                        {option.icon}
                        <span>{option.name}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>

                <motion.div variants={item}>
                  <label className="block text-sm font-medium text-scriptgenius-black mb-2">
                    您的视频概念
                  </label>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="例如：将改变世界的新技术"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-scriptgenius-blue focus:ring-1 focus:ring-scriptgenius-blue outline-none transition"
                  />
                </motion.div>

                <motion.div variants={item}>
                  <label className="block text-sm font-medium text-scriptgenius-black mb-2">
                    目标受众
                  </label>
                  <input
                    type="text"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder="例如：热爱科技的年轻成年人"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-scriptgenius-blue focus:ring-1 focus:ring-scriptgenius-blue outline-none transition"
                  />
                </motion.div>

                <motion.div variants={item}>
                  <label className="block text-sm font-medium text-scriptgenius-black mb-2">
                    视频语调
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {toneOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setTone(option.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all hover:scale-105 ${
                          tone === option.id
                            ? "bg-scriptgenius-blue text-white"
                            : "bg-gray-100 text-scriptgenius-black hover:bg-gray-200"
                        }`}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </motion.div>

                <motion.div variants={item}>
                  <label className="block text-sm font-medium text-scriptgenius-black mb-2">
                    叙事风格
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {styleOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setStyle(option.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all hover:scale-105 ${
                          style === option.id
                            ? "bg-scriptgenius-blue text-white"
                            : "bg-gray-100 text-scriptgenius-black hover:bg-gray-200"
                        }`}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </motion.div>

                <motion.div variants={item}>
                  <label className="block text-sm font-medium text-scriptgenius-black mb-2">
                    目标时长
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {durationOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setDuration(option.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all hover:scale-105 ${
                          duration === option.id
                            ? "bg-scriptgenius-blue text-white"
                            : "bg-gray-100 text-scriptgenius-black hover:bg-gray-200"
                        }`}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </motion.div>

                <motion.div variants={item}>
                  <div className="text-scriptgenius-blue text-sm flex items-center gap-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                    高级选项
                  </div>
                  
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-scriptgenius-black mb-1">
                        叙事结构优化
                      </label>
                      <div className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white">
                        前卫（实验性）
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-xs font-medium text-scriptgenius-black mb-1">
                        情感强度 (1-10)
                      </label>
                      <div className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white">
                        7
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-xs font-medium text-scriptgenius-black mb-1">
                        视觉建议
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-scriptgenius-blue rounded border"></div>
                        <span className="text-sm">包含镜头提示</span>
                      </div>
                    </div>
                  </div>
                </motion.div>

                <motion.div variants={item}>
                  <button
                    onClick={generateScript}
                    disabled={topic.trim() === "" || isLoading}
                    className={`w-full mt-4 group relative overflow-hidden transition-all duration-300 inline-flex items-center justify-center px-6 py-3 text-base font-medium text-white rounded-lg ${
                      topic.trim() === "" || isLoading
                        ? "bg-gray-400 cursor-not-allowed opacity-50"
                        : "bg-scriptgenius-blue hover:bg-scriptgenius-blue-dark shadow-blue hover:shadow-lg hover:scale-105"
                    }`}
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>正在生成脚本...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center space-x-2">
                        <span>生成独特脚本</span>
                        <RocketIcon className="w-5 h-5" />
                      </div>
                    )}
                  </button>
                </motion.div>
              </div>
            </GlassCard>
          </motion.div>

          <div className="lg:col-span-7">
            {scriptGenerated ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                <ScriptCard
                  title={topic || "AI生成脚本"}
                  platform={platform as any}
                  duration={duration}
                  tone={tone.charAt(0).toUpperCase() + tone.slice(1)}
                  content={generatedContent}
                  onEdit={handleEdit}
                  onRegenerate={handleRegenerate}
                />
              </motion.div>
            ) : (
              <motion.div 
                className="h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-100 p-6 relative overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.3 }}
              >
                {/* Decorative elements */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-100 rounded-full opacity-30 blur-3xl"></div>
                <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-scriptgenius-blue/10 rounded-full opacity-40 blur-3xl"></div>
                
                <div className="text-center max-w-md relative z-10">
                  <div className="mx-auto w-20 h-20 bg-scriptgenius-blue/10 rounded-full flex items-center justify-center mb-6 backdrop-blur-sm">
                    <RocketIcon className="w-10 h-10 text-scriptgenius-blue" />
                  </div>
                  <h3 className="text-2xl font-semibold text-scriptgenius-black mb-4">
                    新一代电影级脚本
                  </h3>
                  <p className="text-scriptgenius-black/70 mb-6">
                    我们的前沿AI将生成独特脚本，以卓越的叙事风格优化吸引您的受众。
                  </p>
                  <div className="flex flex-wrap justify-center gap-3 text-xs">
                    <span className="px-3 py-1.5 bg-scriptgenius-blue/10 text-scriptgenius-blue rounded-full">
                      优化叙事结构
                    </span>
                    <span className="px-3 py-1.5 bg-scriptgenius-blue/10 text-scriptgenius-blue rounded-full">
                      战略注意点
                    </span>
                    <span className="px-3 py-1.5 bg-scriptgenius-blue/10 text-scriptgenius-blue rounded-full">
                      高点击率标题
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ScriptDemo;
