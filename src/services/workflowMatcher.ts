import type { RecordedAction } from '../types';
import type { FrameworkProject, FrameworkWorkflowMetadata } from './frameworkGenerator';
import type { OptimizedAction } from './optimizer/types';

export type WorkflowMatchStatus = 'MATCHED' | 'PARTIAL' | 'NOT_MATCHED';

export interface WorkflowRequest {
  intent: 'OpenRecord' | 'UpdateRecord' | 'CreateRecord' | 'SubmitRecord' | 'Search' | 'Unknown';
  operation: string;
  entity: string;
  identity?: string;
  fields: Array<{ field: string; value: string }>;
  clickTargets: string[];
}

export interface WorkflowCapabilityResult {
  kind: 'field' | 'click';
  label: string;
  value?: string;
  status: 'matched' | 'resolved' | 'not-resolved';
}

export interface WorkflowMatch {
  status: WorkflowMatchStatus;
  request: WorkflowRequest;
  reusableWorkflows: FrameworkWorkflowMetadata[];
  missingCapabilities: string[];
  matchedCapabilities: string[];
  matchedClickTargets: string[];
  reusedActionIds: string[];
  /** actionIds belonging to prerequisite workflows (login, search/filter to
   * locate the record, ...) chronologically before the target entity's own
   * workflows -- see matchWorkflow()'s prerequisiteWorkflows for why these
   * always get reused. Exposed so callers can tell a prerequisite's own
   * field fills (e.g. a login password, a filter textbox) apart from the
   * target workflow's optional field capabilities. */
  prerequisiteActionIds: string[];
}

export interface WorkflowResolutionResult {
  match: WorkflowMatch;
  resolvedActions: RecordedAction[];
  unresolved: string[];
  capabilityResults: WorkflowCapabilityResult[];
  mergedActions: RecordedAction[];
  optimizedActions: OptimizedAction[];
  generatedSpec: string | null;
  generatedProject: FrameworkProject | null;
}

export interface WorkflowResolutionDependencies {
  startResolutionSession(targetUrl: string): Promise<string>;
  resolveIntent(sessionId: string, instruction: string): Promise<{
    actions: RecordedAction[];
    unresolved: string[];
  }>;
  closeResolutionSession(sessionId: string): Promise<void>;
  optimize(actions: RecordedAction[]): OptimizedAction[];
  generateSpec(actions: OptimizedAction[], targetUrl: string): string;
  generateFramework(
    recordedActions: RecordedAction[],
    optimizedActions: OptimizedAction[],
    targetUrl: string
  ): FrameworkProject;
}

export interface MatchAvailability {
  recordingActive: boolean;
  frameworkAvailable: boolean;
  frameworkValidated: boolean;
  canGenerate: boolean;
  reason?: 'recording-active' | 'framework-unavailable' | 'framework-not-validated';
}

const ENTITY_NAMES: Record<string, string> = {
  incident: 'Incident',
  incidents: 'Incident',
  request: 'Request',
  requests: 'Request',
  user: 'User',
  users: 'User',
  task: 'Task',
  tasks: 'Task',
  change: 'Change',
  changes: 'Change'
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function entityMatches(workflowEntity: string, requestEntity: string): boolean {
  if (normalize(workflowEntity) === normalize(requestEntity)) return true;
  const entityTokens = workflowEntity
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return entityTokens.includes(normalize(requestEntity));
}

function unquote(value: string): string {
  return value.trim().replace(/[.,;]+$/, '').replace(/^["']|["']$/g, '').trim();
}

function actionFieldLabel(action: RecordedAction): string {
  const explicitLabel = action.smartLocator?.label ?? action.smartLocator?.placeholder;
  if (explicitLabel) return explicitLabel;
  const locatorLabel = /getBy(?:Label|Placeholder)\('((?:[^'\\]|\\.)*)'/.exec(action.selector)?.[1];
  return locatorLabel?.replace(/\\'/g, "'") ?? '';
}

function clickTargetFromLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

function actionClickLabel(action: RecordedAction): string {
  if (action.smartLocator?.text) return clickTargetFromLabel(action.smartLocator.text);
  const roleLabel = /getByRole\('[^']+',\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'/.exec(action.selector)?.[1];
  if (roleLabel) return clickTargetFromLabel(roleLabel.replace(/\\'/g, "'"));
  const textLabel = /getByText\('((?:[^'\\]|\\.)*)'/.exec(action.selector)?.[1];
  return textLabel ? clickTargetFromLabel(textLabel.replace(/\\'/g, "'")) : '';
}

export function formatCapabilityResult(result: WorkflowCapabilityResult): string {
  const capability = result.kind === 'click' ? `Click ${result.label}` : result.label;
  if (result.status === 'matched') {
    return result.kind === 'click'
      ? `Reused capability: ${capability}`
      : `Reused capability: ${capability}=${result.value ?? ''}`;
  }
  if (result.status === 'resolved') {
    return result.kind === 'click'
      ? `Resolved new capability: ${capability} · Source: live DOM resolution`
      : `Resolved new capability: ${capability}=${result.value ?? ''} · Source: live DOM resolution`;
  }
  return `Missing capability: ${capability} — Not resolved`;
}

export function parseWorkflowRequest(instruction: string, fallbackEntity = 'record'): WorkflowRequest {
  const normalizedPrompt = instruction.trim();
  const startsWithCreate = /^(?:please\s+)?(?:create|new)\b/i.test(normalizedPrompt);
  const startsWithUpdate = /^(?:please\s+)?(?:update|change|set|fill|enter|type)\b/i.test(normalizedPrompt);
  const containsFieldAssignment = /\b(?:change|update|set|fill|enter|type)\s+(?:the\s+)?[\s\S]+?\s+(?:field\s+)?(?:to|=|with)\b/i.test(normalizedPrompt);
  const requestsUpdate =
    startsWithUpdate ||
    containsFieldAssignment ||
    /\bclick\s+(?:on\s+)?update\b/i.test(normalizedPrompt);
  const intent: WorkflowRequest['intent'] =
    startsWithCreate ? 'CreateRecord' :
    requestsUpdate ? 'UpdateRecord' :
    /^(?:please\s+)?(?:search|find|look\s+up)\b/i.test(normalizedPrompt) ? 'Search' :
    /^(?:please\s+)?(?:submit|save)\b/i.test(normalizedPrompt) ||
    /^click\s+(?:submit|save)\b/i.test(normalizedPrompt) ? 'SubmitRecord' :
    /^(?:please\s+)?(?:open|view|navigate\s+to)\b/i.test(normalizedPrompt) ? 'OpenRecord' :
    'Unknown';

  const entityMatch = [...normalizedPrompt.matchAll(/\b(incidents?|requests?|users?|tasks?|changes?)\b/gi)]
    .find((match) => !(intent === 'UpdateRecord' &&
      match[1].toLowerCase().startsWith('change') &&
      match.index === normalizedPrompt.search(/\bchange\b/i)));
  const entity = entityMatch
    ? ENTITY_NAMES[entityMatch[1].toLowerCase()] ?? entityMatch[1]
    : fallbackEntity;
  const identity = /\b(?:INC|REQ|RITM|TASK|CHG)\d+\b/i.exec(normalizedPrompt)?.[0]?.toUpperCase();
  const fields: Array<{ field: string; value: string }> = [];
  const assignmentPattern = /\b(?:set|change|update|fill|enter|type)\s+(?:the\s+)?(.+?)\s+(?:field\s+)?(?:to|=|with)\s+(.+?)(?=\s+\b(?:and|then|click)\b|$)/gi;
  const assignmentText = identity
    ? normalizedPrompt.replace(/^.*?\b(?:INC|REQ|RITM|TASK|CHG)\d+\b\s*(?:and\s+)?/i, '')
    : normalizedPrompt;
  for (const match of assignmentText.matchAll(assignmentPattern)) {
    const field = unquote(match[1].replace(/\b(?:incident|request|user|task|change)\s+\b(?:INC|REQ|RITM|TASK|CHG)\d+\b/ig, '').trim());
    const normalizedField = field.replace(/^(?:and\s+)?(?:set|change|update)\s+/i, '').trim();
    const value = unquote(match[2]);
    if (normalizedField && value) fields.push({ field: normalizedField, value });
  }

  const clickTargets = [...normalizedPrompt.matchAll(
    /\bclick\s+(?:on\s+)?(.+?)(?=\s+\b(?:and|then)\s+(?:click|set|change|update|fill|enter|type)\b|$)/gi
  )]
    .map((match) => clickTargetFromLabel(unquote(match[1])))
    .filter(Boolean);

  const operation = intent === 'UpdateRecord' ? `Update${entity}` : intent;
  return { intent, operation, entity, identity, fields, clickTargets };
}

export function matchWorkflow(
  instruction: string,
  project: FrameworkProject
): WorkflowMatch {
  const defaultEntity = project.workflows[0]?.entity ?? 'record';
  const request = parseWorkflowRequest(instruction, defaultEntity);
  const entityWorkflows = project.workflows.filter((workflow) =>
    entityMatches(workflow.entity, request.entity)
  );
  const reusableWorkflows = project.workflows.filter((workflow) =>
    (entityMatches(workflow.entity, request.entity) && workflow.intent === request.intent) ||
    normalize(workflow.name) === normalize(request.operation)
  );

  const openWorkflows = request.intent === 'UpdateRecord'
    ? entityWorkflows.filter((workflow) => workflow.intent === 'OpenRecord')
    : [];
  const targetWorkflows = [...openWorkflows, ...reusableWorkflows];

  // Any workflow entirely BEFORE the target entity's own workflows, in the
  // session's original chronological order, is a navigation prerequisite
  // for reaching it -- login, search/filter to locate the record, module
  // navigation, whatever the real app actually requires -- and must always
  // be included, regardless of its own entity or intent. project.workflows
  // is already in first-appearance order (workflowGroups() pushes groups
  // in the order their boundary action was encountered), so this is just
  // "everything before the earliest target workflow's position".
  //
  // Root cause this replaces: entity-scoped reuse (reusableWorkflows/
  // openWorkflows above) only ever pulls in workflows whose OWN entity
  // matches the target ("Incident"); a Login workflow's entity never does,
  // and neither does a Search/filter workflow used only to locate the
  // record -- both were silently dropped from every reused spec. Confirmed
  // live, one gap at a time (hand-enumerating specific intents like
  // 'Login' as each one surfaced in a real Execute failure, then hitting
  // the exact same class of bug again for 'Search'): a fresh Execute run
  // supplies real credentials via Credential Manager, but without the
  // recorded login actions the session never authenticates at all; even
  // once login is included, skipping the search/filter steps means the
  // replay reaches the right app but never locates the specific record
  // before trying to click into it. Chronological-prerequisite inclusion
  // fixes the whole class at once instead of requiring a new special case
  // for every future missing step.
  const targetIndices = targetWorkflows
    .map((workflow) => project.workflows.indexOf(workflow))
    .filter((index) => index >= 0);
  const earliestTargetIndex = targetIndices.length > 0 ? Math.min(...targetIndices) : project.workflows.length;
  const prerequisiteWorkflows = project.workflows.slice(0, earliestTargetIndex);
  const allWorkflows = [...prerequisiteWorkflows, ...targetWorkflows];
  const capabilities = allWorkflows.flatMap((workflow) => workflow.capabilities);
  const matchedCapabilities = request.fields
    .filter(({ field }) => capabilities.some((capability) =>
      (capability.type === 'fill' || capability.type === 'select') &&
      normalize(capability.label ?? '') === normalize(field)
    ))
    .map(({ field }) => field);
  const matchedClickTargets = request.clickTargets.filter((target) =>
    capabilities.some((capability) =>
      capability.type === 'click' && normalize(capability.label ?? '') === normalize(target)
    )
  );
  const missingCapabilities = request.fields
    .filter(({ field }) => !matchedCapabilities.some((matched) => normalize(matched) === normalize(field)))
    .map(({ field }) => field);
  missingCapabilities.push(...request.clickTargets
    .filter((target) => !matchedClickTargets.some((matched) => normalize(matched) === normalize(target)))
    .map((target) => `Click ${target}`));
  const reusedActionIds = [...new Set(allWorkflows.flatMap((workflow) => workflow.actionIds))];

  const status: WorkflowMatchStatus = reusableWorkflows.length === 0
    ? 'NOT_MATCHED'
    : missingCapabilities.length > 0
      ? 'PARTIAL'
      : 'MATCHED';

  return {
    status,
    request,
    reusableWorkflows,
    missingCapabilities,
    matchedCapabilities,
    matchedClickTargets,
    reusedActionIds,
    prerequisiteActionIds: prerequisiteWorkflows.flatMap((workflow) => workflow.actionIds)
  };
}

function missingCapabilityInstruction(match: WorkflowMatch): string {
  const missingFields = match.request.fields
    .filter(({ field }) => !match.matchedCapabilities.some((matched) => normalize(matched) === normalize(field)))
    .map(({ field, value }) => `set ${field} to ${value}`);
  const missingClicks = match.request.clickTargets
    .filter((target) => !match.matchedClickTargets.some((matched) => normalize(matched) === normalize(target)))
    .map((target) => `click ${target}`);
  return [...missingFields, ...missingClicks].join(' and ');
}

function resolutionPageUrl(
  match: WorkflowMatch,
  project: FrameworkProject,
  fallbackUrl: string
): string {
  const actionIds = new Set(match.reusedActionIds);
  const formAction = [...project.recordedActions].reverse().find((action) =>
    actionIds.has(action.id) &&
    Boolean(action.url) &&
    (action.type === 'fill' || action.type === 'select') &&
    normalize(action.pageMetadata?.entity ?? action.pageMetadata?.module ?? '') === normalize(match.request.entity)
  );
  return formAction?.url ?? fallbackUrl;
}

export function getMatchAvailability(
  isLiveRecording: boolean,
  hasFrameworkContext: boolean,
  isFrameworkValidated: boolean
): MatchAvailability {
  if (isLiveRecording) {
    return {
      recordingActive: true,
      frameworkAvailable: hasFrameworkContext,
      frameworkValidated: isFrameworkValidated,
      canGenerate: false,
      reason: 'recording-active'
    };
  }
  if (!hasFrameworkContext) {
    return {
      recordingActive: false,
      frameworkAvailable: false,
      frameworkValidated: false,
      canGenerate: false,
      reason: 'framework-unavailable'
    };
  }
  if (!isFrameworkValidated) {
    return {
      recordingActive: false,
      frameworkAvailable: true,
      frameworkValidated: false,
      canGenerate: false,
      reason: 'framework-not-validated'
    };
  }
  return { recordingActive: false, frameworkAvailable: true, frameworkValidated: true, canGenerate: true };
}

function applyRequestedValues(
  action: RecordedAction,
  match: WorkflowMatch
): RecordedAction {
  const valueFor = match.request.fields.find(({ field }) =>
    normalize(field) === normalize(actionFieldLabel(action))
  );
  let next = valueFor
    ? {
        ...action,
        value: valueFor.value,
        codeLine: action.codeLine.replace(
          /(\.(?:fill|selectOption)\s*\()[\s\S]*?(\)\s*;?\s*$)/,
          (_match, callStart: string, callEnd: string) =>
            `${callStart}${JSON.stringify(valueFor.value)}${callEnd}`
        )
      }
    : { ...action };

  if (match.request.identity && next.identitySelector) {
    next = {
      ...next,
      identitySelector: next.identitySelector.replace(
        /\b(?:INC|REQ|RITM|TASK|CHG)\d+\b/i,
        match.request.identity
      )
    };
  }
  return next;
}

export async function resolveWorkflowRequest(
  instruction: string,
  targetUrl: string,
  project: FrameworkProject,
  dependencies: WorkflowResolutionDependencies
): Promise<WorkflowResolutionResult> {
  const match = matchWorkflow(instruction, project);
  const selectedIds = new Set(match.reusedActionIds);
  // A prerequisite workflow's own fill/select actions (a login password, a
  // search/filter textbox, ...) are part of navigating to the target
  // record, not optional field capabilities the user is choosing between
  // -- the requested-field filter below exists to drop an entity
  // workflow's OTHER field fills (e.g. Priority when only Urgency was
  // requested), and must not also strip prerequisite actions just because
  // their labels never match a requested field name.
  const prerequisiteActionIds = new Set(match.prerequisiteActionIds);
  const existingActions = project.recordedActions
    .filter((action) => selectedIds.has(action.id))
    .filter((action) => {
      if (action.type !== 'fill' && action.type !== 'select') return true;
      if (prerequisiteActionIds.has(action.id)) return true;
      const label = actionFieldLabel(action);
      return match.request.fields.some((field) => normalize(field.field) === normalize(label));
    })
    .map((action) => applyRequestedValues(action, match));

  const resolvedActions: RecordedAction[] = [];
  let unresolved: string[] = [];
  if (match.status !== 'MATCHED') {
    const resolutionSessionId = await dependencies.startResolutionSession(
      resolutionPageUrl(match, project, targetUrl)
    );
    try {
      const capabilityInstruction = match.reusableWorkflows.length > 0
        ? missingCapabilityInstruction(match)
        : instruction;
      const resolution = await dependencies.resolveIntent(
        resolutionSessionId,
        capabilityInstruction || instruction
      );
      const hasReusableOpen = existingActions.some((action) =>
        action.intent?.intent === 'OpenRecord' || Boolean(action.identitySelector)
      );
      resolvedActions.push(...resolution.actions
        .filter((action) => {
          if (hasReusableOpen && (action.intent?.intent === 'OpenRecord' || action.identitySelector)) {
            return false;
          }
          return !existingActions.some((existing) =>
            existing.type === action.type && normalize(existing.selector) === normalize(action.selector)
          );
        })
        .map((action) => ({
          ...action,
          intent: action.intent ?? {
            eventId: action.id,
            intent: match.request.intent,
            confidence: 1,
            signals: ['deterministic workflow matcher request']
          }
        })));
      unresolved = resolution.unresolved;
    } finally {
      await dependencies.closeResolutionSession(resolutionSessionId);
    }
  }

  const orderedExistingActions = [...existingActions]
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const leftSourceIndex = project.recordedActions.findIndex((source) => source.id === left.action.id);
      const rightSourceIndex = project.recordedActions.findIndex((source) => source.id === right.action.id);
      return leftSourceIndex - rightSourceIndex;
    })
    .map(({ action }) => action);
  // Any newly resolved field value belongs before whatever save/submit/
  // update click concludes the matched existing actions -- true regardless
  // of the REQUEST's own classified intent. Root cause this replaces: this
  // was gated on `match.request.intent === 'UpdateRecord'` only, so a
  // CreateRecord request (e.g. "Create an incident and set Urgency to 2")
  // against a reused create-then-submit journey appended the newly
  // resolved Urgency action AFTER the submit click instead of before it --
  // confirmed live, generating a test that submits the record first and
  // only tries to set Urgency afterward, on whatever page submission lands
  // on. The insertion point is a property of the matched journey's own
  // shape (does it end in a submit-like click), not of the request intent.
  const submitIndex = orderedExistingActions.findIndex((action) =>
    action.type === 'click' && /\b(?:save|submit|update)\b/i.test(action.selector));

  // A reused workflow's own actionIds never include the session's initial
  // navigation -- that action is always grouped into whichever workflow
  // comes first in the recording (typically login), a different entity
  // that reuse never pulls in. Without it, generateOptimizedSpec has
  // nothing to derive a page.goto() from (it never synthesizes one; it
  // only ever emits the goto already present in a navigation action) and
  // the generated spec starts interacting with a page that was never
  // opened. Confirmed live: a MATCHED real-ServiceNow case executed
  // straight into `page.frameLocator('#gsft_main')...` with no preceding
  // navigation at all.
  const initialNavigation = project.recordedActions[0];
  const needsInitialNavigation = initialNavigation?.type === 'navigation' && !selectedIds.has(initialNavigation.id);

  const mergedActions: RecordedAction[] = [];
  if (needsInitialNavigation) mergedActions.push(initialNavigation);
  mergedActions.push(...orderedExistingActions);
  if (submitIndex >= 0) {
    mergedActions.splice((needsInitialNavigation ? 1 : 0) + submitIndex, 0, ...resolvedActions);
  } else {
    mergedActions.push(...resolvedActions);
  }

  const capabilityResults: WorkflowCapabilityResult[] = [
    ...match.request.fields.map(({ field, value }) => {
      if (match.matchedCapabilities.some((matched) => normalize(matched) === normalize(field))) {
        return { kind: 'field' as const, label: field, value, status: 'matched' as const };
      }
      const wasResolved = resolvedActions.some((action) =>
        (action.type === 'fill' || action.type === 'select') &&
        normalize(actionFieldLabel(action)) === normalize(field)
      );
      return {
        kind: 'field' as const,
        label: field,
        value,
        status: wasResolved ? 'resolved' as const : 'not-resolved' as const
      };
    }),
    ...match.request.clickTargets.map((target) => {
      if (match.matchedClickTargets.some((matched) => normalize(matched) === normalize(target))) {
        return { kind: 'click' as const, label: target, status: 'matched' as const };
      }
      const wasResolved = resolvedActions.some((action) =>
        action.type === 'click' && normalize(actionClickLabel(action)) === normalize(target)
      );
      return {
        kind: 'click' as const,
        label: target,
        status: wasResolved ? 'resolved' as const : 'not-resolved' as const
      };
    })
  ];

  const optimizedActions = dependencies.optimize(mergedActions);
  const generatedSpec = optimizedActions.length > 0
    ? dependencies.generateSpec(optimizedActions, targetUrl)
    : null;
  const generatedProject = optimizedActions.length > 0
    ? dependencies.generateFramework(mergedActions, optimizedActions, targetUrl)
    : null;

  return {
    match,
    resolvedActions,
    unresolved,
    capabilityResults,
    mergedActions,
    optimizedActions,
    generatedSpec,
    generatedProject
  };
}
