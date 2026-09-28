import React from 'react';
import { CategorySubTab } from '../types';

interface CategoryTabsProps {
  activeTab: CategorySubTab;
  onSelectTab: (tab: CategorySubTab) => void;
}

export const CategoryTabs: React.FC<CategoryTabsProps> = ({
  activeTab,
  onSelectTab
}) => {
  const tabs: { id: CategorySubTab; label: string; dot?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'pom', label: 'POM (Page Objects)', dot: true },
    { id: 'tests', label: 'Test Cases' },
    { id: 'assertions', label: 'Assertions' },
    { id: 'api', label: 'API Calls' },
    { id: 'ci', label: 'Download & CI' }
  ];

  return (
    <section className="w-full -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto no-scrollbar flex items-center gap-1.5 py-0.5">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`tab-item px-3 py-1.5 rounded-full text-[11px] font-mono whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer flex-shrink-0 ${
              isActive
                ? 'bg-[#0566d9] text-[#e6ecff] font-semibold shadow-sm'
                : 'bg-[#181c24] text-[#c7c4d7] hover:text-[#dfe2ee] hover:bg-[#262a33]'
            }`}
          >
            {tab.dot && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isActive ? 'bg-[#4cd7f6]' : 'bg-[#4cd7f6]/60'
                }`}
              />
            )}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </section>
  );
};
