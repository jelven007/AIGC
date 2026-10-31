import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
interface MagneticButtonProps {
  children: React.ReactNode;
  className?: string;
  strength?: number;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}
const MagneticButton = ({
  children,
  className,
  strength = 30,
  onClick,
  disabled = false,
  type = "button",
  onMouseEnter: externalMouseEnter,
  onMouseLeave: externalMouseLeave
}: MagneticButtonProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({
    x: 0,
    y: 0
  });
  const [isHovered, setIsHovered] = useState(false);
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!buttonRef.current || disabled) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setPosition({
      x,
      y
    });
  };
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (externalMouseEnter) externalMouseEnter();
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
    setPosition({
      x: 0,
      y: 0
    });
    if (externalMouseLeave) externalMouseLeave();
  };
  useEffect(() => {
    const reset = () => {
      if (!isHovered) {
        setPosition({
          x: 0,
          y: 0
        });
      }
    };
    reset();
    window.addEventListener("resize", reset);
    return () => {
      window.removeEventListener("resize", reset);
    };
  }, [isHovered]);
  const scale = isHovered ? 1.05 : 1;
  const translateX = position.x * 0.5;
  const translateY = position.y * 0.5;
  
  return (
    <button
      ref={buttonRef}
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "relative transition-all duration-200 ease-out cursor-pointer",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
      style={{
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transition: isHovered ? "none" : "transform 0.3s ease-out"
      }}
    >
      {children}
    </button>
  );
};
export default MagneticButton;