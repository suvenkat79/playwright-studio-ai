export interface RecordedBrowserEvent {
  id: string;
  type: 'click' | 'fill' | 'select' | 'assert' | 'navigation' | 'press';
  selector: string;
  value?: string;
  timestamp: string;
  codeLine: string;
  url: string;
}

export interface RecordingSession {
  id: string;
  targetUrl: string;
  startTime: number;
  browser: any;
  context: any;
  page: any;
  events: RecordedBrowserEvent[];
  isActive: boolean;
}

export interface RecordStartRequest {
  url: string;
}

export interface RecordStartResponse {
  status: 'RECORDING_STARTED';
  sessionId: string;
  targetUrl: string;
}

export interface RecordStopRequest {
  sessionId: string;
}

export interface RecordStopResponse {
  status: 'RECORDING_STOPPED';
  sessionId: string;
  totalEvents: number;
  generatedCode: string;
}

export interface RecordEventsResponse {
  sessionId: string;
  events: RecordedBrowserEvent[];
  isRecording: boolean;
  totalEvents: number;
}
