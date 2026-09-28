import React, { useState } from 'react';

interface LiveTraceAttachmentProps {
  onOpenSandbox: () => void;
}

export const LiveTraceAttachment: React.FC<LiveTraceAttachmentProps> = ({
  onOpenSandbox
}) => {
  const [showFullTraceModal, setShowFullTraceModal] = useState(false);

  return (
    <>
      <section className="flex flex-col gap-1.5 bg-[#181c24] p-3.5 sm:p-4 rounded-xl border border-[#262a33]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-[#c7c4d7] uppercase tracking-wider font-semibold">
            Live Trace Attachment
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[#adc6ff]">
              RUN #408
            </span>
            <button
              onClick={() => setShowFullTraceModal(true)}
              className="text-[10px] font-mono text-[#4cd7f6] hover:underline"
            >
              Expand
            </button>
          </div>
        </div>

        <div
          onClick={() => setShowFullTraceModal(true)}
          className="relative w-full h-36 rounded-lg overflow-hidden bg-[#0a0e16] cursor-pointer group border border-[#262a33]/60 transition-all hover:border-[#4cd7f6]/60"
        >
          <img
            className="w-full h-full object-cover opacity-85 group-hover:opacity-95 transition-opacity"
            alt="High quality dark mode screenshot of a web application incident management form with modern indigo accent buttons and Playwright locator target highlights glowing in bright cyan"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuAK3puHgElqamy-_fmWMk476GyHjd_x4qLy_qq2Qez0SXt7Ogd_QixF7At05jxcyx87C0-xPl2m0nRBMfogK2m0PTAUIiMf_BoBXOJe0od1EOeDyZc7D2d7qCylmV1sY0S4DFbbUbXaUuAOEgWHDq5P__IKBJdrxftvBXloQ5E4B2AQ3BLg3-VCfscGBYZ8h2TWcx3I2-fbnch87jVBDV5ZyRg5aNFJ1Y0g98YNCPvfEBJjcE7rswY"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e16] via-transparent to-transparent"></div>

          {/* Micro-HUD telemetry overlay */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0a0e16]/80 backdrop-blur-md text-[#dfe2ee] text-[10px] font-mono border border-[#262a33]/50">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ffb4ab] animate-pulse"></span>
            <span>STEP 3: fill(description)</span>
          </div>

          <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded bg-[#0a0e16]/80 backdrop-blur-md text-[#4cd7f6] text-[11px] font-mono border border-[#262a33]/50 font-semibold">
            <span>⏱ 412ms</span>
          </div>

          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 backdrop-blur-[1px]">
            <span className="px-3 py-1.5 rounded-lg bg-[#0566d9] text-white text-xs font-mono font-medium flex items-center gap-1 shadow-lg">
              <span className="material-symbols-outlined text-[16px]">visibility</span>
              Inspect Trace Viewer
            </span>
          </div>
        </div>
      </section>

      {/* Expanded Trace Viewer Modal */}
      {showFullTraceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-[#181c24] border border-[#262a33] rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-4 py-3 bg-[#1c2028] border-b border-[#262a33] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#4cd7f6] text-[20px]">
                  auto_videocam
                </span>
                <span className="text-sm font-semibold text-[#dfe2ee]">
                  Playwright Trace Inspector — Run #408
                </span>
                <span className="px-2 py-0.5 rounded bg-[#10b981]/20 text-[#10b981] text-[10px] font-mono">
                  PASSED
                </span>
              </div>
              <button
                onClick={() => setShowFullTraceModal(false)}
                className="text-[#908fa0] hover:text-[#dfe2ee]"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-y-auto space-y-4">
              {/* Snapshot image */}
              <div className="relative rounded-xl overflow-hidden border border-[#262a33]">
                <img
                  className="w-full object-cover max-h-80"
                  alt="Trace Screenshot"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAK3puHgElqamy-_fmWMk476GyHjd_x4qLy_qq2Qez0SXt7Ogd_QixF7At05jxcyx87C0-xPl2m0nRBMfogK2m0PTAUIiMf_BoBXOJe0od1EOeDyZc7D2d7qCylmV1sY0S4DFbbUbXaUuAOEgWHDq5P__IKBJdrxftvBXloQ5E4B2AQ3BLg3-VCfscGBYZ8h2TWcx3I2-fbnch87jVBDV5ZyRg5aNFJ1Y0g98YNCPvfEBJjcE7rswY"
                />
                <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded bg-[#0a0e16]/85 backdrop-blur-md text-[11px] font-mono text-[#4cd7f6]">
                  Action Target: input[id="short-desc"] (resolved via getByLabel)
                </div>
              </div>

              {/* Action Filmstrip Steps */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-mono text-[#908fa0] uppercase">
                  Action Filmstrip & Network Timeline:
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2 rounded bg-[#1c2028] border border-[#262a33] text-[11px] font-mono">
                    <div className="text-[#908fa0]">0ms</div>
                    <div className="text-[#dfe2ee] font-semibold truncate">
                      page.goto()
                    </div>
                    <div className="text-[#10b981] text-[10px]">200 OK (84ms)</div>
                  </div>
                  <div className="p-2 rounded bg-[#1c2028] border border-[#262a33] text-[11px] font-mono">
                    <div className="text-[#908fa0]">120ms</div>
                    <div className="text-[#dfe2ee] font-semibold truncate">
                      click(New Incident)
                    </div>
                    <div className="text-[#10b981] text-[10px]">Auto-Wait (45ms)</div>
                  </div>
                  <div className="p-2 rounded bg-[#0566d9]/20 border border-[#0566d9]/40 text-[11px] font-mono">
                    <div className="text-[#4cd7f6]">245ms (Active)</div>
                    <div className="text-[#dfe2ee] font-semibold truncate">
                      fill(description)
                    </div>
                    <div className="text-[#adc6ff] text-[10px]">Target Locked</div>
                  </div>
                  <div className="p-2 rounded bg-[#1c2028] border border-[#262a33] text-[11px] font-mono">
                    <div className="text-[#908fa0]">380ms</div>
                    <div className="text-[#dfe2ee] font-semibold truncate">
                      expect(toBeVisible)
                    </div>
                    <div className="text-[#10b981] text-[10px]">Verified (32ms)</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-[#1c2028] border-t border-[#262a33] flex items-center justify-between">
              <span className="text-xs text-[#c7c4d7]">
                Trace stored: <code className="text-[#4cd7f6]">test-results/run-408.zip</code>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowFullTraceModal(false);
                    onOpenSandbox();
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-[#adc6ff] text-[#002e6a] text-xs font-semibold hover:bg-white transition-colors"
                >
                  Replay in Sandbox
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
