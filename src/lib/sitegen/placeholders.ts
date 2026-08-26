import type { ProfileField } from './profile';

/**
 * What a generated page says where the source said nothing.
 *
 * The central rule of this platform lives here. Each entry is a **request for
 * data addressed to the owner**, never a sample of what the data might be.
 * There is no "من 200 ريال" waiting to be mistaken for a real price, and no
 * "9 صباحًا - 5 مساءً" waiting to be mistaken for real hours.
 *
 * The renderer draws these inside a dashed outline with a label, so they read
 * as an unfinished field on sight. A visitor who somehow sees the page before
 * the owner fills it in learns nothing false; they simply see it is not ready.
 */

export interface Placeholder {
  /** Shown as the slot's label. */
  label: string;
  /** What the owner should put there. */
  ask: string;
}

export const PLACEHOLDERS: Record<ProfileField, Placeholder> = {
  tagline: {
    label: 'الجملة التعريفية',
    ask: 'اكتب سطرًا واحدًا يشرح ما تقدّمه ولمن.',
  },
  about: {
    label: 'نبذة عن النشاط',
    ask: 'فقرة قصيرة: متى بدأتم، وما الذي يميّزكم.',
  },
  services: {
    label: 'الخدمات',
    ask: 'أضف خدماتك، كل خدمة في سطر.',
  },
  prices: {
    label: 'الأسعار',
    ask: 'أضف سعر كل خدمة. تُركت فارغة لأن المصدر لم يذكر أسعارًا.',
  },
  hours: {
    label: 'ساعات العمل',
    ask: 'أضف أيام وساعات العمل الفعلية.',
  },
  phone: {
    label: 'رقم الهاتف',
    ask: 'أضف رقمًا يصل إليك العميل عليه.',
  },
  email: {
    label: 'البريد الإلكتروني',
    ask: 'أضف بريدًا للتواصل.',
  },
  address: {
    label: 'العنوان',
    ask: 'أضف العنوان أو رابط الموقع على الخريطة.',
  },
  website: {
    label: 'الموقع الحالي',
    ask: 'لا يوجد موقع — وهذا سبب بناء هذه الصفحة.',
  },
  rating: {
    label: 'التقييم',
    ask: 'لم يُنشر تقييم في المصدر.',
  },
};

/**
 * Gaps that stop a page from being publishable, as opposed to ones that only
 * make it thinner.
 *
 * A site with no way to contact the business cannot do its job, so those are
 * called out first in the UI. Everything else can ship and be improved.
 */
const BLOCKING: ProfileField[] = ['phone', 'services'];

export function blockingGaps(missing: ProfileField[]): ProfileField[] {
  return missing.filter((m) => BLOCKING.includes(m));
}
