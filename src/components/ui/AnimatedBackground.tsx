
import React from "react";
import { cn } from "@/lib/utils";

interface AnimatedBackgroundProps {
  className?: string;
  variant?: "circles" | "grid" | "dots";
  color?: string;
}

const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({
  className,
  variant = "circles",
  color = "rgba(0, 122, 255, 0.1)",
}) => {
  // Generate random size and position for circles
  const generateCircles = (count: number) => {
    return Array.from({ length: count }, (_, i) => {
      const size = Math.random() * 300 + 50;
      const left = Math.random() * 100;
      const top = Math.random() * 100;
      const delay = Math.random() * 5;
      const duration = Math.random() * 10 + 10;

      return (
        <div
          key={i}
          className="absolute rounded-full opacity-30 animate-float"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            left: `${left}%`,
            top: `${top}%`,
            background: color,
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
          }}
        />
      );
    });
  };

  const renderVariant = () => {
    switch (variant) {
      case "circles":
        return generateCircles(6);
      case "grid":
        return (
          <div className="absolute inset-0 bg-grid-pattern opacity-10"></div>
        );
      case "dots":
        return <div className="absolute inset-0 bg-dots-pattern opacity-10"></div>;
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden pointer-events-none z-0",
        className
      )}
    >
      {renderVariant()}
    </div>
  );
};

export default AnimatedBackground;
