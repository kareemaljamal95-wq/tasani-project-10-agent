import { Brain, Search, FileText, MessageSquare, Bookmark, Tags } from 'lucide-react';

export default function BrainPage() {
  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Knowledge Brain</h1>
        <p className="text-white/60 mt-1">Memory system, documents, and context retrieval</p>
      </div>

      <div className="relative">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl px-5 py-3">
          <Search className="h-5 w-5 text-white/40" />
          <input
            type="text"
            placeholder="Search memories, documents, and knowledge..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
          />
          <kbd className="hidden lg:inline-block rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/40">⌘K</kbd>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-violet-400" />
              Recent Memories
            </h2>
            <span className="text-xs text-white/40">Last 7 days</span>
          </div>
          <div className="space-y-3">
            {[
              { content: 'User prefers morning meetings for deep work', type: 'Preference', importance: 'High' },
              { content: 'Completed Q1 financial review - revenue up 23%', type: 'Fact', importance: 'High' },
              { content: 'Learning TypeScript advanced patterns', type: 'Skill', importance: 'Medium' },
              { content: 'Discussed new product launch strategy with team', type: 'Conversation', importance: 'Medium' },
            ].map((mem, i) => (
              <div key={i} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300">{mem.type}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${mem.importance === 'High' ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'}`}>{mem.importance}</span>
                </div>
                <p className="text-sm text-white/80">{mem.content}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <FileText className="h-5 w-5 text-violet-400" />
                Documents
              </h2>
            </div>
            <div className="space-y-2">
              {[
                { name: 'Q1 Strategy Report.pdf', pages: 24, date: '2 days ago' },
                { name: 'Product Roadmap 2024.docx', pages: 12, date: '5 days ago' },
                { name: 'Competitor Analysis.xlsx', pages: 8, date: '1 week ago' },
              ].map((doc, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all cursor-pointer">
                  <FileText className="h-5 w-5 text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{doc.name}</p>
                    <p className="text-xs text-white/40">{doc.pages} pages · {doc.date}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Tags className="h-5 w-5 text-violet-400" />
              <h2 className="text-lg font-semibold text-white">Knowledge Tags</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {['Business', 'Technology', 'Strategy', 'Finance', 'Marketing', 'Product', 'Sales', 'Growth'].map((tag) => (
                <span key={tag} className="px-3 py-1.5 rounded-full text-xs bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white transition-all cursor-pointer">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
