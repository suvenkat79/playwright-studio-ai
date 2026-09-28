import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RecordedAction, NavigationTab } from '../types';
import { useRecording } from '../context/RecordingContext';

/**
 * Formats elapsed seconds into MM:SS or HH:MM:SS display string
 */
function formatElapsedTime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Parses a recorded event's elapsed-time string (e.g. "00:03.45", MM:SS.hh)
 * into a millisecond offset from session start.
 */
function elapsedTimestampToMs(ts: string): number {
  const match = /^(\d+):(\d+)(?:\.(\d+))?$/.exec(ts.trim());
  if (!match) return 0;
  const minutes = parseInt(match[1], 10) || 0;
  const seconds = parseInt(match[2], 10) || 0;
  const hundredths = match[3] ? parseInt(match[3].padEnd(2, '0').slice(0, 2), 10) : 0;
  return minutes * 60000 + seconds * 1000 + hundredths * 10;
}

/**
 * Converts a recorded event's elapsed timestamp into a wall-clock HH:mm:ss
 * string, anchored to when the current session actually started.
 */
function formatWallClockTimestamp(sessionStartedAt: number | null, ts: string): string {
  if (!sessionStartedAt) return '--:--:--';
  const date = new Date(sessionStartedAt + elapsedTimestampToMs(ts));
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Turns a raw Playwright selector into a short human-readable locator label,
 * e.g. "page.getByRole('button', { name: 'Sign In' })" -> "Button: Sign In".
 */
function humanizeLocator(selector: string, url?: string): string {
  const roleMatch = /getByRole\('([a-zA-Z]+)',\s*\{\s*name:\s*'([^']*)'/.exec(selector);
  if (roleMatch) {
    const [, role, name] = roleMatch;
    return `${role.charAt(0).toUpperCase()}${role.slice(1)}: ${name}`;
  }

  const labelMatch = /getByLabel\('([^']*)'\)/.exec(selector);
  if (labelMatch) return labelMatch[1];

  const placeholderMatch = /getByPlaceholder\('([^']*)'\)/.exec(selector);
  if (placeholderMatch) return placeholderMatch[1];

  const testIdMatch = /getByTestId\('([^']*)'\)/.exec(selector);
  if (testIdMatch) return `Element: ${testIdMatch[1]}`;

  const textMatch = /getByText\('([^']*)'\)/.exec(selector);
  if (textMatch) return textMatch[1];

  if (selector === 'page' && url) return url;

  return selector.replace(/^page\./, '');
}

/**
 * Builds the full display line for a timeline card body, combining the
 * human locator with the value for FILL/SELECT actions.
 */
function buildTimelineDisplayValue(action: RecordedAction): string {
  const locator = humanizeLocator(action.selector, action.url);
  if ((action.type === 'fill' || action.type === 'select') && action.value) {
    return `${locator} = ${action.value}`;
  }
  return locator;
}

interface LiveRecorderViewProps {
  onInsertIntoPOM: (code: string) => void;
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  onNavigateToTab?: (tab: NavigationTab) => void;
}

type AppPresetType = 'incident' | 'ecommerce' | 'saas' | 'custom';

export const LiveRecorderView: React.FC<LiveRecorderViewProps> = ({
  onInsertIntoPOM,
  onToast,
  onNavigateToTab
}) => {
  const {
    sessionId,
    status: sessionStatus,
    sessionLifecycleStatus,
    recordedUrl,
    isStarting,
    isStopping,
    isLiveRecording,
    capturedEvents,
    lastGeneratedScript,
    sessionStartedAt,
    elapsedSeconds,
    canStart,
    canStop,
    startRecording,
    stopRecording,
    prepareForAIGeneration
  } = useRecording();

  const [activePreset, setActivePreset] = useState<AppPresetType>('incident');
  const [targetUrl, setTargetUrl] = useState('https://core-e2e.internal.corp/incidents/new');
  const [inputUrl, setInputUrl] = useState('https://core-e2e.internal.corp/incidents/new');
  const [isRecording, setIsRecording] = useState(true);

  // Sync with context recorded URL if set
  useEffect(() => {
    if (recordedUrl) {
      setTargetUrl(recordedUrl);
      setInputUrl(recordedUrl);
      setActivePreset('custom');
      setIsRecording(true);
    }
  }, [recordedUrl]);

  // Sync real-time captured events from active browser recording session
  useEffect(() => {
    if (capturedEvents && capturedEvents.length > 0) {
      setRecordedActions(capturedEvents);
    }
  }, [capturedEvents]);


  const [recordedActions, setRecordedActions] = useState<RecordedAction[]>([
    {
      id: '1',
      type: 'click',
      selector: "page.getByRole('button', { name: 'New Incident' })",
      timestamp: '00:01.20',
      codeLine: "await page.getByRole('button', { name: 'New Incident' }).click();"
    },
    {
      id: '2',
      type: 'fill',
      selector: "page.getByLabel('Short description')",
      value: 'Latency spike on payments API',
      timestamp: '00:03.45',
      codeLine:
        "await page.getByLabel('Short description').fill('Latency spike on payments API');"
    }
  ]);

  // Live statistics derived from the current recorded action timeline
  const liveStats = useMemo(() => {
    let clicks = 0;
    let fills = 0;
    let navigations = 0;
    for (const action of recordedActions) {
      if (action.type === 'click') clicks++;
      else if (action.type === 'fill' || action.type === 'select') fills++;
      else if (action.type === 'navigation') navigations++;
    }
    return {
      totalSteps: recordedActions.length,
      clicks,
      fills,
      navigations
    };
  }, [recordedActions]);

  // Demo app states: Incident
  const [formDescription, setFormDescription] = useState('Latency spike on payments API');
  const [formUrgency, setFormUrgency] = useState('High');
  const [formCategory, setFormCategory] = useState('Database');
  const [ticketCreated, setTicketCreated] = useState(false);

  // Demo app states: E-Commerce
  const [cartQuantity, setCartQuantity] = useState(2);
  const [shippingEmail, setShippingEmail] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [shippingMethod, setShippingMethod] = useState('standard');
  const [orderPlaced, setOrderPlaced] = useState(false);

  // Demo app states: SaaS Team
  const [inviteEmail, setInviteEmail] = useState('');
  const [userRole, setUserRole] = useState('Developer');
  const [notifySlack, setNotifySlack] = useState(true);
  const [memberInvited, setMemberInvited] = useState(false);

  // Demo app states: Custom URL Web Inspector
  const [customSearchQuery, setCustomSearchQuery] = useState('');
  const [customToggle, setCustomToggle] = useState(false);
  const [customActionTriggered, setCustomActionTriggered] = useState(false);

  const [hoveredElement, setHoveredElement] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const addAction = (
    type: 'click' | 'fill' | 'select' | 'assert',
    selector: string,
    codeLine: string,
    value?: string
  ) => {
    if (!isRecording) return;
    const newAction: RecordedAction = {
      id: Date.now().toString(),
      type,
      selector,
      value,
      timestamp: `00:${String(recordedActions.length * 2 + 4).padStart(2, '0')}.12`,
      codeLine
    };
    setRecordedActions((prev) => [...prev, newAction]);
  };

  // Switch URL / Preset
  const handleSelectPreset = (type: AppPresetType) => {
    setActivePreset(type);
    let newUrl = '';
    if (type === 'incident') newUrl = 'https://core-e2e.internal.corp/incidents/new';
    else if (type === 'ecommerce') newUrl = 'https://store.demo.cloud/cart/checkout';
    else if (type === 'saas') newUrl = 'https://app.workplace.io/settings/team';
    else if (type === 'custom') newUrl = inputUrl || 'https://my-application.com';

    setTargetUrl(newUrl);
    setInputUrl(newUrl);
    setRecordedActions([]);
    setTicketCreated(false);
    setOrderPlaced(false);
    setMemberInvited(false);
    setCustomActionTriggered(false);
  };

  const handleStartRecordingSession = async () => {
    let urlToUse = inputUrl.trim() || targetUrl;
    if (!urlToUse.startsWith('http://') && !urlToUse.startsWith('https://')) {
      urlToUse = `https://${urlToUse}`;
      setInputUrl(urlToUse);
    }
    setTargetUrl(urlToUse);
    setActivePreset('custom');
    setRecordedActions([]);
    setCustomActionTriggered(false);

    try {
      const response = await startRecording(urlToUse);
      setIsRecording(true);
      onToast?.(
        `Recording started successfully! Session ID: ${response.sessionId}`,
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown recording error';
      onToast?.(`Failed to start recording: ${msg}`, 'error');
    }
  };

  const handleStopRecordingSession = async () => {
    try {
      const res = await stopRecording();
      onToast?.(
        `Recording stopped. Captured ${res?.totalEvents ?? recordedActions.length} browser actions.`,
        'info'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to stop recording';
      onToast?.(msg, 'error');
    }
  };

  const handlePrepareForAI = () => {
    if (recordedActions.length === 0) {
      onToast?.('Please record some actions before preparing for AI generation.', 'info');
      return;
    }
    prepareForAIGeneration(recordedActions, targetUrl);
    onToast?.('Captured actions prepared for AI generation! Switching tab...', 'success');
    if (onNavigateToTab) {
      onNavigateToTab('ai-gen');
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleStartRecordingSession();
  };

  const handleClear = () => {
    setRecordedActions([]);
    setTicketCreated(false);
    setOrderPlaced(false);
    setMemberInvited(false);
    setCustomActionTriggered(false);
  };

  const generatedScript =
    lastGeneratedScript ||
    `import { test, expect } from '@playwright/test';

test('Recorded user journey on ${targetUrl}', async ({ page }) => {
  // Navigate to target URL
  await page.goto('${targetUrl}');

  // Recorded actions and assertions
${
  recordedActions.length > 0
    ? recordedActions.map((a) => `  ${a.codeLine}`).join('\n')
    : "  // Click or type in the interactive browser preview on the left to record steps"
}
});`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedScript);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 text-[#dfe2ee]">
      {/* Top Banner / Controls */}
      <div className="bg-[#181c24] p-3 sm:p-4 rounded-xl border border-[#262a33] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsRecording(!isRecording)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono flex items-center gap-1.5 transition-all cursor-pointer ${
              isRecording
                ? 'bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/40 animate-pulse'
                : 'bg-[#262a33] text-[#c7c4d7] hover:text-[#dfe2ee]'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {isRecording ? 'radio_button_checked' : 'play_arrow'}
            </span>
            <span>{isRecording ? 'RECORDING ACTIVE' : 'RECORDER PAUSED'}</span>
          </button>

          {/* Session ID Badge from Context */}
          {sessionId && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0566d9]/20 border border-[#4cd7f6]/40 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse"></span>
              <span className="text-[#908fa0]">Session:</span>
              <span className="text-[#4cd7f6] font-semibold">{sessionId}</span>
            </div>
          )}

          {/* Start Browser Recording Button */}
          <button
            onClick={handleStartRecordingSession}
            disabled={!canStart}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold font-mono flex items-center gap-1.5 transition-all cursor-pointer bg-[#adc6ff] hover:bg-[#c0d4ff] text-[#002e6a] shadow-sm disabled:opacity-60"
            id="recorderStartBtn"
            title="POST http://localhost:8099/api/record/start"
          >
            <span className="material-symbols-outlined text-[16px]">
              {isStarting ? 'progress_activity' : 'fiber_manual_record'}
            </span>
            <span>{isStarting ? 'Starting...' : 'Start Browser Recording'}</span>
          </button>

          {/* Stop Browser Session Button */}
          {sessionId && (
            <button
              onClick={handleStopRecordingSession}
              disabled={!canStop}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold font-mono flex items-center gap-1.5 transition-all cursor-pointer bg-[#ffb4ab]/15 border border-[#ffb4ab]/40 text-[#ffb4ab] hover:bg-[#ffb4ab]/25 disabled:opacity-60"
              title="POST http://localhost:8099/api/record/stop"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isStopping ? 'progress_activity' : 'stop_circle'}
              </span>
              <span>{isStopping ? 'Stopping...' : 'Stop Recording'}</span>
            </button>
          )}

          {/* Preset Buttons */}
          <div className="flex items-center gap-1 bg-[#1c2028] p-0.5 rounded-lg border border-[#262a33]">
            <button
              onClick={() => handleSelectPreset('incident')}
              className={`px-2 py-1 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                activePreset === 'incident'
                  ? 'bg-[#0566d9] text-white font-semibold'
                  : 'text-[#c7c4d7] hover:text-white'
              }`}
            >
              Incidents
            </button>
            <button
              onClick={() => handleSelectPreset('ecommerce')}
              className={`px-2 py-1 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                activePreset === 'ecommerce'
                  ? 'bg-[#0566d9] text-white font-semibold'
                  : 'text-[#c7c4d7] hover:text-white'
              }`}
            >
              E-Commerce
            </button>
            <button
              onClick={() => handleSelectPreset('saas')}
              className={`px-2 py-1 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                activePreset === 'saas'
                  ? 'bg-[#0566d9] text-white font-semibold'
                  : 'text-[#c7c4d7] hover:text-white'
              }`}
            >
              SaaS Admin
            </button>
            <button
              onClick={() => handleSelectPreset('custom')}
              className={`px-2 py-1 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                activePreset === 'custom'
                  ? 'bg-[#0566d9] text-white font-semibold'
                  : 'text-[#c7c4d7] hover:text-white'
              }`}
            >
              Custom URL
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="px-2.5 py-1.5 rounded-lg bg-[#262a33] hover:bg-[#31353e] text-xs font-mono text-[#c7c4d7] hover:text-[#dfe2ee] transition-colors cursor-pointer"
          >
            Clear ({recordedActions.length})
          </button>
          <button
            onClick={handleCopyCode}
            className="px-3 py-1.5 rounded-lg bg-[#31353e] hover:bg-[#3d424e] text-xs font-mono text-[#dfe2ee] flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">
              {copiedCode ? 'check' : 'content_copy'}
            </span>
            <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
          </button>
          <button
            onClick={() => onInsertIntoPOM(generatedScript)}
            className="px-3.5 py-1.5 rounded-lg bg-[#c0c1ff] hover:bg-[#a9aaff] text-[#1000a9] text-xs font-semibold font-mono flex items-center gap-1 transition-all cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">
              save_as
            </span>
            <span>Save to Suite</span>
          </button>
          <button
            onClick={handlePrepareForAI}
            className="px-3.5 py-1.5 rounded-lg bg-[#6750a4]/30 hover:bg-[#6750a4]/45 border border-[#c0c1ff]/30 text-[#dfe2ee] text-xs font-semibold font-mono flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
            title="Prepare captured events for AI Generation"
          >
            <span className="material-symbols-outlined text-[16px] text-[#adc6ff]">
              auto_awesome
            </span>
            <span>Prepare for AI</span>
          </button>
        </div>
      </div>

      {/* Live Statistics: Total Steps, Clicks, Fills, Navigations, Session Duration */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div className="p-3 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Total Steps
          </span>
          <div className="text-xl font-bold font-mono text-[#dfe2ee] mt-1">
            {liveStats.totalSteps}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Clicks
          </span>
          <div className="text-xl font-bold font-mono text-[#4cd7f6] mt-1">
            {liveStats.clicks}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Fills
          </span>
          <div className="text-xl font-bold font-mono text-[#c0c1ff] mt-1">
            {liveStats.fills}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Navigations
          </span>
          <div className="text-xl font-bold font-mono text-[#8083ff] mt-1">
            {liveStats.navigations}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Session Duration
          </span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xl font-bold font-mono text-[#10b981]">
              {formatElapsedTime(elapsedSeconds)}
            </span>
            {isLiveRecording && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse"></span>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Interactive Web App Sandbox on Left, Generated Playwright Code on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Interactive App Mockup (7 columns) */}
        <div className="lg:col-span-7 flex flex-col bg-[#181c24] rounded-xl border border-[#262a33] overflow-hidden">
          {/* Interactive URL Address Bar */}
          <form
            onSubmit={handleUrlSubmit}
            className="px-3 py-2 bg-[#1c2028] border-b border-[#262a33] flex items-center gap-2 text-xs font-mono"
          >
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ffb4ab]"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span>
            </div>
            <div className="flex-1 bg-[#0a0e16] px-2.5 py-1 rounded text-[11px] text-[#4cd7f6] flex items-center gap-1.5 border border-[#262a33] focus-within:border-[#4cd7f6]">
              <span className="material-symbols-outlined text-[13px] text-[#10b981]">
                lock
              </span>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Enter any target URL (e.g. https://your-site.com)"
                className="flex-1 bg-transparent text-xs font-mono text-[#dfe2ee] focus:outline-none placeholder:text-[#908fa0]"
              />
              <button
                type="submit"
                className="text-[10px] text-[#adc6ff] hover:text-white px-1.5 py-0.5 rounded bg-[#262a33]"
              >
                Go
              </button>
            </div>
            <span className="text-[10px] text-[#adc6ff] hidden sm:inline flex-shrink-0">
              Codegen Inspector
            </span>
          </form>

          {/* Interactive Form Surface based on Active Preset */}
          <div className="p-4 sm:p-5 flex-1 space-y-4">
            {/* View A: Incident Portal */}
            {activePreset === 'incident' && (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
                  <div>
                    <h3 className="text-sm font-semibold text-[#dfe2ee]">
                      Incident Management Portal
                    </h3>
                    <p className="text-xs text-[#908fa0]">
                      Click elements or type to record resilient Playwright locators
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      addAction(
                        'click',
                        "page.getByRole('button', { name: 'New Incident' })",
                        "await page.getByRole('button', { name: 'New Incident' }).click();"
                      );
                    }}
                    onMouseEnter={() =>
                      setHoveredElement("page.getByRole('button', { name: 'New Incident' })")
                    }
                    onMouseLeave={() => setHoveredElement(null)}
                    className="px-3 py-1.5 rounded-lg bg-[#0566d9] hover:bg-[#0455b5] text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-all active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[15px]">add</span>
                    <span>New Incident</span>
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addAction(
                      'click',
                      "page.getByTestId('submit-incident-action')",
                      "await page.getByTestId('submit-incident-action').click();"
                    );
                    setTicketCreated(true);
                    setTimeout(() => {
                      addAction(
                        'assert',
                        "page.getByText('Incident created successfully')",
                        "await expect(page.getByText('Incident created successfully')).toBeVisible();"
                      );
                    }, 400);
                  }}
                  className="space-y-3.5"
                >
                  <div>
                    <label
                      htmlFor="short-desc"
                      className="block text-xs font-medium text-[#c7c4d7] mb-1"
                    >
                      Short description
                    </label>
                    <input
                      id="short-desc"
                      type="text"
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      onBlur={() => {
                        if (formDescription) {
                          addAction(
                            'fill',
                            "page.getByLabel('Short description')",
                            `await page.getByLabel('Short description').fill('${formDescription}');`,
                            formDescription
                          );
                        }
                      }}
                      onMouseEnter={() =>
                        setHoveredElement("page.getByLabel('Short description')")
                      }
                      onMouseLeave={() => setHoveredElement(null)}
                      placeholder="e.g. Latency spike on payments API"
                      className="w-full px-3 py-2 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs text-[#dfe2ee] focus:border-[#4cd7f6] focus:outline-none font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="urgency"
                        className="block text-xs font-medium text-[#c7c4d7] mb-1"
                      >
                        Urgency
                      </label>
                      <select
                        id="urgency"
                        value={formUrgency}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormUrgency(val);
                          addAction(
                            'select',
                            "page.getByRole('combobox', { name: 'Urgency' })",
                            `await page.getByRole('combobox', { name: 'Urgency' }).selectOption('${val}');`,
                            val
                          );
                        }}
                        onMouseEnter={() =>
                          setHoveredElement("page.getByRole('combobox', { name: 'Urgency' })")
                        }
                        onMouseLeave={() => setHoveredElement(null)}
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs text-[#dfe2ee] focus:border-[#4cd7f6] focus:outline-none font-mono cursor-pointer"
                      >
                        <option value="Low">Low Priority</option>
                        <option value="Medium">Medium Priority</option>
                        <option value="High">High Urgency</option>
                        <option value="Critical">Critical P0</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#c7c4d7] mb-1">
                        Component Category
                      </label>
                      <div className="flex items-center gap-2 pt-1.5">
                        {['Database', 'API', 'UI'].map((cat) => (
                          <label
                            key={cat}
                            className="flex items-center gap-1 text-xs text-[#dfe2ee] cursor-pointer"
                            onMouseEnter={() =>
                              setHoveredElement(`page.getByRole('radio', { name: '${cat}' })`)
                            }
                            onMouseLeave={() => setHoveredElement(null)}
                          >
                            <input
                              type="radio"
                              name="category"
                              checked={formCategory === cat}
                              onChange={() => {
                                setFormCategory(cat);
                                addAction(
                                  'click',
                                  `page.getByRole('radio', { name: '${cat}' })`,
                                  `await page.getByRole('radio', { name: '${cat}' }).check();`
                                );
                              }}
                              className="text-[#0566d9] focus:ring-0"
                            />
                            <span>{cat}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {ticketCreated && (
                    <div className="p-3 rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 flex items-center justify-between text-xs font-mono text-[#10b981] animate-in fade-in">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">
                          check_circle
                        </span>
                        <span>Incident created successfully (#INC-8492)</span>
                      </div>
                      <span className="text-[10px] text-[#c7c4d7]">Status: Triaged</span>
                    </div>
                  )}

                  <div className="pt-2 flex items-center gap-2">
                    <button
                      type="submit"
                      data-testid="submit-incident-action"
                      onMouseEnter={() =>
                        setHoveredElement(
                          "page.getByTestId('submit-incident-action')"
                        )
                      }
                      onMouseLeave={() => setHoveredElement(null)}
                      className="flex-1 py-2 px-4 rounded-lg bg-[#c0c1ff] hover:bg-[#a9aaff] text-[#1000a9] text-xs font-semibold font-mono flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-98 transition-all"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        send
                      </span>
                      <span>Submit Incident</span>
                    </button>
                  </div>
                </form>
              </>
            )}

            {/* View B: E-Commerce Store & Checkout */}
            {activePreset === 'ecommerce' && (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
                  <div>
                    <h3 className="text-sm font-semibold text-[#dfe2ee]">
                      Storefront Checkout Flow
                    </h3>
                    <p className="text-xs text-[#908fa0]">
                      Target URL: {targetUrl}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-mono text-[#4cd7f6] font-bold">
                      Subtotal: $189.00
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="shipping-email"
                      className="block text-xs font-medium text-[#c7c4d7] mb-1"
                    >
                      Shipping Email
                    </label>
                    <input
                      id="shipping-email"
                      type="email"
                      value={shippingEmail}
                      onChange={(e) => setShippingEmail(e.target.value)}
                      onBlur={() => {
                        if (shippingEmail) {
                          addAction(
                            'fill',
                            "page.getByLabel('Shipping Email')",
                            `await page.getByLabel('Shipping Email').fill('${shippingEmail}');`,
                            shippingEmail
                          );
                        }
                      }}
                      onMouseEnter={() =>
                        setHoveredElement("page.getByLabel('Shipping Email')")
                      }
                      onMouseLeave={() => setHoveredElement(null)}
                      placeholder="qa.tester@domain.com"
                      className="w-full px-3 py-2 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs text-[#dfe2ee] font-mono focus:border-[#4cd7f6] focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#c7c4d7] mb-1">
                        Shipping Option
                      </label>
                      <div className="space-y-1.5">
                        {['Standard Ground', 'Express Air'].map((opt) => (
                          <label
                            key={opt}
                            className="flex items-center gap-1.5 text-xs text-[#dfe2ee] cursor-pointer"
                            onMouseEnter={() =>
                              setHoveredElement(`page.getByRole('radio', { name: '${opt}' })`)
                            }
                            onMouseLeave={() => setHoveredElement(null)}
                          >
                            <input
                              type="radio"
                              name="shipping"
                              checked={shippingMethod === opt}
                              onChange={() => {
                                setShippingMethod(opt);
                                addAction(
                                  'click',
                                  `page.getByRole('radio', { name: '${opt}' })`,
                                  `await page.getByRole('radio', { name: '${opt}' }).check();`
                                );
                              }}
                              className="text-[#0566d9]"
                            />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="promo"
                        className="block text-xs font-medium text-[#c7c4d7] mb-1"
                      >
                        Promo Code
                      </label>
                      <div className="flex gap-1">
                        <input
                          id="promo"
                          type="text"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value)}
                          placeholder="PLAYWRIGHT20"
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs font-mono text-[#dfe2ee]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            addAction(
                              'click',
                              "page.getByRole('button', { name: 'Apply' })",
                              "await page.getByRole('button', { name: 'Apply' }).click();"
                            );
                          }}
                          onMouseEnter={() =>
                            setHoveredElement("page.getByRole('button', { name: 'Apply' })")
                          }
                          onMouseLeave={() => setHoveredElement(null)}
                          className="px-2.5 py-1 rounded-lg bg-[#262a33] text-xs font-mono text-[#4cd7f6] hover:text-white"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </div>

                  {orderPlaced && (
                    <div className="p-3 rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-xs font-mono text-[#10b981]">
                      ✓ Order #ORD-94819 confirmed and payment captured!
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      addAction(
                        'click',
                        "page.getByRole('button', { name: 'Place Order' })",
                        "await page.getByRole('button', { name: 'Place Order' }).click();"
                      );
                      setOrderPlaced(true);
                      setTimeout(() => {
                        addAction(
                          'assert',
                          "page.getByRole('heading', { name: 'Thank you for your order!' })",
                          "await expect(page.getByRole('heading', { name: 'Thank you for your order!' })).toBeVisible();"
                        );
                      }, 300);
                    }}
                    onMouseEnter={() =>
                      setHoveredElement("page.getByRole('button', { name: 'Place Order' })")
                    }
                    onMouseLeave={() => setHoveredElement(null)}
                    className="w-full py-2 rounded-lg bg-[#0566d9] hover:bg-[#0455b5] text-white text-xs font-semibold font-mono flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      shopping_bag
                    </span>
                    <span>Place Order ($189.00)</span>
                  </button>
                </div>
              </>
            )}

            {/* View C: SaaS Team Settings */}
            {activePreset === 'saas' && (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
                  <div>
                    <h3 className="text-sm font-semibold text-[#dfe2ee]">
                      Team Members & Permissions
                    </h3>
                    <p className="text-xs text-[#908fa0]">
                      Target URL: {targetUrl}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="invite-email"
                      className="block text-xs font-medium text-[#c7c4d7] mb-1"
                    >
                      Member Email Address
                    </label>
                    <input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onBlur={() => {
                        if (inviteEmail) {
                          addAction(
                            'fill',
                            "page.getByLabel('Member Email Address')",
                            `await page.getByLabel('Member Email Address').fill('${inviteEmail}');`,
                            inviteEmail
                          );
                        }
                      }}
                      onMouseEnter={() =>
                        setHoveredElement("page.getByLabel('Member Email Address')")
                      }
                      onMouseLeave={() => setHoveredElement(null)}
                      placeholder="engineer@cloudcorp.com"
                      className="w-full px-3 py-2 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs font-mono text-[#dfe2ee]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="role-select"
                        className="block text-xs font-medium text-[#c7c4d7] mb-1"
                      >
                        Assigned Role
                      </label>
                      <select
                        id="role-select"
                        value={userRole}
                        onChange={(e) => {
                          const r = e.target.value;
                          setUserRole(r);
                          addAction(
                            'select',
                            "page.getByRole('combobox', { name: 'Assigned Role' })",
                            `await page.getByRole('combobox', { name: 'Assigned Role' }).selectOption('${r}');`,
                            r
                          );
                        }}
                        onMouseEnter={() =>
                          setHoveredElement("page.getByRole('combobox', { name: 'Assigned Role' })")
                        }
                        onMouseLeave={() => setHoveredElement(null)}
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs font-mono text-[#dfe2ee]"
                      >
                        <option value="Admin">Admin (Full Access)</option>
                        <option value="Developer">Developer</option>
                        <option value="QA Lead">QA Lead</option>
                        <option value="Viewer">Viewer Only</option>
                      </select>
                    </div>

                    <div className="flex items-center pt-5">
                      <label
                        className="flex items-center gap-2 text-xs text-[#dfe2ee] cursor-pointer"
                        onMouseEnter={() =>
                          setHoveredElement("page.getByRole('checkbox', { name: 'Send Slack Invite' })")
                        }
                        onMouseLeave={() => setHoveredElement(null)}
                      >
                        <input
                          type="checkbox"
                          checked={notifySlack}
                          onChange={(e) => {
                            setNotifySlack(e.target.checked);
                            addAction(
                              'click',
                              "page.getByRole('checkbox', { name: 'Send Slack Invite' })",
                              `await page.getByRole('checkbox', { name: 'Send Slack Invite' }).setChecked(${e.target.checked});`
                            );
                          }}
                          className="rounded text-[#0566d9]"
                        />
                        <span>Send Slack Notification</span>
                      </label>
                    </div>
                  </div>

                  {memberInvited && (
                    <div className="p-3 rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-xs font-mono text-[#10b981]">
                      ✓ Invitation sent to {inviteEmail || 'user'} with role {userRole}!
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      addAction(
                        'click',
                        "page.getByRole('button', { name: 'Invite Team Member' })",
                        "await page.getByRole('button', { name: 'Invite Team Member' }).click();"
                      );
                      setMemberInvited(true);
                      setTimeout(() => {
                        addAction(
                          'assert',
                          "page.getByText('Invitation sent successfully')",
                          "await expect(page.getByText('Invitation sent successfully')).toBeVisible();"
                        );
                      }, 300);
                    }}
                    onMouseEnter={() =>
                      setHoveredElement("page.getByRole('button', { name: 'Invite Team Member' })")
                    }
                    onMouseLeave={() => setHoveredElement(null)}
                    className="w-full py-2 rounded-lg bg-[#c0c1ff] hover:bg-[#a9aaff] text-[#1000a9] text-xs font-semibold font-mono flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      person_add
                    </span>
                    <span>Invite Team Member</span>
                  </button>
                </div>
              </>
            )}

            {/* View D: Custom URL Inspector */}
            {activePreset === 'custom' && (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
                  <div>
                    <h3 className="text-sm font-semibold text-[#dfe2ee]">
                      Custom Target Inspector
                    </h3>
                    <p className="text-xs text-[#4cd7f6] font-mono truncate max-w-[280px]">
                      {targetUrl}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-[#10b981]/20 text-[#10b981] text-[10px] font-mono font-semibold">
                    DOM CONNECTED
                  </span>
                </div>

                <div className="space-y-3.5">
                  <div className="p-3 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs text-[#c7c4d7] space-y-2">
                    <p>
                      Interacting with any of these sample controls records genuine Playwright
                      selectors against <strong className="text-[#4cd7f6]">{targetUrl}</strong>.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="custom-search"
                      className="block text-xs font-medium text-[#c7c4d7] mb-1"
                    >
                      Search / Filter Query
                    </label>
                    <input
                      id="custom-search"
                      type="text"
                      value={customSearchQuery}
                      onChange={(e) => setCustomSearchQuery(e.target.value)}
                      onBlur={() => {
                        if (customSearchQuery) {
                          addAction(
                            'fill',
                            "page.getByPlaceholder('Search query or keywords...')",
                            `await page.getByPlaceholder('Search query or keywords...').fill('${customSearchQuery}');`,
                            customSearchQuery
                          );
                        }
                      }}
                      onMouseEnter={() =>
                        setHoveredElement("page.getByPlaceholder('Search query or keywords...')")
                      }
                      onMouseLeave={() => setHoveredElement(null)}
                      placeholder="Search query or keywords..."
                      className="w-full px-3 py-2 rounded-lg bg-[#0a0e16] border border-[#262a33] text-xs font-mono text-[#dfe2ee]"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#0a0e16] border border-[#262a33]">
                    <div className="text-xs">
                      <span className="font-semibold text-[#dfe2ee]">
                        Feature Toggle Flag
                      </span>
                      <p className="text-[11px] text-[#908fa0]">
                        Auto-refresh data feeds on navigation
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const nextVal = !customToggle;
                        setCustomToggle(nextVal);
                        addAction(
                          'click',
                          "page.getByRole('switch', { name: 'Auto-refresh feeds' })",
                          `await page.getByRole('switch', { name: 'Auto-refresh feeds' }).click();`
                        );
                      }}
                      onMouseEnter={() =>
                        setHoveredElement("page.getByRole('switch', { name: 'Auto-refresh feeds' })")
                      }
                      onMouseLeave={() => setHoveredElement(null)}
                      className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                        customToggle ? 'bg-[#0566d9]' : 'bg-[#262a33]'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                          customToggle ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {customActionTriggered && (
                    <div className="p-3 rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-xs font-mono text-[#10b981]">
                      ✓ Custom workflow action dispatched to {targetUrl}!
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        addAction(
                          'click',
                          "page.getByRole('button', { name: 'Execute Action' })",
                          "await page.getByRole('button', { name: 'Execute Action' }).click();"
                        );
                        setCustomActionTriggered(true);
                      }}
                      onMouseEnter={() =>
                        setHoveredElement("page.getByRole('button', { name: 'Execute Action' })")
                      }
                      onMouseLeave={() => setHoveredElement(null)}
                      className="py-2 rounded-lg bg-[#0566d9] hover:bg-[#0455b5] text-white text-xs font-mono font-medium cursor-pointer"
                    >
                      Execute Action
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        addAction(
                          'assert',
                          "expect(page).toHaveURL(/.+/)",
                          `await expect(page).toHaveURL('${targetUrl}');`
                        );
                      }}
                      onMouseEnter={() =>
                        setHoveredElement("expect(page).toHaveURL(...)")
                      }
                      onMouseLeave={() => setHoveredElement(null)}
                      className="py-2 rounded-lg bg-[#262a33] hover:bg-[#31353e] text-[#4cd7f6] text-xs font-mono font-medium cursor-pointer"
                    >
                      Assert Current URL
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Live Hover Locator HUD */}
            <div className="p-2.5 rounded-lg bg-[#0a0e16] border border-[#262a33] text-[11px] font-mono flex items-center justify-between">
              <div className="flex items-center gap-1.5 truncate">
                <span className="material-symbols-outlined text-[15px] text-[#4cd7f6]">
                  ads_click
                </span>
                <span className="text-[#908fa0]">Inspector Target:</span>
                <span className="text-[#dfe2ee] font-semibold truncate">
                  {hoveredElement || 'Hover over any UI element to preview selector'}
                </span>
              </div>
              <span className="text-[10px] text-[#adc6ff] flex-shrink-0">
                ARIA / TestID Mode
              </span>
            </div>
          </div>
        </div>

        {/* Live Generated Code View (5 columns) */}
        <div className="lg:col-span-5 flex flex-col bg-[#0a0e16] rounded-xl border border-[#262a33] overflow-hidden">
          <div className="px-3 py-2 bg-[#1c2028] border-b border-[#262a33] flex items-center justify-between text-xs font-mono">
            <span className="text-[#4cd7f6] flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px]">
                code_blocks
              </span>
              GENERATED PLAYWRIGHT SPEC
            </span>
            <span className="text-[#908fa0] text-[10px]">
              {recordedActions.length} Actions
            </span>
          </div>

          <div className="p-3 font-mono text-[11px] leading-relaxed flex-1 overflow-y-auto max-h-[420px] text-[#dfe2ee]">
            <pre className="whitespace-pre-wrap selection:bg-[#8083ff]/30">
              <code>{generatedScript}</code>
            </pre>
          </div>

          <div className="p-2.5 bg-[#181c24] border-t border-[#262a33] text-[10px] font-mono text-[#908fa0] flex items-center justify-between">
            <span className="flex items-center gap-1 text-[#10b981]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>
              Auto-waiting locators
            </span>
            <span>Target: {targetUrl}</span>
          </div>
        </div>
      </div>

      {/* Live Recorder Timeline: step-by-step feed of captured browser actions */}
      <div className="flex flex-col bg-[#181c24] rounded-xl border border-[#262a33] overflow-hidden">
        <div className="px-3 py-2 bg-[#1c2028] border-b border-[#262a33] flex items-center justify-between text-xs font-mono">
          <span className="text-[#4cd7f6] flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px]">
              timeline
            </span>
            LIVE RECORDER TIMELINE
          </span>
          <span className="text-[#908fa0] text-[10px]">
            {sessionLifecycleStatus === 'RUNNING'
              ? 'Streaming...'
              : sessionLifecycleStatus === 'FAILED'
              ? 'Session failed'
              : sessionLifecycleStatus === 'STOPPED'
              ? 'Session stopped'
              : 'No active session'}
          </span>
        </div>

        <div className="p-3 flex flex-col gap-2 max-h-[360px] overflow-y-auto">
          {recordedActions.length === 0 && (
            <div className="p-4 text-center text-xs font-mono text-[#908fa0]">
              No steps recorded yet. Start a browser recording session to see live steps here.
            </div>
          )}

          {recordedActions.map((action, index) => (
            <div
              key={action.id}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0a0e16] border border-[#262a33]"
            >
              <span className="flex-shrink-0 w-14 text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
                Step {index + 1}
              </span>
              <span
                className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                  action.type === 'click'
                    ? 'bg-[#4cd7f6]/15 text-[#4cd7f6]'
                    : action.type === 'fill' || action.type === 'select'
                    ? 'bg-[#c0c1ff]/15 text-[#c0c1ff]'
                    : action.type === 'navigation'
                    ? 'bg-[#8083ff]/15 text-[#8083ff]'
                    : action.type === 'press'
                    ? 'bg-[#f59e0b]/15 text-[#f59e0b]'
                    : 'bg-[#10b981]/15 text-[#10b981]'
                }`}
              >
                {action.type === 'navigation' ? 'NAVIGATE' : action.type}
              </span>
              <span className="flex-1 text-xs font-mono text-[#dfe2ee] truncate">
                {buildTimelineDisplayValue(action)}
              </span>
              <span className="flex-shrink-0 text-[10px] font-mono text-[#908fa0]">
                {formatWallClockTimestamp(sessionStartedAt, action.timestamp)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
