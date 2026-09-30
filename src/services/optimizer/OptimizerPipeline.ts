import { OptimizedAction, OptimizerPlugin } from './types';
import { TypingMergePlugin } from './TypingMergePlugin';
import { CredentialPlugin } from './CredentialPlugin';
import { SmartWaitPlugin } from './SmartWaitPlugin';
import { NavigationParamPlugin } from './NavigationParamPlugin';
import { LocatorPlugin } from './LocatorPlugin';
import { DynamicDataPlugin } from './DynamicDataPlugin';
import { ActionAbstractionPlugin } from './ActionAbstractionPlugin';

/**
 * Recorded Events -> TypingMergePlugin -> CredentialPlugin -> SmartWaitPlugin
 *                  -> NavigationParamPlugin -> LocatorPlugin -> DynamicDataPlugin
 *                  -> ActionAbstractionPlugin
 *                  -> PlaywrightGenerator (generateOptimizedSpec, in ../optimizerService.ts)
 *
 * DEFAULT_PLUGINS is the discoverable plugin set. Adding a future AI feature
 * (e.g. an AssertionPlugin) means writing one new class implementing
 * OptimizerPlugin and adding it here — nothing in the recorder, this file's
 * `run()` method, or any existing plugin needs to change. NavigationParamPlugin,
 * ActionAbstractionPlugin, and DynamicDataPlugin (dynamic business-ID regex +
 * waitForURL predicate cleanup) were all added this way, without modifying
 * any other plugin.
 *
 * DynamicDataPlugin.order (42) sits numerically after LocatorPlugin.order
 * (40) — see DynamicDataPlugin's own doc comment for why that's fine.
 */
const DEFAULT_PLUGINS: OptimizerPlugin[] = [
  new TypingMergePlugin(),
  new CredentialPlugin(),
  new SmartWaitPlugin(),
  new NavigationParamPlugin(),
  new LocatorPlugin(),
  new DynamicDataPlugin(),
  new ActionAbstractionPlugin()
];

export class OptimizerPipeline {
  private readonly plugins: OptimizerPlugin[];

  constructor(plugins: OptimizerPlugin[] = DEFAULT_PLUGINS) {
    // Sort ascending by `order` so callers can register plugins in any
    // order (or pass a custom/partial set) and still get correct execution.
    this.plugins = [...plugins].sort((a, b) => a.order - b.order);
  }

  run(events: OptimizedAction[]): OptimizedAction[] {
    return this.plugins.reduce((acc, plugin) => plugin.optimize(acc), events);
  }
}

export const defaultOptimizerPipeline = new OptimizerPipeline();
