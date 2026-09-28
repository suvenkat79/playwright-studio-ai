/**
 * Reusable HTTP API client for Playwright Studio AI
 */

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
  params?: Record<string, string>;
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Generic reusable HTTP client with error handling, json parsing, and abort timeout
 */
export async function apiClient<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { timeoutMs = 15000, headers, params, ...customConfig } = options;

  let url = endpoint;
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams(params);
    url += (url.includes('?') ? '&' : '?') + searchParams.toString();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  try {
    const response = await fetch(url, {
      ...customConfig,
      headers: {
        ...defaultHeaders,
        ...headers
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Parse response body safely
    let responseData: unknown;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      if (responseData && typeof responseData === 'object' && 'message' in responseData) {
        errorMessage = String((responseData as { message: unknown }).message);
      } else if (responseData && typeof responseData === 'object' && 'error' in responseData) {
        errorMessage = String((responseData as { error: unknown }).error);
      } else if (typeof responseData === 'string' && responseData.trim()) {
        errorMessage = responseData;
      }
      throw new ApiError(errorMessage, response.status, responseData);
    }

    return responseData as T;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(`Request timeout after ${timeoutMs}ms`, 408);
    }
    const message =
      error instanceof Error ? error.message : 'Unknown network error occurred';
    throw new ApiError(
      `Network connection failed: ${message}. Make sure server is running on http://localhost:8099`,
      0
    );
  }
}
