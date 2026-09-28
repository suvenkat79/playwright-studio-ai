import React, { useState } from 'react';
import { generateAndDownloadZip } from '../utils/zipExport';
import { SuiteFile } from '../types';

interface ProjectHeaderProps {
  files: SuiteFile[];
  baseUrl: string;
  isHeadless: boolean;
  onToggleHeadless: () => void;
  onChangeBaseUrl: (newUrl: string) => void;
  onTriggerRun: (url?: string) => void;
  onStartRecording?: () => void;
  isRecordingStarting?: boolean;
  canStartRecording?: boolean;
}

const PRESET_ENVIRONMENTS = [
  {
    name: 'Awwwards E-Commerce Gallery',
    url: 'https://www.awwwards.com/websites/e-commerce/',
    desc: 'Award-winning e-commerce website nominees & design showcase'
  },
  {
    name: 'Staging / Cloud E2E',
    url: 'https://core-e2e.internal.corp',
    desc: 'Corporate staging cluster with full test telemetry'
  },
  {
    name: 'Local Dev Server',
    url: 'http://localhost:3000',
    desc: 'Local development environment with fast hot-reloading'
  },
  {
    name: 'E-Commerce Store & Checkout',
    url: 'https://store.demo.cloud',
    desc: 'Retail shopping cart, product catalog & checkout flow'
  }
];

export const ProjectHeader: React.FC<ProjectHeaderProps> = ({
  files,
  baseUrl,
  isHeadless,
  onToggleHeadless,
  onChangeBaseUrl,
  onTriggerRun,
  onStartRecording,
  isRecordingStarting = false,
  canStartRecording = true
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [showGhModal, setShowGhModal] = useState(false);
  const [ghPushed, setGhPushed] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [customInputUrl, setCustomInputUrl] = useState(baseUrl);

  const handleDownload = async () => {
    setIsExporting(true);
    const success = await generateAndDownloadZip(files, isHeadless);
    setIsExporting(false);
    if (success) {
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 2500);
    }
  };

  const handleGhPush = () => {
    setGhPushed(true);
    setTimeout(() => {
      setGhPushed(false);
      setShowGhModal(false);
    }, 1800);
  };

  const handleSaveCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    let url = customInputUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    onChangeBaseUrl(url);
    setShowUrlModal(false);
  };

  return (
    <>
      <section className="flex flex-col gap-3 bg-[#181c24] p-4 sm:p-5 rounded-xl shadow-md border border-[#262a33]">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0566d9]/20 text-[#adc6ff] text-[11px] font-mono font-semibold">
                <span className="material-symbols-outlined text-[13px] text-[#4cd7f6]">
                  deployed_code
                </span>
                v1.2 ACTIVE
              </span>
              <span className="text-[11px] font-mono text-[#c7c4d7] truncate">
                repo: playwright-enterprise-template
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold text-[#dfe2ee] tracking-tight truncate">
              Enterprise E2E Suite
            </h1>

            {/* Target URL switcher pill */}
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                onClick={() => {
                  setCustomInputUrl(baseUrl);
                  setShowUrlModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0a0e16] hover:bg-[#141820] border border-[#262a33] text-[11px] font-mono text-[#4cd7f6] transition-colors cursor-pointer group"
                title="Click to change target test URL"
              >
                <span className="material-symbols-outlined text-[13px] text-[#10b981]">
                  link
                </span>
                <span className="text-[#908fa0]">BaseURL:</span>
                <span className="font-semibold underline decoration-dashed decoration-[#4cd7f6]/50 underline-offset-2 truncate max-w-[200px] sm:max-w-[320px]">
                  {baseUrl}
                </span>
                <span className="material-symbols-outlined text-[13px] text-[#908fa0] group-hover:text-[#dfe2ee]">
                  edit
                </span>
              </button>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              aria-label="Project actions"
              className="w-8 h-8 rounded-lg bg-[#1c2028] flex items-center justify-center text-[#c7c4d7] hover:text-[#dfe2ee] hover:bg-[#262a33] transition-colors flex-shrink-0 cursor-pointer"
              id="quickOptionsBtn"
            >
              <span className="material-symbols-outlined text-[18px]">
                more_vert
              </span>
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 mt-1 w-64 bg-[#181c24] border border-[#262a33] rounded-lg shadow-xl py-1 z-40 font-mono">
                {onStartRecording && (
                  <button
                    onClick={() => {
                      setShowMoreMenu(false);
                      onStartRecording();
                    }}
                    disabled={!canStartRecording}
                    className="w-full text-left px-3 py-2 text-xs text-[#adc6ff] hover:bg-[#262a33] flex items-center gap-2 cursor-pointer font-semibold"
                    id="headerStartRecordingBtn"
                  >
                    <span className="material-symbols-outlined text-[15px] text-[#ffb4ab]">
                      fiber_manual_record
                    </span>
                    {isRecordingStarting ? 'Starting Recording...' : 'Start Browser Recording'}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    onTriggerRun(baseUrl);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-[#dfe2ee] hover:bg-[#262a33] flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px] text-[#4cd7f6]">
                    play_circle
                  </span>
                  Execute in Sandbox ({!isHeadless ? 'Headed' : 'Headless'})
                </button>
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    onToggleHeadless();
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-[#dfe2ee] hover:bg-[#262a33] flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px] text-amber-400">
                    {!isHeadless ? 'visibility_off' : 'visibility'}
                  </span>
                  Toggle: {!isHeadless ? 'Switch to Headless' : 'Switch to Headed'}
                </button>
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    setCustomInputUrl(baseUrl);
                    setShowUrlModal(true);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-[#dfe2ee] hover:bg-[#262a33] flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px] text-[#10b981]">
                    edit_note
                  </span>
                  Configure Base URL
                </button>
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowGhModal(true);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-[#dfe2ee] hover:bg-[#262a33] flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px] text-[#adc6ff]">
                    sync
                  </span>
                  Sync GitHub Action
                </button>
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    navigator.clipboard.writeText(
                      `npx playwright test ${!isHeadless ? '--headed' : ''}`
                    );
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-[#dfe2ee] hover:bg-[#262a33] flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    terminal
                  </span>
                  Copy CLI Command ({!isHeadless ? '--headed' : 'default'})
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Framework Metadata Chips & Headed Mode Toggle */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#31353e] text-[#dfe2ee] text-[11px] font-mono">
            <span className="text-[#4cd7f6] font-bold">TS</span> 5.7
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#31353e] text-[#dfe2ee] text-[11px] font-mono">
            <span className="material-symbols-outlined text-[13px] text-[#c0c1ff]">
              play_arrow
            </span>{' '}
            Playwright 1.50
          </span>

          {/* Browser engine badge */}
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#31353e] text-[#c7c4d7] text-[11px] font-mono">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4cd7f6]"></span>
              CHR
              <span className="w-1.5 h-1.5 rounded-full bg-[#adc6ff]"></span>
              FFX
              <span className="w-1.5 h-1.5 rounded-full bg-[#8083ff]"></span>
              WKT
            </span>
          </span>

          {/* Headed Mode (headless: false) Toggle Chip */}
          <button
            onClick={onToggleHeadless}
            title={!isHeadless ? 'Running in Headed Mode. Click to switch to Headless.' : 'Running in Headless Mode. Click to switch to Headed.'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-semibold transition-all cursor-pointer ${
              !isHeadless
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-[#31353e] text-[#c7c4d7] hover:text-[#dfe2ee]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px] text-amber-400">
              {!isHeadless ? 'desktop_windows' : 'terminal'}
            </span>
            <span>{!isHeadless ? 'HEADED (headless: false)' : 'HEADLESS: true'}</span>
          </button>
        </div>

        {/* Quick Export Row */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleDownload}
            disabled={isExporting}
            className="flex-1 h-9 rounded-lg bg-[#c0c1ff] hover:bg-[#a9aaff] text-[#1000a9] flex items-center justify-center gap-2 px-3 text-xs sm:text-[13px] font-medium shadow-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-75"
            id="downloadZipBtn"
          >
            <span className="material-symbols-outlined text-[18px]">
              {isExporting ? 'autorenew' : exportSuccess ? 'check_circle' : 'folder_zip'}
            </span>
            <span>
              {isExporting
                ? 'Packaging...'
                : exportSuccess
                ? 'Suite Downloaded!'
                : 'Download Project .ZIP'}
            </span>
            <span className="ml-auto px-1.5 py-0.5 rounded bg-[#1000a9]/15 text-[#1000a9] text-[10px] font-mono font-semibold">
              1.4 MB
            </span>
          </button>

          <button
            onClick={() => setShowGhModal(true)}
            aria-label="Push to GitHub"
            title="Push to GitHub"
            className="w-9 h-9 rounded-lg bg-[#262a33] text-[#dfe2ee] flex items-center justify-center hover:bg-[#31353e] transition-colors flex-shrink-0 cursor-pointer"
            id="ghPushBtn"
          >
            <span className="material-symbols-outlined text-[18px]">
              publish
            </span>
          </button>
        </div>
      </section>

      {/* Target URL Modal */}
      {showUrlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#181c24] border border-[#262a33] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#4cd7f6] text-[20px]">
                  settings_suggest
                </span>
                <h3 className="text-sm font-semibold text-[#dfe2ee]">
                  Configure Target Test URL
                </h3>
              </div>
              <button
                onClick={() => setShowUrlModal(false)}
                className="text-[#908fa0] hover:text-[#dfe2ee]"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveCustomUrl} className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-[#c7c4d7] mb-1">
                  Custom Base URL:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customInputUrl}
                    onChange={(e) => setCustomInputUrl(e.target.value)}
                    placeholder="https://www.awwwards.com/websites/e-commerce/"
                    className="flex-1 h-9 px-3 rounded-lg bg-[#11141c] border border-[#262a33] text-xs font-mono text-[#dfe2ee] focus:border-[#4cd7f6] outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="h-9 px-4 rounded-lg bg-[#0566d9] hover:bg-[#0455b5] text-xs font-mono text-white font-medium cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-mono text-[#908fa0] mb-1.5">
                  Or select preset target environment:
                </div>
                <div className="space-y-1.5">
                  {PRESET_ENVIRONMENTS.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => {
                        onChangeBaseUrl(preset.url);
                        setShowUrlModal(false);
                      }}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs font-mono transition-colors flex flex-col gap-0.5 cursor-pointer ${
                        baseUrl === preset.url
                          ? 'bg-[#0566d9]/20 border-[#4cd7f6] text-[#dfe2ee]'
                          : 'bg-[#141820] border-[#262a33] text-[#c7c4d7] hover:border-[#31353e] hover:bg-[#1c2028]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">
                          {preset.name}
                        </span>
                        {baseUrl === preset.url && (
                          <span className="text-[10px] text-[#4cd7f6] font-bold">
                            CURRENT
                          </span>
                        )}
                      </div>
                      <span className="text-[#4cd7f6] text-[11px] truncate">
                        {preset.url}
                      </span>
                      <span className="text-[#908fa0] text-[10px]">
                        {preset.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#262a33]">
                <button
                  type="button"
                  onClick={() => setShowUrlModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-[#262a33] text-xs text-[#dfe2ee] hover:bg-[#31353e] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GitHub Push Modal */}
      {showGhModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#181c24] border border-[#262a33] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#4cd7f6] text-[20px]">
                  cloud_upload
                </span>
                <h3 className="text-sm font-semibold text-[#dfe2ee]">
                  Push Suite to GitHub
                </h3>
              </div>
              <button
                onClick={() => setShowGhModal(false)}
                className="text-[#908fa0] hover:text-[#dfe2ee]"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="text-xs text-[#c7c4d7] space-y-2">
              <div className="p-2.5 rounded-lg bg-[#1c2028] font-mono text-[11px] space-y-1">
                <div className="text-[#908fa0]">Target Repository:</div>
                <div className="text-[#4cd7f6] font-semibold truncate">
                  org/playwright-enterprise-template:main
                </div>
                <div className="text-[#908fa0] pt-1">Active Target URL:</div>
                <div className="text-[#10b981] truncate">{baseUrl}</div>
                <div className="text-[#908fa0] pt-1">Execution Mode:</div>
                <div className="text-amber-300 font-semibold">
                  {!isHeadless ? 'HEADED (headless: false)' : 'HEADLESS (headless: true)'}
                </div>
              </div>
              <p>
                This will trigger the associated GitHub Actions CI workflow with
                parallel execution across Chromium, Firefox, and WebKit.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowGhModal(false)}
                className="px-3 py-1.5 rounded-lg bg-[#262a33] text-xs text-[#dfe2ee] hover:bg-[#31353e]"
              >
                Cancel
              </button>
              <button
                onClick={handleGhPush}
                disabled={ghPushed}
                className="px-4 py-1.5 rounded-lg bg-[#0566d9] text-xs font-medium text-white hover:bg-[#0455b5] flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {ghPushed ? 'check' : 'publish'}
                </span>
                <span>{ghPushed ? 'Pushed to origin/main!' : 'Confirm Push'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
