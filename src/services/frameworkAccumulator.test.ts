import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecordedAction } from '../types';
import type { OptimizedAction } from './optimizer/types';
import { generateFrameworkProject } from './frameworkGenerator';
import { validateFrameworkProject } from './frameworkValidator';
import {
  createAccumulatedFramework,
  mergeIntoFramework,
  toFrameworkProject
} from './frameworkAccumulator';

/**
 * Regression coverage for the Add to Suite structural-merge architecture:
 * FrameworkProject stays the single source of truth across repeated merges,
 * the original recorded test is never overwritten, every AI-added test gets
 * a unique business-intent filename, and -- most importantly -- a reused
 * workflow's growing *Parameters interface (one merge adds Urgency, the
 * next adds State) never invalidates an EARLIER test's own frozen call
 * site. That last guarantee is checked with a real tsc --noEmit pass via
 * validateFrameworkProject, the same mechanism "Validate Framework" runs
 * live, not just a string assertion.
 */

function optimizedAction(
  id: string,
  type: OptimizedAction['type'],
  selector: string,
  options: Partial<OptimizedAction> = {}
): OptimizedAction {
  return {
    id,
    type,
    selector,
    timestamp: '00:01.00',
    codeLine: `await ${selector}.click();`,
    tabIndex: 0,
    locatorQuality: 'semantic',
    mergedFromCount: 1,
    warnings: [],
    ...options
  };
}

const pageMetadata = {
  pageType: 'Incident Form',
  module: 'incident',
  entity: 'Incident',
  confidence: 1,
  signals: []
};
const applicationMetadata = { application: 'ServiceNow', confidence: 1, signals: [] };

/** Builds a "create incident" session with however many fill/select fields
 * are requested before the terminal Create click -- mirrors how
 * resolveWorkflowRequest grows the SAME merged action list, one genuinely
 * new field at a time, across repeated Add to Suite calls. */
function buildCreateIncidentProject(fields: Array<{ id: string; label: string; type: 'fill' | 'select'; value: string }>) {
  const fieldRecorded: RecordedAction[] = fields.map((field, index) => ({
    id: field.id,
    type: field.type,
    selector: `page.getBy${field.type === 'fill' ? 'Label' : 'Label'}('${field.label}')`,
    value: field.value,
    timestamp: `00:0${index + 1}.00`,
    codeLine: `await page.getByLabel('${field.label}').${field.type === 'fill' ? 'fill' : 'selectOption'}('${field.value}');`,
    smartLocator: { strategy: 'label', tag: field.type === 'fill' ? 'input' : 'select', label: field.label },
    applicationMetadata,
    pageMetadata
  }));
  const clickRecorded: RecordedAction = {
    id: 'click-create',
    type: 'click',
    selector: "page.getByRole('button', { name: 'Create' })",
    timestamp: '00:09.00',
    codeLine: "await page.getByRole('button', { name: 'Create' }).click();",
    applicationMetadata,
    pageMetadata,
    intent: { eventId: 'click-create', intent: 'CreateRecord', confidence: 1, signals: [] }
  };
  const recorded = [...fieldRecorded, clickRecorded];

  const fieldOptimized = fields.map((field) =>
    optimizedAction(field.id, field.type, `page.getByLabel('${field.label}')`, {
      value: field.value,
      codeLine: `await page.getByLabel('${field.label}').${field.type === 'fill' ? 'fill' : 'selectOption'}('${field.value}');`
    })
  );
  const clickOptimized = optimizedAction('click-create', 'click', "page.getByRole('button', { name: 'Create' })");
  const optimized = [...fieldOptimized, clickOptimized];

  return generateFrameworkProject(recorded, optimized, 'https://servicenow.example/');
}

test('createAccumulatedFramework freezes the original recorded test as entry 0', () => {
  const initial = buildCreateIncidentProject([
    { id: 'fill-short-description', label: 'Short description', type: 'fill', value: 'Printer not working' }
  ]);
  const acc = createAccumulatedFramework(initial, 'https://servicenow.example/');

  assert.equal(acc.tests.length, 1);
  assert.equal(acc.tests[0].fileName, 'tests/recorded-journey.spec.ts');
  assert.equal(acc.tests[0].instruction, null);
  assert.equal(acc.tests[0].content, initial.files['tests/recorded-journey.spec.ts']);
});

test('mergeIntoFramework adds a uniquely-named test without touching the original, and keeps the framework executable as parameters accumulate', async () => {
  const initial = buildCreateIncidentProject([
    { id: 'fill-short-description', label: 'Short description', type: 'fill', value: 'Printer not working' }
  ]);
  let acc = createAccumulatedFramework(initial, 'https://servicenow.example/');
  const originalTestContent = acc.tests[0].content;

  // Round 1: "Create an incident and set Urgency to 2" -- simulates
  // resolveWorkflowRequest's merged action list after reusing createIncident
  // and inserting the newly resolved Urgency field before the Create click.
  const round1 = buildCreateIncidentProject([
    { id: 'fill-short-description', label: 'Short description', type: 'fill', value: 'Printer not working' },
    { id: 'select-urgency', label: 'Urgency', type: 'select', value: '2' }
  ]);
  acc = mergeIntoFramework(acc, round1, 'Create an incident and set Urgency to 2');

  assert.equal(acc.tests.length, 2);
  assert.equal(acc.tests[0].content, originalTestContent, 'original recorded test must never be overwritten');
  assert.equal(acc.tests[1].fileName, 'tests/create-an-incident-and-set-urgency-to-2.spec.ts');
  assert.ok(acc.tests[1].content.includes('test("Create an incident and set Urgency to 2"'));
  assert.ok(acc.tests[1].content.includes('createIncident'));
  assert.ok(acc.sharedFiles['utils/workflows.ts'].includes('urgency'));

  const project1 = toFrameworkProject(acc);
  assert.equal(project1.metadata.testCount, 2);
  assert.ok(project1.files['tests/recorded-journey.spec.ts']);
  assert.ok(project1.files['tests/create-an-incident-and-set-urgency-to-2.spec.ts']);
  assert.equal(project1.files['tests/recorded-journey.spec.ts'], originalTestContent);

  const validation1 = await validateFrameworkProject(project1.files);
  assert.equal(validation1.status, 'PASS', JSON.stringify(validation1.diagnostics, null, 2));

  // Round 2: "Create an incident and set State to In Progress" -- merges
  // again on top of the round-1 accumulated state, same as a second AI Gen
  // request matched against the now-accumulated framework.
  const round2 = buildCreateIncidentProject([
    { id: 'fill-short-description', label: 'Short description', type: 'fill', value: 'Printer not working' },
    { id: 'select-urgency', label: 'Urgency', type: 'select', value: '2' },
    { id: 'select-state', label: 'State', type: 'select', value: 'In Progress' }
  ]);
  acc = mergeIntoFramework(acc, round2, 'Create an incident and set State to In Progress');

  assert.equal(acc.tests.length, 3);
  assert.equal(acc.tests[0].content, originalTestContent, 'original recorded test must still be untouched after a second merge');
  assert.equal(acc.tests[1].fileName, 'tests/create-an-incident-and-set-urgency-to-2.spec.ts');
  assert.equal(acc.tests[2].fileName, 'tests/create-an-incident-and-set-state-to-in-progress.spec.ts');
  assert.ok(acc.sharedFiles['utils/workflows.ts'].includes('urgency'));
  assert.ok(acc.sharedFiles['utils/workflows.ts'].includes('state'));

  const project2 = toFrameworkProject(acc);
  assert.equal(project2.metadata.testCount, 3);
  assert.equal(project2.files['tests/recorded-journey.spec.ts'], originalTestContent);
  assert.equal(
    project2.files['tests/create-an-incident-and-set-urgency-to-2.spec.ts'],
    acc.tests[1].content,
    'round-1 AI test must still be present and unchanged after round 2'
  );

  const validation2 = await validateFrameworkProject(project2.files);
  assert.equal(validation2.status, 'PASS', JSON.stringify(validation2.diagnostics, null, 2));
});

test('mergeIntoFramework de-duplicates identical business-intent filenames', () => {
  const initial = buildCreateIncidentProject([
    { id: 'fill-short-description', label: 'Short description', type: 'fill', value: 'Printer not working' }
  ]);
  let acc = createAccumulatedFramework(initial, 'https://servicenow.example/');
  const round = buildCreateIncidentProject([
    { id: 'fill-short-description', label: 'Short description', type: 'fill', value: 'Printer not working' },
    { id: 'select-urgency', label: 'Urgency', type: 'select', value: '2' }
  ]);

  acc = mergeIntoFramework(acc, round, 'Set Urgency to 2');
  acc = mergeIntoFramework(acc, round, 'Set Urgency to 2');

  assert.equal(acc.tests[1].fileName, 'tests/set-urgency-to-2.spec.ts');
  assert.equal(acc.tests[2].fileName, 'tests/set-urgency-to-2-2.spec.ts');
});
