import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import * as esbuild from 'esbuild';
import type { RecordedAction } from '../types';
import type { OptimizedAction } from './optimizer/types';
import type { RecordedBrowserEvent } from '../../recorder/types';
import { optimizeRecordedActions, generateOptimizedSpec } from './optimizerService';
import { generateFrameworkProject, type FrameworkProject } from './frameworkGenerator';
import {
  formatCapabilityResult,
  getMatchAvailability,
  matchWorkflow,
  parseWorkflowRequest,
  resolveWorkflowRequest,
  type WorkflowResolutionDependencies
} from './workflowMatcher';

// Phase 2 end-to-end: a REAL recording (real Smart Recorder intent
// classification, driven by real Playwright actions on a real page) ->
// real stopSession() -> the real generateFrameworkProject() -> the real
// Workflow Matcher deciding whether a brand-new free-text test case can
// reuse what was just recorded, falling back to a real resolution session
// (Phase 1) for whatever is missing. No mocks anywhere in this chain --
// matches this project's established testing convention (real browser,
// real engine, no reimplementation of the thing under test).
//
// engine.ts is imported from an esbuild bundle, not raw tsx, for the same
// reason resolveIntent.test.ts does: tsx's on-the-fly transform omits the
// __name helper esbuild injects for class methods passed into
// page.evaluate() (extractBrowserFacts) -- production never hits this
// because the recorder always ships as the esbuild-bundled
// recorder/dist/cli.js.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, '..', '..', 'recorder', 'dist', 'test-engine-bundle-workflow.mjs');
let recordingEngine: typeof import('../../recorder/engine')['recordingEngine'];

before(async () => {
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', '..', 'recorder', 'engine.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    packages: 'external'
  });
  ({ recordingEngine } = await import(`${bundlePath}?t=${Date.now()}`));
});

after(async () => {
  await rm(bundlePath, { force: true });
});

const TEST_HTML = `<!DOCTYPE html><html><body>
  <h1>Incident INC0012345</h1>
  <label for="priority-select">Priority</label>
  <select id="priority-select">
    <option value="1">1 - Critical</option>
    <option value="2">2 - High</option>
    <option value="3">3 - Moderate</option>
  </select>
  <label for="urgency-select">Urgency</label>
  <select id="urgency-select">
    <option value="1">1 - High</option>
    <option value="2">2 - Medium</option>
    <option value="3">3 - Low</option>
  </select>
  <label for="notes">Notes</label>
  <input id="notes" type="text" />
  <button>Update</button>
  <button>Save</button>
</body></html>`;

test('parses UpdateRecord, entity, identity, and field/value deterministically', () => {
  assert.deepEqual(
    parseWorkflowRequest('Update incident INC0010021 and set Urgency to 2'),
    {
      intent: 'UpdateRecord',
      operation: 'UpdateIncident',
      entity: 'Incident',
      identity: 'INC0010021',
      fields: [{ field: 'Urgency', value: '2' }],
      clickTargets: []
    }
  );
});

test('does not treat Change in an entity name as an update action', () => {
  assert.deepEqual(parseWorkflowRequest('Open change request CHG12345'), {
    intent: 'OpenRecord',
    operation: 'OpenRecord',
    entity: 'Change',
    identity: 'CHG12345',
    fields: [],
    clickTargets: []
  });
});

test('reuses Create/Open/Update workflows and resolves only Urgency for a compound request', async () => {
  const instruction = 'Open the last created incident and change Urgency to 2 - Medium, then click Update';
  const project = matcherFixture(false);
  project.workflows.unshift(
    {
      name: 'createIncident',
      intent: 'CreateRecord',
      entity: 'Incident',
      actionIds: ['create-incident'],
      capabilities: []
    },
    {
      name: 'openIncident',
      intent: 'OpenRecord',
      entity: 'Incident',
      actionIds: ['open-incident'],
      capabilities: []
    }
  );

  const match = matchWorkflow(instruction, project);

  assert.equal(match.request.intent, 'UpdateRecord');
  assert.equal(match.request.operation, 'UpdateIncident');
  assert.deepEqual(match.request.fields, [{ field: 'Urgency', value: '2 - Medium' }]);
  assert.deepEqual(match.request.clickTargets, ['Update']);
  assert.equal(match.status, 'PARTIAL');
  assert.ok(match.reusableWorkflows.some((workflow) => workflow.name === 'updateIncident'));
  assert.deepEqual(match.matchedClickTargets, ['Update']);
  assert.deepEqual(match.missingCapabilities, ['Urgency']);
  assert.deepEqual(match.reusedActionIds.slice(0, 2), ['create-incident', 'open-incident']);

  let resolutionInstruction = '';
  const resolution = await resolveWorkflowRequest(
    instruction,
    'https://example.test/incidents',
    project,
    {
      ...matcherDependencies(async (_sessionId, request) => {
        resolutionInstruction = request;
        return {
          actions: [{
            id: 'resolved-urgency',
            type: 'select',
            selector: "page.getByLabel('Urgency')",
            value: '2 - Medium',
            timestamp: '00:03.00',
            codeLine: "await page.getByLabel('Urgency').selectOption('2');",
            smartLocator: { strategy: 'label', tag: 'select', label: 'Urgency' }
          }],
          unresolved: []
        };
      }),
      startResolutionSession: async () => 'fresh-resolution-session'
    }
  );

  assert.equal(resolutionInstruction, 'set Urgency to 2 - Medium');
  assert.equal(resolution.capabilityResults.find((capability) => capability.kind === 'click')?.status, 'matched');
  assert.equal(resolution.capabilityResults.find((capability) => capability.label === 'Urgency')?.status, 'resolved');
  assert.ok(resolution.mergedActions.some((action) => action.id === 'update'));
  assert.ok(resolution.mergedActions.some((action) => action.id === 'resolved-urgency'));
});

test('matches Update incident with Priority as the UpdateIncident workflow', () => {
  const match = matchWorkflow(
    'Update incident INC0010021 and set Priority to 1',
    matcherFixture(false)
  );

  assert.equal(match.request.intent, 'UpdateRecord');
  assert.equal(match.request.operation, 'UpdateIncident');
  assert.equal(match.request.entity, 'Incident');
  assert.equal(match.request.identity, 'INC0010021');
  assert.equal(match.status, 'MATCHED');
  assert.deepEqual(match.matchedCapabilities, ['Priority']);
  assert.ok(match.reusableWorkflows.some((workflow) => workflow.name === 'updateIncident'));
});

test('matches UpdateIncident by workflow operation name when the recorded intent metadata is unavailable', () => {
  const project = matcherFixture(false);
  project.workflows[0].intent = 'Unknown';
  project.workflows[0].entity = 'Incident Form';

  const match = matchWorkflow(
    'Update incident INC0010021 and set Urgency to 2',
    project
  );

  assert.equal(match.status, 'PARTIAL');
  assert.ok(match.reusableWorkflows.some((workflow) => workflow.name === 'updateIncident'));
  assert.deepEqual(match.missingCapabilities, ['Urgency']);
});

test('matches Urgency as a parameterized field capability on the UpdateIncident workflow', () => {
  const match = matchWorkflow(
    'Update incident INC0010021 and set Urgency to 2',
    matcherFixture(false, 'Urgency')
  );

  assert.equal(match.status, 'MATCHED');
  assert.equal(match.request.entity, 'Incident');
  assert.equal(match.request.identity, 'INC0010021');
  assert.deepEqual(match.request.fields, [{ field: 'Urgency', value: '2' }]);
  assert.deepEqual(match.matchedCapabilities, ['Urgency']);
  assert.ok(match.reusableWorkflows.some((workflow) => workflow.name === 'updateIncident'));
});

test('reuses and parameterizes an existing Urgency action with the requested value', async () => {
  let resolutionStarted = false;
  const result = await resolveWorkflowRequest(
    'Update incident INC0010021 and set Urgency to 1',
    'https://example.test/',
    matcherFixture(false, 'Urgency'),
    {
      ...matcherDependencies(async () => {
        resolutionStarted = true;
        return { actions: [], unresolved: [] };
      }),
      startResolutionSession: async () => {
        resolutionStarted = true;
        return 'unexpected-resolution-session';
      }
    }
  );

  assert.equal(result.match.status, 'MATCHED');
  assert.equal(resolutionStarted, false);
  assert.equal(result.mergedActions.find((action) => action.id === 'urgency')?.value, '1');
});

test('a MATCHED reuse still includes the session\'s initial navigation, even though it belongs to a different (login) workflow', async () => {
  const project = matcherFixture(false, 'Urgency');
  const navAction: RecordedAction = {
    id: 'nav_init',
    type: 'navigation',
    selector: 'page',
    timestamp: '00:00.00',
    codeLine: "await page.goto('https://example.test/');",
    url: 'https://example.test/'
  };
  // nav_init deliberately does NOT appear in the "updateIncident" workflow's
  // actionIds -- real Framework Generator output groups the initial
  // navigation into the session's first (e.g. login) workflow, a different
  // entity reuse never pulls in.
  project.recordedActions = [navAction, ...project.recordedActions];

  const result = await resolveWorkflowRequest(
    'Update incident INC0010021 and set Urgency to 1',
    'https://example.test/',
    project,
    matcherDependencies(async () => ({ actions: [], unresolved: [] }))
  );

  assert.equal(result.match.status, 'MATCHED');
  assert.equal(result.mergedActions[0]?.id, 'nav_init');
  assert.ok(result.generatedSpec?.includes('goto('), result.generatedSpec ?? 'null');
});

test('a reused workflow always includes the session\'s Login actions, even though Login is a different entity', async () => {
  const project = matcherFixture(false, 'Urgency');
  const loginActions: RecordedAction[] = [
    {
      id: 'login_username',
      type: 'fill',
      selector: "page.getByLabel('User name')",
      value: 'admin',
      timestamp: '00:00.10',
      codeLine: "await page.getByLabel('User name').fill(process.env.APP_USERNAME!);",
      smartLocator: { strategy: 'label', tag: 'input', label: 'User name' },
      variableName: 'APP_USERNAME',
      intent: { eventId: 'login_username', intent: 'Unknown', confidence: 0, signals: [] }
    },
    {
      id: 'login_password',
      type: 'fill',
      selector: "page.getByLabel('Password')",
      value: 'secret',
      timestamp: '00:00.20',
      codeLine: "await page.getByLabel('Password').fill(process.env.APP_PASSWORD!);",
      smartLocator: { strategy: 'label', tag: 'input', label: 'Password' },
      isSensitive: true,
      variableName: 'APP_PASSWORD',
      intent: { eventId: 'login_password', intent: 'Unknown', confidence: 0, signals: [] }
    },
    {
      id: 'login_click',
      type: 'click',
      selector: "page.getByRole('button', { name: 'Log in' })",
      timestamp: '00:00.30',
      codeLine: "await page.getByRole('button', { name: 'Log in' }).click();",
      intent: { eventId: 'login_click', intent: 'Login', confidence: 1, signals: [] }
    }
  ];
  // Login's own workflow entity is never "Incident" -- that's the whole
  // point of this test -- so it must never be found via entity-scoped
  // reuse (reusableWorkflows/openWorkflows), only via the unconditional
  // loginWorkflows inclusion.
  project.recordedActions = [...loginActions, ...project.recordedActions];
  project.workflows = [
    {
      name: 'login',
      intent: 'Login',
      entity: 'Session',
      actionIds: loginActions.map((action) => action.id),
      capabilities: []
    },
    ...project.workflows
  ];

  const result = await resolveWorkflowRequest(
    'Update incident INC0010021 and set Urgency to 1',
    'https://example.test/',
    project,
    matcherDependencies(async () => ({ actions: [], unresolved: [] }))
  );

  assert.equal(result.match.status, 'MATCHED');
  assert.ok(result.mergedActions.some((action) => action.id === 'login_username'));
  assert.ok(result.mergedActions.some((action) => action.id === 'login_password'));
  assert.ok(result.mergedActions.some((action) => action.id === 'login_click'));
  assert.ok(result.generatedSpec?.includes('APP_USERNAME'), result.generatedSpec ?? 'null');
  assert.ok(result.generatedSpec?.includes('APP_PASSWORD'), result.generatedSpec ?? 'null');
});

test('a newly resolved field is inserted before the submit click even when the request is classified CreateRecord, not UpdateRecord', async () => {
  // Root-cause regression: resolveWorkflowRequest's submit-click insertion
  // point used to be computed only `if (match.request.intent ===
  // 'UpdateRecord')`, falling back to appending newly resolved actions at
  // the very end otherwise. Confirmed live against a real ServiceNow
  // Create Incident recording: "Create an incident and set Urgency to 2"
  // appended the resolved Urgency select AFTER the Submit click, producing
  // a test that submits the record first and only tries to set Urgency
  // afterward. The insertion point is a property of the matched journey's
  // own shape (does it end in a submit-like click), not of the request's
  // own classified intent -- this covers any non-UpdateRecord intent
  // (CreateRecord here) reusing a submit-terminated journey.
  const project: FrameworkProject = {
    files: {},
    metadata: {
      generatedFileCount: 0,
      pageObjectCount: 0,
      workflowFunctionCount: 1,
      testCount: 0,
      testDataFileCount: 0,
      fixtureCount: 0,
      files: []
    },
    recordedActions: [
      {
        id: 'short-description',
        type: 'fill',
        selector: "page.getByLabel('Short description')",
        value: 'Printer broken',
        timestamp: '00:01.00',
        codeLine: "await page.getByLabel('Short description').fill('Printer broken');",
        smartLocator: { strategy: 'label', tag: 'input', label: 'Short description' },
        intent: { eventId: 'short-description', intent: 'Unknown', confidence: 0, signals: [] }
      },
      {
        id: 'submit-click',
        type: 'click',
        selector: "page.getByRole('button', { name: 'Submit' })",
        timestamp: '00:02.00',
        codeLine: "await page.getByRole('button', { name: 'Submit' }).click();",
        intent: { eventId: 'submit-click', intent: 'SubmitRecord', confidence: 1, signals: [] }
      }
    ],
    actions: [],
    workflows: [
      {
        name: 'submitIncident',
        intent: 'SubmitRecord',
        entity: 'Incident',
        actionIds: ['short-description', 'submit-click'],
        capabilities: [{ actionId: 'short-description', type: 'fill', label: 'Short description', identity: false }]
      }
    ]
  };

  const result = await resolveWorkflowRequest(
    'Create an incident and set Urgency to 2',
    'https://example.test/',
    project,
    matcherDependencies(async () => ({
      actions: [{
        id: 'urgency',
        type: 'select',
        selector: "page.getByLabel('Urgency')",
        value: '2',
        timestamp: '00:00.50',
        codeLine: "await page.getByLabel('Urgency').selectOption('2');",
        smartLocator: { strategy: 'label', tag: 'select', label: 'Urgency' }
      }],
      unresolved: []
    }))
  );

  assert.equal(result.match.status, 'NOT_MATCHED');
  const ids = result.mergedActions.map((action) => action.id);
  assert.ok(ids.includes('urgency'), ids.join(', '));
  assert.ok(
    ids.indexOf('urgency') < ids.indexOf('submit-click'),
    `expected urgency before submit-click, got order: ${ids.join(', ')}`
  );
});

test('resolves only an uncovered field clause while reusing the UpdateIncident workflow', async () => {
  let resolverInstruction = '';
  let resolutionStarted = false;
  const result = await resolveWorkflowRequest(
    'Update incident INC0010021 and set Urgency to 2',
    'https://example.test/',
    matcherFixture(false),
    {
      ...matcherDependencies(async (_sessionId, instruction) => {
        resolverInstruction = instruction;
        return {
          actions: [{
            id: 'resolved-urgency',
            type: 'select',
            selector: "page.getByLabel('Urgency')",
            value: '2',
            timestamp: '00:03.00',
            codeLine: "await page.getByLabel('Urgency').selectOption('2');",
            smartLocator: { strategy: 'label', tag: 'select', label: 'Urgency' }
          }],
          unresolved: []
        };
      }),
      startResolutionSession: async () => {
        resolutionStarted = true;
        return 'resolution-session';
      }
    }
  );

  assert.equal(result.match.status, 'PARTIAL');
  assert.ok(result.match.reusableWorkflows.some((workflow) => workflow.name === 'updateIncident'));
  assert.equal(resolverInstruction, 'set Urgency to 2');
  assert.deepEqual(result.unresolved, []);
  assert.ok(result.mergedActions.some((action) => action.id === 'update'));
  assert.ok(result.mergedActions.some((action) => action.id === 'resolved-urgency'));
  assert.deepEqual(result.capabilityResults, [
    { kind: 'field', label: 'Urgency', value: '2', status: 'resolved' }
  ]);
  assert.equal(resolutionStarted, true);
});

test('keeps a genuinely unsupported Incident field unresolved', async () => {
  let resolverInstruction = '';
  const result = await resolveWorkflowRequest(
    'Update incident INC0010021 and set Category to 2',
    'https://example.test/',
    matcherFixture(false),
    matcherDependencies(async (_sessionId, instruction) => {
      resolverInstruction = instruction;
      return { actions: [], unresolved: ['set Category to 2'] };
    })
  );

  assert.equal(resolverInstruction, 'set Category to 2');
  assert.equal(result.match.status, 'PARTIAL');
  assert.deepEqual(result.match.missingCapabilities, ['Category']);
  assert.deepEqual(result.unresolved, ['set Category to 2']);
  assert.deepEqual(result.capabilityResults, [
    { kind: 'field', label: 'Category', value: '2', status: 'not-resolved' }
  ]);
});

test('blocks active recording and allows stopped sessions only when framework context exists', () => {
  assert.equal(getMatchAvailability(true, true, true).canGenerate, false);
  assert.equal(getMatchAvailability(false, true, true).canGenerate, true);
  assert.equal(getMatchAvailability(false, false, false).reason, 'framework-unavailable');
});

test('blocks AI Test Generation until the generated framework has passed Validate Framework', () => {
  assert.equal(getMatchAvailability(false, true, false).canGenerate, false);
  assert.equal(getMatchAvailability(false, true, false).reason, 'framework-not-validated');
  assert.equal(getMatchAvailability(false, true, true).canGenerate, true);
});

test('reports NOT_MATCHED when the framework has no workflow for the requested operation', () => {
  const project: FrameworkProject = {
    files: {},
    metadata: {
      generatedFileCount: 0,
      pageObjectCount: 0,
      workflowFunctionCount: 0,
      testCount: 0,
      testDataFileCount: 0,
      fixtureCount: 0,
      files: []
    },
    recordedActions: [],
    actions: [],
    workflows: [{
      name: 'updateIncident',
      intent: 'UpdateRecord',
      entity: 'Incident',
      actionIds: [],
      capabilities: []
    }]
  };
  assert.equal(matchWorkflow('Create user', project).status, 'NOT_MATCHED');
});

function matcherFixture(includeSave: boolean, fieldLabel = 'Priority'): FrameworkProject {
  const fieldId = fieldLabel.toLowerCase();
  const recordedActions: RecordedAction[] = [
    {
      id: fieldId,
      type: 'select',
      selector: `page.getByLabel('${fieldLabel}')`,
      value: '2',
      timestamp: '00:01.00',
      codeLine: `await page.getByLabel('${fieldLabel}').selectOption('2');`,
      smartLocator: { strategy: 'label', tag: 'select', label: fieldLabel },
      intent: { eventId: fieldId, intent: 'UpdateRecord', confidence: 1, signals: [] }
    },
    {
      id: 'update',
      type: 'click',
      selector: "page.getByRole('button', { name: 'Update' })",
      timestamp: '00:02.00',
      codeLine: "await page.getByRole('button', { name: 'Update' }).click();",
      intent: { eventId: 'update', intent: 'UpdateRecord', confidence: 1, signals: [] }
    },
    ...(includeSave ? [{
      id: 'save',
      type: 'click' as const,
      selector: "page.getByRole('button', { name: 'Save' })",
      timestamp: '00:03.00',
      codeLine: "await page.getByRole('button', { name: 'Save' }).click();",
      intent: { eventId: 'save', intent: 'UpdateRecord', confidence: 1, signals: [] }
    }] : [])
  ];
  const actionIds = recordedActions.map((action) => action.id);
  return {
    files: {},
    metadata: {
      generatedFileCount: 0,
      pageObjectCount: 0,
      workflowFunctionCount: 1,
      testCount: 0,
      testDataFileCount: 0,
      fixtureCount: 0,
      files: []
    },
    recordedActions,
    actions: [],
    workflows: [{
      name: 'updateIncident',
      intent: 'UpdateRecord',
      entity: 'Incident',
      actionIds,
      capabilities: recordedActions.map((action) => ({
        actionId: action.id,
        type: action.type,
        label: action.id === fieldId ? fieldLabel : action.id === 'save' ? 'Save' : 'Update',
        identity: false
      }))
    }]
  };
}

function matcherDependencies(
  resolveIntent: WorkflowResolutionDependencies['resolveIntent']
): WorkflowResolutionDependencies {
  return {
    startResolutionSession: async () => 'resolution-session',
    resolveIntent,
    closeResolutionSession: async () => {},
    optimize: (actions) => actions.map((action) => ({
      ...action,
      tabIndex: 0,
      locatorQuality: 'semantic',
      mergedFromCount: 1,
      warnings: []
    })),
    generateSpec: (actions) => actions.map((action) => action.codeLine).join('\n'),
    generateFramework: (recordedActions) => ({
      ...matcherFixture(false),
      recordedActions
    })
  };
}

test('matches a requested click target already covered by the reusable workflow', () => {
  const match = matchWorkflow(
    'Update incident INC0010021 and click Save',
    matcherFixture(true)
  );
  assert.equal(match.status, 'MATCHED', JSON.stringify({
    request: match.request,
    matchedClickTargets: match.matchedClickTargets,
    workflows: match.reusableWorkflows
  }));
  assert.ok(match.reusableWorkflows.some((workflow) => workflow.name === 'updateIncident'));
  assert.deepEqual(match.matchedClickTargets, ['Save']);
  assert.deepEqual(match.missingCapabilities, []);
});

test('marks an uncovered requested click target as a partial workflow match', () => {
  const match = matchWorkflow(
    'Update incident INC0010021 and click Save',
    matcherFixture(false)
  );
  assert.equal(match.status, 'PARTIAL');
  assert.deepEqual(match.missingCapabilities, ['Click Save']);
});

test('resolves and merges a missing click target through the resolution session', async () => {
  const server = await startTestServer();
  let resolutionSessionId: string | undefined;
  try {
    const result = await resolveWorkflowRequest(
      'Update incident INC0010021 and click Save',
      server.url,
      matcherFixture(false),
      {
        ...matcherDependencies(async (sessionId, instruction) => {
          const resolved = await recordingEngine.resolveIntent(sessionId, instruction);
          return {
            actions: frameworkActionsFromResolution(resolved.actions),
            unresolved: resolved.unresolved
          };
        }),
        startResolutionSession: async (targetUrl) => {
          resolutionSessionId = await recordingEngine.startResolutionSession(targetUrl, true);
          return resolutionSessionId;
        },
        closeResolutionSession: async (sessionId) => {
          await recordingEngine.closeResolutionSession(sessionId);
        }
      }
    );

    assert.ok(resolutionSessionId);
    assert.equal(result.capabilityResults.find((capability) => capability.kind === 'click')?.status, 'resolved');
    assert.ok(result.resolvedActions.some((action) =>
      action.type === 'click' && action.selector.includes("name: 'Save'")
    ));
    assert.ok(result.mergedActions.some((action) =>
      action.type === 'click' && action.selector.includes("name: 'Save'")
    ));
    assert.match(result.generatedSpec ?? '', /name: 'Save'/);
  } finally {
    if (resolutionSessionId) await recordingEngine.closeResolutionSession(resolutionSessionId);
    await server.close();
  }
});

test('reports a missing click target explicitly when live resolution cannot resolve it', async () => {
  const result = await resolveWorkflowRequest(
    'Update incident INC0010021 and click Save',
    'https://example.test/',
    matcherFixture(false),
    matcherDependencies(async () => ({ actions: [], unresolved: ['Click Save'] }))
  );

  const clickResult = result.capabilityResults.find((capability) => capability.kind === 'click');
  assert.deepEqual(clickResult, {
    kind: 'click',
    label: 'Save',
    status: 'not-resolved'
  });
  assert.equal(formatCapabilityResult(clickResult!), 'Missing capability: Click Save — Not resolved');
});

test('tracks every field and click capability in a mixed request through the final result', async () => {
  const result = await resolveWorkflowRequest(
    'Update incident INC0010021 and set Priority to 1 and click Save',
    'https://example.test/',
    matcherFixture(false),
    matcherDependencies(async () => ({
      actions: [{
        id: 'resolved-save',
        type: 'click',
        selector: "page.getByRole('button', { name: 'Save' })",
        timestamp: '00:03.00',
        codeLine: "await page.getByRole('button', { name: 'Save' }).click();"
      }],
      unresolved: []
    }))
  );

  assert.deepEqual(result.match.request.fields, [{ field: 'Priority', value: '1' }]);
  assert.deepEqual(result.match.request.clickTargets, ['Save']);
  assert.deepEqual(result.capabilityResults, [
    { kind: 'field', label: 'Priority', value: '1', status: 'matched' },
    { kind: 'click', label: 'Save', status: 'resolved' }
  ]);
  assert.ok(result.mergedActions.some((action) => action.id === 'priority' && action.value === '1'));
  assert.ok(result.mergedActions.some((action) => action.id === 'resolved-save'));
  assert.equal(
    result.capabilityResults.length,
    result.match.request.fields.length + result.match.request.clickTargets.length
  );
});

test('retains mixed field and click clauses when the click is stated first', () => {
  const request = parseWorkflowRequest(
    'Update incident INC0010021 and click Save and set Priority to 1'
  );
  assert.deepEqual(request.clickTargets, ['Save']);
  assert.deepEqual(request.fields, [{ field: 'Priority', value: '1' }]);
});

async function startTestServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TEST_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function startTestServerWithoutUrgency(): Promise<{ url: string; close: () => Promise<void> }> {
  const html = `<!DOCTYPE html><html><body>
    <label for="priority-select">Priority</label>
    <select id="priority-select"><option value="1">1</option></select>
    <label for="notes">Notes</label>
    <input id="notes" type="text" />
    <button>Update</button>
  </body></html>`;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server without Urgency');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function startAuthenticatedIncidentServer(): Promise<{
  url: string;
  formUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    const isAuthenticated = req.headers.cookie?.includes('servicenow-auth=authenticated');
    res.writeHead(isAuthenticated ? 200 : 401, { 'Content-Type': 'text/html' });
    res.end(isAuthenticated
      ? TEST_HTML
      : '<!DOCTYPE html><html><body><h1>Login</h1><input aria-label="User name"><input type="password" aria-label="Password"></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind authenticated test server');
  const url = `http://127.0.0.1:${address.port}/`;
  return {
    url,
    formUrl: `${url}incident.do`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function startServiceNowClassicServer(): Promise<{
  url: string;
  formUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (pathname === '/nav_to.do') {
      res.end(`<!DOCTYPE html><html><head><meta name="application-name" content="ServiceNow"></head><body>
        <iframe id="gsft_main" src="/frame-shell.do"></iframe>
      </body></html>`);
    } else if (pathname === '/frame-shell.do') {
      res.end(`<!DOCTYPE html><html><body>
        <script>location.replace('/incident.do?sys_id=record-1&sysparm_record_target=incident')</script>
      </body></html>`);
    } else if (pathname === '/incident.do') {
      res.end(`<!DOCTYPE html><html><head><meta name="application-name" content="ServiceNow"></head><body role="application">
        <macroponent-record-form></macroponent-record-form>
        <label for="priority">Priority</label>
        <select id="priority"><option value="1">1 - Critical</option><option value="2">2 - High</option></select>
        <label for="urgency">Urgency</label>
        <select id="urgency"><option value="1">1 - High</option><option value="2">2 - Medium</option></select>
        <button>Update</button>
      </body></html>`);
    } else {
      res.end(`<!DOCTYPE html><html><head><meta name="application-name" content="ServiceNow"></head><body>
        <macroponent-shell></macroponent-shell><iframe id="gsft_main" src="about:blank"></iframe>
        <table role="grid"><tr><td><a href="/nav_to.do">Open incident</a></td></tr></table>
      </body></html>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind ServiceNow test server');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    formUrl: `${url}/incident.do?sys_id=record-1&sysparm_record_target=incident`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

/** Drives REAL Playwright actions on the recording session's own live
 * page -- the browser-injected script's own click/select listeners detect
 * these exactly as they would a human's, emitting real captured events
 * (including real Smart Recorder intent classification) through the same
 * exposeBinding a human interaction would trigger. */
async function recordRealUpdateWorkflow(targetUrl: string): Promise<{ sessionId: string; recordedActions: RecordedAction[] }> {
  const sessionId: string = await recordingEngine.startSession(targetUrl, true);
  const page = recordingEngine.getPage(sessionId)!;

  await page.locator('#priority-select').selectOption('2');
  // Intent classifier matches /\bupdate\b/ in the clicked element's own
  // text -- "Update", not "Save" -- see recorder/smart-recorder/intentClassifier.ts.
  await page.getByRole('button', { name: 'Update' }).click();

  await recordingEngine.stopSession(sessionId);
  const recordedActions = recordingEngine.getEvents(sessionId) as unknown as RecordedAction[];
  return { sessionId, recordedActions };
}

function frameworkActionsFromResolution(actions: RecordedBrowserEvent[]): RecordedAction[] {
  return actions.map((action) => {
    if (action.type === 'check' || action.type === 'upload') {
      throw new Error(`The framework generator does not support resolved "${action.type}" actions.`);
    }
    return {
      ...action,
      type: action.type,
      applicationMetadata: action.applicationMetadata
        ? { ...action.applicationMetadata, signals: [...action.applicationMetadata.signals] }
        : undefined,
      pageMetadata: action.pageMetadata
        ? { ...action.pageMetadata, signals: [...action.pageMetadata.signals] }
        : undefined,
      frameMetadata: action.frameMetadata
        ? {
            ...action.frameMetadata,
            framePath: [...action.frameMetadata.framePath],
            signals: [...action.frameMetadata.signals]
          }
        : undefined,
      intent: action.intent
        ? { ...action.intent, signals: [...action.intent.signals] }
        : undefined
    };
  });
}

test('a real recorded Update workflow is classified with real Smart Recorder intent and reused by the Workflow Matcher (MATCHED)', async () => {
  const server = await startTestServer();
  try {
    const { recordedActions } = await recordRealUpdateWorkflow(server.url);

    // Sanity: this is a REAL recording, not a fabricated fixture -- the
    // Update click really was classified as UpdateRecord by the actual
    // Smart Recorder, the same classifier that runs during live recording.
    const updateEvent = recordedActions.find((a) => a.type === 'click');
    assert.equal(updateEvent?.intent?.intent, 'UpdateRecord');
    const selectEvent = recordedActions.find((a) => a.type === 'select');
    assert.match(selectEvent?.codeLine ?? '', /getByLabel\('Priority'\)\.selectOption\('2'\)/);

    const optimizedActions = optimizeRecordedActions(recordedActions);
    const project = generateFrameworkProject(recordedActions, optimizedActions, server.url);

    // The real Framework Generator produced a real, semantically-named
    // workflow from this real recording.
    assert.ok(project.workflows.some((w) => w.intent === 'UpdateRecord'));

    const match = matchWorkflow('Change Priority to 1 and click Update', project);
    assert.equal(match.status, 'MATCHED', JSON.stringify({
      request: match.request,
      matchedClickTargets: match.matchedClickTargets,
      workflows: project.workflows
    }));
    assert.ok(match.reusableWorkflows.length > 0);
    assert.deepEqual(match.missingCapabilities, []);

    // No resolution browser is needed at all for a fully MATCHED request --
    // dependencies that would open one must never be called.
    const result = await resolveWorkflowRequest(
      'Change Priority to 1 and click Update',
      server.url,
      project,
      {
        startResolutionSession: async () => { throw new Error('must not open a resolution session for a MATCHED request'); },
        resolveIntent: async () => { throw new Error('must not call resolveIntent for a MATCHED request'); },
        closeResolutionSession: async () => { throw new Error('must not close a resolution session that was never opened'); },
        optimize: optimizeRecordedActions,
        generateSpec: generateOptimizedSpec,
        generateFramework: generateFrameworkProject
      }
    );

    assert.equal(result.match.status, 'MATCHED');
    assert.ok(result.generatedSpec, 'expected a generated spec for the reused workflow');
    assert.equal(result.mergedActions.find((action) => action.type === 'select')?.value, '1', JSON.stringify({
      fields: result.match.request.fields,
      actions: result.mergedActions
    }));
    // The reused action's value was re-parameterized to the NEW request's
    // value (1), not the originally recorded value (2).
    assert.match(result.generatedSpec!, /selectOption\(["']1["']\)/);
    assert.doesNotMatch(result.generatedSpec!, /selectOption\('2'\)/);
    assert.ok(result.generatedProject);
    assert.match(result.generatedProject!.files['test-data/workflow.json'], /"priority": "1"/);
    assert.doesNotMatch(
      Object.entries(result.generatedProject!.files)
        .filter(([filePath]) => filePath.startsWith('pages/'))
        .map(([, content]) => content)
        .join('\n'),
      /selectOption\(["']1["']\)/
    );
    assert.doesNotMatch(result.generatedProject!.files['utils/workflows.ts'], /selectOption\(["']1["']\)/);
  } finally {
    await server.close();
  }
});

test('a fresh resolution browser restores stopped-session authentication and merges live Urgency=2', async () => {
  const server = await startAuthenticatedIncidentServer();
  let recordingSessionId: string | undefined;
  let resolutionSessionId: string | undefined;
  try {
    const targetUrl = `${server.url}incidents`;
    recordingSessionId = await recordingEngine.startSession(targetUrl, true);
    const recordingPage = recordingEngine.getPage(recordingSessionId)!;
    await recordingPage.context().addCookies([{
      name: 'servicenow-auth',
      value: 'authenticated',
      url: server.url
    }]);
    await recordingPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    const stoppedRecording = await recordingEngine.stopSession(recordingSessionId);
    const project = matcherFixture(false);
    project.recordedActions[0].url = server.formUrl;
    project.recordedActions[0].pageMetadata = {
      pageType: 'Incident Form',
      module: 'Incident',
      entity: 'Incident',
      confidence: 1,
      signals: ['test-fixture']
    };

    let resolverInstruction = '';
    let resolutionTargetUrl = '';
    const result = await resolveWorkflowRequest(
      'Update incident INC0010021 and set Urgency to 2',
      targetUrl,
      project,
      {
        ...matcherDependencies(async (sessionId, instruction) => {
          resolverInstruction = instruction;
          const resolution = await recordingEngine.resolveIntent(sessionId, instruction);
          return {
            actions: frameworkActionsFromResolution(resolution.actions),
            unresolved: resolution.unresolved
          };
        }),
        startResolutionSession: async (targetUrl) => {
          resolutionTargetUrl = targetUrl;
          resolutionSessionId = await recordingEngine.startResolutionSession(
            targetUrl,
            true,
            undefined,
            stoppedRecording.storageState
          );
          return resolutionSessionId;
        },
        closeResolutionSession: async (sessionId) => recordingEngine.closeResolutionSession(sessionId)
      }
    );

    assert.equal(result.match.status, 'PARTIAL');
    assert.equal(resolverInstruction, 'set Urgency to 2');
    assert.equal(resolutionTargetUrl, server.formUrl);
    assert.ok(resolutionSessionId, 'missing Urgency must start a fresh resolution session');
    assert.deepEqual(result.unresolved, []);
    assert.ok(result.resolvedActions.some((action) =>
      action.type === 'select' && action.selector.includes("getByLabel('Urgency')") && action.value === '2'
    ));
    assert.ok(result.mergedActions.some((action) =>
      action.type === 'select' && action.selector.includes("getByLabel('Urgency')") && action.value === '2'
    ));
    assert.deepEqual(result.capabilityResults, [
      { kind: 'field', label: 'Urgency', value: '2', status: 'resolved' }
    ]);
  } finally {
    if (resolutionSessionId) await recordingEngine.closeResolutionSession(resolutionSessionId);
    if (recordingSessionId) await recordingEngine.stopSession(recordingSessionId).catch(() => {});
    await server.close();
  }
});

test('real ServiceNow recording resolves a missing Urgency through stop, auth restore, DOM detection, and workflow merge', async () => {
  const server = await startServiceNowClassicServer();
  let recordingSessionId: string | undefined;
  let resolutionSessionId: string | undefined;
  try {
    const targetUrl = `${server.url}/`;
    recordingSessionId = await recordingEngine.startSession(targetUrl, true);
    const recordingPage = recordingEngine.getPage(recordingSessionId)!;
    await recordingPage.context().addCookies([{
      name: 'servicenow-auth',
      value: 'authenticated',
      url: server.url
    }]);
    await recordingPage.goto(targetUrl);
    await recordingPage.getByRole('link', { name: 'Open incident' }).click();
    const formFrame = recordingPage.frameLocator('#gsft_main');
    await formFrame.getByLabel('Priority').selectOption('1');
    await formFrame.getByRole('button', { name: 'Update' }).click();
    const recordedSelectEvent = recordingEngine.getRecordedEvents(recordingSessionId)
      .find((event) => event.type === 'select');
    const recordedSelectIntent = recordedSelectEvent
      ? recordingEngine.getIntentTimeline(recordingSessionId).find((intent) => intent.eventId === recordedSelectEvent.id)
      : undefined;
    const staleIframeSrc = await recordingPage.locator('#gsft_main').getAttribute('src');
    const liveFormFrameUrl = recordingPage.frames().find((frame) => frame.url().includes('/incident.do'))?.url();

    const stoppedRecording = await recordingEngine.stopSession(recordingSessionId);
    const recordedActions = frameworkActionsFromResolution(
      recordingEngine.getEvents(recordingSessionId)
    );
    const optimizedActions = optimizeRecordedActions(recordedActions);
    const project = generateFrameworkProject(recordedActions, optimizedActions, targetUrl);

    assert.equal(recordingEngine.getApplicationMetadata(recordingSessionId)?.application, 'ServiceNow');
    assert.ok(recordedSelectEvent);
    assert.equal(recordedSelectEvent.application.application, 'ServiceNow');
    assert.equal(recordedSelectEvent.page.pageType, 'Incident Form');
    assert.equal(recordedSelectEvent.page.entity, 'Incident');
    assert.equal(recordedSelectEvent.frame.frameType, 'MainFrame');
    assert.equal(recordedSelectEvent.frame.frameSelector, '#gsft_main');
    assert.equal(recordedSelectEvent.locator.label, 'Priority');
    assert.equal(recordedSelectIntent?.intent, 'Unknown');
    const recordedSelectActionMetadata = recordedActions.filter((action) => action.type === 'select').map((action) => ({
      url: action.url,
      page: action.pageMetadata?.pageType,
      entity: action.pageMetadata?.entity,
      frame: action.frameMetadata?.frameType,
      frameSelector: action.frameSelector
    }));
    assert.deepEqual(recordedSelectActionMetadata, [{
      url: server.formUrl,
      page: 'Incident Form',
      entity: 'Incident',
      frame: 'MainFrame',
      frameSelector: '#gsft_main'
    }]);
    assert.equal(staleIframeSrc, '/frame-shell.do');
    assert.ok(liveFormFrameUrl);
    assert.equal(new URL(liveFormFrameUrl).pathname, '/incident.do');
    assert.equal(staleIframeSrc, '/frame-shell.do');
    assert.ok(project.workflows.some((workflow) =>
      workflow.name === 'updateIncident' && workflow.entity === 'Incident'
    ), JSON.stringify(project.workflows));
    const generatedActionMetadata = Object.values((JSON.parse(project.files['test-data/workflow.json']) as {
      actionMetadata: Record<string, {
        page?: { pageType: string; entity: string };
        locator?: { label?: string };
      }>;
    }).actionMetadata);
    const selectActionMetadata = generatedActionMetadata.find((metadata) =>
      metadata.page?.pageType === 'Incident Form' && metadata.locator?.label === 'Priority'
    );
    assert.ok(selectActionMetadata);
    assert.equal(selectActionMetadata.page.pageType, 'Incident Form');
    assert.equal(selectActionMetadata.page.entity, 'Incident');

    let resolvedUrl = '';
    let resolverInstruction = '';
    let resolutionMetadata: Record<string, unknown> = {};
    const result = await resolveWorkflowRequest(
      'Update incident INC0010021 and set Urgency to 2',
      targetUrl,
      project,
      {
        ...matcherDependencies(async (sessionId, instruction) => {
          resolverInstruction = instruction;
          const resolutionPage = recordingEngine.getPage(sessionId)!;
          assert.equal((await resolutionPage.context().cookies()).some((cookie) =>
            cookie.name === 'servicenow-auth' && cookie.value === 'authenticated'
          ), true);
          assert.equal(await resolutionPage.getByLabel('Urgency').count(), 1);
          resolutionMetadata = {
            finalUrl: resolutionPage.url(),
            application: recordingEngine.getApplicationMetadata(sessionId),
            page: recordingEngine.getPageMetadata(sessionId),
            frame: recordingEngine.getFrameMetadata(sessionId)
          };
          const resolution = await recordingEngine.resolveIntent(sessionId, instruction);
          resolutionMetadata.actions = resolution.actions;
          resolutionMetadata.unresolved = resolution.unresolved;
          return {
            actions: frameworkActionsFromResolution(resolution.actions),
            unresolved: resolution.unresolved
          };
        }),
        startResolutionSession: async (url) => {
          resolvedUrl = url;
          resolutionSessionId = await recordingEngine.startResolutionSession(
            url,
            true,
            undefined,
            stoppedRecording.storageState
          );
          return resolutionSessionId;
        },
        closeResolutionSession: async (sessionId) => recordingEngine.closeResolutionSession(sessionId)
      }
    );

    assert.equal(result.match.status, 'PARTIAL');
    assert.equal(resolvedUrl, server.formUrl);
    assert.equal(resolverInstruction, 'set Urgency to 2');
    assert.ok(resolutionSessionId);
    assert.equal(resolutionMetadata.finalUrl, server.formUrl);
    assert.equal((resolutionMetadata.application as { application: string }).application, 'ServiceNow');
    assert.equal((resolutionMetadata.page as { pageType: string }).pageType, 'Incident Form');
    assert.equal((resolutionMetadata.page as { entity: string }).entity, 'Incident');
    assert.equal((resolutionMetadata.frame as { frameType: string }).frameType, 'MainFrame');
    const rawResolutionActions = resolutionMetadata.actions as RecordedAction[];
    assert.equal(rawResolutionActions.length, 1);
    assert.equal(rawResolutionActions[0].type, 'select');
    assert.ok(rawResolutionActions[0].selector.includes("getByLabel('Urgency')"));
    assert.equal(rawResolutionActions[0].value, '2');
    assert.deepEqual(resolutionMetadata.unresolved, []);
    assert.deepEqual(result.unresolved, []);
    assert.ok(result.resolvedActions.some((action) =>
      action.type === 'select' &&
      action.selector.includes("getByLabel('Urgency')") &&
      action.value === '2'
    ));
    assert.ok(result.mergedActions.some((action) =>
      action.selector.includes("getByLabel('Urgency')") && action.value === '2'
    ));
    assert.ok(result.mergedActions.some((action) =>
      action.type === 'click' && action.selector.includes("name: 'Update'")
    ));
  } finally {
    if (resolutionSessionId) await recordingEngine.closeResolutionSession(resolutionSessionId);
    if (recordingSessionId) await recordingEngine.stopSession(recordingSessionId).catch(() => {});
    await server.close();
  }
});

test('a live resolution browser leaves Urgency explicitly unresolved when the authenticated form lacks that field', async () => {
  const server = await startTestServerWithoutUrgency();
  let resolutionSessionId: string | undefined;
  try {
    const result = await resolveWorkflowRequest(
      'Update incident INC0010021 and set Urgency to 2',
      server.url,
      matcherFixture(false),
      {
        ...matcherDependencies(async (sessionId, instruction) => {
          const resolution = await recordingEngine.resolveIntent(sessionId, instruction);
          return {
            actions: frameworkActionsFromResolution(resolution.actions),
            unresolved: resolution.unresolved
          };
        }),
        startResolutionSession: async (targetUrl) => {
          resolutionSessionId = await recordingEngine.startResolutionSession(targetUrl, true);
          return resolutionSessionId;
        },
        closeResolutionSession: async (sessionId) => recordingEngine.closeResolutionSession(sessionId)
      }
    );

    assert.ok(resolutionSessionId);
    assert.deepEqual(result.resolvedActions, []);
    assert.deepEqual(result.unresolved, ['set Urgency to 2']);
    assert.deepEqual(result.capabilityResults, [
      { kind: 'field', label: 'Urgency', value: '2', status: 'not-resolved' }
    ]);
  } finally {
    if (resolutionSessionId) await recordingEngine.closeResolutionSession(resolutionSessionId);
    await server.close();
  }
});

test('a request needing a field outside the recorded workflow falls back to a real resolution session (PARTIAL)', async () => {
  const server = await startTestServer();
  try {
    const { recordedActions } = await recordRealUpdateWorkflow(server.url);
    const optimizedActions = optimizeRecordedActions(recordedActions);
    const project = generateFrameworkProject(recordedActions, optimizedActions, server.url);

    // "Notes" was never part of the recorded workflow (only Priority +
    // Update were recorded) -- the matcher must report it as missing, not
    // silently drop it or fabricate a match.
    const preMatch = matchWorkflow('Change Priority to 1 and fill Notes with hello and click Update', project);
    assert.equal(preMatch.status, 'PARTIAL');
    assert.deepEqual(preMatch.missingCapabilities, ['Notes']);

    let resolutionSessionId: string | undefined;
    let resolutionOpened = false;
    let resolutionClosed = false;

    const result = await resolveWorkflowRequest(
      'Change Priority to 1 and fill Notes with hello and click Update',
      server.url,
      project,
      {
        startResolutionSession: async (targetUrl) => {
          resolutionOpened = true;
          resolutionSessionId = await recordingEngine.startResolutionSession(targetUrl, true);
          return resolutionSessionId;
        },
        resolveIntent: async (sessionId, instruction) => {
          const result = await recordingEngine.resolveIntent(sessionId, instruction);
          return {
            actions: frameworkActionsFromResolution(result.actions),
            unresolved: result.unresolved
          };
        },
        closeResolutionSession: async (sessionId) => {
          resolutionClosed = true;
          await recordingEngine.closeResolutionSession(sessionId);
        },
        optimize: optimizeRecordedActions,
        generateSpec: generateOptimizedSpec,
        generateFramework: generateFrameworkProject
      }
    );

    assert.equal(result.match.status, 'PARTIAL');
    assert.ok(resolutionOpened, 'expected a resolution session to be opened for the missing capability');
    assert.ok(resolutionClosed, 'expected the resolution session to be closed again afterwards');
    assert.ok(resolutionSessionId);

    // The gap was genuinely resolved live against the real DOM, not
    // fabricated -- "Notes" really exists as an <input> on this page.
    assert.deepEqual(result.unresolved, []);
    assert.ok(result.resolvedActions.some((a) => a.codeLine.includes("getByLabel('Notes')")));

    // Reused (Priority/Update) + newly-resolved (Notes) actions were
    // merged into ONE generated spec through the existing Optimizer --
    // not two separate specs, not a second optimizer.
    assert.match(result.generatedSpec!, /selectOption\(["']1["']\)/);
    assert.match(result.generatedSpec!, /getByLabel\('Notes'.*\.fill\('hello'\)/);
    assert.match(result.generatedSpec!, /getByRole\('button', \{ name: 'Update'.*\.click\(\)/);
  } finally {
    await server.close();
  }
});
