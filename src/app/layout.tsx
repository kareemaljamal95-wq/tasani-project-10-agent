import type { Metadata } from 'next';
import { Inter, Cairo } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const cairo = Cairo({ subsets: ['arabic'], variable: '--font-cairo' });

export const metadata: Metadata = {
  title: 'KARMISH - Your Personal AI Operating System',
  description: 'An AI companion that understands you deeply, remembers context, manages projects, executes tasks, and helps build businesses.',
  keywords: ['AI', 'personal assistant', 'business', 'productivity', 'Arabic'],
  authors: [{ name: 'KARMISH' }],
  openGraph: {
    title: 'KARMISH - Your Personal AI Operating System',
    description: 'Your digital brain, executive assistant, business operator, and life manager.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className={`${inter.variable} ${cairo.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
