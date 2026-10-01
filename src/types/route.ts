import type { ComponentType } from 'react';

export interface RouteConfig {
  path: string;
  component: ComponentType;
  isPublic?: boolean;
}
