import { OptimizedAction, OptimizerPlugin } from './types';

/**
 * Re-enforces (never trusts alone) that any field the recorder tagged with
 * a variableName never emits a literal value into the generated code. Runs
 * after TypingMergePlugin so it only has to act once per field instead of
 * once per keystroke.
 */
export class CredentialPlugin implements OptimizerPlugin {
  name = 'CredentialPlugin';
  order = 20;

  optimize(events: OptimizedAction[]): OptimizedAction[] {
    return events.map((action) => {
      if (!action.variableName) return action;

      return {
        ...action,
        value: action.isSensitive ? '***MASKED***' : action.value,
        // Split across two lines (chained .fill() on its own indented line) —
        // matches the desired output style for credential fields specifically;
        // non-credential fills (TypingMergePlugin) stay single-line.
        codeLine: `await ${action.selector}\n    .fill(process.env.${action.variableName}!);`
      };
    });
  }
}
