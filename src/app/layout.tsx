import type { Metadata, Viewport } from 'next';
import { Inter, Cairo } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { SITE } from '@/lib/site';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const cairo = Cairo({ subsets: ['arabic'], variable: '--font-cairo', display: 'swap' });

/**
 * `metadataBase` is what lets Next resolve canonical and OpenGraph URLs to
 * absolute ones. Without it, relative OG image paths are dropped by most
 * scrapers.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
  keywords: [
    'AI agents',
    'lead generation',
    'sales automation',
    'business automation',
    'وكلاء الذكاء الاصطناعي',
    'أتمتة المبيعات',
  ],
  authors: [{ name: SITE.name }],
  alternates: {
    canonical: '/',
    languages: { 'ar-SA': '/', 'en-US': '/en' },
  },
  openGraph: {
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: SITE.url,
    siteName: SITE.name,
    type: 'website',
    locale: 'ar_SA',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

export const viewport: Viewport = {
  themeColor: '#030303',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className="dark">
      <body className={`${inter.variable} ${cairo.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
