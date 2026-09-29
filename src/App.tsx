import React, { useState } from 'react';
import { Header } from './components/Header';
import { ProjectHeader } from './components/ProjectHeader';
import { CategoryTabs } from './components/CategoryTabs';
import { CodeViewer } from './components/CodeViewer';
import { FrameworkDiagnostics } from './components/FrameworkDiagnostics';
import { LiveTraceAttachment } from './components/LiveTraceAttachment';
import { StickyActionBar } from './components/StickyActionBar';
import { BottomNavBar } from './components/BottomNavBar';
import { SandboxRunnerModal } from './components/SandboxRunnerModal';
import { LiveRecorderView } from './components/LiveRecorderView';
import { AIGeneratorView } from './components/AIGeneratorView';
import { DashboardView } from './components/DashboardView';
import { INITIAL_SUITE_FILES } from './data/suiteFiles';
import { generateAndDownloadZip } from './utils/zipExport';
import { NavigationTab, CategorySubTab, SuiteFile, ToastNotification } from './types';
import { useRecording } from './context/RecordingContext';

export default function App() {
  const {
    sessionId,
    isStarting: isRecordingStarting,
    canStart: canStartRecording,
    startRecording
  } = useRecording();

  const [activeNavTab, setActiveNavTab] = useState<NavigationTab>('projects');
  const [activeCategoryTab, setActiveCategoryTab] = useState<CategorySubTab>('pom');
  const [currentProject, setCurrentProject] = useState('core-e2e / Projects');
  const [targetBaseUrl, setTargetBaseUrl] = useState<string>('https://www.amazon.in');
  const [isHeadless, setIsHeadless] = useState<boolean>(false); // Headed mode (headless: false) by default
  const [suiteFiles, setSuiteFiles] = useState<SuiteFile[]>(INITIAL_SUITE_FILES);
  const [activeFileId, setActiveFileId] = useState<string>('AwwwardsEcommercePage.ts');
  const [isSandboxOpen, setIsSandboxOpen] = useState(false);
  const [sandboxInitialUrl, setSandboxInitialUrl] = useState<string>('https://www.awwwards.com/websites/e-commerce/');
  const [toast, setToast] = useState<ToastNotification | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({
      id: Date.now().toString(),
      type,
      message
    });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  /**
   * Connects "Start Browser Recording" button to:
   * POST http://localhost:8099/api/record/start
   * Request: { "url": string }
   * Response: { "status": "RECORDING_STARTED", "sessionId": string }
   * Stores sessionId in React Context, navigates to Live Recorder screen, shows toast
   */
  const handleStartBrowserRecording = async (urlToRecord: string = targetBaseUrl) => {
    const cleanUrl = urlToRecord.trim() || 'https://store.demo.cloud';
    try {
      const response = await startRecording(cleanUrl);
      showToast(
        `Recording started successfully! Session ID: ${response.sessionId}`,
        'success'
      );
      // Navigate to the Live Recorder screen upon success
      setActiveNavTab('recorder');
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to start browser recording';
      showToast(`Error: ${errorMessage}`, 'error');
    }
  };

  // Toggle between headed (headless: false) and headless mode
  const handleToggleHeadless = () => {
    const nextVal = !isHeadless;
    setIsHeadless(nextVal);

    // Update playwright.config.ts content dynamically
    setSuiteFiles((prev) =>
      prev.map((f) => {
        if (f.id === 'playwright.config.ts') {
          return {
            ...f,
            content: f.content.replace(/headless: (true|false)/g, `headless: ${nextVal}`)
          };
        }
        return f;
      })
    );

    showToast(
      !nextVal
        ? 'Switched to Headed Mode (headless: false) - Browser window will be visible'
        : 'Switched to Headless Mode (headless: true)',
      'info'
    );
  };

  // Change target base URL across suite files and config
  const handleChangeBaseUrl = (newUrl: string) => {
    setTargetBaseUrl(newUrl);
    setSandboxInitialUrl(newUrl);

    // Update playwright.config.ts content
    setSuiteFiles((prev) =>
      prev.map((f) => {
        if (f.id === 'playwright.config.ts') {
          return {
            ...f,
            content: f.content.replace(/baseURL: '.*'/, `baseURL: '${newUrl}'`)
          };
        }
        return f;
      })
    );

    showToast(`Updated suite Base URL to ${newUrl}`, 'info');
  };

  // Handle category sub-tab switching
  const handleSelectCategoryTab = (tab: CategorySubTab) => {
    setActiveCategoryTab(tab);
    if (tab === 'pom') {
      const pomFile = suiteFiles.find((f) => f.category === 'pom');
      if (pomFile) setActiveFileId(pomFile.id);
    } else if (tab === 'tests') {
      const testFile = suiteFiles.find((f) => f.category === 'test');
      if (testFile) setActiveFileId(testFile.id);
    } else if (tab === 'ci') {
      const configFile = suiteFiles.find((f) => f.category === 'config');
      if (configFile) setActiveFileId(configFile.id);
    }
  };

  // When AI generates a new file or recorder saves code
  const handleAddGeneratedFile = (file: SuiteFile) => {
    setSuiteFiles((prev) => [file, ...prev]);
    setActiveFileId(file.id);
    setActiveNavTab('projects');
    setActiveCategoryTab(file.category === 'pom' ? 'pom' : 'tests');
    showToast(`Added ${file.name} to suite files`, 'success');
  };

  const handleExport = async () => {
    showToast(`Packaging suite with headless: ${isHeadless} into .ZIP...`, 'info');
    await generateAndDownloadZip(suiteFiles, isHeadless);
    showToast('Download started: playwright-enterprise-suite.zip', 'success');
  };

  const handleOpenSandboxWithUrl = (url?: string) => {
    if (url) {
      setSandboxInitialUrl(url);
    }
    setIsSandboxOpen(true);
  };

  return (
    <div className="bg-[#0f131c] text-[#dfe2ee] font-sans antialiased min-h-screen flex flex-col selection:bg-[#8083ff]/30">
      {/* Toast Notification (Success / Error / Info) */}
      {toast && (
        <div
          role="alert"
          className={`fixed top-20 right-4 z-50 px-4 py-2.5 rounded-xl text-xs font-mono shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 border ${
            toast.type === 'success'
              ? 'bg-[#064e3b] text-[#34d399] border-[#10b981]/50 shadow-[0_4px_20px_rgba(16,185,129,0.3)]'
              : toast.type === 'error'
              ? 'bg-[#450a0a] text-[#fca5a5] border-[#ef4444]/50 shadow-[0_4px_20px_rgba(239,68,68,0.3)]'
              : 'bg-[#0566d9] text-white border-[#4cd7f6]/40 shadow-[0_4px_20px_rgba(5,102,217,0.3)]'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {toast.type === 'success'
              ? 'check_circle'
              : toast.type === 'error'
              ? 'error'
              : 'info'}
          </span>
          <span className="font-semibold">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 opacity-70 hover:opacity-100 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      )}

      {/* Persistent App Header */}
      <Header
        currentProject={currentProject}
        onSelectProject={(proj) => {
          setCurrentProject(proj);
          showToast(`Switched workspace to ${proj}`, 'info');
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative w-full px-4 sm:px-6 pt-18 sm:pt-20 pb-24 max-w-7xl mx-auto">
        {activeNavTab === 'projects' && (
          <div className="flex flex-col w-full gap-4 text-[#dfe2ee]">
            {/* Project Header & Quick Export */}
            <ProjectHeader
              files={suiteFiles}
              baseUrl={targetBaseUrl}
              isHeadless={isHeadless}
              onToggleHeadless={handleToggleHeadless}
              onChangeBaseUrl={handleChangeBaseUrl}
              onTriggerRun={handleOpenSandboxWithUrl}
              onStartRecording={() => handleStartBrowserRecording(targetBaseUrl)}
              isRecordingStarting={isRecordingStarting}
              canStartRecording={canStartRecording}
            />

            {/* Horizontal Scrollable Category Tabs */}
            <CategoryTabs
              activeTab={activeCategoryTab}
              onSelectTab={handleSelectCategoryTab}
            />

            {/* Responsive Split for Desktop / Vertical for Mobile */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Left/Main column: Interactive Code Viewer */}
              <div className="lg:col-span-8 flex flex-col gap-4">
                <CodeViewer
                  files={suiteFiles}
                  activeFileId={activeFileId}
                  onSelectFile={setActiveFileId}
                />
              </div>

              {/* Right column: Framework Diagnostics & Live Trace Attachment */}
              <div className="lg:col-span-4 flex flex-col gap-4">
                <FrameworkDiagnostics />
                <LiveTraceAttachment
                  onOpenSandbox={() => handleOpenSandboxWithUrl(targetBaseUrl)}
                />
              </div>
            </div>

            {/* Sticky Quick Action Bar with Start Browser Recording */}
            <StickyActionBar
              onStartBrowserRecording={() => handleStartBrowserRecording(targetBaseUrl)}
              isStarting={isRecordingStarting}
              canStart={canStartRecording}
              onRunSandbox={() => handleOpenSandboxWithUrl(targetBaseUrl)}
              onExport={handleExport}
            />
          </div>
        )}

        {/* View 2: Live Codegen Recorder */}
        {activeNavTab === 'recorder' && (
          <LiveRecorderView
            onToast={showToast}
            onNavigateToTab={(tab) => setActiveNavTab(tab)}
            onInsertIntoPOM={(code) => {
              const newFile: SuiteFile = {
                id: `recorded-${Date.now()}.spec.ts`,
                name: 'recorded-flow.spec.ts',
                category: 'test',
                description: `Recorded actions on ${targetBaseUrl}`,
                locCount: code.split('\n').length,
                content: code,
                healingActive: true
              };
              handleAddGeneratedFile(newFile);
            }}
          />
        )}

        {/* View 3: AI Test & POM Generator */}
        {activeNavTab === 'ai-gen' && (
          <AIGeneratorView onAddGeneratedFile={handleAddGeneratedFile} />
        )}

        {/* View 4: Suite Quality & Telemetry Dashboard */}
        {activeNavTab === 'dashboard' && (
          <DashboardView
            onReplayRun={(runNum) => {
              showToast(`Loading trace for Run #${runNum} into sandbox...`, 'info');
              handleOpenSandboxWithUrl(targetBaseUrl);
            }}
          />
        )}
      </main>

      {/* Interactive Sandbox Test Runner Modal */}
      <SandboxRunnerModal
        isOpen={isSandboxOpen}
        onClose={() => setIsSandboxOpen(false)}
        initialUrl={sandboxInitialUrl}
        initialHeadless={isHeadless}
        suiteFiles={suiteFiles}
      />

      {/* Persistent Bottom Mobile Navigation Bar */}
      <BottomNavBar
        activeTab={activeNavTab}
        onSelectTab={setActiveNavTab}
      />
    </div>
  );
}
