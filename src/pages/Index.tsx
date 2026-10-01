
import React from 'react';
import Navbar from '@/components/Navbar';
import HeroSection from '@/components/HeroSection';
import HowItWorksSection from '@/components/HowItWorksSection';
import StatsSection from '@/components/StatsSection';
import ScriptDemo from '@/components/ScriptDemo';

import TestimonialSection from '@/components/TestimonialSection';
import PricingSection from '@/components/PricingSection';
import ContactSection from '@/components/ContactSection';
import Footer from '@/components/Footer';
import AnimatedBackground from '@/components/ui/AnimatedBackground';
import FloatingCTA from '@/components/ui/FloatingCTA';

const Index = () => {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      <AnimatedBackground />
      <Navbar />
      <main>
        <HeroSection />
        <StatsSection />
        <HowItWorksSection />
        <ScriptDemo />
        
        <TestimonialSection />
        <PricingSection />
        <ContactSection />
      </main>
      <Footer />
      <FloatingCTA threshold={400} />
    </div>
  );
};

export default Index;
