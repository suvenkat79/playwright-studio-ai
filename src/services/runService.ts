import { apiClient } from './api';
import { RunExecuteRequest, RunExecuteResponse, RunEventsResponse, RunHistoryEntry } from '../types';

export const RUN_API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8099';

/**
 * Real Playwright Test Execution Engine API client.
 * Talks to the Spring Boot backend's /api/run/* endpoints, which spawn a
 * real `npx playwright test` child process per run (see RunService.java).
 */
export const runService = {
  /**
   * Materializes the given spec (+ optional POM) on disk and starts a real
   * Playwright test run.
   * POST http://localhost:8099/api/run/execute
   */
  async startRun(request: RunExecuteRequest): Promise<RunExecuteResponse> {
    return await apiClient<RunExecuteResponse>(`${RUN_API_BASE_URL}/api/run/execute`, {
      method: 'POST',
      body: JSON.stringify(request)
    });
  },

  /**
   * Polls the live step timeline, console logs, and (once finished) report
   * artifact paths for a run.
   * GET http://localhost:8099/api/run/events?runId=...
   */
  async getRunEvents(runId: string): Promise<RunEventsResponse> {
    return await apiClient<RunEventsResponse>(
      `${RUN_API_BASE_URL}/api/run/events?runId=${encodeURIComponent(runId)}`,
      { method: 'GET' }
    );
  },

  /**
   * Terminates an in-progress run's child process.
   * POST http://localhost:8099/api/run/cancel
   */
  async cancelRun(runId: string): Promise<void> {
    await apiClient<unknown>(`${RUN_API_BASE_URL}/api/run/cancel`, {
      method: 'POST',
      body: JSON.stringify({ runId })
    });
  },

  /**
   * Recent completed real runs, most recent first.
   * GET http://localhost:8099/api/run/history
   */
  async getRunHistory(): Promise<RunHistoryEntry[]> {
    return await apiClient<RunHistoryEntry[]>(`${RUN_API_BASE_URL}/api/run/history`, {
      method: 'GET'
    });
  }
};
