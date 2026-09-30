import { OptimizedAction, OptimizerPlugin } from './types';

function navigationWaitCode(url: string): string {
  try {
    const { pathname } = new URL(url);
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    const fragment = lastSegment?.replace(/\.[a-zA-Z0-9]+$/, '');

    if (fragment) {
      const expectedSegment = JSON.stringify(fragment);
      return `await page.waitForURL(url => url.pathname.split('/').some(segment => segment === ${expectedSegment} || segment.replace(/\\.[a-zA-Z0-9]+$/, '') === ${expectedSegment}));`;
    }

    return `await page.waitForURL(url => url.pathname === ${JSON.stringify(pathname)});`;
  } catch {
    return `await page.waitForURL(${JSON.stringify(url)});`;
  }
}

/** Generic origin extraction for BASE_URL parameterization — works for any target site. */
function extractOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * NavigationParamPlugin — parameterizes navigation targets so the generated
 * spec runs against any environment (dev/staging/prod) without editing code:
 *
 *  1. The FIRST navigation event (the initial page.goto) has its origin
 *     replaced with process.env.BASE_URL, keeping the path as a literal
 *     suffix: `await page.goto(\`${process.env.BASE_URL}/login.do\`);`
 *  2. Every SUBSEQUENT navigation event (a waitForURL) is rewritten as a
 *     URL predicate matching a meaningful path segment, independent of
 *     origin and query parameters.
 *
 * Runs after SmartWaitPlugin (order=30) so it only rewrites one surviving
 * codeLine per navigation, not every duplicate that gets collapsed.
 *
 * Demonstrates the plugin framework's stated goal: this is a wholly new
 * capability added by registering one new class in OptimizerPipeline — none
 * of TypingMergePlugin, CredentialPlugin, SmartWaitPlugin, or LocatorPlugin
 * changed to support it.
 */
export class NavigationParamPlugin implements OptimizerPlugin {
  name = 'NavigationParamPlugin';
  order = 35;

  optimize(events: OptimizedAction[]): OptimizedAction[] {
    let sawFirstNavigation = false;

    return events.map((action) => {
      if (action.type !== 'navigation' || !action.url) return action;

      if (!sawFirstNavigation) {
        sawFirstNavigation = true;
        const origin = extractOrigin(action.url);
        if (!origin) return action;
        const path = action.url.slice(origin.length);
        return {
          ...action,
          codeLine: `await page.goto(\`\${process.env.BASE_URL}${path}\`);`
        };
      }

      return {
        ...action,
        codeLine: navigationWaitCode(action.url)
      };
    });
  }
}
