import React, { useState, useEffect } from 'react';
import { SuiteFile } from '../types';
import { useRecording } from '../context/RecordingContext';

interface AIGeneratorViewProps {
  onAddGeneratedFile: (file: SuiteFile) => void;
}

export const AIGeneratorView: React.FC<AIGeneratorViewProps> = ({
  onAddGeneratedFile
}) => {
  const { aiPromptPrefill } = useRecording();

  const [prompt, setPrompt] = useState(
    'Create an enterprise Page Object Model and spec for an incident escalation flow. Include priority dropdown, assignee selection, SLA countdown assertions, and error handling for missing root-cause.'
  );

  useEffect(() => {
    if (aiPromptPrefill) {
      setPrompt(aiPromptPrefill);
    }
  }, [aiPromptPrefill]);
  const [locatorStrategy, setLocatorStrategy] = useState<'accessible' | 'testid' | 'resilient'>('accessible');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedOutput, setGeneratedOutput] = useState<{
    pomName: string;
    pomCode: string;
    specName: string;
    specCode: string;
  } | null>(null);
  const [addedSuccess, setAddedSuccess] = useState(false);

  const presets = [
    {
      title: 'Incident Escalation SLA',
      prompt:
        'Create an enterprise Page Object Model and spec for an incident escalation flow. Include priority dropdown, assignee selection, SLA countdown assertions, and error handling for missing root-cause.'
    },
    {
      title: 'Stripe Checkout Failure',
      prompt:
        'Test Stripe 3D-Secure checkout decline. Verify error toast on expired card, assert CVV validation tooltip, and ensure cart items persist after failure.'
    },
    {
      title: 'Auth 2FA TOTP Flow',
      prompt:
        'Generate Page Object for passwordless login with 6-digit TOTP verification code input, auto-submitting on 6th digit, and checking dashboard redirect.'
    }
  ];

  const handleGenerate = () => {
    setIsGenerating(true);
    setGenerationProgress(10);
    setGeneratedOutput(null);
    setAddedSuccess(false);

    const interval = setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 20;
      });
    }, 200);

    setTimeout(() => {
      clearInterval(interval);
      setGenerationProgress(100);
      setIsGenerating(false);

      setGeneratedOutput({
        pomName: 'IncidentEscalationPage.ts',
        pomCode: `import { Page, Locator, expect } from '@playwright/test';

export class IncidentEscalationPage {
  readonly page: Page;
  readonly escalateBtn: Locator;
  readonly assigneeSelect: Locator;
  readonly rootCauseInput: Locator;
  readonly confirmEscalationBtn: Locator;
  readonly slaBadge: Locator;

  constructor(page: Page) {
    this.page = page;
    this.escalateBtn = page.getByRole('button', { name: 'Escalate Incident' });
    this.assigneeSelect = page.getByRole('combobox', { name: 'Escalation Target' });
    this.rootCauseInput = page.getByLabel('Root Cause Summary');
    this.confirmEscalationBtn = page.getByTestId('confirm-escalation-action');
    this.slaBadge = page.getByTestId('sla-countdown-badge');
  }

  async escalateTicket(assignee: string, summary: string) {
    await this.escalateBtn.click();
    await this.assigneeSelect.selectOption({ label: assignee });
    await this.rootCauseInput.fill(summary);
    await this.confirmEscalationBtn.click();
    await expect(this.page.getByText('Escalated to Tier 3 Ops')).toBeVisible();
  }

  async verifySlaWarning() {
    await expect(this.slaBadge).toHaveClass(/critical-sla/);
  }
}`,
        specName: 'incident-escalation.spec.ts',
        specCode: `import { test, expect } from '@playwright/test';
import { IncidentEscalationPage } from './IncidentEscalationPage';

test.describe('Incident Escalation Suite', () => {
  test('should escalate critical outage to Tier 3 oncall', async ({ page }) => {
    const escalationPage = new IncidentEscalationPage(page);
    await page.goto('/incidents/INC-409/triage');

    await escalationPage.escalateTicket(
      'Site Reliability Oncall (Tier 3)',
      'Primary database replication lag exceeded 180s'
    );

    await escalationPage.verifySlaWarning();
  });
});`
      });
    }, 1400);
  };

  const handleAddToSuite = () => {
    if (!generatedOutput) return;

    const newPomFile: SuiteFile = {
      id: generatedOutput.pomName,
      name: generatedOutput.pomName,
      category: 'pom',
      description: 'AI-Generated POM with accessible locators',
      locCount: generatedOutput.pomCode.split('\n').length,
      content: generatedOutput.pomCode,
      healingActive: true
    };

    onAddGeneratedFile(newPomFile);
    setAddedSuccess(true);
    setTimeout(() => setAddedSuccess(false), 3000);
  };

  return (
    <div className="flex flex-col gap-4 text-[#dfe2ee]">
      {/* Header Banner */}
      <div className="bg-[#181c24] p-4 sm:p-5 rounded-xl border border-[#262a33]">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-[20px] text-[#4cd7f6]">
            auto_awesome
          </span>
          <h2 className="text-base font-semibold text-[#dfe2ee]">
            AI Test & POM Generator
          </h2>
          <span className="px-2 py-0.5 rounded-full bg-[#8083ff]/20 text-[#c0c1ff] text-[10px] font-mono">
            Zero-Flake Engine
          </span>
        </div>
        <p className="text-xs text-[#c7c4d7]">
          Describe any user workflow in natural language. The studio will synthesize
          resilient Page Object Models, strict auto-waited assertions, and Playwright
          test specs.
        </p>

        {/* Quick presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3">
          <span className="text-[11px] font-mono text-[#908fa0] mr-1">
            Prompt Presets:
          </span>
          {presets.map((preset) => (
            <button
              key={preset.title}
              onClick={() => setPrompt(preset.prompt)}
              className="px-2.5 py-1 rounded-full bg-[#1c2028] hover:bg-[#262a33] text-[11px] font-mono text-[#adc6ff] transition-colors cursor-pointer border border-[#262a33]"
            >
              {preset.title}
            </button>
          ))}
        </div>
      </div>

      {/* Generator Prompt Box */}
      <div className="bg-[#181c24] p-4 rounded-xl border border-[#262a33] space-y-3">
        <div>
          <label className="block text-xs font-mono text-[#c7c4d7] mb-1.5 uppercase tracking-wider">
            Natural Language Specification
          </label>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full p-3 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs font-mono text-[#dfe2ee] focus:border-[#4cd7f6] focus:outline-none resize-none"
            placeholder="Describe actions, inputs, URLs, and expected outcome assertions..."
          />
        </div>

        {/* Configuration row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-[#908fa0]">Locator Strategy:</span>
            <select
              value={locatorStrategy}
              onChange={(e) =>
                setLocatorStrategy(e.target.value as 'accessible' | 'testid' | 'resilient')
              }
              className="px-2.5 py-1 rounded bg-[#0a0e16] border border-[#262a33] text-[11px] text-[#4cd7f6] focus:outline-none cursor-pointer"
            >
              <option value="accessible">Semantic Roles (getByRole / getByLabel)</option>
              <option value="testid">Dedicated TestIDs (getByTestId)</option>
              <option value="resilient">Dual-Layer Self-Healing Hybrid</option>
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="px-4 py-2 rounded-lg bg-[#c0c1ff] hover:bg-[#a9aaff] text-[#1000a9] text-xs font-semibold font-mono flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-98 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">
              {isGenerating ? 'autorenew' : 'bolt'}
            </span>
            <span>{isGenerating ? `Synthesizing ${generationProgress}%...` : 'Synthesize POM & Spec'}</span>
          </button>
        </div>

        {isGenerating && (
          <div className="w-full bg-[#0a0e16] h-1.5 rounded-full overflow-hidden mt-2">
            <div
              className="bg-[#4cd7f6] h-full transition-all duration-200"
              style={{ width: `${generationProgress}%` }}
            ></div>
          </div>
        )}
      </div>

      {/* Generated Results Area */}
      {generatedOutput && (
        <div className="bg-[#181c24] rounded-xl border border-[#262a33] overflow-hidden animate-in fade-in space-y-3 p-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#262a33]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#10b981] text-[18px]">
                check_circle
              </span>
              <span className="text-xs font-semibold text-[#dfe2ee]">
                Synthesized: {generatedOutput.pomName} + {generatedOutput.specName}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleAddToSuite}
                className="px-3 py-1.5 rounded-lg bg-[#0566d9] hover:bg-[#0455b5] text-white text-xs font-mono font-medium flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">
                  {addedSuccess ? 'done' : 'add_task'}
                </span>
                <span>{addedSuccess ? 'Added to Suite!' : 'Add to Suite Files'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* POM Box */}
            <div className="p-3 rounded-lg bg-[#0a0e16] border border-[#262a33]">
              <div className="text-[11px] font-mono text-[#4cd7f6] font-semibold mb-2 flex items-center justify-between">
                <span>{generatedOutput.pomName}</span>
                <span className="text-[10px] text-[#908fa0]">Page Object</span>
              </div>
              <pre className="text-[10px] font-mono text-[#dfe2ee] overflow-x-auto max-h-64 leading-relaxed">
                <code>{generatedOutput.pomCode}</code>
              </pre>
            </div>

            {/* Spec Box */}
            <div className="p-3 rounded-lg bg-[#0a0e16] border border-[#262a33]">
              <div className="text-[11px] font-mono text-[#adc6ff] font-semibold mb-2 flex items-center justify-between">
                <span>{generatedOutput.specName}</span>
                <span className="text-[10px] text-[#908fa0]">E2E Spec</span>
              </div>
              <pre className="text-[10px] font-mono text-[#dfe2ee] overflow-x-auto max-h-64 leading-relaxed">
                <code>{generatedOutput.specCode}</code>
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
