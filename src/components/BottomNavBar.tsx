import React from 'react';
import { NavigationTab } from '../types';

interface BottomNavBarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  activeTab,
  onSelectTab
}) => {
  const tabs: {
    id: NavigationTab;
    label: string;
    icon: string;
    badgeDot?: boolean;
  }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: 'terminal'
    },
    {
      id: 'recorder',
      label: 'Recorder',
      icon: 'radio_button_checked',
      badgeDot: true
    },
    {
      id: 'ai-gen',
      label: 'AI Gen',
      icon: 'auto_awesome'
    },
    {
      id: 'projects',
      label: 'Projects',
      icon: 'source_environment'
    }
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 pb-safe bg-[#0a0e16]/90 backdrop-blur-xl shadow-[0_-4px_16px_rgba(0,0,0,0.4)] border-t border-[#262a33]/60">
      <div className="max-w-md sm:max-w-xl mx-auto flex justify-around items-center h-16 px-4">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 w-16 h-12 transition-colors cursor-pointer relative ${
                isActive
                  ? 'text-[#c0c1ff] font-medium'
                  : 'text-[#c7c4d7] hover:text-[#dfe2ee]'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">
                  {tab.icon}
                </span>
                {tab.badgeDot && (
                  <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#ffb4ab] animate-pulse"></span>
                )}
              </div>
              <span className="text-[10px] font-mono leading-none tracking-tight">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
