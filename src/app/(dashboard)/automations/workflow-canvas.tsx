'use client';

import { ChevronLeft, Clock, Filter, Bot, ShieldCheck, Send, Lock } from 'lucide-react';
import type { TriggerRow } from './automations-board';

/**
 * The visual editor for one automation.
 *
 * Deliberately a fixed pipeline and not a free-form node graph. A canvas where
 * arbitrary nodes can be wired together implies an engine that walks arbitrary
 * edges, and a second execution path is precisely how an agent ends up
 * reaching dispatch without passing the approval gate. The gate is the
 * product's promise, so the canvas is not able to express a workflow that
 * omits it: the approval node is rendered locked because it *is* locked.
 *
 * Every editable node maps onto a field of AutomationTrigger, so clicking one
 * opens the same form the list already uses. No new schema, no second writer.
 */

const AGENT_LABEL: Record<string, string> = {
  CEO: 'الوكيل التنفيذي',
  SALES: 'وكيل المبيعات',
  MARKETING: 'وكيل التسويق',
  RESEARCH: 'وكيل البحث',
  FINANCE: 'الوكيل المالي',
  OPERATIONS: 'وكيل العمليات',
  CONTENT: 'وكيل المحتوى',
  CUSTOMER_SUPPORT: 'وكيل الدعم',
  DISCOVERY: 'وكيل الاستكشاف',
  STRATEGIST: 'وكيل الحلول',
  ANALYST: 'وكيل التحليل',
};

function Node({
  icon,
  title,
  detail,
  onClick,
  locked = false,
  muted = false,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick?: () => void;
  locked?: boolean;
  muted?: boolean;
}) {
  const base =
    'w-40 shrink-0 rounded-xl border p-3 text-right transition-colors';
  const tone = locked
    ? 'border-amber-500/30 bg-amber-500/10'
    : muted
      ? 'border-white/10 bg-white/[0.03]'
      : 'border-white/10 bg-white/5';

  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] text-white/45">
        {icon}
        {title}
        {locked && <Lock className="h-3 w-3 mr-auto" />}
      </span>
      <span className="mt-1 block text-xs text-white/85 line-clamp-2">
        {detail}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div
        className={`${base} ${tone}`}
        title={locked ? 'ثابتة — لا يمكن لأي أتمتة تخطّي اعتمادك' : undefined}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${tone} hover:bg-white/10 hover:border-white/25`}
    >
      {body}
    </button>
  );
}

/** In RTL the flow reads right to left, so the connector points left. */
function Connector() {
  return (
    <ChevronLeft className="h-4 w-4 shrink-0 text-white/20" aria-hidden />
  );
}

export function WorkflowCanvas({
  trigger,
  leadStatusLabel,
  onEdit,
}: {
  trigger: TriggerRow;
  /** Reuses the board's own status labels rather than keeping a second copy. */
  leadStatusLabel: Record<string, string>;
  onEdit: () => void;
}) {
  return (
    <div
      className="flex items-stretch gap-2 overflow-x-auto pb-1"
      role="group"
      aria-label={`مسار الأتمتة ${trigger.name}`}
    >
      <Node
        icon={<Clock className="h-3 w-3" />}
        title="المُشغّل"
        detail={
          trigger.kind === 'schedule'
            ? `كل ${trigger.cooldownHours} ساعة`
            : `تغيّر حالة العميل · كل ${trigger.cooldownHours}س`
        }
        onClick={onEdit}
      />
      <Connector />

      <Node
        icon={<Filter className="h-3 w-3" />}
        title="التصفية"
        detail={
          trigger.leadStatus
            ? leadStatusLabel[trigger.leadStatus] ?? trigger.leadStatus
            : 'كل الحالات'
        }
        onClick={onEdit}
      />
      <Connector />

      <Node
        icon={<Bot className="h-3 w-3" />}
        title="الوكيل"
        detail={AGENT_LABEL[trigger.agentType] ?? trigger.agentType}
        onClick={onEdit}
      />
      <Connector />

      <Node
        icon={<ShieldCheck className="h-3 w-3" />}
        title="بوابة الاعتماد"
        detail="بانتظار اعتمادك دائمًا"
        locked
      />
      <Connector />

      <Node
        icon={<Send className="h-3 w-3" />}
        title="بعد الاعتماد"
        detail="تُرسل وتُسجَّل في سجل العميل"
        muted
      />
    </div>
  );
}
