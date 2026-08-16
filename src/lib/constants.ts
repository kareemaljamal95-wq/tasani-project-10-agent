export const AGENT_COLORS: Record<string, string> = {
  CEO: 'from-violet-600 to-purple-600',
  SALES: 'from-green-600 to-teal-600',
  MARKETING: 'from-blue-600 to-cyan-600',
  RESEARCH: 'from-amber-600 to-orange-600',
  FINANCE: 'from-emerald-600 to-green-600',
  OPERATIONS: 'from-rose-600 to-pink-600',
  FASHION: 'from-fuchsia-600 to-pink-600',
  CUSTOMER_SUPPORT: 'from-indigo-600 to-blue-600',
  EXECUTIVE: 'from-violet-600 to-purple-600',
  BUSINESS: 'from-amber-600 to-orange-600',
  COMMERCE: 'from-red-600 to-pink-600',
  GROWTH: 'from-teal-600 to-emerald-600',
};

export const APP_NAME = 'Tasami OS';
export const APP_DESCRIPTION = 'Your Futuristic AI Operating System & Digital Twin';

// Custom Karmish AI Modes and Personalities
export const KARMISH_MODES = {
  COMPANION: {
    nameEn: 'Personal Companion',
    nameAr: 'الرفيق الشخصي',
    descriptionEn: 'Daily conversations, mindset check-ins, and companion support.',
    descriptionAr: 'محادثات يومية، دعم ذهني، ورفقة ذكية.',
    color: 'from-pink-500 to-rose-600',
    avatarState: 'PULSING_ROSE'
  },
  BUSINESS: {
    nameEn: 'Business Advisor',
    nameAr: 'مستشار الأعمال',
    descriptionEn: 'Shopify tracking, e-commerce analytics, and marketing strategy.',
    descriptionAr: 'متابعة شوبيفاي، تحليلات التجارة الرقمية، واستراتيجية التسويق.',
    color: 'from-amber-500 to-orange-600',
    avatarState: 'STABLE_GOLD'
  },
  FASHION: {
    nameEn: 'Fashion Stylist',
    nameAr: 'منسق المظهر',
    descriptionEn: 'Outfit planning, wardrobe recommendations, and style advice.',
    descriptionAr: 'تنسيق الملابس، اقتراحات المظهر، واستشارات الأناقة.',
    color: 'from-fuchsia-500 to-violet-600',
    avatarState: 'WAVE_VIOLET'
  },
  COACH: {
    nameEn: 'Productivity Coach',
    nameAr: 'مدرب الإنتاجية',
    descriptionEn: 'Goal tracking, habit formation, and daily planner organizer.',
    descriptionAr: 'متابعة الأهداف، بناء العادات، وتنظيم المهام اليومية.',
    color: 'from-teal-500 to-emerald-600',
    avatarState: 'SPINNING_EMERALD'
  }
} as const;

