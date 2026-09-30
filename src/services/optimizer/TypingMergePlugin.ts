import { OptimizedAction, OptimizerPlugin } from './types';

const FILLABLE_TYPES = new Set<OptimizedAction['type']>(['fill', 'select']);

const LOCATOR_QUALITY_RANK: Record<OptimizedAction['locatorQuality'], number> = {
  semantic: 3,
  testid: 2,
  css: 1
};

function isSameTarget(a: OptimizedAction, b: OptimizedAction): boolean {
  return a.selector === b.selector;
}

/** When two representations of the same field/target disagree, keep the higher-quality one. */
function pickBetterLocator(a: OptimizedAction, b: OptimizedAction): OptimizedAction {
  return LOCATOR_QUALITY_RANK[b.locatorQuality] > LOCATOR_QUALITY_RANK[a.locatorQuality] ? b : a;
}

function rebuildFillCodeLine(selector: string, type: OptimizedAction['type'], value?: string): string {
  const escaped = (value || '').replace(/'/g, "\\'");
  return type === 'select'
    ? `await ${selector}.selectOption('${escaped}');`
    : `await ${selector}.fill('${escaped}');`;
}

/**
 * Collapses a run of keystroke-level FILL/SELECT events on the same field
 * (fill("a"), fill("ad"), fill("adm"), ...) into a single action carrying
 * only the final value, keeping whichever of the merged events had the
 * better-quality locator.
 */
export class TypingMergePlugin implements OptimizerPlugin {
  name = 'TypingMergePlugin';
  order = 10;

  optimize(events: OptimizedAction[]): OptimizedAction[] {
    const output: OptimizedAction[] = [];

    for (const next of events) {
      const last = output[output.length - 1];

      if (last && FILLABLE_TYPES.has(next.type) && last.type === next.type && isSameTarget(last, next)) {
        const preferred = pickBetterLocator(last, next);
        output[output.length - 1] = {
          ...preferred,
          value: next.value,
          isSensitive: next.isSensitive ?? preferred.isSensitive,
          variableName: next.variableName ?? preferred.variableName,
          codeLine: rebuildFillCodeLine(preferred.selector, next.type, next.value),
          timestamp: next.timestamp,
          mergedFromCount: last.mergedFromCount + 1,
          warnings: preferred.warnings
        };
        continue;
      }

      output.push(next);
    }

    return output;
  }
}
