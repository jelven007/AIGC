import React, { useState, useEffect } from "react";
import { LogoIcon } from "@/assets/icons";
import MagneticButton from "./ui/MagneticButton";
import { cn } from "@/lib/utils";
const Navbar: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const scrollToContact = () => {
    document.getElementById('contact')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };
  return <header className={cn("fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b", isScrolled ? "bg-white/80 backdrop-blur-md border-gray-200/20 py-3" : "bg-transparent border-transparent py-5")}>
    <div className="container-custom flex items-center justify-between">
      <div className="flex items-center">
        <a href="/" className="flex items-center space-x-2">
          <img src="/shopro.png" className="w-8 h-8 object-contain shrink-0" alt="Shopro Logo" />
          <span className="text-xl font-bold text-scriptgenius-black">
            Shopro-电商AIGC带货视频
          </span>
        </a>
      </div>

      {/* Desktop Navigation */}
      <nav className="hidden md:flex items-center space-x-8">
        <a href="#demo" className="text-scriptgenius-black hover:text-scriptgenius-blue transition-colors">
          演示
        </a>
        <a href="#pricing" className="text-scriptgenius-black hover:text-scriptgenius-blue transition-colors">
          价格
        </a>
        <a
          href="#testimonials"
          className="text-scriptgenius-black hover:text-scriptgenius-blue transition-colors"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('testimonials')?.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }}
        >
          评价
        </a>
        <a
          href="#contact"
          className="text-scriptgenius-black hover:text-scriptgenius-blue transition-colors"
          onClick={(e) => {
            e.preventDefault();
            scrollToContact();
          }}
        >
          联系我们
        </a>
      </nav>

      <div className="hidden md:flex items-center space-x-4">

        <MagneticButton className="button-primary" onClick={scrollToContact}>
          开始使用
        </MagneticButton>
      </div>

      {/* Mobile menu button */}
      <button onClick={toggleMobileMenu} className="md:hidden flex items-center text-scriptgenius-black" aria-label="Toggle mobile menu">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isMobileMenuOpen ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
      </button>
    </div>

    {/* Mobile Navigation */}
    <div className={cn("md:hidden absolute top-full left-0 right-0 bg-white border-b border-gray-200 transition-all duration-300 ease-in-out", isMobileMenuOpen ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none")}>
      <div className="container-custom py-4 flex flex-col space-y-4">
        <a href="#demo" className="text-scriptgenius-black hover:text-scriptgenius-blue py-2 transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
          演示
        </a>
        <a href="#pricing" className="text-scriptgenius-black hover:text-scriptgenius-blue py-2 transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
          价格
        </a>
        <a
          href="#testimonials"
          className="text-scriptgenius-black hover:text-scriptgenius-blue py-2 transition-colors"
          onClick={(e) => {
            e.preventDefault();
            setIsMobileMenuOpen(false);
            document.getElementById('testimonials')?.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }}
        >
          评价
        </a>
        <a
          href="#contact"
          className="text-scriptgenius-black hover:text-scriptgenius-blue py-2 transition-colors"
          onClick={(e) => {
            e.preventDefault();
            setIsMobileMenuOpen(false);
            scrollToContact();
          }}
        >
          联系我们
        </a>
        <div className="flex flex-col space-y-2 pt-2 border-t border-gray-100">
          <a href="/login" className="text-scriptgenius-blue hover:text-scriptgenius-blue-dark py-2 transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
            登录
          </a>
          <button className="button-primary text-center" onClick={() => { setIsMobileMenuOpen(false); scrollToContact(); }}>
            开始使用
          </button>
        </div>
      </div>
    </div>
  </header>;
};
export default Navbar;