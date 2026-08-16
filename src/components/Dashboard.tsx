import { useState, useEffect, useRef, FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Users, 
  TrendingUp, 
  Zap, 
  ShieldCheck, 
  MessageSquare, 
  ShoppingBag,
  AlertCircle,
  Check,
  X,
  Lock,
  Cpu,
  BrainCircuit,
  CornerDownLeft,
  ArrowRight,
  Info,
  Sparkles,
  LockKeyhole
} from "lucide-react";
import { Agent, AgentId, Message, Approval, TASAMI_AGENTS } from "../types";

interface DashboardProps {
  onBackToLanding: () => void;
}

export default function Dashboard({ onBackToLanding }: DashboardProps) {
  // Selected agent to chat with
  const [selectedAgent, setSelectedAgent] = useState<Agent>(TASAMI_AGENTS.ceo);
  
  // Conversation histories indexed by Agent ID
  const [conversations, setConversations] = useState<Record<AgentId, Message[]>>(() => {
    const initialHistories: any = {};
    Object.keys(TASAMI_AGENTS).forEach((id) => {
      const agent = TASAMI_AGENTS[id as AgentId];
      initialHistories[id] = [
        {
          id: `welcome-${id}`,
          role: "assistant",
          content: agent.greeting,
          timestamp: new Date().toLocaleTimeString("ar-SA", { hour: '2-digit', minute: '2-digit' }),
        }
      ];
    });
    return initialHistories;
  });

  // Current inputs for each agent chatroom
  const [userInputs, setUserInputs] = useState<Record<AgentId, string>>({
    ceo: "",
    seller: "",
    support: "",
    marketing: "",
    content: ""
  });

  // Chat modes: "fast" (gemini-3.1-flash-lite), "standard" (gemini-3.5-flash), "thinking" (gemini-3.1-pro-preview with HIGH thinkingLevel)
  const [chatMode, setChatMode] = useState<"fast" | "standard" | "thinking">("standard");

  // Loading state for each agent chat
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Critical approvals for the founder under human sovereignty principle
  const [approvals, setApprovals] = useState<Approval[]>([]);

  // Global override safety switch
  const [emergencyOverride, setEmergencyOverride] = useState<boolean>(false);

  // UI Toast state to show success messages
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Map backend approval item to frontend Approval
  const mapBackendApproval = (backendItem: any): Approval => {
    const agent = TASAMI_AGENTS[backendItem.agentId as AgentId] || TASAMI_AGENTS.ceo;
    const timeStr = new Date(backendItem.createdAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
    const risk = backendItem.decision?.riskLevel?.toUpperCase() || "MEDIUM";
    const impact = backendItem.decision?.expectedBusinessImpact || "مستوى مخاطرة متوسط";
    const budget = backendItem.amountUsd ? ` | الميزانية: $${backendItem.amountUsd}` : "";
    
    return {
      id: backendItem.id,
      agentName: agent.name,
      task: backendItem.objective,
      impact: `${risk} RISK | الأثر: ${impact}${budget}`,
      timestamp: `اليوم ${timeStr}`
    };
  };

  // Toast notifier
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Helper to extract budget from text query
  const extractAmount = (text: string): number | undefined => {
    const match = text.match(/(\d+(?:\.\d+)?)\s*(\$|دولار|ر\.س|ريال)/) || text.match(/(\$|دولار|ر\.س|ريال)\s*(\d+(?:\.\d+)?)/);
    if (match) {
      const val = parseFloat(match[1] || match[2]);
      return isNaN(val) ? undefined : val;
    }
    if (/ميزانية|خصم|تكلفة|مبلغ/i.test(text)) {
      const numMatch = text.match(/\d+(?:\.\d+)?/);
      if (numMatch) {
        const val = parseFloat(numMatch[0]);
        return isNaN(val) ? undefined : val;
      }
    }
    return undefined;
  };

  // Load approvals and override state from backend
  const loadBackendState = async () => {
    try {
      const overrideRes = await fetch("/api/override");
      const overrideData = await overrideRes.json();
      if (overrideData.ok) {
        setEmergencyOverride(overrideData.manualOverride);
      }

      const approvalsRes = await fetch("/api/approvals");
      const approvalsData = await approvalsRes.json();
      if (approvalsData.ok) {
        setApprovals(approvalsData.approvals.map(mapBackendApproval));
      }
    } catch (err) {
      console.error("Failed to fetch state from Tasami OS APIs:", err);
    }
  };

  useEffect(() => {
    loadBackendState();
  }, []);

  // Handle Approve from side board
  const handleApprove = async (id: string, taskName: string) => {
    try {
      const res = await fetch(`/api/approvals/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" })
      });
      const data = await res.json();
      if (data.ok) {
        setApprovals(data.approvals.map(mapBackendApproval));
        showToast(`✓ تم تمرير والموافقة على قرار [${taskName}] بنجاح وتوجيهه للتنفيذ المستقل.`);
      }
    } catch (err) {
      console.error(err);
      showToast("⚠️ فشل معالجة الموافقة.");
    }
  };

  // Handle Reject from side board
  const handleReject = async (id: string, taskName: string) => {
    try {
      const res = await fetch(`/api/approvals/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" })
      });
      const data = await res.json();
      if (data.ok) {
        setApprovals(data.approvals.map(mapBackendApproval));
        showToast(`✕ تم رفض قرار [${taskName}] وإبلاغ الوكيل لإعادة صياغة الخيار البديل.`);
      }
    } catch (err) {
      console.error(err);
      showToast("⚠️ فشل معالجة الرفض.");
    }
  };

  // Handle Emergency Override toggle
  const handleToggleOverride = async () => {
    const nextState = !emergencyOverride;
    try {
      const res = await fetch("/api/override", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextState })
      });
      const data = await res.json();
      if (data.ok) {
        setEmergencyOverride(data.manualOverride);
        showToast(
          data.manualOverride 
            ? "🚨 تم تفعيل قفل الطوارئ السيادي وتجميد كافة العمليات التلقائية للوكلاء فوراً!" 
            : "🔓 تم فك قفل الطوارئ بنجاح، وإعادة تفعيل بروتوكول التشغيل الذاتي والمستقل للوكلاء."
        );
      }
    } catch (err) {
      console.error(err);
      showToast("⚠️ فشل تحديث حالة الإيقاف الطارئ في الخادم.");
    }
  };

  // Handle Send Chat
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const currentInput = userInputs[selectedAgent.id]?.trim();
    if (!currentInput) return;

    if (emergencyOverride) {
      showToast("⚠️ النظام مغلق بموجب بروتوكول الإيقاف الطارئ. يرجى إلغاء تفعيله للتواصل مع الوكلاء.");
      return;
    }

    // Capture user query
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: currentInput,
      timestamp: new Date().toLocaleTimeString("ar-SA", { hour: '2-digit', minute: '2-digit' }),
    };

    // Update conversation with user query
    const updatedHistory = [...conversations[selectedAgent.id], userMsg];
    setConversations((prev) => ({
      ...prev,
      [selectedAgent.id]: updatedHistory
    }));

    // Clear text field
    setUserInputs((prev) => ({
      ...prev,
      [selectedAgent.id]: ""
    }));

    setIsLoading(true);

    try {
      // Formulate request payload for Agents Run
      const amountUsd = extractAmount(currentInput);
      const isTaskMode = chatMode === "thinking" || amountUsd !== undefined || /حملة|خصم|تحديث|ميزانية|أمر|إجراء/i.test(currentInput);

      if (isTaskMode) {
        // Run as a Sovereign Agency Decision Task
        const response = await fetch("/api/agents/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: selectedAgent.id,
            objective: currentInput,
            amountUsd: amountUsd,
            requester: "founder"
          }),
        });

        const data = await response.json();

        if (response.status === 403) {
          // Blocked by sovereignty policies
          const blockMsg: Message = {
            id: `reply-${Date.now()}`,
            role: "assistant",
            content: `🚫 حظر أمني سيادي: تم حظر الإجراء المقترح تلقائياً بموجب سياسات حماية المؤسس البشرية الصارمة.\n\nالسبب: ${data.reason}`,
            timestamp: new Date().toLocaleTimeString("ar-SA", { hour: '2-digit', minute: '2-digit' }),
          };
          setConversations((prev) => ({
            ...prev,
            [selectedAgent.id]: [...updatedHistory, blockMsg]
          }));
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || "Failed to execute agent run");
        }

        // Handle decision returned
        const decision = data.decision || data.approval?.decision;
        const status = data.status;

        let replyContent = "";
        if (status === "approval_required") {
          replyContent = `⚠️ تم الكشف عن إجراء يتطلب موافقة المؤسس البشرية بموجب بروتوكول السيادة ميزانية/مخاطر.\n\n📌 القرار المقترح: ${decision.decision}\n👉 الإجراء: ${decision.recommendedAction}\n⚖️ المخاطر: ${decision.riskLevel.toUpperCase()}\n📊 معدل الثقة: ${(decision.confidence * 100).toFixed(0)}%\n\n📝 التحليل الإستراتيجي:\n${decision.rationaleSummary}\n\n💼 الأثر التجاري المتوقع:\n${decision.expectedBusinessImpact}\n\n🔍 الخطوة التالية:\n${decision.suggestedNextStep}\n\n🔒 تم إرسال طلب الموافقة إلى لوحة التحكم الجانبية ولا يمكن التنفيذ بدون إذنك.`;
        } else {
          replyContent = `✅ تم اتخاذ قرار تشغيلي مستقل ضمن حدود ميزانيتك المصغرة المعتمَدة لـ ${selectedAgent.name}.\n\n📌 القرار: ${decision.decision}\n👉 الإجراء المقترح: ${decision.recommendedAction}\n⚖️ مستوى المخاطرة: ${decision.riskLevel.toUpperCase()}\n\n📝 ملخص التحليل المبرر:\n${decision.rationaleSummary}\n\n💼 الأثر المتوقع:\n${decision.expectedBusinessImpact}\n\n🔍 الخطوة التالية المتوقعة:\n${decision.suggestedNextStep}`;
        }

        const replyMsg: Message = {
          id: `reply-${Date.now()}`,
          role: "assistant",
          content: replyContent,
          timestamp: new Date().toLocaleTimeString("ar-SA", { hour: '2-digit', minute: '2-digit' }),
        };

        setConversations((prev) => ({
          ...prev,
          [selectedAgent.id]: [...updatedHistory, replyMsg]
        }));

        // Refresh approvals list
        loadBackendState();

      } else {
        // Fallback to standard chat response
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedHistory,
            systemInstruction: selectedAgent.systemInstruction,
            thinkingMode: chatMode === "thinking",
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to generate reply");
        }

        const replyMsg: Message = {
          id: `reply-${Date.now()}`,
          role: "assistant",
          content: data.content,
          timestamp: new Date().toLocaleTimeString("ar-SA", { hour: '2-digit', minute: '2-digit' }),
        };

        setConversations((prev) => ({
          ...prev,
          [selectedAgent.id]: [...updatedHistory, replyMsg]
        }));
      }

    } catch (err: any) {
      console.error(err);
      const errorMsg: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `⚠️ تعذر الاتصال بمحرك الوكيل. سبب الخطأ: ${err.message || "خطأ غير معروف"}. يرجى التحقق من مفتاح الـ API وتحديث الصفحة.`,
        timestamp: new Date().toLocaleTimeString("ar-SA", { hour: '2-digit', minute: '2-digit' }),
      };
      setConversations((prev) => ({
        ...prev,
        [selectedAgent.id]: [...updatedHistory, errorMsg]
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const currentMessages = conversations[selectedAgent.id] || [];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col md:flex-row relative selection:bg-white selection:text-black border-8 border-neutral-900" dir="rtl">
      
      {/* Massive Background Typography */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] select-none z-0 overflow-hidden">
        <h1 className="text-[180px] sm:text-[380px] font-black italic tracking-tighter uppercase leading-none text-neutral-600">OS</h1>
      </div>

      {/* Toast Alert Box */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -50, x: "-50%" }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 p-4 bg-neutral-900 border border-neutral-800 text-xs uppercase tracking-widest font-black text-white shadow-2xl flex items-center gap-3 max-w-xl text-center rounded-none"
          >
            <div className="w-2 h-2 bg-white" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Control Room Sidebar */}
      <aside className="relative z-30 w-full md:w-80 bg-neutral-950 border-l border-neutral-900 flex flex-col h-auto md:h-screen sticky top-0">
        
        {/* Branding Node */}
        <div className="p-6 border-b border-neutral-900 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 bg-white text-black flex items-center justify-center font-bold text-xl uppercase italic tracking-tighter">
              T
            </div>
            <div>
              <h1 className="text-sm font-black tracking-widest block uppercase">تسامي OS</h1>
              <span className="text-[9px] uppercase tracking-[0.3em] font-bold text-neutral-500 block -mt-1">STRUCTURAL // V.02</span>
            </div>
          </div>
          <button
            onClick={onBackToLanding}
            className="p-2 bg-neutral-900 border border-neutral-800 hover:border-white text-neutral-400 hover:text-white transition-all cursor-pointer"
            title="رجوع للموقع التعريفي"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Agent Tabs Nav */}
        <div className="flex-1 px-4 py-6 space-y-2 overflow-y-auto custom-scrollbar">
          <span className="px-4 text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-3">الشبكة الوكيلية الحالية</span>
          {Object.values(TASAMI_AGENTS).map((agent) => {
            const isSelected = selectedAgent.id === agent.id;
            return (
              <button
                key={agent.id}
                onClick={() => setSelectedAgent(agent)}
                className={`w-full text-right flex items-center justify-between p-4 rounded-none border transition-all duration-300 group cursor-pointer ${
                  isSelected 
                    ? "bg-white text-black font-black border-transparent" 
                    : "text-neutral-400 bg-transparent border-transparent hover:bg-neutral-900 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 ${isSelected ? "bg-black" : "bg-neutral-500"}`}
                  />
                  <div>
                    <span className="text-xs font-black uppercase block leading-tight">{agent.name}</span>
                    <span className={`text-[9px] block uppercase tracking-wider ${isSelected ? "text-neutral-700 font-bold" : "text-neutral-500 group-hover:text-neutral-400"}`}>
                      {agent.arabicTitle}
                    </span>
                  </div>
                </div>
                
                {agent.progress > 0 && (
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-none ${isSelected ? "bg-black/10 text-black" : "bg-neutral-900 text-neutral-400"}`}>
                    {agent.progress}%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sovereignty Protection Panel */}
        <div className="p-4 border-t border-neutral-900 space-y-3 bg-neutral-950">
          <div className="p-3 bg-neutral-900 border border-neutral-800 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-white" />
              <span className="text-neutral-400 uppercase tracking-wider">سيادة المؤسس:</span>
            </div>
            <span className="text-[9px] bg-white text-black px-2 py-0.5 font-bold uppercase tracking-widest">
              ACTIVE
            </span>
          </div>

          <button
            onClick={onBackToLanding}
            className="flex items-center justify-center gap-2 w-full py-3 text-neutral-400 hover:text-red-500 hover:bg-red-950/10 border border-neutral-900 hover:border-red-950/20 transition-all text-xs font-semibold cursor-pointer"
          >
            <span>الخروج للرئيسية</span>
          </button>
        </div>
      </aside>

      {/* Main Core View Area */}
      <main className="flex-1 min-h-screen flex flex-col overflow-x-hidden relative z-10">
        
        {/* Core Operations Header */}
        <header className="p-6 md:p-8 border-b border-neutral-900 bg-[#030303]/80 backdrop-blur-md flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 sticky top-0 z-20">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl md:text-3xl font-black tracking-tight uppercase italic leading-none">غرفة القيادة والسيطرة</h2>
              <span className={`px-2.5 py-0.5 border text-[10px] font-bold font-mono tracking-wider ${
                emergencyOverride 
                  ? "bg-red-950/20 text-red-500 border-red-900/50" 
                  : "bg-white text-black border-transparent"
              }`}>
                {emergencyOverride ? "🔐 SOVEREIGN_OVERRIDE_ACTIVE" : "⚡ AUTOPILOT_ONLINE"}
              </span>
            </div>
            <p className="text-xs md:text-sm text-neutral-400 font-light font-mono uppercase tracking-wide">
              مرحباً بك مجدداً أيها المؤسس. يمكنك متابعة الوكلاء وإدارة الموافقات والتفاعل المباشر معهم.
            </p>
          </div>

          {/* Emergency Kill Switch Trigger */}
          <button
            onClick={handleToggleOverride}
            id="override-kill-switch"
            className={`px-6 py-3 font-black text-xs uppercase tracking-widest flex items-center gap-2.5 border transition-all duration-300 cursor-pointer ${
              emergencyOverride 
                ? "bg-red-600 text-white border-red-500 animate-pulse shadow-[0_0_20px_rgba(220,38,38,0.3)]" 
                : "bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-red-500 hover:border-red-500/50"
            }`}
          >
            <LockKeyhole className="w-4 h-4" />
            <span>{emergencyOverride ? "إلغاء قفل الطوارئ وتنشيط الوكلاء" : "تفعيل بروتوكول الإيقاف الطارئ (Override)"}</span>
          </button>
        </header>

        {/* Global Emergency Status Banner */}
        {emergencyOverride && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-red-950/20 border-b border-red-900/30 text-red-200 px-6 py-4 flex items-start gap-4 text-xs md:text-sm"
          >
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5 animate-bounce" />
            <div className="space-y-1">
              <h4 className="font-bold text-white">تم تفعيل بروتوكول الإيقاف السيادي الطارئ (Manual Override)</h4>
              <p className="text-neutral-400 leading-relaxed font-light">
                تم تعليق اتخاذ القرارات والردود التلقائية لجميع الوكلاء المستقلين بشكل احترازي. يرجى إلغاء تفعيل قفل الطوارئ من الأعلى لاستعادة التشغيل المعتاد للأنظمة والوكلاء.
              </p>
            </div>
          </motion.div>
        )}

        {/* Core Content Grid */}
        <div className="p-6 md:p-8 space-y-8 flex-1 flex flex-col justify-between">
          
          {/* Top Panel: Core Metrics row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            
            {/* Metric 1 */}
            <div className="p-6 rounded-none bg-neutral-900/10 border border-neutral-850 hover:border-white transition-all duration-300 flex justify-between items-start relative overflow-hidden group">
              <div className="space-y-2 w-full">
                <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono block">Project MRR</span>
                <div className="text-3xl font-black italic">158,400 ر.س</div>
                <div className="text-[10px] text-neutral-400 uppercase tracking-widest mt-1 italic font-mono flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> +14.2% // MONTHLY RECURRING
                </div>
                <div className="h-[2px] w-full bg-neutral-800 mt-2">
                  <div className="h-full bg-white" style={{ width: "84%" }}></div>
                </div>
              </div>
            </div>

            {/* Metric 2 */}
            <div className="p-6 rounded-none bg-neutral-900/10 border border-neutral-850 hover:border-white transition-all duration-300 flex justify-between items-start relative overflow-hidden group">
              <div className="space-y-2 w-full">
                <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono block">Conversations Rate</span>
                <div className="text-3xl font-black italic">2,842 محادثة</div>
                <div className="text-[10px] text-neutral-400 uppercase tracking-widest mt-1 italic font-mono flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> +24.8% // ACTIVE CHATS
                </div>
                <div className="h-[2px] w-full bg-neutral-800 mt-2">
                  <div className="h-full bg-white" style={{ width: "72%" }}></div>
                </div>
              </div>
            </div>

            {/* Metric 3 */}
            <div className="p-6 rounded-none bg-neutral-900/10 border border-neutral-850 hover:border-white transition-all duration-300 flex justify-between items-start relative overflow-hidden group">
              <div className="space-y-2 w-full">
                <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono block">Response Time</span>
                <div className="text-3xl font-black italic">1.2 ثانية</div>
                <div className="text-[10px] text-neutral-400 uppercase tracking-widest mt-1 italic font-mono flex items-center gap-1">
                  -88% كفاءة // RESPONSE RATE
                </div>
                <div className="h-[2px] w-full bg-neutral-800 mt-2">
                  <div className="h-full bg-white" style={{ width: "94%" }}></div>
                </div>
              </div>
            </div>

            {/* Metric 4 */}
            <div className="p-6 rounded-none bg-neutral-900/10 border border-neutral-850 hover:border-white transition-all duration-300 flex justify-between items-start relative overflow-hidden group">
              <div className="space-y-2 w-full">
                <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono block">Operational Efficiency</span>
                <div className="text-3xl font-black italic">94.5%</div>
                <div className="text-[10px] text-neutral-400 uppercase tracking-widest mt-1 italic font-mono flex items-center gap-1">
                  +6.1% تلقائي // AUTOMATED DEPLOY
                </div>
                <div className="h-[2px] w-full bg-neutral-800 mt-2">
                  <div className="h-full bg-white" style={{ width: "88%" }}></div>
                </div>
              </div>
            </div>

          </div>

          {/* Core Interactive Center Grid: Chatroom and Sovereign Board */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
            
            {/* Left Side (X-Large Panel): The Chatroom & Network interface */}
            <div className="xl:col-span-7 flex flex-col bg-neutral-900/10 border border-neutral-850 rounded-none overflow-hidden h-[600px]">
              
              {/* Chatroom Agent Header */}
              <div className="p-4 bg-neutral-950 border-b border-neutral-850 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-neutral-900 border border-neutral-800 text-white flex items-center justify-center font-bold text-xs uppercase font-mono">
                    {selectedAgent.name[4] || "A"}
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                      <span>{selectedAgent.name}</span>
                      <span className="w-1.5 h-1.5 bg-white animate-ping" />
                    </h3>
                    <p className="text-[10px] text-neutral-500 uppercase font-mono tracking-wider">{selectedAgent.statusText}</p>
                  </div>
                </div>

                {/* Model and Thinking selection controls */}
                <div className="flex items-center bg-neutral-950 border border-neutral-800 p-0.5">
                  <button
                    onClick={() => setChatMode("fast")}
                    id="chat-mode-fast"
                    className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                      chatMode === "fast" 
                        ? "bg-white text-black" 
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                    title="موجز وسريع"
                  >
                    🚀 FAST
                  </button>
                  <button
                    onClick={() => setChatMode("standard")}
                    id="chat-mode-standard"
                    className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                      chatMode === "standard" 
                        ? "bg-white text-black" 
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                    title="متوازن وافتراضي"
                  >
                    🌐 STD
                  </button>
                  <button
                    onClick={() => setChatMode("thinking")}
                    id="chat-mode-thinking"
                    className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                      chatMode === "thinking" 
                        ? "bg-white text-black" 
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                    title="التفكير الفائق لعام 2026 وحل المسائل الصعبة"
                  >
                    🧠 THINK
                  </button>
                </div>
              </div>

              {/* Message scroll viewport */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 custom-scrollbar bg-black shadow-inner">
                {currentMessages.map((msg) => {
                  const isAssistant = msg.role === "assistant";
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col max-w-[85%] space-y-1.5 ${isAssistant ? "mr-0 ml-auto" : "ml-0 mr-auto"}`}
                    >
                      <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest">
                        <span className="text-neutral-500">{msg.timestamp}</span>
                        <span className="text-neutral-400 font-bold">
                          {isAssistant ? selectedAgent.name : "المؤسس البشري"}
                        </span>
                      </div>
                      
                      <div
                        className={`p-4 rounded-none text-xs leading-relaxed font-mono uppercase tracking-wide whitespace-pre-wrap ${
                          isAssistant
                            ? "bg-neutral-900/40 border border-neutral-850 text-neutral-200"
                            : "bg-neutral-950 border border-neutral-700 text-neutral-200"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })}

                {/* Animated thinking/reasoning state chain logs */}
                {isLoading && (
                  <div className="flex flex-col space-y-1.5 mr-0 ml-auto max-w-[80%]">
                    <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest">
                      <span className="text-neutral-500">الآن</span>
                      <span className="text-neutral-400 font-bold">{selectedAgent.name}</span>
                    </div>

                    <div className="p-4 rounded-none bg-neutral-900/20 border border-neutral-800 space-y-3">
                      {chatMode === "thinking" ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-[10px] font-mono text-white uppercase tracking-wider animate-pulse">
                            <BrainCircuit className="w-4 h-4 animate-spin text-white" />
                            <span>تنشيط محرك التفكير الفائق (Reasoning Chain)...</span>
                          </div>
                          <div className="pl-3 border-r border-neutral-800 text-[9.5px] text-neutral-500 font-mono space-y-1 mr-1 uppercase">
                            <p className="animate-pulse">→ تحليل السؤال ومطابقة السياق والدستور...</p>
                            <p className="text-neutral-600">→ استدعاء نظام التعليمات التوجيهي والمستندات المشتركة...</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                          <span className="flex space-x-1">
                            <span className="w-1.5 h-1.5 bg-white animate-bounce [animation-delay:-0.3s]" />
                            <span className="w-1.5 h-1.5 bg-neutral-500 animate-bounce [animation-delay:-0.15s]" />
                            <span className="w-1.5 h-1.5 bg-neutral-700 animate-bounce" />
                          </span>
                          <span>ANALYZING_SYSTEM_PROMPT...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Command Area */}
              <form onSubmit={handleSendMessage} className="p-4 bg-neutral-950 border-t border-neutral-850 flex gap-3">
                <input
                  type="text"
                  value={userInputs[selectedAgent.id]}
                  onChange={(e) => setUserInputs({ ...userInputs, [selectedAgent.id]: e.target.value })}
                  disabled={isLoading || emergencyOverride}
                  placeholder={
                    emergencyOverride 
                      ? "النظام مغلق بموجب بروتوكول الإيقاف الطارئ..." 
                      : `وجّه أمراً أو استفساراً لـ ${selectedAgent.name}...`
                  }
                  className="flex-1 bg-neutral-900 border border-neutral-800 rounded-none px-5 py-3.5 text-xs font-mono uppercase tracking-wide focus:outline-none focus:border-white transition-all text-white disabled:opacity-50"
                />
                
                <button
                  type="submit"
                  disabled={isLoading || emergencyOverride || !userInputs[selectedAgent.id]?.trim()}
                  className="px-6 py-3.5 bg-white hover:bg-neutral-200 text-black font-black uppercase tracking-widest text-[10px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <span>إرسال</span>
                  <CornerDownLeft className="w-3.5 h-3.5" />
                </button>
              </form>

            </div>

            {/* Right Side: Sovereign Approval Board & Active Network metrics */}
            <div className="xl:col-span-5 space-y-8 flex flex-col justify-between">
              
              {/* Sovereign Approvals Panel */}
              <div className="p-6 md:p-8 rounded-none bg-neutral-900/10 border border-neutral-850 space-y-6 flex-1">
                <div className="flex justify-between items-center border-b border-neutral-850 pb-4">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="text-white w-5 h-5" />
                    <h3 className="text-base font-black uppercase tracking-wider">طلبات الموافقة المعلقة للمؤسس</h3>
                  </div>
                  <span className="px-2.5 py-1 bg-neutral-900 text-[10px] font-black uppercase tracking-widest text-white border border-neutral-800">
                    {approvals.length} معلقة
                  </span>
                </div>

                <div className="space-y-4 max-h-[310px] overflow-y-auto custom-scrollbar">
                  <AnimatePresence mode="popLayout">
                    {approvals.length === 0 ? (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="py-12 text-center text-[10px] uppercase tracking-widest text-neutral-500 border border-dashed border-neutral-800 rounded-none font-mono"
                      >
                        رائع! لا توجد قرارات معلقة حالياً. الوكلاء المفوّضون يقودون العمل بسلاسة.
                      </motion.div>
                    ) : (
                      approvals.map((app) => (
                        <motion.div
                          key={app.id}
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, x: -50 }}
                          className="p-4 rounded-none bg-neutral-950 border border-neutral-850 hover:border-white transition-all space-y-2 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-right"
                        >
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-widest">
                              <span className="bg-white text-black px-1.5 py-0.5 font-bold">
                                {app.agentName}
                              </span>
                              <span className="text-neutral-500">{app.timestamp}</span>
                            </div>
                            <h4 className="text-xs font-black text-neutral-200">{app.task}</h4>
                            <p className="text-[10px] text-neutral-500 font-mono uppercase tracking-wider whitespace-pre-wrap">{app.impact}</p>
                          </div>

                          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                            <button
                              onClick={() => handleReject(app.id, app.task)}
                              className="p-2 border border-neutral-800 hover:bg-red-950/20 hover:border-red-500/30 text-red-500 transition-all cursor-pointer"
                              title="رفض الإجراء"
                            >
                              <X className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleApprove(app.id, app.task)}
                              className="p-2 bg-white hover:bg-neutral-200 text-black font-bold transition-all cursor-pointer"
                              title="موافقة وتمرير"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Informative Guidance Node */}
              <div className="p-5 border border-white/20 bg-neutral-900 rounded-none text-[11px] leading-relaxed text-neutral-400 font-mono uppercase tracking-wider text-right">
                <div className="space-y-2">
                  <h4 className="font-black text-white flex items-center gap-2 justify-end">
                    <span>تفويض الأثر المستقبلي الفوري</span>
                    <Info className="w-4 h-4 text-white" />
                  </h4>
                  <p className="font-light">
                    يقوم الوكلاء بمزامنة ميزانياتهم المصغرة وتكتيكاتهم بشكل مستمر. في حال واجهت أي استفسار تسويقي أو مالي معقد، استخدم تصفية **"التفكير الفائق"** لتحقيق أقصى مستوى من المنطق والتحليل للوصول لأفضل الخيارات.
                  </p>
                </div>
              </div>

            </div>

          </div>

        </div>

      </main>
    </div>
  );
}
