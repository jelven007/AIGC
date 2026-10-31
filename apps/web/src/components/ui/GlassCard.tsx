
import React from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const glassCardVariants = cva(
  "relative overflow-hidden backdrop-blur-md rounded-xl transition-all duration-300",
  {
    variants: {
      variant: {
        default: "bg-white/80 border border-white/20 shadow-glass",
        blue: "bg-scriptgenius-blue/10 border border-scriptgenius-blue/20 shadow-blue",
        dark: "bg-scriptgenius-black/10 border border-scriptgenius-black/20",
      },
      size: {
        sm: "p-4",
        default: "p-6",
        lg: "p-8",
      },
      hover: {
        none: "",
        lift: "hover:translate-y-[-5px] hover:shadow-lg",
        glow: "hover:shadow-blue",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      hover: "lift",
    },
  }
);

export interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {
  children: React.ReactNode;
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, children, variant, size, hover, ...props }, ref) => {
    return (
      <div
        className={cn(glassCardVariants({ variant, size, hover, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    );
  }
);

GlassCard.displayName = "GlassCard";

export default GlassCard;
