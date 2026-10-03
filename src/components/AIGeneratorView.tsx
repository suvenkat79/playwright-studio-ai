import React, { useEffect, useState } from 'react';
import { RecordedAction, RunLifecycleStatus } from '../types';
import { useRecording } from '../context/RecordingContext';
import { recordService } from '../services/recordService';
import { runService } from '../services/runService';
import { optimizeRecordedActions, generateOptimizedSpec } from '../services/optimizerService';
import { generateFrameworkProject, type FrameworkProject } from '../services/frameworkGenerator';
import {
  formatCapabilityResult,
  getMatchAvailability,
  resolveWorkflowRequest,
  type WorkflowCapabilityResult,
  type WorkflowMatch
} from '../services/workflowMatcher';
import { ApiError } from '../services/api';
import { isFrameworkValidationCurrent } from '../services/frameworkValidationService';
import { CredentialManagerModal, CredentialManagerValues } from './CredentialManagerModal';

interface AIGeneratorViewProps {
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const presets = [
  { title: 'Change a field + save', prompt: 'Change Priority to 2 and click Update' },
  { title: 'Fill and submit', prompt: 'Enter test@example.com in Email and click Submit' },
  { title: 'Single click', prompt: 'Click Save' }
];

export const AIGeneratorView: React.FC<AIGeneratorViewProps> = ({
  onToast
}) => {
  const {
    sessionId,
    sessionLifecycleStatus,
    isLiveRecording,
    recordedUrl,
    preparedAIContext,
    preparedFrameworkContext,
    frameworkValidationState,
    addGeneratedProjectToSuite
  } = useRecording();

  // A clean, user-typed field — never auto-populated. See
  // RecordingContext's PreparedAIContext doc comment: "Prepare for AI"
  // prepares structured display context (below), it does not write into
  // this box.
  const [prompt, setPrompt] = useState('');

  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedActions, setResolvedActions] = useState<RecordedAction[] | null>(null);
  const [unresolvedClauses, setUnresolvedClauses] = useState<string[]>([]);
  const [generatedSpec, setGeneratedSpec] = useState<string | null>(null);
  const [generatedProject, setGeneratedProject] = useState<FrameworkProject | null>(null);
  const [workflowMatch, setWorkflowMatch] = useState<WorkflowMatch | null>(null);
  const [capabilityResults, setCapabilityResults] = useState<WorkflowCapabilityResult[]>([]);
  const [addedSuccess, setAddedSuccess] = useState(false);
  const [isAddingToSuite, setIsAddingToSuite] = useState(false);

  const [isCredentialModalOpen, setIsCredentialModalOpen] = useState(false);
  const [executeRunId, setExecuteRunId] = useState<string | null>(null);
  const [executeStatus, setExecuteStatus] = useState<RunLifecycleStatus | null>(null);

  const isRecordingActive = isLiveRecording ||
    sessionLifecycleStatus === 'RUNNING' ||
    sessionLifecycleStatus === 'STOPPING';
  const frameworkContext = preparedFrameworkContext;
  const isFrameworkValidated = frameworkContext !== null &&
    isFrameworkValidationCurrent(frameworkContext.project.files, frameworkValidationState);
  const availability = getMatchAvailability(isRecordingActive, Boolean(frameworkContext), isFrameworkValidated);

  // Results belong to the stopped recording/framework snapshot that was
  // matched. Changing recordings or regenerating its framework invalidates
  // results; the user's prompt remains intact.
  useEffect(() => {
    setResolvedActions(null);
    setUnresolvedClauses([]);
    setGeneratedSpec(null);
    setGeneratedProject(null);
    setWorkflowMatch(null);
    setCapabilityResults([]);
    setResolveError(null);
    setAddedSuccess(false);
    setExecuteRunId(null);
    setExecuteStatus(null);
  }, [sessionId, frameworkContext?.preparedAt]);

  /**
   * Reuse matched framework actions first, then start the isolated
   * non-recording resolver only when the workflow is partial or missing.
   */
  const handleGenerate = async () => {
    if (availability.reason === 'recording-active') {
      setResolveError('Stop recording before generating a new test case. AI Gen will open its separate resolution browser after the recording has stopped.');
      return;
    }
    if (!availability.canGenerate || !frameworkContext) {
      setResolveError('Generate a framework from the stopped recording first. AI Gen uses that framework and its captured application/page context to match workflows.');
      return;
    }

    setIsResolving(true);
    setResolveError(null);
    setResolvedActions(null);
    setUnresolvedClauses([]);
    setGeneratedSpec(null);
    setGeneratedProject(null);
    setWorkflowMatch(null);
    setCapabilityResults([]);
    setAddedSuccess(false);

    try {
      const result = await resolveWorkflowRequest(
        prompt,
        frameworkContext.targetUrl,
        frameworkContext.project,
        {
          startResolutionSession: async (targetUrl) => {
            if (isRecordingActive) {
              throw new Error('Stop recording before starting a resolution browser.');
            }
            const session = await recordService.startResolutionSession(
              targetUrl,
              frameworkContext.sessionId || undefined
            );
            return session.sessionId;
          },
          resolveIntent: async (resolutionSessionId, instruction) => {
            const resolution = await recordService.resolveIntent(resolutionSessionId, instruction);
            return { actions: resolution.actions, unresolved: resolution.unresolved };
          },
          closeResolutionSession: (resolutionSessionId) =>
            recordService.closeResolutionSession(resolutionSessionId),
          optimize: optimizeRecordedActions,
          generateSpec: generateOptimizedSpec,
          generateFramework: generateFrameworkProject
        }
      );
      setWorkflowMatch(result.match);
      setCapabilityResults(result.capabilityResults);
      setResolvedActions(result.resolvedActions);
      setUnresolvedClauses(result.unresolved);
      setGeneratedSpec(result.generatedSpec);
      setGeneratedProject(result.generatedProject);
    } catch (err: unknown) {
      const message = err instanceof ApiError && err.status === 409
        ? 'The resolution browser could not start because recording is active. Stop recording, then try again.'
        : err instanceof Error ? err.message : 'Failed to resolve instruction against the live page.';
      setResolveError(message);
    } finally {
      setIsResolving(false);
    }
  };

  /** Structurally merges this result into the accumulated FrameworkProject
   * (see RecordingContext's addGeneratedProjectToSuite) -- never appends a
   * flat, disconnected file. Reuses existing Page Objects/workflow
   * functions/test-data automatically (generatedProject already reflects
   * the full accumulated action union), adds a uniquely-named test under
   * tests/, preserves every test added before it, and re-runs Validate
   * Framework against the merged result. */
  const handleAddToSuite = async () => {
    if (!generatedProject) return;

    setIsAddingToSuite(true);
    try {
      const addedTest = await addGeneratedProjectToSuite(generatedProject, prompt);
      setAddedSuccess(true);
      onToast?.(`Added "${addedTest.fileName}" to the framework.`, 'success');
      setTimeout(() => setAddedSuccess(false), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add this test to the framework.';
      onToast?.(message, 'error');
    } finally {
      setIsAddingToSuite(false);
    }
  };

  /** Execute entry point — identical wiring to LiveRecorderView's: confirm
   * credentials/environment, then runService.startRun() with the same
   * generated spec, never SandboxRunnerModal's hardcoded demo specs. */
  const handleExecuteClick = () => {
    if (!generatedSpec) return;
    setIsCredentialModalOpen(true);
  };

  const handleCredentialCancel = () => setIsCredentialModalOpen(false);

  const handleCredentialConfirm = async (values: CredentialManagerValues) => {
    setIsCredentialModalOpen(false);
    if (!generatedSpec) return;

    setExecuteRunId(null);
    setExecuteStatus('RUNNING');
    try {
      const response = await runService.startRun({
        spec: generatedSpec,
        baseUrl: values.baseUrl,
        username: values.username,
        password: values.password,
        browser: values.browser,
        headed: values.headed,
        headless: !values.headed,
        credentials: {
          BASE_URL: values.baseUrl,
          APP_USERNAME: values.username,
          APP_PASSWORD: values.password
        }
      });
      setExecuteRunId(response.runId);
      onToast?.(`Execution started — run #${response.runNumber}.`, 'info');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start Playwright run';
      setExecuteStatus('ERROR');
      onToast?.(`Failed to start execution: ${message}`, 'error');
    }
  };

  // Poll the real Playwright run until it reaches a terminal status —
  // same pattern as LiveRecorderView's own Execute polling.
  useEffect(() => {
    if (!executeRunId || executeStatus !== 'RUNNING') return;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await runService.getRunEvents(executeRunId);
        if (cancelled) return;
        if (data.status !== 'RUNNING') {
          setExecuteStatus(data.status);
          if (data.status === 'PASSED') {
            onToast?.(`Execution passed in ${data.totalDurationMs}ms.`, 'success');
          } else {
            onToast?.(`Execution ${data.status.toLowerCase()}${data.failureReason ? `: ${data.failureReason}` : ''}`, 'error');
          }
        }
      } catch (pollErr) {
        console.debug('[AIGeneratorView] Execute poll debug:', pollErr);
      }
    };

    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [executeRunId, executeStatus, onToast]);

  return (
    <div className="flex flex-col gap-4 text-[#dfe2ee]">
      {/* Header Banner */}
      <div className="bg-[#181c24] p-4 sm:p-5 rounded-xl border border-[#262a33]">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-[20px] text-[#4cd7f6]">
            auto_awesome
          </span>
          <h2 className="text-base font-semibold text-[#dfe2ee]">
            AI Test Generator
          </h2>
          <span className="px-2 py-0.5 rounded-full bg-[#8083ff]/20 text-[#c0c1ff] text-[10px] font-mono">
            Workflow Matcher
          </span>
        </div>
        <p className="text-xs text-[#c7c4d7]">
          Describe an action in natural language (e.g. "Change Priority to 2 and click Update").
          AI Gen matches a new case against the stopped recording's generated workflows first.
          Missing capabilities are resolved against the real DOM in a separate, non-recording browser,
          then merged and passed through the existing Optimizer.
        </p>

        {/* Quick presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3">
          <span className="text-[11px] font-mono text-[#908fa0] mr-1">
            Example Instructions:
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

      {/* Structured context "Prepare for AI" gathered — read-only, never
          written into the instruction field below. */}
      {preparedAIContext && preparedAIContext.sessionId === sessionId && (
        <div className="bg-[#14202a] border border-[#1f3a4a] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-[#4cd7f6] text-[18px]">fact_check</span>
            <span className="text-xs font-semibold text-[#dfe2ee]">Prepared AI Context</span>
            <span className="text-[10px] text-[#908fa0]">from "Prepare for AI"</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-mono">
            <div>
              <div className="text-[#908fa0]">Target</div>
              <div className="text-[#dfe2ee] truncate" title={preparedAIContext.targetUrl}>{preparedAIContext.targetUrl}</div>
            </div>
            <div>
              <div className="text-[#908fa0]">Application</div>
              <div className="text-[#dfe2ee]">{preparedAIContext.applicationMetadata?.application ?? 'Not yet detected'}</div>
            </div>
            <div>
              <div className="text-[#908fa0]">Page</div>
              <div className="text-[#dfe2ee]">{preparedAIContext.pageMetadata?.pageType ?? 'Not yet detected'}</div>
            </div>
            <div>
              <div className="text-[#908fa0]">Frame</div>
              <div className="text-[#dfe2ee]">{preparedAIContext.frameMetadata?.frameType ?? 'Not yet detected'}</div>
            </div>
          </div>
          <div className="text-[10px] text-[#6c7a86] mt-2">
            {preparedAIContext.optimizedStepCount} optimized step{preparedAIContext.optimizedStepCount === 1 ? '' : 's'} recorded so far — context only, not sent as an instruction. Type what you want AI Gen to do below.
          </div>
        </div>
      )}

      {availability.reason === 'recording-active' && (
        <div className="bg-[#2a1f14] border border-[#4a3620] rounded-xl p-4 flex items-start gap-3">
          <span className="material-symbols-outlined text-[#f6a94c] text-[20px]">warning</span>
          <div className="text-xs text-[#e8d9c2]">
            <p className="font-semibold mb-0.5">Recording is active</p>
            <p>
              Stop recording before starting a new AI Gen request. Resolution uses a separate
              browser and must not run alongside an active recording.
            </p>
          </div>
        </div>
      )}

      {availability.reason === 'framework-unavailable' && !isRecordingActive && (
        <div className="bg-[#2a1f14] border border-[#4a3620] rounded-xl p-4 text-xs text-[#e8d9c2]">
          Stop the recording, then generate a framework in the Recorder tab before creating a new test case.
        </div>
      )}

      {availability.reason === 'framework-not-validated' && !isRecordingActive && (
        <div className="bg-[#2a1f14] border border-[#4a3620] rounded-xl p-4 flex items-start gap-3">
          <span className="material-symbols-outlined text-[#f6a94c] text-[20px]">warning</span>
          <div className="text-xs text-[#e8d9c2]">
            <p className="font-semibold mb-0.5">Framework not validated yet</p>
            <p>
              Run "Validate Framework" on the generated framework card in the Recorder tab before
              starting AI Test Generation.
            </p>
          </div>
        </div>
      )}

      {/* Generator Prompt Box */}
      <div className="bg-[#181c24] p-4 rounded-xl border border-[#262a33] space-y-3">
        <div>
          <label className="block text-xs font-mono text-[#c7c4d7] mb-1.5 uppercase tracking-wider">
            Natural Language Instruction
          </label>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full p-3 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs font-mono text-[#dfe2ee] focus:border-[#4cd7f6] focus:outline-none resize-none"
            placeholder='e.g. "Click Save" or "Change Priority to 2"'
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            onClick={handleGenerate}
            disabled={isResolving || !prompt.trim() || !availability.canGenerate}
            className="px-4 py-2 rounded-lg bg-[#c0c1ff] hover:bg-[#a9aaff] text-[#1000a9] text-xs font-semibold font-mono flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-98 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">
              {isResolving ? 'autorenew' : 'bolt'}
            </span>
            <span>{isResolving ? 'Matching workflow and resolving…' : 'Match Workflow & Generate'}</span>
          </button>
        </div>
      </div>

      {resolveError && (
        <div className="bg-[#2a1416] border border-[#4a2024] rounded-xl p-4 flex items-start gap-3">
          <span className="material-symbols-outlined text-[#f64c4c] text-[20px]">error</span>
          <p className="text-xs text-[#f0c2c4]">{resolveError}</p>
        </div>
      )}

      {unresolvedClauses.length > 0 && (
        <div className="bg-[#2a1f14] border border-[#4a3620] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="material-symbols-outlined text-[#f6a94c] text-[18px]">help</span>
            <span className="text-xs font-semibold text-[#e8d9c2]">
              Could not resolve {unresolvedClauses.length} clause{unresolvedClauses.length > 1 ? 's' : ''}
            </span>
          </div>
          <ul className="list-disc list-inside text-[11px] font-mono text-[#e8d9c2] space-y-0.5">
            {unresolvedClauses.map((clause, i) => (
              <li key={i}>{clause}</li>
            ))}
          </ul>
          <p className="text-[10px] text-[#a99872] mt-2">
            Either the phrasing wasn't recognized, or no matching element exists on the live page right now.
          </p>
        </div>
      )}

      {/* Resolved Results Area */}
      {workflowMatch && (
        <div className="bg-[#181c24] rounded-xl border border-[#262a33] overflow-hidden animate-in fade-in space-y-3 p-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#262a33]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#10b981] text-[18px]">
                check_circle
              </span>
              <span className="text-xs font-semibold text-[#dfe2ee]">
                Workflow Matcher: {workflowMatch.status}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExecuteClick}
                disabled={!generatedSpec}
                className="px-3 py-1.5 rounded-lg bg-[#1c2028] hover:bg-[#262a33] border border-[#262a33] text-[#adc6ff] text-xs font-mono font-medium flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                <span>Execute</span>
              </button>
              <button
                onClick={handleAddToSuite}
                disabled={!generatedProject || isAddingToSuite}
                className="px-3 py-1.5 rounded-lg bg-[#0566d9] hover:bg-[#0455b5] text-white text-xs font-mono font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[15px]">
                  {addedSuccess ? 'done' : isAddingToSuite ? 'autorenew' : 'add_task'}
                </span>
                <span>{addedSuccess ? 'Added to Suite!' : isAddingToSuite ? 'Merging…' : 'Add to Suite'}</span>
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-[#262a33] bg-[#0a0e16] p-3 text-[11px] font-mono space-y-1">
            <div><span className="text-[#908fa0]">Intent:</span> {workflowMatch.request.operation}</div>
            <div><span className="text-[#908fa0]">Entity:</span> {workflowMatch.request.entity}</div>
            {workflowMatch.request.identity && (
              <div>
                <span className="text-[#908fa0]">Parameters:</span>{' '}
                {`${workflowMatch.request.entity.charAt(0).toLowerCase()}${workflowMatch.request.entity.slice(1)}Number`}={workflowMatch.request.identity}
              </div>
            )}
            {workflowMatch.reusableWorkflows.length > 0 && (
              <div className="text-emerald-300">
                Reused workflow{workflowMatch.reusableWorkflows.length > 1 ? 's' : ''}: {workflowMatch.reusableWorkflows.map((workflow) => workflow.name).join(', ')}
              </div>
            )}
            {capabilityResults.map((capability) => (
              <div
                key={`${capability.kind}-${capability.label}`}
                className={capability.status === 'matched'
                  ? 'text-emerald-300'
                  : capability.status === 'resolved'
                    ? 'text-[#4cd7f6]'
                    : 'text-amber-300'}
              >
                {formatCapabilityResult(capability)}
              </div>
            ))}
            {workflowMatch.reusableWorkflows.length === 0 && (
              <div className="text-amber-300">No existing workflow matched; resolved actions, if any, are sourced from live DOM resolution.</div>
            )}
          </div>

          {/* Resolved actions summary — real locators, real metadata */}
          <div className="space-y-1.5">
            {(resolvedActions ?? []).map((action) => (
              <div key={action.id} className="p-2 rounded-lg bg-[#0a0e16] border border-[#262a33] text-[11px] font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-[#4cd7f6]">{action.type}</span>
                  {action.applicationMetadata && (
                    <span className="text-[10px] text-[#908fa0]">
                      {action.applicationMetadata.application}
                      {action.frameMetadata?.frameType === 'NestedFrame' ? ` · ${action.frameMetadata.frameSelector}` : ''}
                    </span>
                  )}
                </div>
                <div className="text-[#dfe2ee] mt-0.5">{action.codeLine}</div>
              </div>
            ))}
          </div>

          {executeStatus && (
            <div className="text-[11px] font-mono text-[#908fa0]">
              Execution status: <span className="text-[#dfe2ee]">{executeStatus}</span>
              {executeRunId ? ` (run ${executeRunId})` : ''}
            </div>
          )}

          {/* Generated Spec */}
          {generatedSpec && (
            <div className="p-3 rounded-lg bg-[#0a0e16] border border-[#262a33]">
              <div className="text-[11px] font-mono text-[#adc6ff] font-semibold mb-2 flex items-center justify-between">
                <span>Generated Spec</span>
                <span className="text-[10px] text-[#908fa0]">Playwright Test</span>
              </div>
              <pre className="text-[10px] font-mono text-[#dfe2ee] overflow-x-auto max-h-80 leading-relaxed">
                <code>{generatedSpec}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      <CredentialManagerModal
        isOpen={isCredentialModalOpen}
        initialBaseUrl={recordedUrl}
        initialHeaded
        onCancel={handleCredentialCancel}
        onConfirm={handleCredentialConfirm}
      />
    </div>
  );
};
