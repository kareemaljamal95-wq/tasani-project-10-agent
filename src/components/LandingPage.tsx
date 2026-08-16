import { motion } from "motion/react";
import { ArrowUpRight, Play, Cpu, Shield, Sparkles, Zap, ArrowLeft, Terminal, Bot } from "lucide-react";
import { TASAMI_AGENTS } from "../types";

interface LandingPageProps {
  onEnterDashboard: () => void;
}

export default function LandingPage({ onEnterDashboard }: LandingPageProps) {
  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden font-sans select-none selection:bg-white selection:text-black border-8 border-neutral-900 flex flex-col justify-between" dir="rtl">
      
      {/* Massive Background Typography */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5 select-none z-0 overflow-hidden">
        <h1 className="text-[180px] sm:text-[360px] font-black italic tracking-tighter uppercase leading-none text-neutral-600">TASAMI</h1>
      </div>

      {/* Floating Header */}
      <header className="relative z-50 w-full max-w-7xl mx-auto px-8 py-6 flex justify-between items-center border-b border-neutral-850">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-white text-black flex items-center justify-center font-bold text-xl uppercase italic tracking-tighter">
            T
          </div>
          <div>
            <span className="text-sm font-black tracking-widest block uppercase">تسامي OS</span>
            <span className="text-[9px] uppercase tracking-[0.3em] font-bold text-neutral-500 block -mt-1">STRUCTURAL // V.02</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden sm:block px-4 py-1 border border-neutral-800 rounded-none text-[10px] uppercase tracking-widest text-neutral-400 font-mono">
            System: Active
          </div>
          <button
            onClick={onEnterDashboard}
            id="nav-enter-dashboard"
            className="group px-6 py-2.5 bg-neutral-900 border border-neutral-800 hover:border-white text-xs uppercase tracking-widest font-black transition-all duration-300 flex items-center gap-2 cursor-pointer"
          >
            <span>لوحة السيطرة</span>
            <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform text-white" />
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-8 pt-16 pb-20 text-center space-y-12">
        {/* Technical Ribbon */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2.5 px-4 py-1.5 border border-neutral-800 bg-neutral-900/50 text-[10px] uppercase tracking-[0.25em] text-neutral-400 font-mono"
        >
          <Sparkles className="w-3.5 h-3.5 text-white animate-spin" />
          <span>عصر الوكلاء المستقلين // 2026_AGENTIC_ERA</span>
          <span className="w-1.5 h-1.5 bg-white animate-ping" />
        </motion.div>

        {/* Main Bold Header */}
        <div className="space-y-6">
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-4xl sm:text-7xl md:text-8xl font-black tracking-tight leading-[1.05] uppercase"
          >
            لا تدر برمجياتك، <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-neutral-300 via-white to-neutral-400 italic">
              أدر وكلاءك المستقلين.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="max-w-3xl mx-auto text-base md:text-lg text-neutral-400 leading-relaxed font-light font-mono uppercase tracking-wide"
          >
            نظام التشغيل المركزي الأول لعام 2026 المصمم لتشغيل وتنمية شركتك بشكل كامل وتلقائي عبر شبكة وكلاء ذكاء اصطناعي مترابطة تعمل 24/7 تحت سيادتك وتوجيهك المباشر.
          </motion.p>
        </div>

        {/* Action Buttons (Bold style) */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-5 pt-4"
        >
          <button
            onClick={onEnterDashboard}
            id="hero-cta-activate"
            className="group px-12 py-5 bg-white text-black font-black uppercase tracking-widest text-sm hover:invert transition-all duration-300 transform active:scale-98 cursor-pointer flex items-center justify-center gap-2.5"
          >
            تنشيط القوة العاملة والتحليق
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          </button>
          
          <button
            onClick={onEnterDashboard}
            id="hero-cta-simulate"
            className="px-10 py-5 border border-neutral-850 bg-neutral-900/40 hover:bg-neutral-900 text-white text-xs uppercase tracking-widest font-black flex items-center justify-center gap-2.5 transition-all cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current text-white" />
            شاهد محاكاة حية للشبكة
          </button>
        </motion.div>

        {/* Built-in Guarantees Banner */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="flex flex-wrap justify-center items-center gap-x-8 gap-y-4 pt-4 text-[10px] uppercase tracking-widest text-neutral-500 font-mono"
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-white" />
            <span>متوافق مع سيادة البيانات المطلقة لعام 2026</span>
          </div>
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-white" />
            <span>محرك ذكاء اصطناعي لامركزي فائق التفكير</span>
          </div>
        </motion.div>
      </section>

      {/* Interactive Simulation Dashboard Component */}
      <section className="relative z-10 max-w-6xl mx-auto px-8 pb-24 w-full">
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.5 }}
          className="relative rounded-none border border-neutral-800 bg-neutral-900/20 p-6 md:p-8 overflow-hidden group hover:border-neutral-700 transition-all duration-500"
        >
          {/* Top Panel Controls */}
          <div className="flex justify-between items-center border-b border-neutral-800 pb-5 mb-6">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 bg-neutral-800" />
              <span className="w-3.5 h-3.5 bg-neutral-700" />
              <span className="w-3.5 h-3.5 bg-white" />
              <span className="text-xs font-mono text-neutral-500 mr-2">tasami_os_simulation_core.sh</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400 bg-neutral-950 px-3 py-1.5 rounded-none border border-neutral-800 font-mono">
              <Terminal className="w-3.5 h-3.5 text-white" />
              <span>STABLE_NET_OK</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Simulation Console Screen */}
            <div className="md:col-span-7 bg-black rounded-none border border-neutral-800 p-5 font-mono text-xs text-neutral-300 space-y-4 h-[320px] overflow-y-auto custom-scrollbar shadow-inner">
              <div className="text-neutral-500 flex justify-between">
                <span>[2026-07-16 04:51:00] SYSTEM INITIATION</span>
                <span className="text-white font-bold">VERIFIED_OK</span>
              </div>
              <div className="space-y-2">
                <p className="text-neutral-400 font-bold">⚡ [OmniCEO] <span className="text-neutral-300 font-normal">بدء دورة التفتيش والمطابقة الدورية...</span></p>
                <div className="pl-4 border-r border-neutral-800 space-y-1 mr-2">
                  <p className="text-neutral-400">→ فحص أداء OmniSeller: <span className="text-white font-bold">نشط ومستقر (18 صفقة معلقة)</span></p>
                  <p className="text-neutral-400">→ فحص ميزانية OmniMarketing المعتمدة: <span className="text-white font-bold">120$ / 1,500$ مستخدم</span></p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-neutral-400 font-bold">💬 [OmniSeller] <span className="text-neutral-300 font-normal">محادثة واتساب نشطة مع عميل كبار شخصيات (#1092)</span></p>
                <p className="text-neutral-500 mr-4">"مفاوضات ناجحة لخصم 25% من قيمة الاشتراك السنوي. أطلب تفويض OmniCEO والمؤسس..."</p>
              </div>
              <div className="space-y-1">
                <p className="text-neutral-400 font-bold">🛠️ [OmniSupport] <span className="text-neutral-300 font-normal">تم حل مشكلة مزامنة المدفوعات للعميل رقم #4920 بنجاح.</span></p>
                <p className="text-neutral-500 mr-4">"وقت الاستجابة الإجمالي: 1.1 ثانية. تقييم الرضا: 5/5"</p>
              </div>
              <div className="space-y-1 animate-pulse">
                <p className="text-neutral-400 font-bold">🎯 [OmniMarketing] <span className="text-neutral-300 font-normal">رصد فرصة نمو إعلاني جديدة في السوق الإقليمي...</span></p>
                <p className="text-neutral-500 mr-4">"أقترح تحويل 450$ إضافية لحملة سناب شات المستهدفة الفورية."</p>
              </div>
            </div>

            {/* Simulated Live Statistics Sidebar */}
            <div className="md:col-span-5 flex flex-col justify-between space-y-4">
              <div className="bg-neutral-950 rounded-none border border-neutral-800 p-5 space-y-4">
                <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-neutral-500 font-mono">
                  <span>الكفاءة التشغيلية الكلية</span>
                  <span className="font-bold text-white">94.5%</span>
                </div>
                <div className="w-full bg-neutral-900 h-[2px] rounded-none">
                  <div className="bg-white h-full" style={{ width: "94.5%" }} />
                </div>

                <div className="flex justify-between items-center pt-2 text-[10px] uppercase tracking-widest text-neutral-500 font-mono">
                  <span>توفير رأس المال البشري</span>
                  <span className="font-bold text-white">88%</span>
                </div>
                <div className="w-full bg-neutral-900 h-[2px] rounded-none">
                  <div className="bg-white h-full" style={{ width: "88%" }} />
                </div>
              </div>

              {/* Founder Override Panel Preview */}
              <div className="bg-neutral-950 rounded-none border border-neutral-800 p-5 flex flex-col justify-center items-center text-center space-y-4">
                <Bot className="w-8 h-8 text-white" />
                <h4 className="text-xs uppercase tracking-widest font-black">لوحة القيادة الذاتية الفائقة</h4>
                <p className="text-xs text-neutral-500 leading-relaxed font-light">
                  ادخل إلى لوحة القيادة لتوجيه شبكة الوكلاء وتفعيل التفكير الفائق لحل مشكلات شركتك المعقدة.
                </p>
                <button
                  onClick={onEnterDashboard}
                  id="simulator-cta-launch"
                  className="w-full py-3 bg-white text-black font-black uppercase tracking-widest text-[10px] border border-transparent hover:bg-neutral-200 transition-all duration-300 cursor-pointer"
                >
                  فتح غرفة العمليات الآن
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Constitution Section (دستور تسامي المحدث) */}
      <section className="relative z-10 max-w-7xl mx-auto px-8 py-20 border-t border-neutral-900 bg-black">
        <div className="text-right space-y-4 mb-16">
          <div className="text-[10px] uppercase tracking-[0.4em] text-neutral-500 font-mono">Constitutional Charter</div>
          <h2 className="text-3xl md:text-5xl font-black tracking-tight uppercase italic leading-none">دستور تسامي السيادي المحدث (v2026.1)</h2>
          <p className="text-neutral-400 max-w-2xl text-xs md:text-sm font-light font-mono uppercase tracking-wider">
            مجموعة المبادئ والأطر الصارمة لعام 2026 التي تضمن استقلالية الوكلاء التشغيلية، مع الحفاظ الكامل على سيادة المؤسس البشري.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 border border-neutral-800 divide-y md:divide-y-0 md:divide-x divide-neutral-800 md:dir-ltr">
          {/* Principle 1 */}
          <div className="p-8 space-y-4 text-right">
            <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">PRINCIPLE // 01</div>
            <h3 className="text-lg font-black uppercase italic">1. سيادة الأنثروبوس المطلقة</h3>
            <p className="text-xs text-neutral-400 leading-relaxed font-light font-mono uppercase tracking-wide">
              المؤسس البشري هو السلطة السيادية العليا. لا يحق لأي وكيل، بما في ذلك OmniCEO، إجراء تغييرات هيكلية أو نقل ملكية أو تغييرات مالية مصيرية بدون موافقة يدوية مشفرة.
            </p>
          </div>

          {/* Principle 2 */}
          <div className="p-8 space-y-4 text-right">
            <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">PRINCIPLE // 02</div>
            <h3 className="text-lg font-black uppercase italic">2. ميزانيات الاستقلال المالي</h3>
            <p className="text-xs text-neutral-400 leading-relaxed font-light font-mono uppercase tracking-wide">
              يُمنح الوكلاء تفويضاً مالياً محدوداً معتمد مسبقاً (Micro-Budgets) لإتمام الصفقات الإعلانية ومفاوضات المبيعات التلقائية دون إرهاق المؤسس بطلبات موافقة متكررة.
            </p>
          </div>

          {/* Principle 3 */}
          <div className="p-8 space-y-4 text-right">
            <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">PRINCIPLE // 03</div>
            <h3 className="text-lg font-black uppercase italic">3. الشفافية التامة وسلاسل التفكير</h3>
            <p className="text-xs text-neutral-400 leading-relaxed font-light font-mono uppercase tracking-wide">
              تلتزم كافة الكيانات الذكية في تسامي OS بتسجيل "سلسلة التفكير المنطقي والتحليلي" الخاصة بكل قرار أو إجراء، لضمان القابلية الكاملة للمراجعة والتدقيق والتعلم البشري.
            </p>
          </div>

          {/* Principle 4 */}
          <div className="p-8 space-y-4 text-right">
            <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">PRINCIPLE // 04</div>
            <h3 className="text-lg font-black uppercase italic">4. بروتوكول الإيقاف الطارئ</h3>
            <p className="text-xs text-neutral-400 leading-relaxed font-light font-mono uppercase tracking-wide">
              أمن النظام يفوق كل شيء. زر التجاوز الطارئ (Emergency Override) بمثابة قفل مركزي يعطل على الفور كافة الوكلاء ويجبرهم على العودة للتوجيه البشري اليدوي الكامل.
            </p>
          </div>
        </div>
      </section>

      {/* Agents Team Cards Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-8 py-20 border-t border-neutral-900 bg-black">
        <div className="text-right space-y-4 mb-16">
          <div className="text-[10px] uppercase tracking-[0.4em] text-neutral-500 font-mono">Active Workforce</div>
          <h2 className="text-3xl md:text-5xl font-black tracking-tight uppercase italic leading-none">فريق العمل الذكي النشط</h2>
          <p className="text-neutral-400 max-w-2xl text-xs md:text-sm font-light font-mono uppercase tracking-wider">
            تعرّف على الوكلاء التنفيذيين الملتزمين بالدفاع عن نمو وتكامل عملياتك التشغيلية على مدار الساعة.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-0 border border-neutral-800 divide-y lg:divide-y-0 lg:divide-x divide-neutral-800 lg:dir-ltr">
          {Object.values(TASAMI_AGENTS).map((agent) => (
            <div
              key={agent.id}
              className="p-6 flex flex-col justify-between h-[360px] text-right"
            >
              <div className="space-y-4">
                <div className="w-8 h-8 bg-neutral-900 border border-neutral-800 text-white flex items-center justify-center font-bold text-xs">
                  {agent.name[4] || "A"}
                </div>
                <div>
                  <h3 className="text-base font-black uppercase tracking-wider">{agent.name}</h3>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block">
                    {agent.arabicTitle}
                  </span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed font-light font-mono uppercase tracking-wide">
                  {agent.roleDescription}
                </p>
              </div>

              <div className="space-y-2 border-t border-neutral-850 pt-4">
                <div className="flex justify-between items-center text-[9px] text-neutral-500 font-mono uppercase tracking-widest">
                  <span>Capacity</span>
                  <span className="font-bold text-white">{agent.progress}%</span>
                </div>
                <div className="w-full bg-neutral-900 h-[2px]">
                  <div
                    className="h-full bg-white"
                    style={{ width: `${agent.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer Status Bar (Stark alignment to the requested footer) */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto px-8 py-6 border-t border-neutral-900 flex flex-col sm:flex-row justify-between items-center gap-6 text-[10px] text-neutral-500 font-mono uppercase tracking-widest">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-white"></div>
            <span>Auth: Verified</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-white"></div>
            <span>Grid: Stable</span>
          </div>
        </div>
        <div className="text-neutral-500">
          LAST_BUILD_REF: 0xFF021_ALPHA_SYNC_2026
        </div>
      </footer>
    </div>
  );
}
