import React from 'react';
import { motion } from 'framer-motion';
import { Mail, Phone, MapPin, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import GlassCard from './ui/GlassCard';
import { useToast } from '@/hooks/use-toast';

const ContactSection = () => {
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "消息已发送",
      description: "感谢您的联系，我们会尽快回复您！",
    });
  };

  const contactInfo = [
    {
      icon: <Mail className="w-6 h-6" />,
      title: "邮箱地址",
      content: "xxxxx@163.com",
      href: "mailto:xxxxx@163.com"
    },
    {
      icon: <Phone className="w-6 h-6" />,
      title: "联系电话",
      content: "010-xxxxxxxx",
      href: "tel:010-xxxxxxxx"
    },
    {
      icon: <MapPin className="w-6 h-6" />,
      title: "办公地址",
      content: "北京市朝阳区创新大厦",
      href: "#"
    }
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6 }
    }
  };

  return (
    <section id="contact" className="py-20 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-scriptgenius-blue/5 via-transparent to-scriptgenius-blue-light/5"></div>
      
      <div className="container-custom relative z-10">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          className="text-center mb-16"
        >
          <motion.h2 variants={itemVariants} className="text-4xl md:text-5xl font-bold mb-6">
            <span className="bg-gradient-to-r from-scriptgenius-blue to-scriptgenius-blue-light bg-clip-text text-transparent">
              联系我们
            </span>
          </motion.h2>
          
          <motion.p variants={itemVariants} className="text-xl text-scriptgenius-black/70 max-w-3xl mx-auto leading-relaxed">
            有任何问题或建议？我们很乐意为您提供帮助
          </motion.p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-6xl mx-auto">
          {/* 联系表单 */}
          <motion.div
            variants={itemVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <GlassCard className="p-8 h-full">
              <h3 className="text-2xl font-bold mb-6 text-scriptgenius-black">
                发送消息
              </h3>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">姓名</Label>
                    <Input 
                      id="name" 
                      placeholder="请输入您的姓名" 
                      required
                      className="border-scriptgenius-gray/30 focus:border-scriptgenius-blue"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">邮箱</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="请输入您的邮箱" 
                      required
                      className="border-scriptgenius-gray/30 focus:border-scriptgenius-blue"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="subject">主题</Label>
                  <Input 
                    id="subject" 
                    placeholder="请输入消息主题"
                    className="border-scriptgenius-gray/30 focus:border-scriptgenius-blue"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="message">消息内容</Label>
                  <Textarea 
                    id="message" 
                    placeholder="请详细描述您的问题或建议..."
                    rows={5}
                    required
                    className="border-scriptgenius-gray/30 focus:border-scriptgenius-blue resize-none"
                  />
                </div>
                
                <Button 
                  type="submit" 
                  className="w-full button-primary group"
                >
                  <Send className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform duration-300" />
                  发送消息
                </Button>
              </form>
            </GlassCard>
          </motion.div>

          {/* 联系信息 */}
          <motion.div
            variants={itemVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="space-y-6"
          >
            <GlassCard className="p-8">
              <h3 className="text-2xl font-bold mb-6 text-scriptgenius-black">
                联系信息
              </h3>
              
              <div className="space-y-6">
                {contactInfo.map((info, index) => (
                  <motion.a
                    key={index}
                    href={info.href}
                    className="flex items-start space-x-4 p-4 rounded-lg hover:bg-scriptgenius-blue/5 transition-colors duration-300 group"
                    whileHover={{ x: 4 }}
                  >
                    <div className="bg-scriptgenius-blue/10 p-3 rounded-full text-scriptgenius-blue group-hover:bg-scriptgenius-blue/20 transition-colors duration-300">
                      {info.icon}
                    </div>
                    <div>
                      <h4 className="font-semibold text-scriptgenius-black mb-1">
                        {info.title}
                      </h4>
                      <p className="text-scriptgenius-black/70">
                        {info.content}
                      </p>
                    </div>
                  </motion.a>
                ))}
              </div>
            </GlassCard>

            <GlassCard className="p-8">
              <h3 className="text-xl font-bold mb-4 text-scriptgenius-black">
                工作时间
              </h3>
              <div className="space-y-2 text-scriptgenius-black/70">
                <p>周一至周五：9:00 - 18:00</p>
                <p>周六：10:00 - 16:00</p>
                <p>周日：休息</p>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;