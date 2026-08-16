import { redirect } from 'next/navigation';
import { Briefcase } from 'lucide-react';
import { getSession } from '@/lib/auth/session';
import { NotConnected } from '@/components/dashboard/not-connected';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الأعمال' };

/**
 * Business overview.
 *
 * Previously rendered hardcoded revenue, growth rate, customer count and
 * conversion figures. There is no revenue, customer or transaction model in
 * the schema, so none of it could have been real. Until a billing or CRM
 * source is connected, this page says so rather than inventing numbers.
 */
export default async function BusinessPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <NotConnected
      icon={Briefcase}
      title="الأعمال"
      description="نظرة على الإيرادات والنمو والعملاء"
      requirement="تتطلب هذه الصفحة ربط مصدر إيرادات أو نظام CRM. بعد الربط ستُعرض هنا أرقامك الفعلية."
    />
  );
}
