import { apiClient } from './api';
import {
  StartRecordingRequest,
  StartRecordingResponse,
  StopRecordingRequest,
  StopRecordingResponse,
  RecordingEventsResponse,
  SessionStatusResponse
} from '../types';

export const RECORD_API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8099';

/**
 * Reusable Recording API Service
 * Integrates directly with the Spring Boot backend or Node Playwright recorder on http://localhost:8099
 */
export const recordService = {
  /**
   * Starts a visible browser recording session on the target URL
   * POST http://localhost:8099/api/record/start
   */
  async startRecording(url: string): Promise<StartRecordingResponse> {
    const payload: StartRecordingRequest = {
      url: url.trim()
    };

    return await apiClient<StartRecordingResponse>(
      `${RECORD_API_BASE_URL}/api/record/start`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  },

  /**
   * Polls live captured browser events for an active recording session
   * GET http://localhost:8099/api/record/events?sessionId=...
   */
  async getRecordedEvents(sessionId: string): Promise<RecordingEventsResponse> {
    return await apiClient<RecordingEventsResponse>(
      `${RECORD_API_BASE_URL}/api/record/events?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: 'GET'
      }
    );
  },

  /**
   * Stops an active recording session and closes the browser
   * POST http://localhost:8099/api/record/stop
   */
  async stopRecording(sessionId: string): Promise<StopRecordingResponse> {
    const payload: StopRecordingRequest = { sessionId };
    return await apiClient<StopRecordingResponse>(
      `${RECORD_API_BASE_URL}/api/record/stop`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  },

  /**
   * Checks recording session lifecycle status
   * GET http://localhost:8099/api/record/status?sessionId=...
   */
  async getStatus(sessionId: string): Promise<SessionStatusResponse> {
    return await apiClient<SessionStatusResponse>(
      `${RECORD_API_BASE_URL}/api/record/status?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: 'GET'
      }
    );
  }
};
