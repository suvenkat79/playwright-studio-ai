import React from 'react';

interface StickyActionBarProps {
  onStartBrowserRecording: () => void;
  isStarting?: boolean;
  canStart?: boolean;
  onRunSandbox: () => void;
  onExport: () => void;
}

export const StickyActionBar: React.FC<StickyActionBarProps> = ({
  onStartBrowserRecording,
  isStarting = false,
  canStart = true,
  onRunSandbox,
  onExport
}) => {
  return (
    <section className="sticky bottom-16 sm:bottom-0 z-30 pt-1 pb-1.5 bg-[#0f131c]/95 backdrop-blur-md flex flex-col gap-1 border-t border-[#262a33]/60 sm:border-0">
      <div className="flex items-center gap-2">
        <button
          onClick={onStartBrowserRecording}
          disabled={!canStart}
          className="flex-1 h-10 rounded-lg bg-[#adc6ff] hover:bg-[#c0d4ff] text-[#002e6a] flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold shadow-md active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
          id="startBrowserRecordingBtn"
        >
          <span className="material-symbols-outlined text-[18px]">
            {isStarting ? 'progress_activity' : 'fiber_manual_record'}
          </span>
          <span>{isStarting ? 'Starting Recording...' : 'Start Browser Recording'}</span>
        </button>

        <button
          onClick={onRunSandbox}
          className="h-10 px-3.5 rounded-lg bg-[#1c2028] hover:bg-[#262a33] text-[#dfe2ee] border border-[#262a33] flex items-center justify-center gap-1.5 text-xs sm:text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer"
          id="runSandboxBtn"
          title="Execute in Sandbox"
        >
          <span className="material-symbols-outlined text-[18px] text-[#4cd7f6]">
            play_circle
          </span>
          <span className="hidden sm:inline">Execute</span>
        </button>

        <button
          onClick={onExport}
          className="h-10 px-3.5 rounded-lg bg-[#262a33] hover:bg-[#31353e] text-[#dfe2ee] flex items-center justify-center gap-1.5 text-xs sm:text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer"
          id="exportGhBtn"
        >
          <span className="material-symbols-outlined text-[18px]">
            cloud_upload
          </span>
          <span className="inline">Export</span>
        </button>
      </div>
    </section>
  );
};
