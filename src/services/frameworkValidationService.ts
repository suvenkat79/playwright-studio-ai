import { apiClient } from './api';
import type {
  FrameworkValidationDiagnostic,
  FrameworkValidationStatus
} from './frameworkValidator';

export type { FrameworkValidationDiagnostic, FrameworkValidationStatus };

export interface FrameworkValidationResponse {
  status: FrameworkValidationStatus;
  diagnostics: FrameworkValidationDiagnostic[];
  checkedAt: number;
}

export interface FrameworkValidationSnapshot {
  status: string;
  contentKey?: string;
}

export function frameworkContentKey(files: Record<string, string>): string {
  return JSON.stringify(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}

export function isFrameworkValidationCurrent(
  files: Record<string, string>,
  validation: FrameworkValidationSnapshot | null
): boolean {
  return validation?.status === 'passed' && validation.contentKey === frameworkContentKey(files);
}

const VALIDATE_API_BASE_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8099';

/**
 * "Validate Framework": sends the generated FrameworkProject's files to the
 * Java backend, which spawns the compiled recorder/dist/validateFramework.js
 * (a wrapper around the one real tsc --noEmit check in
 * src/services/frameworkValidator.ts) and relays its PASS/FAIL result.
 * POST http://localhost:8099/api/framework/validate
 */
export const frameworkValidationService = {
  async validate(files: Record<string, string>): Promise<FrameworkValidationResponse> {
    return await apiClient<FrameworkValidationResponse>(
      `${VALIDATE_API_BASE_URL}/api/framework/validate`,
      {
        method: 'POST',
        body: JSON.stringify({ files }),
        timeoutMs: 60000
      }
    );
  }
};
