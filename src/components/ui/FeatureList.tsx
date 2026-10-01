
import React from "react";
import { cn } from "@/lib/utils";

interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

interface FeatureListProps {
  features: Feature[];
  className?: string;
  columns?: 1 | 2 | 3 | 4;
}

const FeatureList: React.FC<FeatureListProps> = ({
  features,
  className,
  columns = 3,
}) => {
  const getGridClass = () => {
    switch (columns) {
      case 1:
        return "grid-cols-1";
      case 2:
        return "grid-cols-1 md:grid-cols-2";
      case 3:
        return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
      case 4:
        return "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";
      default:
        return "grid-cols-1 md:grid-cols-3";
    }
  };

  return (
    <div className={cn("w-full", className)}>
      <div className={cn("grid gap-6 md:gap-8", getGridClass())}>
        {features.map((feature, index) => (
          <div
            key={index}
            className="group flex flex-col p-5 rounded-xl border border-gray-100 bg-white shadow-soft transition-all duration-300 hover:shadow-blue hover:border-scriptgenius-blue/20"
          >
            <div className="mb-4 p-3 rounded-full bg-scriptgenius-blue/10 w-fit group-hover:bg-scriptgenius-blue/20 transition-colors duration-300">
              {feature.icon}
            </div>
            <h3 className="text-lg font-semibold mb-2 text-scriptgenius-black">
              {feature.title}
            </h3>
            <p className="text-scriptgenius-gray-dark text-sm">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FeatureList;
