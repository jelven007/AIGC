
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RocketIcon } from '@/assets/icons';
import MagneticButton from './MagneticButton';

interface FloatingCTAProps {
  threshold?: number;
}

const FloatingCTA = ({ threshold = 300 }: FloatingCTAProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      setIsVisible(scrollPosition > threshold);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [threshold]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed bottom-6 right-6 z-50"
          initial={{ y: 100, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 100, opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          <div className="relative">
            {/* Pulsing circle behind button */}
            <AnimatePresence>
              {hover && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 0.15, scale: 1.5 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.5 }}
                  className="absolute inset-0 bg-scriptgenius-blue rounded-full"
                />
              )}
            </AnimatePresence>
            
            <MagneticButton
              className="button-primary group shadow-xl backdrop-blur-sm relative z-10 border border-scriptgenius-blue-light/20"
              strength={25}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              onClick={() => {
                document.getElementById('contact')?.scrollIntoView({ 
                  behavior: 'smooth',
                  block: 'start'
                });
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-scriptgenius-blue to-scriptgenius-blue-light opacity-0 group-hover:opacity-100 rounded-lg transition-opacity duration-500"></div>
              <div className="flex items-center space-x-2 relative z-10">
                <span>创建专业脚本</span>
                <RocketIcon className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
              </div>
            </MagneticButton>

            {/* Decorative floating elements */}
            <motion.div 
              className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full"
              animate={{ 
                y: [0, -8, 0],
                opacity: [0.7, 1, 0.7]
              }}
              transition={{ 
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
            <motion.div 
              className="absolute -bottom-1 -left-1 w-2 h-2 bg-white rounded-full"
              animate={{ 
                y: [0, 6, 0],
                opacity: [0.5, 0.8, 0.5]
              }}
              transition={{ 
                duration: 2.5,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.5
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FloatingCTA;
