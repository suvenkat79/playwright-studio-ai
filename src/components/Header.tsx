import React, { useState } from 'react';

interface HeaderProps {
  currentProject: string;
  onSelectProject: (proj: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentProject,
  onSelectProject
}) => {
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const projects = [
    'core-e2e / Projects',
    'checkout-pipeline / Projects',
    'auth-service / Projects',
    'billing-engine / Projects'
  ];

  const notifications = [
    {
      id: 1,
      title: 'Run #408 Completed',
      desc: 'All 7 steps passed in 412ms across Chromium',
      time: '2m ago',
      type: 'success'
    },
    {
      id: 2,
      title: 'Self-Healing Locator Activated',
      desc: 'Auto-repaired urgencySelect using getByRole combobox',
      time: '18m ago',
      type: 'info'
    },
    {
      id: 3,
      title: 'GitHub Action Triggered',
      desc: 'Automated smoke test queued on branch main',
      time: '1h ago',
      type: 'neutral'
    }
  ];

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-[#0a0e16]/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.3)] pt-safe border-b border-[#262a33]/60">
      <div className="max-w-7xl mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-2">
        {/* Brand & Project Selector */}
        <div className="flex items-center gap-2 min-w-0">
          <img
            alt="Playwright Studio AI Logo"
            className="h-8 w-auto object-contain flex-shrink-0"
            src="https://lh3.googleusercontent.com/aida/AEtjO1VnDAI7Pzpbtsp_Zn4cuIdlTMp5MDprKnt3HI1ucZ9glxLsbuCefXDk9NqwnZmKtQhKe7niMwWd-PJaWCfffoL2-XylHui58nrYwCqrFvm1dkU5mh-iz3OrHKz2UmpWwmf4KGhije_llf9Bba6f6XwC3bsrvAy4rIINma7m3FdSfqJTI0wtNYTapoYXvuZBoPk6IxCoWj7d2FpFyaoCz-LveCGKyL8q6boGNFOBl254RvbKIYpP4uk3Tg"
          />

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-semibold text-[#dfe2ee] tracking-tight truncate">
                Playwright Studio AI
              </span>
              <span className="px-1.5 py-0.5 rounded-full bg-[#0566d9]/20 text-[#adc6ff] text-[10px] font-mono font-semibold uppercase tracking-wider">
                v2.4
              </span>
            </div>

            {/* Context Breadcrumbs */}
            <div className="relative flex items-center gap-1 text-[#c7c4d7]">
              <button
                onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                className="flex items-center gap-0.5 text-[11px] font-mono hover:text-[#dfe2ee] transition-colors truncate text-left"
              >
                <span className="truncate">{currentProject}</span>
                <span className="material-symbols-outlined text-[14px]">
                  {showProjectDropdown ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              {/* Project Dropdown */}
              {showProjectDropdown && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-[#181c24] border border-[#262a33] rounded-lg shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-1.5 text-[10px] font-mono uppercase text-[#908fa0] border-b border-[#262a33]">
                    Switch Workspace Repository
                  </div>
                  {projects.map((proj) => (
                    <button
                      key={proj}
                      onClick={() => {
                        onSelectProject(proj);
                        setShowProjectDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center justify-between hover:bg-[#262a33] transition-colors ${
                        currentProject === proj
                          ? 'text-[#4cd7f6] bg-[#262a33]/50'
                          : 'text-[#dfe2ee]'
                      }`}
                    >
                      <span className="truncate">{proj}</span>
                      {currentProject === proj && (
                        <span className="material-symbols-outlined text-[14px]">
                          check
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Actions: Notifications & Profile */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label="Notifications"
              className="relative w-10 h-10 rounded-lg flex items-center justify-center text-[#c7c4d7] hover:text-[#dfe2ee] hover:bg-[#1c2028] transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">
                notifications
              </span>
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#4cd7f6] ring-2 ring-[#0a0e16]"></span>
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-[#181c24] border border-[#262a33] rounded-xl shadow-2xl py-2 z-50">
                <div className="px-3.5 py-1.5 flex items-center justify-between border-b border-[#262a33]">
                  <span className="text-xs font-semibold text-[#dfe2ee]">
                    Runtime Notifications
                  </span>
                  <span className="text-[10px] font-mono text-[#4cd7f6]">
                    3 unread
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#262a33]/50">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="px-3.5 py-2.5 hover:bg-[#1c2028] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#dfe2ee]">
                          {n.title}
                        </span>
                        <span className="text-[10px] font-mono text-[#908fa0]">
                          {n.time}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#c7c4d7] mt-0.5 line-clamp-2">
                        {n.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => setShowProfile(!showProfile)}
              className="flex items-center justify-center p-0.5 rounded-full bg-[#31353e] hover:ring-2 hover:ring-[#4cd7f6]/50 transition-all"
            >
              <img
                alt="Profile"
                className="w-8 h-8 rounded-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBbHdCLco1fEbdd0VhJJ2N8DXGyB9-ZvYZLHyNf21e4A4_I969hlD8KNjJWAo1DwUHDdp8YgFiHMO5Bpf7wYtDlL2h4zf-yFYKFsH9dguFAagrH99NebQ4VXWMZCUqpvtyyApN-zE0cdvkxxlLcE1K0pP-90E7y5RKW7CUOiPA8j_VaejL2urK30XU_A_nqIphbjnOQ3CUh9Xv96MH69Q3NE9kl-d_o2E9OOzcEoB4CN5HSB306CWc"
              />
            </button>

            {showProfile && (
              <div className="absolute right-0 mt-2 w-64 bg-[#181c24] border border-[#262a33] rounded-xl shadow-2xl p-3 z-50">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-[#262a33]">
                  <img
                    alt="User"
                    className="w-9 h-9 rounded-full object-cover"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuBbHdCLco1fEbdd0VhJJ2N8DXGyB9-ZvYZLHyNf21e4A4_I969hlD8KNjJWAo1DwUHDdp8YgFiHMO5Bpf7wYtDlL2h4zf-yFYKFsH9dguFAagrH99NebQ4VXWMZCUqpvtyyApN-zE0cdvkxxlLcE1K0pP-90E7y5RKW7CUOiPA8j_VaejL2urK30XU_A_nqIphbjnOQ3CUh9Xv96MH69Q3NE9kl-d_o2E9OOzcEoB4CN5HSB306CWc"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#dfe2ee] truncate">
                      Automation Lead
                    </div>
                    <div className="text-[11px] font-mono text-[#908fa0] truncate">
                      sundarvenkatchennai@gmail.com
                    </div>
                  </div>
                </div>
                <div className="pt-2 flex flex-col gap-1 text-xs text-[#c7c4d7]">
                  <div className="flex items-center justify-between py-1 font-mono text-[11px]">
                    <span>CI Sandbox Token</span>
                    <span className="text-[#10b981]">Active</span>
                  </div>
                  <div className="flex items-center justify-between py-1 font-mono text-[11px]">
                    <span>Engine Version</span>
                    <span>1.50.0-linux</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
