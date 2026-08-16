export type AgentType =
  | 'CEO'
  | 'SALES'
  | 'MARKETING'
  | 'RESEARCH'
  | 'FINANCE'
  | 'OPERATIONS'
  | 'FASHION'
  | 'CUSTOMER_SUPPORT'
  | 'EXECUTIVE'
  | 'BUSINESS'
  | 'COMMERCE'
  | 'GROWTH';

export interface AgentInfo {
  name: string;
  description: string;
  color: string;
  icon: string;
}

export const AGENT_DISPLAY_INFO: Record<AgentType, AgentInfo> = {
  CEO: {
    name: 'CEO Agent',
    description: 'Strategic business leadership and decision making',
    color: 'from-violet-600 to-purple-600',
    icon: 'crown',
  },
  SALES: {
    name: 'Sales Agent',
    description: 'Lead qualification and closing strategies',
    color: 'from-green-600 to-teal-600',
    icon: 'trending-up',
  },
  MARKETING: {
    name: 'Marketing Agent',
    description: 'Market research and campaign management',
    color: 'from-blue-600 to-cyan-600',
    icon: 'megaphone',
  },
  RESEARCH: {
    name: 'Research Agent',
    description: 'Deep research and knowledge synthesis',
    color: 'from-amber-600 to-orange-600',
    icon: 'search',
  },
  FINANCE: {
    name: 'Finance Agent',
    description: 'Financial analysis and revenue optimization',
    color: 'from-emerald-600 to-green-600',
    icon: 'dollar-sign',
  },
  OPERATIONS: {
    name: 'Operations Agent',
    description: 'Process optimization and workflow management',
    color: 'from-rose-600 to-pink-600',
    icon: 'settings',
  },
  FASHION: {
    name: 'Fashion Agent',
    description: 'Fashion advice and inventory management',
    color: 'from-fuchsia-600 to-pink-600',
    icon: 'shirt',
  },
  CUSTOMER_SUPPORT: {
    name: 'Support Agent',
    description: 'Customer support and issue resolution',
    color: 'from-indigo-600 to-blue-600',
    icon: 'headphones',
  },
  EXECUTIVE: {
    name: 'Executive Assistant',
    description: 'Calendar, tasks, goals & planning',
    color: 'from-violet-600 to-purple-600',
    icon: 'calendar',
  },
  BUSINESS: {
    name: 'Business Operator',
    description: 'Strategy, KPIs & growth',
    color: 'from-amber-600 to-orange-600',
    icon: 'briefcase',
  },
  COMMERCE: {
    name: 'Commerce Assistant',
    description: 'Products, stores & sales',
    color: 'from-red-600 to-pink-600',
    icon: 'shopping-cart',
  },
  GROWTH: {
    name: 'Growth Coach',
    description: 'Habits, skills & learning',
    color: 'from-teal-600 to-emerald-600',
    icon: 'sparkles',
  },
};
