// ============================================================
// Tab Bar — Navigation between views
// Bilingual: English / Chinese
// ============================================================

type TabId = 'transcript' | 'translation' | 'speech' | 'summary';

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  aiConfigured: boolean;
}

const TABS: Array<{ id: TabId; en: string; zh: string; requiresAI: boolean }> = [
  { id: 'transcript', en: 'Transcript', zh: '字幕', requiresAI: false },
  { id: 'translation', en: 'Translation', zh: '翻译', requiresAI: true },
  { id: 'speech', en: 'Speech', zh: '发言', requiresAI: true },
  { id: 'summary', en: 'Summary', zh: '摘要', requiresAI: true },
];

export default function TabBar({ activeTab, onTabChange, aiConfigured }: TabBarProps) {
  return (
    <div className="flex border-b border-zinc-200 dark:border-zinc-700 px-2">
      {TABS.map(tab => {
        const disabled = tab.requiresAI && !aiConfigured;
        return (
          <button
            key={tab.id}
            onClick={() => !disabled && onTabChange(tab.id)}
            disabled={disabled}
            className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : disabled
                  ? 'border-transparent text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {tab.en}
            <span className="block text-[10px] font-normal opacity-70">{tab.zh}</span>
          </button>
        );
      })}
    </div>
  );
}

export type { TabId };
