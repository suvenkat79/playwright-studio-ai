import React, { useEffect, useState } from 'react';
import { MOCK_TEST_RUNS } from '../data/suiteFiles';
import { runService } from '../services/runService';
import { RunHistoryEntry } from '../types';

interface DashboardViewProps {
  onReplayRun: (runNumber: number) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onReplayRun
}) => {
  const [liveRuns, setLiveRuns] = useState<RunHistoryEntry[]>([]);

  // Real completed Playwright runs (from RunController#getRunHistory) are
  // shown above the existing mock rows, so the table stays populated before
  // the first real run and reflects genuine execution results afterward.
  useEffect(() => {
    let cancelled = false;

    const fetchHistory = async () => {
      try {
        const history = await runService.getRunHistory();
        if (!cancelled) setLiveRuns(history);
      } catch (err) {
        console.debug('[DashboardView] Failed to fetch run history:', err);
      }
    };

    fetchHistory();
    const interval = setInterval(fetchHistory, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const displayedRuns = [...liveRuns, ...MOCK_TEST_RUNS];

  return (
    <div className="flex flex-col gap-4 text-[#dfe2ee]">
      {/* Top Header */}
      <div className="bg-[#181c24] p-4 sm:p-5 rounded-xl border border-[#262a33]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[#4cd7f6]">
              insights
            </span>
            <h2 className="text-base font-semibold text-[#dfe2ee]">
              Quality Lab & Execution Telemetry
            </h2>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-[#10b981]/20 text-[#10b981] text-[10px] font-mono font-semibold">
            SUITE HEALTH: OPTIMAL
          </span>
        </div>
        <p className="text-xs text-[#c7c4d7] mt-1">
          Real-time metrics aggregated across multi-browser Playwright execution workers.
        </p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="p-3.5 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Pass Rate
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-[#10b981]">
              98.4%
            </span>
            <span className="text-[10px] font-mono text-[#10b981]">+0.8%</span>
          </div>
          <div className="w-full bg-[#1c2028] h-1 rounded-full mt-2 overflow-hidden">
            <div className="bg-[#10b981] h-full w-[98.4%]"></div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Average Step Latency
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-[#4cd7f6]">
              412ms
            </span>
            <span className="text-[10px] font-mono text-[#adc6ff]">fast</span>
          </div>
          <div className="w-full bg-[#1c2028] h-1 rounded-full mt-2 overflow-hidden">
            <div className="bg-[#4cd7f6] h-full w-[65%]"></div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Self-Healed Locators
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-[#8083ff]">
              6
            </span>
            <span className="text-[10px] font-mono text-[#c0c1ff]">prevented</span>
          </div>
          <div className="w-full bg-[#1c2028] h-1 rounded-full mt-2 overflow-hidden">
            <div className="bg-[#8083ff] h-full w-[80%]"></div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#181c24] border border-[#262a33]">
          <span className="text-[10px] font-mono text-[#908fa0] uppercase tracking-wider">
            Flakiness Radar
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-[#dfe2ee]">
              0.0%
            </span>
            <span className="text-[10px] font-mono text-[#10b981]">0 quarantined</span>
          </div>
          <div className="w-full bg-[#1c2028] h-1 rounded-full mt-2 overflow-hidden">
            <div className="bg-[#10b981] h-full w-[100%]"></div>
          </div>
        </div>
      </div>

      {/* Browser Coverage Grid */}
      <div className="bg-[#181c24] p-4 rounded-xl border border-[#262a33] space-y-3">
        <h3 className="text-xs font-mono uppercase text-[#908fa0] tracking-wider">
          Multi-Browser Matrix Validation
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="p-3 rounded-lg bg-[#1c2028] border border-[#262a33]">
            <div className="flex items-center justify-between text-xs font-mono mb-1.5">
              <span className="text-[#4cd7f6] font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#4cd7f6]"></span>
                Chromium
              </span>
              <span className="text-[#10b981]">99.1% Pass</span>
            </div>
            <div className="text-[11px] font-mono text-[#908fa0] space-y-0.5">
              <div>Avg Latency: 412ms</div>
              <div>Headless Workers: 4</div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#1c2028] border border-[#262a33]">
            <div className="flex items-center justify-between text-xs font-mono mb-1.5">
              <span className="text-[#adc6ff] font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#adc6ff]"></span>
                Firefox
              </span>
              <span className="text-[#10b981]">97.8% Pass</span>
            </div>
            <div className="text-[11px] font-mono text-[#908fa0] space-y-0.5">
              <div>Avg Latency: 580ms</div>
              <div>Headless Workers: 2</div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#1c2028] border border-[#262a33]">
            <div className="flex items-center justify-between text-xs font-mono mb-1.5">
              <span className="text-[#8083ff] font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#8083ff]"></span>
                WebKit
              </span>
              <span className="text-[#10b981]">98.2% Pass</span>
            </div>
            <div className="text-[11px] font-mono text-[#908fa0] space-y-0.5">
              <div>Avg Latency: 610ms</div>
              <div>Headless Workers: 2</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Runs Table */}
      <div className="bg-[#181c24] rounded-xl border border-[#262a33] overflow-hidden">
        <div className="px-4 py-3 bg-[#1c2028] border-b border-[#262a33] flex items-center justify-between">
          <span className="text-xs font-mono uppercase text-[#908fa0] tracking-wider">
            Recent Pipeline Executions
          </span>
          <span className="text-[11px] font-mono text-[#4cd7f6]">
            Total Runs: 408
          </span>
        </div>

        <div className="divide-y divide-[#262a33]">
          {displayedRuns.map((run) => (
            <div
              key={run.id}
              className="p-3.5 hover:bg-[#1c2028]/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold ${
                    run.status === 'passed'
                      ? 'bg-[#10b981]/20 text-[#10b981]'
                      : 'bg-[#f59e0b]/20 text-[#f59e0b]'
                  }`}
                >
                  {run.status === 'passed' ? '✓' : '!'}
                </span>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold font-mono text-[#dfe2ee]">
                      RUN #{run.runNumber}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#262a33] text-[#c7c4d7]">
                      {run.branch}
                    </span>
                    <span className="text-[10px] font-mono text-[#908fa0]">
                      {run.commitSha}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#908fa0] mt-0.5 font-mono">
                    {run.totalSteps} steps · {run.browser} · {run.timestamp}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-auto font-mono text-xs">
                <span className="text-[#4cd7f6]">{run.durationMs}ms</span>
                {run.healedCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-[#8083ff]/20 text-[#c0c1ff] text-[10px]">
                    {run.healedCount} healed
                  </span>
                )}
                <button
                  onClick={() => onReplayRun(run.runNumber)}
                  className="px-2.5 py-1 rounded bg-[#262a33] hover:bg-[#31353e] text-xs text-[#adc6ff] transition-colors cursor-pointer"
                >
                  Replay
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
