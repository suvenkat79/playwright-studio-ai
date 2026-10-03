import type { RecordedAction } from '../types';
import type { OptimizedAction } from './optimizer/types';

export type FrameworkFileSet = Record<string, string>;

export interface FrameworkProjectMetadata {
  generatedFileCount: number;
  pageObjectCount: number;
  workflowFunctionCount: number;
  testCount: number;
  testDataFileCount: number;
  fixtureCount: number;
  files: string[];
}

function locatorExpressionWithIdentity(action: FrameworkAction, pageExpression: string): string {
  const identity = /\b(?:INC|REQ|RITM|TASK|CHG)\d+\b/.exec(action.selector)?.[0];
  if (!identity || !action.identityKey) return locatorExpression(action, pageExpression);
  const selector = action.selector.replace(
    /(['"])([^'"]*\b(?:INC|REQ|RITM|TASK|CHG)\d+\b[^'"]*)\1/,
    (_match, _quote: string, label: string) => `\`${label.replace(identity, '${identity}')}\``
  );
  const frameSelectors = action.frameSelector
    ? [action.frameSelector]
    : action.source?.frameMetadata?.frameSelector
      ? [action.source.frameMetadata.frameSelector]
      : action.source?.frameMetadata?.framePath ?? [];
  const root = frameSelectors.reduce(
    (expression, frameSelector) => `${expression}.frameLocator(${JSON.stringify(frameSelector)})`,
    pageExpression
  );
  return selector.replace(/\bpage\d*\./g, `${root}.`);
}

export interface FrameworkProject {
  files: FrameworkFileSet;
  metadata: FrameworkProjectMetadata;
  recordedActions: RecordedAction[];
  actions: OptimizedAction[];
  workflows: FrameworkWorkflowMetadata[];
}

export interface FrameworkWorkflowMetadata {
  name: string;
  intent: string;
  entity: string;
  actionIds: string[];
  capabilities: Array<{
    actionId: string;
    type: OptimizedAction['type'];
    label?: string;
    identity: boolean;
  }>;
}

interface FrameworkAction extends OptimizedAction {
  source: RecordedAction | undefined;
  pageObjectIndex: number;
  methodName: string;
  dataKey?: string;
  identityKey?: string;
  opensTabIndex?: number;
  methodParameters: PageObjectParameter[];
}

interface ExtractedAssertionValue {
  key: string;
  value: string;
}

interface WorkflowParameter {
  key: string;
  actionId: string;
}

interface PageObjectParameter {
  name: string;
  type: string;
  source: 'page' | 'data' | 'value' | 'identity';
}

interface WorkflowGroup {
  name: string;
  /** The intent that bounded this group (e.g. 'Login', 'UpdateRecord') --
   * the same value workflowName() used to name the group. Root-cause fix:
   * the public FrameworkWorkflowMetadata.intent used to be read from the
   * group's LAST action's own classified intent instead, which is almost
   * never the boundary intent itself (the boundary-setting action is
   * usually followed by several trailing Unknown/Navigate actions before
   * the next boundary) -- confirmed live: a "loginIncident"-named workflow
   * (correctly named from a 'Login' boundary) reported .intent "Unknown",
   * and "updateIncident" reported .intent "Navigate", because both groups'
   * last action was a trailing navigation, not the boundary click itself.
   * Downstream consumers that filter workflows by .intent (e.g.
   * workflowMatcher.ts's loginWorkflows) silently found nothing. */
  intent?: string;
  actions: FrameworkAction[];
  parameters: WorkflowParameter[];
}

interface PageObjectGroup {
  key: string;
  application: string;
  pageType: string;
  className: string;
  actions: FrameworkAction[];
}

const WORKFLOW_BOUNDARIES = new Set([
  'Login',
  'Logout',
  'CreateRecord',
  'OpenRecord',
  'Search',
  'UpdateRecord',
  'SubmitRecord'
]);

function safeIdentifier(value: string): string {
  const identifier = value.replace(/[^a-zA-Z0-9_$]+/g, '_').replace(/^([^a-zA-Z_$])/, '_$1');
  return identifier || 'Generated';
}

function camelCaseIdentifier(value: string): string {
  return safeIdentifier(value)
    .split(/_+/)
    .filter(Boolean)
    .map((part, index) => index === 0
      ? part.charAt(0).toLowerCase() + part.slice(1)
      : part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'value';
}

function actionLabel(action: OptimizedAction, source?: RecordedAction): string {
  const smart = source?.smartLocator;
  if (smart?.label) return smart.label;
  if (smart?.placeholder) return smart.placeholder;
  if (smart?.text) return smart.text;
  const selector = action.selector;
  const match = /getBy(?:Label|Placeholder|Text)\('((?:[^'\\]|\\.)*)'/.exec(selector) ??
    /getByRole\('[^']+',\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'/.exec(selector);
  return match?.[1]?.replace(/\\'/g, "'") ?? '';
}

function assertionValue(action: OptimizedAction): ExtractedAssertionValue | undefined {
  if (action.type !== 'assert') return undefined;

  const matcherValue = /\.(?:toHaveText|toContainText|toHaveValue|toBe|toEqual|toHaveURL)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/.exec(action.codeLine);
  if (matcherValue) {
    const value = matcherValue[2].replace(/\\(['"\\])/g, '$1');
    const key = `expected${capitalize(camelCaseIdentifier(value))}`;
    return { key, value };
  }

  if (/\.toBeVisible\s*\(/.test(action.codeLine)) {
    const textLocatorValue = /getByText\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/.exec(action.selector);
    if (textLocatorValue) {
      return {
        key: 'expectedMessage',
        value: textLocatorValue[2].replace(/\\(['"\\])/g, '$1')
      };
    }
  }
  return undefined;
}

function locatorExpression(action: FrameworkAction, pageExpression: string): string {
  const framePath = action.source?.frameMetadata?.framePath;
  const frameSelectors = action.frameSelector
    ? [action.frameSelector]
    : action.source?.frameMetadata?.frameSelector
      ? [action.source.frameMetadata.frameSelector]
      : framePath ?? [];
  const root = frameSelectors.reduce(
    (expression, selector) => `${expression}.frameLocator(${JSON.stringify(selector)})`,
    pageExpression
  );
  return action.selector.replace(/\bpage\d*\./g, `${root}.`);
}

function frameLocatorRoot(action: FrameworkAction): string {
  const framePath = action.source?.frameMetadata?.framePath;
  const frameSelectors = action.frameSelector
    ? [action.frameSelector]
    : action.source?.frameMetadata?.frameSelector
      ? [action.source.frameMetadata.frameSelector]
      : framePath ?? [];
  return frameSelectors.reduce(
    (expression, selector) => `${expression}.frameLocator(${JSON.stringify(selector)})`,
    'page'
  );
}

function groupPageKey(action: OptimizedAction, source?: RecordedAction): { key: string; application: string; pageType: string } {
  let hostname = 'RecordedApplication';
  if (action.url) {
    try {
      hostname = new URL(action.url).hostname;
    } catch {
      hostname = 'RecordedApplication';
    }
  }
  const application = source?.applicationMetadata?.application ?? hostname;
  const pageType = source?.pageMetadata?.pageType ?? 'RecordedPage';
  return {
    key: `${application}::${pageType}`,
    application,
    pageType
  };
}

function identityParameter(
  selector: string,
  source: RecordedAction | undefined
): { key: string; value: string; selectorTemplate: string } | undefined {
  const incidentNumber = /\bINC\d+\b/.exec(selector)?.[0];
  const recordNumber = /\b(?:REQ|RITM|TASK|CHG)\d+\b/.exec(selector)?.[0];
  const value = incidentNumber ?? recordNumber;
  if (!value) return undefined;
  const entity = source?.pageMetadata?.entity ?? 'record';
  const normalizedEntity = safeIdentifier(entity).replace(/s$/, '');
  const key = incidentNumber ? 'incidentNumber' : `${normalizedEntity || 'record'}Number`;
  return {
    key,
    value,
    selectorTemplate: selector.replace(value, '{identity}')
  };
}

function pageObjectMethodParameters(action: Pick<FrameworkAction, 'dataKey' | 'isSensitive' | 'variableName' | 'identityKey'>): PageObjectParameter[] {
  const parameters: PageObjectParameter[] = [
    { name: 'page', type: 'Page', source: 'page' },
    { name: 'data', type: 'FrameworkTestData', source: 'data' }
  ];
  // 'value'/'identity' are typed as optionally-undefined, not plain
  // string, so that accumulating MORE fields into the same workflow's
  // *Parameters interface later (Add to Suite merging a genuinely new
  // capability into an existing, reused workflow -- see
  // frameworkAccumulator.ts) never invalidates an earlier-generated test
  // file's own frozen call site, which only ever supplies the fields that
  // existed when IT was generated. The existing runtime guard just below
  // (`if (value === undefined) throw ...`) still enforces that a field a
  // given action actually needs is present, and narrows the type back to
  // string for the rest of the method body.
  if (action.dataKey && !action.isSensitive && !action.variableName) {
    parameters.push({
      name: 'value',
      type: 'string | undefined',
      source: 'value'
    });
  }
  if (action.identityKey) {
    parameters.push({
      name: 'identity',
      type: 'string | undefined',
      source: 'identity'
    });
  }
  return parameters;
}

function workflowName(intent: string | undefined, actions: FrameworkAction[], ordinal: number): string {
  const intentPrefix: Record<string, string> = {
    Login: 'login',
    Logout: 'logout',
    CreateRecord: 'create',
    OpenRecord: 'open',
    Search: 'search',
    UpdateRecord: 'update',
    SubmitRecord: 'submit'
  };
  const boundary = actions[actions.length - 1];
  const entity = boundary?.source?.pageMetadata?.entity ??
    boundary?.source?.pageMetadata?.module ??
    boundary?.source?.pageMetadata?.pageType ??
    'record';
  const entityName = safeIdentifier(entity)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/s$/, '') || 'Record';
  const base = intent && intentPrefix[intent]
    ? `${intentPrefix[intent]}${entityName}`
    : 'runCapturedActions';
  return `${base}${ordinal > 1 ? `_${ordinal}` : ''}`;
}

function workflowGroups(actions: FrameworkAction[]): WorkflowGroup[] {
  const groups: WorkflowGroup[] = [];
  let pending: FrameworkAction[] = [];
  let pendingIntent: string | undefined;
  const intentCounts = new Map<string, number>();
  const functionNameCounts = new Map<string, number>();

  const addGroup = (groupActions: FrameworkAction[], intent?: string) => {
    const parameters = new Map<string, WorkflowParameter>();
    for (const action of groupActions) {
      if (action.dataKey && !action.isSensitive && !action.variableName) {
        parameters.set(action.dataKey, { key: action.dataKey, actionId: action.id });
      }
      if (action.identityKey) {
        parameters.set(action.identityKey, { key: action.identityKey, actionId: action.id });
      }
    }
    const ordinal = (intentCounts.get(intent ?? 'runCapturedActions') ?? 0) + 1;
    intentCounts.set(intent ?? 'runCapturedActions', ordinal);
    const proposedName = workflowName(intent, groupActions, ordinal);
    const duplicateCount = (functionNameCounts.get(proposedName) ?? 0) + 1;
    functionNameCounts.set(proposedName, duplicateCount);
    groups.push({
      name: duplicateCount > 1 ? `${proposedName}_${duplicateCount}` : proposedName,
      intent,
      actions: groupActions,
      parameters: [...parameters.values()]
    });
  };
  for (const action of actions) {
    const intent = action.source?.intent?.intent;
    const boundaryIntent = intent && WORKFLOW_BOUNDARIES.has(intent) ? intent : undefined;
    if (boundaryIntent && pendingIntent && boundaryIntent !== pendingIntent) {
      addGroup(pending, pendingIntent);
      pending = [];
      pendingIntent = boundaryIntent;
    } else if (boundaryIntent && !pendingIntent) {
      pendingIntent = boundaryIntent;
    }
    pending.push(action);
  }

  if (pending.length > 0) {
    addGroup(pending, pendingIntent);
  }
  return groups;
}

function renderPageObject(group: PageObjectGroup): string {
  const imports = `import { expect, type Page } from '@playwright/test';\nimport type { FrameworkTestData } from '../test-data/types';\n\n`;
  const methods = group.actions.map((action) => {
    const method = action.methodName;
    const staticTarget = locatorExpressionWithIdentity(action, 'page');
    const target = action.type === 'assert' && action.dataKey && /\.toBeVisible\s*\(/.test(action.codeLine)
      ? staticTarget.replace(/getByText\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/, 'getByText(value')
      : staticTarget;
    const identity = action.identitySelector
      ? `    const identitySelector = data.identities[${JSON.stringify(action.id)}];\n` +
        `    if (identitySelector === undefined) throw new Error('Missing identity selector for action: ${action.id}');\n` +
        (action.identityKey
          ? `    if (identity === undefined) throw new Error('Missing workflow parameter: ${action.identityKey}');\n` +
            `    const target = ${frameLocatorRoot(action)}.locator(identitySelector.replace('{identity}', identity)).first();\n`
          : `    const target = ${frameLocatorRoot(action)}.locator(identitySelector).first();\n`)
      : `    const target = ${target};\n`;
    const key = action.dataKey;
    const methodParameters = action.methodParameters
      .map(({ name, type }) => `${name}: ${type}`)
      .join(', ');

    if (action.type === 'press') {
      return `  async ${method}(${methodParameters}): Promise<void> {\n` +
        `    await page.keyboard.press(${JSON.stringify(action.value ?? 'Enter')});\n` +
        `  }\n`;
    }

    if (action.type === 'navigation') {
      if (/page\d*\.goto\(/.test(action.codeLine)) {
        return `  async ${method}(${methodParameters}): Promise<void> {\n` +
          `    const destination = data.navigationUrls[${JSON.stringify(action.id)}] ?? data.baseUrl;\n` +
          `    await page.goto(destination === data.baseUrl ? process.env.BASE_URL || destination : destination);\n` +
          `  }\n`;
      }
      // waitUntil: 'domcontentloaded', not Playwright's default 'load' --
      // same root cause as recorder/engine.ts's navigationWaitCode: a
      // real top-level navigation can match its URL immediately while
      // never reaching 'load' within the timeout (persistent background
      // connections the destination page keeps open), confirmed live
      // against a real ServiceNow instance. Subsequent actions' own
      // locators auto-wait for actionability regardless.
      return `  async ${method}(${methodParameters}): Promise<void> {\n` +
        `    const destination = data.navigationUrls[${JSON.stringify(action.id)}];\n` +
        `    if (!destination) throw new Error('Missing navigation URL for action: ${action.id}');\n` +
        `    const expectedPath = new URL(destination).pathname;\n` +
        `    await page.waitForURL(\`**\${expectedPath}**\`, { waitUntil: 'domcontentloaded' });\n` +
        `  }\n`;
    }

    let invocation: string;
    switch (action.type) {
      case 'click':
        invocation = 'await target.click();';
        break;
      case 'fill':
        invocation = `await target.fill(${key && !action.isSensitive && !action.variableName ? 'value' : JSON.stringify(action.value ?? '')});`;
        break;
      case 'select':
        invocation = `await target.selectOption(${key && !action.isSensitive && !action.variableName ? 'value' : JSON.stringify(action.value ?? '')});`;
        break;
      case 'scroll': {
        const position = action.value ? JSON.parse(action.value) as { x: number; y: number } : { x: 0, y: 0 };
        const isDocument = /locator\(['"]html['"]\)/.test(action.selector);
        const scroll = isDocument
          ? 'element.ownerDocument.defaultView?.scrollTo(position.x, position.y)'
          : 'element.scrollTo(position.x, position.y)';
        invocation = `await target.evaluate((element, position) => ${scroll}, data.scrollPositions[${JSON.stringify(action.id)}] ?? ${JSON.stringify(position)});`;
        break;
      }
      case 'assert': {
        invocation = action.codeLine.replace(action.selector, target);
        if (key) {
          invocation = invocation.replace(
            /\.(toHaveText|toContainText|toHaveValue|toBe|toEqual|toHaveURL)\(\s*(['"])((?:\\.|(?!\2)[^\\])*)\2/,
            (_match, matcher: string) => `.${matcher}(value`
          );
        }
        invocation = invocation.replace(/^await\s+/, 'await ');
        break;
      }
      default:
        invocation = action.codeLine.replace(/\bpage\d*\./g, 'page.');
        invocation = invocation.replace(/^await\s+/, 'await ');
        break;
    }

    const credentialName = action.variableName ?? 'APP_PASSWORD';
    const credential = action.isSensitive || action.variableName
      ? `    const value = process.env[${JSON.stringify(credentialName)}];\n` +
        `    if (value === undefined) throw new Error(${JSON.stringify(`Missing required environment variable: ${credentialName}`)});\n`
      : '';
    // Covers 'assert' too, not just fill/select: an assertion's captured
    // expected value is also carried as an optional `value: string |
    // undefined` parameter now (see pageObjectMethodParameters), and the
    // invocation below substitutes the bare `value` identifier straight
    // into a matcher call (e.g. .toHaveText(value)) that expects a plain
    // string -- without this guard's throw-on-undefined, TS has no reason
    // to narrow it and the matcher call fails to type-check.
    const paramGuard = !credential && key && (action.type === 'fill' || action.type === 'select' || action.type === 'assert')
      ? `    if (value === undefined) throw new Error('Missing workflow parameter: ${key}');\n`
      : '';
    if (credential && (action.type === 'fill' || action.type === 'select')) {
      invocation = action.type === 'select' ? 'await target.selectOption(value);' : 'await target.fill(value);';
    }

    return `  async ${method}(${methodParameters}): Promise<void> {\n` +
      `${credential}${paramGuard}${identity}${invocation}\n` +
      `  }\n`;
  }).join('\n');

  return `${imports}export class ${group.className} {\n` +
    `  readonly application = ${JSON.stringify(group.application)};\n` +
    `  readonly pageType = ${JSON.stringify(group.pageType)};\n\n` +
    methods +
    `}\n`;
}

function renderWorkflows(groups: WorkflowGroup[], pageGroups: PageObjectGroup[]): string {
  const imports = pageGroups.map((group) =>
    `import { ${group.className} } from '../pages/${group.className}';\n`
  ).join('');
  const objectInitializers = pageGroups.map((group, index) =>
    `    pageObject${index}: new ${group.className}(),`
  ).join('\n');
  const methodsByAction = new Map(pageGroups.flatMap((group) =>
    group.actions.map((action) => [
      action.id,
      `pageObjects.pageObject${action.pageObjectIndex}.${action.methodName}`
    ] as const)
  ));

  const groupFunctions = groups.map((group) => {
    const body = group.actions.map((action) => {
      const tab = action.tabIndex ?? 0;
      const pageRef = `pages[${tab}] ?? page`;
      const methodRef = methodsByAction.get(action.id)!;
      const opensTab = action.opensTabIndex;
      const actionArguments = action.methodParameters.map((parameter) => {
        switch (parameter.source) {
          case 'page':
            return pageRef;
          case 'data':
            return 'data';
          case 'value':
            return `params.${action.dataKey}`;
          case 'identity':
            return `params.${action.identityKey}`;
        }
      });
      const call = `await ${methodRef}(${actionArguments.join(', ')});`;
      if (action.type === 'click' && opensTab !== undefined) {
        return `  const page${opensTab}Promise = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);\n` +
          `  ${call}\n` +
          `  pages[${opensTab}] = (await page${opensTab}Promise) ?? ${pageRef};`;
      }
      return `  ${call}`;
    }).join('\n');
    // Optional, same reasoning as pageObjectMethodParameters above: a
    // workflow's *Parameters interface must keep accepting an
    // earlier-generated test's call site even after a later Add to Suite
    // merge adds more parameters to this same (reused) workflow.
    const parameterFields = group.parameters.map((parameter) =>
      `  ${parameter.key}?: string;`
    ).join('\n');
    const parameterType = `${capitalize(group.name)}Parameters`;
    const paramsType = group.parameters.length
      ? `export interface ${parameterType} {\n${parameterFields}\n}\n\n`
      : `export type ${parameterType} = Record<string, never>;\n\n`;
    const signature = `export async function ${group.name}(\n` +
      `  page: Page,\n  params: ${parameterType},\n  data: FrameworkTestData,\n` +
      `  pages: Page[] = [page]\n): Promise<void> {\n`;
    return `${paramsType}${signature}${body}\n}\n`;
  }).join('\n');

  return `import type { Page } from '@playwright/test';\n` +
    `import type { FrameworkTestData } from '../test-data/types';\n${imports}\n` +
    `const pageObjects = {\n${objectInitializers}\n};\n\n` +
    groupFunctions;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Shared by generateFrameworkProject and frameworkAccumulator.ts's
 * toFrameworkProject -- an accumulated project's file set is assembled from
 * multiple generation calls' outputs plus every test ever added by Add to
 * Suite, so its metadata must be recomputed from the final merged file set
 * rather than reused from any single generation call. */
export function computeFrameworkMetadata(files: FrameworkFileSet): FrameworkProjectMetadata {
  const generatedPaths = Object.keys(files).sort();
  const workflowSource = files['utils/workflows.ts'] ?? '';
  return {
    generatedFileCount: generatedPaths.length,
    pageObjectCount: generatedPaths.filter((filePath) => /^pages\/.+\.ts$/.test(filePath)).length,
    workflowFunctionCount: [...workflowSource.matchAll(/^export async function \w+\(/gm)].length,
    testCount: generatedPaths.filter((filePath) => /^tests\/.+\.spec\.ts$/.test(filePath)).length,
    testDataFileCount: generatedPaths.filter((filePath) => /^test-data\//.test(filePath)).length,
    fixtureCount: generatedPaths.filter((filePath) => /^fixtures\//.test(filePath)).length,
    files: generatedPaths
  };
}

export function generateFrameworkProject(
  recordedActions: RecordedAction[],
  optimizedActions: OptimizedAction[],
  targetUrl: string
): FrameworkProject {
  if (optimizedActions.length === 0) {
    throw new Error('Cannot generate a framework without optimized recorded actions.');
  }

  const actionsById = new Map(recordedActions.map((action) => [action.id, action]));
  const fields: Record<string, string> = {};
  const identities: Record<string, string> = {};
  const scrollPositions: Record<string, { x: number; y: number }> = {};
  const navigationUrls: Record<string, string> = {};
  const usedKeys = new Map<string, number>();
  const pageGroupsByKey = new Map<string, PageObjectGroup>();

  const frameworkActions = optimizedActions.map((action, index): FrameworkAction => {
    const source = actionsById.get(action.id);
    const info = groupPageKey(action, source);
    let group = pageGroupsByKey.get(info.key);
    if (!group) {
      group = {
        ...info,
        className: `${safeIdentifier(info.application)}${safeIdentifier(info.pageType)}Page${pageGroupsByKey.size + 1}`,
        actions: []
      };
      pageGroupsByKey.set(info.key, group);
    }

    let dataKey: string | undefined;
    if (action.type === 'fill' || action.type === 'select') {
      const label = actionLabel(action, source) || `${action.type}_${index + 1}`;
      const baseKey = camelCaseIdentifier(label);
      const duplicateCount = (usedKeys.get(baseKey) ?? 0) + 1;
      usedKeys.set(baseKey, duplicateCount);
      dataKey = duplicateCount === 1 ? baseKey : `${baseKey}_${duplicateCount}`;
      if (!action.isSensitive && !action.variableName) fields[dataKey] = action.value ?? '';
    } else {
      const extractedAssertion = assertionValue(action);
      if (extractedAssertion) {
        const duplicateCount = (usedKeys.get(extractedAssertion.key) ?? 0) + 1;
        usedKeys.set(extractedAssertion.key, duplicateCount);
        dataKey = duplicateCount === 1
          ? extractedAssertion.key
          : `${extractedAssertion.key}_${duplicateCount}`;
        fields[dataKey] = extractedAssertion.value;
      }
    }
    const identity = action.identitySelector || /\b(?:INC|REQ|RITM|TASK|CHG)\d+\b/.test(action.selector)
      ? identityParameter(action.identitySelector ?? action.selector, source)
      : undefined;
    if (identity) fields[identity.key] = identity.value;
    if (action.identitySelector) {
      identities[action.id] = identity?.selectorTemplate ?? action.identitySelector;
    }
    if (action.type === 'navigation') {
      const destination = source?.navigation?.toUrl ?? action.url;
      if (destination) navigationUrls[action.id] = destination;
    }
    if (action.type === 'scroll' && action.value) {
      scrollPositions[action.id] = JSON.parse(action.value) as { x: number; y: number };
    }

    const pageObjectIndex = [...pageGroupsByKey.keys()].indexOf(info.key);
    const frameworkAction: FrameworkAction = {
      ...action,
      source,
      pageObjectIndex,
      methodName: `action_${index + 1}`,
      dataKey,
      identityKey: identity?.key,
      methodParameters: [],
      opensTabIndex: optimizedActions[index + 1] && optimizedActions[index + 1].tabIndex > action.tabIndex
        ? optimizedActions[index + 1].tabIndex
        : undefined
    };
    frameworkAction.methodParameters = pageObjectMethodParameters(frameworkAction);
    pageGroupsByKey.get(info.key)!.actions.push(frameworkAction);
    return frameworkAction;
  });

  const pageGroups = [...pageGroupsByKey.values()];
  const groups = workflowGroups(frameworkActions);
  const actionMetadata = Object.fromEntries(frameworkActions.map((action) => [
    action.id,
    {
      intent: action.source?.intent?.intent ?? 'Unknown',
      intentConfidence: action.source?.intent?.confidence ?? 0,
      application: action.source?.applicationMetadata,
      page: action.source?.pageMetadata,
      frame: action.source?.frameMetadata,
      locator: action.source?.smartLocator,
      navigation: action.source?.navigation
    }
  ]));

  const pageObjectFiles = Object.fromEntries(pageGroups.map((group) => [
    `pages/${group.className}.ts`,
    renderPageObject(group)
  ]));
  const files: FrameworkFileSet = {
    ...pageObjectFiles,
    'utils/workflows.ts': renderWorkflows(groups, pageGroups),
    'fixtures/test.ts': `import { test as base, expect } from '@playwright/test';\n` +
      `import workflowData from '../test-data/workflow.json' with { type: 'json' };\n` +
      `import type { FrameworkTestData } from '../test-data/types';\n\n` +
      `export const test = base.extend<{ workflowData: FrameworkTestData }>({\n` +
      `  workflowData: async ({}, use) => use(workflowData as FrameworkTestData)\n` +
      `});\n\nexport { expect };\n`,
    'test-data/types.ts': `export interface FrameworkTestData {\n` +
      `  baseUrl: string;\n  fields: Record<string, string>;\n` +
      `  identities: Record<string, string>;\n  scrollPositions: Record<string, { x: number; y: number }>;\n` +
      `  navigationUrls: Record<string, string>;\n` +
      `}\n`,
    'test-data/workflow.json': JSON.stringify({
      baseUrl: targetUrl,
      fields,
      identities,
      scrollPositions,
      navigationUrls,
      actionMetadata
    }, null, 2),
    'tests/recorded-journey.spec.ts': `import { test, expect } from '../fixtures/test';\n` +
      `${groups.map((group) => `import { ${group.name} } from '../utils/workflows';\n`).join('')}` +
      `import type { Page } from '@playwright/test';\n\n` +
      `test('complete the recorded user journey', async ({ page, context, workflowData }) => {\n` +
      `  const pages: Page[] = [page];\n` +
      `${groups.map((group) => {
        const params = group.parameters.map((parameter) =>
          `    ${parameter.key}: workflowData.fields[${JSON.stringify(parameter.key)}]`
        ).join(',\n');
        return `  await ${group.name}(pages[0] ?? page, {\n${params}\n  }, workflowData, pages);\n`;
      }).join('')}` +
      `  await expect(page).toHaveURL(/.+/);\n` +
      `});\n`,
    'playwright.config.ts': `import 'dotenv/config';\n` +
      `import { defineConfig, devices } from '@playwright/test';\n\n` +
      `export default defineConfig({\n` +
      `  testDir: './tests',\n  fullyParallel: false,\n  reporter: [['list'], ['html', { open: 'never' }]],\n` +
      `  use: { baseURL: process.env.BASE_URL || ${JSON.stringify(targetUrl)}, trace: 'retain-on-failure', screenshot: 'only-on-failure' },\n` +
      `  projects: [\n    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },\n` +
      `    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },\n` +
      `    { name: 'webkit', use: { ...devices['Desktop Safari'] } }\n  ]\n});\n`,
    '.env.example': `BASE_URL=${targetUrl}\n` +
      [...new Set(optimizedActions.filter((action) => action.isSensitive || action.variableName)
        .map((action) => action.variableName ?? 'APP_PASSWORD'))]
        .map((name) => `${name}=`).join('\n') + '\n',
    'package.json': JSON.stringify({
      name: 'playwright-framework',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        test: 'playwright test',
        typecheck: 'tsc --noEmit',
        'test:headed': 'playwright test --headed',
        'test:ui': 'playwright test --ui',
        'test:debug': 'playwright test --debug',
        report: 'playwright show-report'
      },
      devDependencies: {
        '@playwright/test': '^1.63.0',
        '@types/node': '^22.14.0',
        dotenv: '^16.4.5',
        typescript: '^5.7.0'
      }
    }, null, 2),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        types: ['node']
      }
    }, null, 2),
    '.gitignore': `node_modules/\nplaywright-report/\ntest-results/\n.env\n`,
    'README.md': `# Playwright Framework\n\n` +
      `Generated from a validated Playwright Studio recording. Business actions remain in reusable workflow functions, page interactions and locators are isolated in Page Objects, captured assertions are preserved, and fill/select values are parameters backed by editable defaults in \`test-data/workflow.json\`.\n\n` +
      `## Setup\n\n\`\`\`bash\nnpm install\nnpx playwright install\ncp .env.example .env\n\`\`\`\n\n` +
      `Set \`BASE_URL\` and any credential variables in \`.env\`. Sensitive values are never written into test data.\n\n` +
      `Environment configuration and business test data are separate: \`.env\` contains environment-specific URL and credentials, while \`test-data/workflow.json\` contains scenario inputs such as record numbers, field values, and expected messages.\n\n` +
      `## Run\n\n\`\`\`bash\nnpm test\nnpm run test:headed\nnpm run test:ui\nnpm run report\n\`\`\`\n\n` +
      `## Generated structure\n\n- \`tests/recorded-journey.spec.ts\`: small test entry point.\n- \`pages/\`: page-specific locators and interactions grouped by detected application/page.\n- \`utils/workflows.ts\`: reusable intent-labeled workflow functions in recorded order.\n- \`fixtures/test.ts\`: shared workflow-data fixture.\n- \`test-data/workflow.json\`: editable field values, record identities, scroll positions, and captured intent/context metadata.\n- \`playwright.config.ts\`: Playwright projects and environment configuration.\n\n` +
      `Workflow functions are exported from \`utils/workflows.ts\` for reuse. Each \`*Parameters\` interface lists its required inputs; generated tests pass the editable defaults from \`test-data/workflow.json\`. Page-specific assertions are implemented in the corresponding Page Objects and called by workflows. The generated test also checks that the page has a URL after the journey.\n\n` +
      `Record identity selectors are kept in test data so IDs can be replaced without editing Page Objects. Save and Update remain the exact actions from the validated optimized recording; no steps are inferred or added.\n`
  };

  const metadata = computeFrameworkMetadata(files);

  const workflows: FrameworkWorkflowMetadata[] = groups.map((group) => {
    const boundary = group.actions[group.actions.length - 1];
    return {
      name: group.name,
      intent: group.intent ?? 'Unknown',
      entity: boundary?.source?.pageMetadata?.entity ??
        boundary?.source?.pageMetadata?.module ??
        boundary?.source?.pageMetadata?.pageType ??
        'record',
      actionIds: group.actions.map((action) => action.id),
      capabilities: group.actions.map((action) => ({
        actionId: action.id,
        type: action.type,
        label: (action.type === 'fill' || action.type === 'select' || action.type === 'click')
          ? actionLabel(action, action.source)
          : undefined,
        identity: Boolean(action.identitySelector)
      }))
    };
  });

  return { files, metadata, recordedActions, actions: optimizedActions, workflows };
}
