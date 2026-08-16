import { redirect } from 'next/navigation';
import { ShoppingCart } from 'lucide-react';
import { getSession } from '@/lib/auth/session';
import { NotConnected } from '@/components/dashboard/not-connected';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'التجارة' };

/**
 * Commerce overview.
 *
 * Previously rendered hardcoded sales, product, order and conversion figures.
 * No product, order or inventory model exists in the schema, so the page had
 * no data source at all. It now states the requirement instead.
 */
export default async function CommercePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <NotConnected
      icon={ShoppingCart}
      title="التجارة"
      description="المبيعات والمنتجات والطلبات"
      requirement="تتطلب هذه الصفحة ربط متجرك (مثل Shopify أو WooCommerce). بعد الربط ستُعرض هنا طلباتك ومنتجاتك الحقيقية."
    />
  );
}
