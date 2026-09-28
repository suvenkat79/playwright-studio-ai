import React, { useState } from 'react';

export const FrameworkDiagnostics: React.FC = () => {
  const [showLocatorDetails, setShowLocatorDetails] = useState(false);

  const locators = [
    {
      name: 'createIncidentBtn',
      pattern: "page.getByRole('button', { name: 'New Incident' })",
      resilience: 'Semantic Accessible Role',
      timeout: 'Auto-Wait 30s',
      status: 'Healthy'
    },
    {
      name: 'shortDescriptionInput',
      pattern: "page.getByLabel('Short description')",
      resilience: 'Accessible Form Label',
      timeout: 'Auto-Wait 30s',
      status: 'Healthy'
    },
    {
      name: 'urgencySelect',
      pattern: "page.getByRole('combobox', { name: 'Urgency' })",
      resilience: 'Semantic Accessible Combobox',
      timeout: 'Auto-Wait 30s',
      status: 'Self-Healed'
    },
    {
      name: 'submitBtn',
      pattern: "page.getByTestId('submit-incident-action')",
      resilience: 'Resilient Dedicated TestID',
      timeout: 'Auto-Wait 30s',
      status: 'Healthy'
    }
  ];

  return (
    <section className="flex flex-col gap-2 bg-[#181c24] p-3.5 sm:p-4 rounded-xl shadow-sm border border-[#262a33]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className="material-symbols-outlined text-[18px] text-[#4cd7f6]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            verified
          </span>
          <h2 className="text-sm font-semibold text-[#dfe2ee]">
            Framework Diagnostics
          </h2>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-[#0566d9]/20 text-[#adc6ff] text-[10px] font-mono font-semibold uppercase tracking-wider">
          100% Validated
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1">
        <div className="flex flex-col p-2 sm:p-2.5 rounded-lg bg-[#1c2028] border border-[#262a33]/60">
          <span className="text-[10px] font-mono text-[#c7c4d7] uppercase tracking-wider">
            SYNTAX
          </span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="material-symbols-outlined text-[15px] text-[#4cd7f6]">
              check_circle
            </span>
            <span className="text-xs sm:text-[13px] font-semibold text-[#dfe2ee]">
              0 Errors
            </span>
          </div>
        </div>

        <div className="flex flex-col p-2 sm:p-2.5 rounded-lg bg-[#1c2028] border border-[#262a33]/60">
          <span className="text-[10px] font-mono text-[#c7c4d7] uppercase tracking-wider">
            TYPES
          </span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="material-symbols-outlined text-[15px] text-[#adc6ff]">
              security
            </span>
            <span className="text-xs sm:text-[13px] font-semibold text-[#dfe2ee]">
              Safe
            </span>
          </div>
        </div>

        <div className="flex flex-col p-2 sm:p-2.5 rounded-lg bg-[#1c2028] border border-[#262a33]/60">
          <span className="text-[10px] font-mono text-[#c7c4d7] uppercase tracking-wider">
            LOCATORS
          </span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="material-symbols-outlined text-[15px] text-[#4cd7f6]">
              auto_fix_high
            </span>
            <span className="text-xs sm:text-[13px] font-semibold text-[#dfe2ee]">
              Auto-Wait
            </span>
          </div>
        </div>
      </div>

      <button
        onClick={() => setShowLocatorDetails(!showLocatorDetails)}
        className="w-full text-left flex items-center justify-between gap-1 p-2 rounded-lg bg-[#262a33] text-[#c7c4d7] hover:text-[#dfe2ee] hover:bg-[#31353e] text-xs transition-colors cursor-pointer mt-0.5"
      >
        <div className="flex items-center gap-1.5 truncate">
          <span className="material-symbols-outlined text-[16px] text-[#4cd7f6] flex-shrink-0">
            info
          </span>
          <span className="truncate">
            All 4 locators mapped via semantic accessible roles & resilient test IDs.
          </span>
        </div>
        <span className="material-symbols-outlined text-[16px] flex-shrink-0">
          {showLocatorDetails ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {/* Expanded Locator Inspector */}
      {showLocatorDetails && (
        <div className="pt-2 border-t border-[#262a33] space-y-1.5 animate-in fade-in duration-150">
          <div className="text-[10px] font-mono uppercase text-[#908fa0] px-1">
            Registered Locators in POM:
          </div>
          {locators.map((loc) => (
            <div
              key={loc.name}
              className="p-2 rounded bg-[#1c2028] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1 border border-[#262a33]/50"
            >
              <div className="font-mono text-[11px] text-[#dfe2ee]">
                <span className="text-[#4cd7f6] font-semibold">{loc.name}</span>
                <span className="text-[#908fa0] text-[10px] ml-2 block sm:inline">
                  {loc.pattern}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="px-1.5 py-0.2 rounded bg-[#0566d9]/20 text-[#adc6ff]">
                  {loc.resilience}
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded ${
                    loc.status === 'Self-Healed'
                      ? 'bg-[#8083ff]/20 text-[#c0c1ff]'
                      : 'bg-[#10b981]/20 text-[#10b981]'
                  }`}
                >
                  {loc.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
