import React, { useState, useEffect } from "react";
import { RocketIcon } from "@/assets/icons";
import MagneticButton from "./ui/MagneticButton";
import AnimatedBackground from "./ui/AnimatedBackground";
import { motion } from "framer-motion";
const HeroSection: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);
  const container = {
    hidden: {
      opacity: 0
    },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2
      }
    }
  };
  const item = {
    hidden: {
      opacity: 0,
      y: 20
    },
    visible: {
      opacity: 1,
      y: 0
    }
  };
  return <section className="relative pt-32 pb-20 md:pt-44 md:pb-28 overflow-hidden">
    <AnimatedBackground variant="circles" />

    {/* Decorative Elements */}
    <div className="absolute top-1/4 right-[10%] w-64 h-64 bg-blue-400 rounded-full mix-blend-multiply filter blur-5xl opacity-10 animate-float"></div>
    <div className="absolute bottom-1/4 left-[5%] w-72 h-72 bg-indigo-400 rounded-full mix-blend-multiply filter blur-5xl opacity-10 animate-float animation-delay-2000"></div>
    <div className="absolute top-1/3 left-[15%] w-60 h-60 bg-scriptgenius-blue rounded-full mix-blend-multiply filter blur-5xl opacity-10 animate-float animation-delay-4000"></div>

    <div className="container-custom relative z-10">
      <motion.div className="max-w-4xl mx-auto text-center" initial="hidden" animate="visible" variants={container}>
        <motion.div variants={item}>
          <span className="inline-block px-4 py-1.5 text-sm font-medium text-scriptgenius-blue bg-scriptgenius-blue/10 rounded-full mb-5 backdrop-blur-sm border border-scriptgenius-blue/20">
            颠覆性AI，打造卓越视频
          </span>
        </motion.div>

        <motion.h1 variants={item} className="heading-1 mb-6">
          创造<span className="text-gradient relative">
            前瞻性脚本
            <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 358 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9.01709C65 3.84305 127 0.665732 189 3.28417C251 5.90261 313 9.49363 357 9.01709" stroke="url(#paint0_linear_3_107)" strokeWidth="5" strokeLinecap="round" />
              <defs>
                <linearGradient id="paint0_linear_3_107" x1="3" y1="9" x2="357" y2="9" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#007AFF" stopOpacity="0" />
                  <stop offset="0.5" stopColor="#007AFF" />
                  <stop offset="1" stopColor="#007AFF" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </span> 转化您的受众
        </motion.h1>

        <motion.p variants={item} className="text-lg md:text-xl text-scriptgenius-black/70 max-w-2xl mx-auto mb-8">
          Shopro-电商AIGC带货视频生成前沿脚本，以独特且令人难忘的叙事风格吸引您的受众。
        </motion.p>

        <motion.div variants={item} className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4">
          <MagneticButton
            className="button-primary w-full sm:w-auto group relative overflow-hidden"
            onClick={() => {
              document.getElementById('contact')?.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
              });
            }}
          >
            <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-scriptgenius-blue to-scriptgenius-blue-light opacity-0 group-hover:opacity-100 transition-opacity duration-500"></span>
            <div className="flex items-center space-x-2 relative z-10">
              <span>创建卓越脚本</span>
              <RocketIcon className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </MagneticButton>


        </motion.div>
      </motion.div>

      <motion.div className="relative mt-16 max-w-5xl mx-auto rounded-2xl shadow-card overflow-hidden" initial={{
        opacity: 0,
        y: 40
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        duration: 0.7,
        delay: 0.6
      }}>
        <div className="aspect-w-16 aspect-h-9 relative bg-gradient-to-r from-scriptgenius-blue to-scriptgenius-blue-light rounded-2xl p-1">
          <div className="absolute top-0 left-0 w-full h-full rounded-2xl overflow-hidden z-10">
            <div className="absolute inset-0 bg-scriptgenius-blue-dark/10 backdrop-blur-[2px] rounded-2xl z-20"></div>
            <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center p-6 relative z-10">
              {/* Interface elements with layered design */}
              <div className="absolute top-1/4 right-1/4 w-72 h-72 bg-blue-100 rounded-full mix-blend-multiply filter blur-3xl opacity-40"></div>
              <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-indigo-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30"></div>

              <div className="w-full max-w-2xl mx-auto bg-gradient-to-b from-gray-50/90 to-white/90 backdrop-blur-sm rounded-xl p-6 shadow-soft border border-white/50 relative z-20">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 rounded-full bg-scriptgenius-blue"></div>
                    <span className="text-sm font-medium">Shopro-电商AIGC带货视频</span>
                  </div>
                  <div className="text-xs font-medium text-scriptgenius-blue bg-scriptgenius-blue/10 px-3 py-1 rounded-full shadow-soft backdrop-blur-sm">
                    电影级脚本 · 前沿技术
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="animate-pulse-subtle">
                    <div className="h-4 bg-gradient-to-r from-gray-200 to-gray-100 rounded w-3/4"></div>
                  </div>
                  <div className="animate-pulse-subtle animation-delay-200">
                    <div className="h-4 bg-gradient-to-r from-gray-200 to-gray-100 rounded"></div>
                    <div className="h-4 bg-gradient-to-r from-gray-200 to-gray-100 rounded mt-2"></div>
                    <div className="h-4 bg-gradient-to-r from-gray-200 to-gray-100 rounded w-5/6 mt-2"></div>
                  </div>
                  <div className="animate-pulse-subtle animation-delay-400">
                    <div className="h-4 bg-gradient-to-r from-gray-200 to-gray-100 rounded"></div>
                    <div className="h-4 bg-gradient-to-r from-gray-200 to-gray-100 rounded mt-2 w-5/6"></div>
                  </div>
                </div>

                <div className="flex justify-end mt-6">
                  <div className="inline-flex items-center justify-center px-4 py-2 bg-scriptgenius-blue text-white text-sm rounded-lg shadow-blue">
                    <span>生成专业脚本</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Floating elements around the interface */}
          <div className="absolute top-8 right-8 w-20 h-20 bg-white/20 backdrop-blur-xl rounded-full z-30 animate-float"></div>
          <div className="absolute bottom-12 left-12 w-16 h-16 bg-white/30 backdrop-blur-xl rounded-full z-30 animate-float animation-delay-1000"></div>
          <div className="absolute top-1/2 left-6 transform -translate-y-1/2 w-12 h-12 bg-white/20 backdrop-blur-xl rounded-full z-30 animate-float animation-delay-2000"></div>
        </div>

        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full z-30 border border-white/10">
          <span className="animate-pulse mr-1.5 inline-block w-2 h-2 bg-green-400 rounded-full"></span>
          免费创建您的第一个专业脚本
        </div>
      </motion.div>
    </div>
  </section>;
};
export default HeroSection;