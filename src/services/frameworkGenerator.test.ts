import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transform } from 'esbuild';
import type { RecordedAction } from '../types';
import type { OptimizedAction } from './optimizer/types';
import { generateFrameworkProject } from './frameworkGenerator';
import { createFrameworkZip } from '../utils/frameworkZip';
import { validateFrameworkProject } from './frameworkValidator';

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

test('generates reusable structure and keeps business values out of workflow source', async () => {
  const recorded: RecordedAction[] = [
    {
      id: 'open-incident',
      type: 'click',
      selector: "page.getByRole('link', { name: 'Open incident INC12345' })",
      timestamp: '00:01.00',
      codeLine: "await page.getByRole('link', { name: 'Open incident' }).click();",
      identitySelector: "[href='/incident/INC12345']",
      applicationMetadata: {
        application: 'ServiceNow',
        confidence: 0.9,
        signals: ['host']
      },
      pageMetadata: {
        pageType: 'IncidentList',
        module: 'incident',
        entity: 'incident',
        confidence: 0.9,
        signals: ['url']
      },
      intent: {
        eventId: 'open-incident',
        intent: 'OpenRecord',
        confidence: 0.9,
        signals: ['link']
      }
    },
    {
      id: 'fill-description',
      type: 'fill',
      selector: "page.getByLabel('Short description')",
      value: 'Customer-visible incident description',
      timestamp: '00:02.00',
      codeLine: "await page.getByLabel('Short description').fill('Customer-visible incident description');",
      smartLocator: { strategy: 'label', tag: 'input', label: 'Short description' },
      applicationMetadata: {
        application: 'ServiceNow',
        confidence: 0.9,
        signals: ['host']
      },
      pageMetadata: {
        pageType: 'IncidentForm',
        module: 'incident',
        entity: 'incident',
        confidence: 0.9,
        signals: ['url']
      },
      intent: {
        eventId: 'fill-description',
        intent: 'UpdateRecord',
        confidence: 0.9,
        signals: ['form']
      }
    },
    {
      id: 'fill-password',
      type: 'fill',
      selector: "page.getByLabel('Password')",
      value: 'never-write-this-secret',
      timestamp: '00:03.00',
      codeLine: "await page.getByLabel('Password').fill('never-write-this-secret');",
      isSensitive: true,
      variableName: 'APP_PASSWORD',
      applicationMetadata: {
        application: 'ServiceNow',
        confidence: 0.9,
        signals: ['host']
      },
      pageMetadata: {
        pageType: 'IncidentForm',
        module: 'incident',
        entity: 'incident',
        confidence: 0.9,
        signals: ['url']
      }
    }
  ];
  const actions = [
    optimizedAction('open-incident', 'click', "page.getByRole('link', { name: 'Open incident' })", {
      identitySelector: "[href='/incident/INC12345']"
    }),
    optimizedAction('fill-description', 'fill', "page.getByLabel('Short description')", {
      value: 'Customer-visible incident description',
      codeLine: "await page.getByLabel('Short description').fill('Customer-visible incident description');"
    }),
    optimizedAction('fill-password', 'fill', "page.getByLabel('Password')", {
      value: 'never-write-this-secret',
      isSensitive: true,
      variableName: 'APP_PASSWORD',
      codeLine: "await page.getByLabel('Password').fill('never-write-this-secret');"
    })
  ];

  const project = generateFrameworkProject(recorded, actions, 'https://example.test/');
  const { files, metadata } = project;

  assert.equal(metadata.generatedFileCount, Object.keys(files).length);
  assert.equal(metadata.pageObjectCount, 2);
  assert.equal(metadata.workflowFunctionCount, 2);
  assert.equal(metadata.testCount, 1);
  assert.equal(metadata.testDataFileCount, 2);
  assert.equal(metadata.fixtureCount, 1);
  assert.ok(files['tests/recorded-journey.spec.ts'].includes('openIncident'));
  assert.ok(files['tests/recorded-journey.spec.ts'].includes('updateIncident'));
  assert.ok(!files['tests/recorded-journey.spec.ts'].includes('getByLabel'));
  assert.ok(files['pages/ServiceNowIncidentFormPage2.ts'].includes('getByLabel'));
  assert.ok(files['utils/workflows.ts'].includes('export async function openIncident('));
  assert.ok(files['utils/workflows.ts'].includes('export async function updateIncident('));
  assert.ok(files['utils/workflows.ts'].includes('export interface UpdateIncidentParameters'));
  assert.ok(files['utils/workflows.ts'].includes('incidentNumber?: string'));
  assert.ok(files['utils/workflows.ts'].includes('shortDescription?: string'));
  assert.ok(files['utils/workflows.ts'].includes('params.incidentNumber'));
  assert.ok(files['utils/workflows.ts'].includes('params.shortDescription'));
  assert.ok(files['utils/workflows.ts'].includes('pageObjects.pageObject0.action_'));
  assert.ok(files['utils/workflows.ts'].includes('pageObjects.pageObject1.action_'));
  assert.ok(!files['utils/workflows.ts'].includes('Customer-visible incident description'));
  assert.ok(!files['pages/ServiceNowIncidentFormPage2.ts'].includes('Customer-visible incident description'));
  assert.ok(!files['pages/ServiceNowIncidentFormPage2.ts'].includes('INC12345'));
  assert.ok(!files['utils/workflows.ts'].includes('INC12345'));
  assert.ok(files['tests/recorded-journey.spec.ts'].includes('workflowData.fields["shortDescription"]'));
  assert.ok(files['tests/recorded-journey.spec.ts'].includes('workflowData.fields["incidentNumber"]'));
  assert.ok(files['tests/recorded-journey.spec.ts'].includes('await openIncident('));
  assert.ok(files['tests/recorded-journey.spec.ts'].includes('await updateIncident('));
  assert.ok(files['tests/recorded-journey.spec.ts'].includes("test('complete the recorded user journey'"));
  assert.ok(!files['tests/recorded-journey.spec.ts'].includes('replay'));
  assert.ok(files['pages/ServiceNowIncidentListPage1.ts'].includes(".replace('{identity}', identity)"));
  assert.ok(!files['pages/ServiceNowIncidentListPage1.ts'].includes('INC12345'));
  assert.ok(!files['utils/workflows.ts'].includes('INC12345'));
  assert.ok(files['pages/ServiceNowIncidentFormPage2.ts'].includes('await target.fill(value);'));
  assert.ok(files['test-data/workflow.json'].includes('"incidentNumber": "INC12345"'));
  assert.ok(files['test-data/workflow.json'].includes('"shortDescription": "Customer-visible incident description"'));
  assert.ok(files['test-data/workflow.json'].includes('"incidentNumber": "INC12345"'));
  assert.ok(!files['.env.example'].includes('INC12345'));
  assert.ok(files['test-data/workflow.json'].includes("[href='/incident/{identity}']"));
  assert.ok(files['README.md'].includes('Workflow functions are exported'));
  assert.ok(files['pages/ServiceNowIncidentFormPage2.ts'].includes('process.env["APP_PASSWORD"]'));
  assert.ok(!files['test-data/workflow.json'].includes('never-write-this-secret'));
  assert.ok(files['test-data/workflow.json'].includes('Customer-visible incident description'));
  assert.ok(files['test-data/workflow.json'].includes("[href='/incident/{identity}']"));
  assert.ok(files['test-data/workflow.json'].includes('"intent": "UpdateRecord"'));
  assert.ok(files['test-data/workflow.json'].includes('"navigationUrls"'));
  assert.ok(files['package.json'].includes('"@playwright/test"'));
  assert.ok(files['playwright.config.ts'].includes('process.env.BASE_URL'));
  assert.ok(files['.gitignore'].includes('.env'));
  for (const [path, content] of Object.entries(files).filter(([path]) => path.endsWith('.ts'))) {
    await transform(content, { loader: 'ts', sourcefile: path });
  }
});

test('maps a captured popup transition to its actual page alias and frame locators', () => {
  const recorded: RecordedAction[] = [
    {
      id: 'open-popup',
      type: 'click',
      selector: "page.getByRole('link', { name: 'Open details' })",
      timestamp: '00:01.00',
      codeLine: "await page.getByRole('link', { name: 'Open details' }).click();",
      applicationMetadata: { application: 'Portal', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'List', module: null, entity: null, confidence: 1, signals: [] },
      intent: { eventId: 'open-popup', intent: 'Navigate', confidence: 1, signals: [] }
    },
    {
      id: 'wait-url',
      type: 'navigation',
      selector: 'page',
      timestamp: '00:02.00',
      codeLine: "await page1.waitForURL('**/details');",
      url: 'https://example.test/details',
      tabIndex: 1,
      applicationMetadata: { application: 'Portal', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'Details', module: null, entity: null, confidence: 1, signals: [] },
      frameMetadata: {
        frameType: 'NestedFrame',
        frameSelector: null,
        framePath: ['iframe[name="shell"]', 'iframe[name="detail"]'],
        confidence: 1,
        signals: []
      },
      navigation: {
        fromUrl: 'https://example.test/list',
        toUrl: 'https://example.test/details',
        trigger: 'click'
      },
      intent: { eventId: 'wait-url', intent: 'Navigate', confidence: 1, signals: [] }
    },
    {
      id: 'fill-detail',
      type: 'fill',
      selector: "page1.getByLabel('Reference')",
      value: 'REF-123',
      timestamp: '00:03.00',
      codeLine: "await page1.getByLabel('Reference').fill('REF-123');",
      tabIndex: 1,
      frameMetadata: {
        frameType: 'NestedFrame',
        frameSelector: null,
        framePath: ['iframe[name="shell"]', 'iframe[name="detail"]'],
        confidence: 1,
        signals: []
      },
      applicationMetadata: { application: 'Portal', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'Details', module: null, entity: null, confidence: 1, signals: [] },
      smartLocator: { strategy: 'label', tag: 'input', label: 'Reference' }
    }
  ];
  const actions = [
    optimizedAction('open-popup', 'click', "page.getByRole('link', { name: 'Open details' })"),
    optimizedAction('wait-url', 'navigation', 'page', {
      codeLine: "await page1.waitForURL('**/details');",
      url: 'https://example.test/details',
      tabIndex: 1
    }),
    optimizedAction('fill-detail', 'fill', "page1.getByLabel('Reference')", {
      value: 'REF-123',
      codeLine: "await page1.getByLabel('Reference').fill('REF-123');",
      tabIndex: 1
    })
  ];

  const { files } = generateFrameworkProject(recorded, actions, 'https://example.test/');

  assert.ok(files['utils/workflows.ts'].includes("waitForEvent('page'"));
  assert.ok(files['utils/workflows.ts'].includes('pages[1]'));
  const pageObject = files['pages/PortalDetailsPage2.ts'];
  assert.ok(pageObject.includes('const expectedPath = new URL(destination).pathname;'));
  assert.ok(pageObject.includes("await page.waitForURL(`**${expectedPath}**`, { waitUntil: 'domcontentloaded' });"));
  assert.ok(pageObject.includes('frameLocator("iframe[name='));
  assert.ok(pageObject.includes('shell'));
  assert.ok(pageObject.includes('detail'));
  assert.ok(pageObject.includes(".getByLabel('Reference')"));
  assert.ok(files['test-data/workflow.json'].includes('"https://example.test/details"'));
  assert.ok(files['test-data/workflow.json'].includes('"trigger": "click"'));
});

test('preserves assertions and exposes parameterized workflow APIs in the generated framework', () => {
  const recorded: RecordedAction[] = [
    {
      id: 'fill-description',
      type: 'fill',
      selector: "page.getByLabel('Short description')",
      value: 'Captured description',
      timestamp: '00:01.00',
      codeLine: "await page.getByLabel('Short description').fill('Captured description');",
      smartLocator: { strategy: 'label', tag: 'input', label: 'Short description' },
      applicationMetadata: { application: 'ServiceNow', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'IncidentForm', module: 'incident', entity: 'Incident', confidence: 1, signals: [] },
      intent: { eventId: 'fill-description', intent: 'UpdateRecord', confidence: 1, signals: [] }
    },
    {
      id: 'assert-success',
      type: 'assert',
      selector: "page.getByText('Incident updated successfully')",
      timestamp: '00:02.00',
      codeLine: "await expect(page.getByText('Incident updated successfully')).toBeVisible();",
      applicationMetadata: { application: 'ServiceNow', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'IncidentForm', module: 'incident', entity: 'Incident', confidence: 1, signals: [] },
      intent: { eventId: 'assert-success', intent: 'UpdateRecord', confidence: 1, signals: [] }
    }
  ];
  const actions = [
    optimizedAction('fill-description', 'fill', "page.getByLabel('Short description')", {
      value: 'Captured description'
    }),
    optimizedAction('assert-success', 'assert', "page.getByText('Incident updated successfully')", {
      codeLine: "await expect(page.getByText('Incident updated successfully')).toBeVisible();"
    })
  ];
  const project = generateFrameworkProject(recorded, actions, 'https://example.test/incidents');
  const workflowSource = project.files['utils/workflows.ts'];
  const pageObject = project.files['pages/ServiceNowIncidentFormPage1.ts'];
  const testSource = project.files['tests/recorded-journey.spec.ts'];

  assert.ok(workflowSource.includes('export interface UpdateIncidentParameters'));
  assert.ok(workflowSource.includes('shortDescription?: string'));
  assert.ok(workflowSource.includes('export async function updateIncident('));
  assert.ok(workflowSource.includes('params.shortDescription'));
  assert.ok(testSource.includes('await updateIncident('));
  assert.ok(testSource.includes('shortDescription: workflowData.fields["shortDescription"]'));
  assert.ok(testSource.includes('await expect(page).toHaveURL(/.+/);'));
  assert.ok(pageObject.includes("import { expect, type Page }"));
  assert.ok(pageObject.includes('await expect(page.getByText(value)).toBeVisible();'));
  assert.ok(!pageObject.includes('Incident updated successfully'));
  assert.ok(!workflowSource.includes('Incident updated successfully'));
  assert.ok(testSource.includes('expectedMessage: workflowData.fields["expectedMessage"]'));
  assert.ok(project.files['test-data/workflow.json'].includes('"expectedMessage": "Incident updated successfully"'));
  assert.ok(project.files['test-data/workflow.json'].includes('"shortDescription": "Captured description"'));
});

test('packages generated files under the required project directory in the ZIP', async () => {
  const zip = await createFrameworkZip({
    'package.json': '{"name":"playwright-framework"}',
    'tests/test.spec.ts': 'test();'
  }).generateAsync({ type: 'uint8array' });
  const loaded = await (await import('jszip')).default.loadAsync(zip);

  assert.ok(loaded.file('playwright-framework/package.json'));
  assert.ok(loaded.file('playwright-framework/tests/test.spec.ts'));
  assert.equal(loaded.file('package.json'), null);
});

test('generated framework files type-check with Playwright API declarations', async () => {
  const recorded: RecordedAction[] = [{
    id: 'fill-name',
    type: 'fill',
    selector: "page.getByLabel('Name')",
    value: 'Example',
    timestamp: '00:01.00',
    codeLine: "await page.getByLabel('Name').fill('Example');",
    smartLocator: { strategy: 'label', tag: 'input', label: 'Name' },
    intent: { eventId: 'fill-name', intent: 'UpdateRecord', confidence: 1, signals: [] }
  }, {
    id: 'assert-name',
    type: 'assert',
    selector: "page.getByText('Saved')",
    timestamp: '00:02.00',
    codeLine: "await expect(page.getByText('Saved')).toBeVisible();",
    intent: { eventId: 'assert-name', intent: 'UpdateRecord', confidence: 1, signals: [] }
  }];
  const optimized = [
    optimizedAction('fill-name', 'fill', "page.getByLabel('Name')", {
      value: 'Example',
      codeLine: "await page.getByLabel('Name').fill('Example');"
    }),
    optimizedAction('assert-name', 'assert', "page.getByText('Saved')", {
      codeLine: "await expect(page.getByText('Saved')).toBeVisible();"
    })
  ];
  const { files } = generateFrameworkProject(recorded, optimized, 'https://example.test/');
  const result = await validateFrameworkProject(files);

  assert.equal(result.status, 'PASS', JSON.stringify(result.diagnostics, null, 2));
});

test('keeps Page Object contracts consistent for identity, placeholder, navigation, and keyboard actions', async () => {
  const recorded: RecordedAction[] = [
    {
      id: 'fill-number',
      type: 'fill',
      selector: "page.getByPlaceholder('Incident number')",
      value: 'INC0010021',
      timestamp: '00:01.00',
      codeLine: "await page.getByPlaceholder('Incident number').fill('INC0010021');",
      smartLocator: { strategy: 'placeholder', tag: 'input', placeholder: 'Incident number' },
      applicationMetadata: { application: 'ServiceNow', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'IncidentList', module: 'incident', entity: 'Incident', confidence: 1, signals: [] },
      intent: { eventId: 'fill-number', intent: 'UpdateRecord', confidence: 1, signals: [] }
    },
    {
      id: 'open-record',
      type: 'click',
      selector: "page.getByRole('link', { name: 'Open incident INC0010021' })",
      timestamp: '00:01.50',
      codeLine: "await page.getByRole('link', { name: 'Open incident INC0010021' }).click();",
      applicationMetadata: { application: 'ServiceNow', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'IncidentList', module: 'incident', entity: 'Incident', confidence: 1, signals: [] },
      intent: { eventId: 'open-record', intent: 'UpdateRecord', confidence: 1, signals: [] }
    },
    {
      id: 'wait-details',
      type: 'navigation',
      selector: 'page',
      timestamp: '00:02.00',
      codeLine: 'await page.waitForURL((url) => url.pathname.includes("/details"));',
      url: 'https://example.test/details',
      navigation: { fromUrl: 'https://example.test/incidents', toUrl: 'https://example.test/details', trigger: 'click' },
      applicationMetadata: { application: 'ServiceNow', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'IncidentList', module: 'incident', entity: 'Incident', confidence: 1, signals: [] },
      intent: { eventId: 'wait-details', intent: 'UpdateRecord', confidence: 1, signals: [] }
    },
    {
      id: 'press-enter',
      type: 'press',
      selector: 'page',
      value: 'Enter',
      timestamp: '00:03.00',
      codeLine: "await page.keyboard.press('Enter');",
      applicationMetadata: { application: 'ServiceNow', confidence: 1, signals: [] },
      pageMetadata: { pageType: 'IncidentList', module: 'incident', entity: 'Incident', confidence: 1, signals: [] },
      intent: { eventId: 'press-enter', intent: 'UpdateRecord', confidence: 1, signals: [] }
    }
  ];
  const actions = [
    optimizedAction('fill-number', 'fill', "page.getByPlaceholder('Incident number')", {
      value: 'INC0010021'
    }),
    optimizedAction('open-record', 'click', "page.getByRole('link', { name: 'Open incident INC0010021' })"),
    optimizedAction('wait-details', 'navigation', 'page', {
      codeLine: 'await page.waitForURL((url) => url.pathname.includes("/details"));',
      url: 'https://example.test/details'
    }),
    optimizedAction('press-enter', 'press', 'page', {
      value: 'Enter',
      codeLine: "await page.keyboard.press('Enter');"
    })
  ];
  const { files } = generateFrameworkProject(recorded, actions, 'https://example.test/incidents');
  const pageObject = files['pages/ServiceNowIncidentListPage1.ts'];
  const workflow = files['utils/workflows.ts'];

  assert.ok(pageObject.includes("getByPlaceholder('Incident number')"));
  assert.ok(pageObject.includes('Open incident ${identity}'));
  assert.ok(pageObject.includes("await page.waitForURL(`**${expectedPath}**`, { waitUntil: 'domcontentloaded' });"));
  assert.ok(!pageObject.includes('waitForURL((url)'));
  assert.ok(pageObject.includes('page.keyboard.press("Enter")'));
  assert.ok(!pageObject.includes('undefined ??'));
  assert.ok(workflow.includes('params.incidentNumber'));
  assert.ok(workflow.includes('action_1(pages[0] ?? page, data, params.incidentNumber)'));
  assert.ok(workflow.includes('action_2(pages[0] ?? page, data, params.incidentNumber)'));
  assert.ok(workflow.includes('action_3(pages[0] ?? page, data)'));
  assert.ok(workflow.includes('action_4(pages[0] ?? page, data)'));
  assert.ok(files['test-data/workflow.json'].includes('"incidentNumber": "INC0010021"'));

  const result = await validateFrameworkProject(files);
  assert.equal(result.status, 'PASS', JSON.stringify(result.diagnostics, null, 2));
});

test('generates ServiceNow Login and Incident Form methods and calls from the same arity contract', async () => {
  const definitions: Array<{
    id: string;
    type: RecordedAction['type'];
    pageType: string;
    intent: string;
    selector: string;
    value?: string;
    isSensitive?: boolean;
    variableName?: string;
    codeLine: string;
  }> = [
    {
      id: 'landing',
      type: 'click',
      pageType: 'Landing',
      intent: 'Navigate',
      selector: "page.getByRole('link', { name: 'Sign in' })",
      codeLine: "await page.getByRole('link', { name: 'Sign in' }).click();"
    },
    {
      id: 'username',
      type: 'fill',
      pageType: 'Login',
      intent: 'Login',
      selector: "page.getByLabel('User name')",
      value: 'operator',
      codeLine: "await page.getByLabel('User name').fill('operator');"
    },
    {
      id: 'password',
      type: 'fill',
      pageType: 'Login',
      intent: 'Login',
      selector: "page.getByLabel('Password')",
      value: 'not-stored',
      isSensitive: true,
      variableName: 'APP_PASSWORD',
      codeLine: "await page.getByLabel('Password').fill('not-stored');"
    },
    {
      id: 'login',
      type: 'click',
      pageType: 'Login',
      intent: 'Login',
      selector: "page.getByRole('button', { name: 'Log in' })",
      codeLine: "await page.getByRole('button', { name: 'Log in' }).click();"
    },
    {
      id: 'description',
      type: 'fill',
      pageType: 'Incident_Form',
      intent: 'UpdateRecord',
      selector: "page.getByLabel('Short description')",
      value: 'Externalized description',
      codeLine: "await page.getByLabel('Short description').fill('Externalized description');"
    },
    {
      id: 'urgency',
      type: 'select',
      pageType: 'Incident_Form',
      intent: 'UpdateRecord',
      selector: "page.getByLabel('Urgency')",
      value: '2',
      codeLine: "await page.getByLabel('Urgency').selectOption('2');"
    },
    {
      id: 'update',
      type: 'click',
      pageType: 'Incident_Form',
      intent: 'UpdateRecord',
      selector: "page.getByRole('button', { name: 'Update' })",
      codeLine: "await page.getByRole('button', { name: 'Update' }).click();"
    }
  ];
  const recorded: RecordedAction[] = definitions.map((definition) => ({
    id: definition.id,
    type: definition.type,
    selector: definition.selector,
    value: definition.value,
    timestamp: '00:01.00',
    codeLine: definition.codeLine,
    isSensitive: definition.isSensitive,
    variableName: definition.variableName,
    applicationMetadata: { application: 'ServiceNow', confidence: 1, signals: [] },
    pageMetadata: {
      pageType: definition.pageType,
      module: 'incident',
      entity: 'Incident',
      confidence: 1,
      signals: []
    },
    intent: { eventId: definition.id, intent: definition.intent, confidence: 1, signals: [] }
  }));
  const optimized = definitions.map((definition) =>
    optimizedAction(definition.id, definition.type, definition.selector, {
      value: definition.value,
      isSensitive: definition.isSensitive,
      variableName: definition.variableName,
      codeLine: definition.codeLine
    })
  );
  const { files } = generateFrameworkProject(recorded, optimized, 'https://servicenow.example/');
  const loginPage = files['pages/ServiceNowLoginPage2.ts'];
  const incidentPage = files['pages/ServiceNowIncident_FormPage3.ts'];
  const workflow = files['utils/workflows.ts'];

  assert.ok(loginPage.includes('async action_2(page: Page, data: FrameworkTestData, value: string | undefined)'));
  assert.ok(loginPage.includes('async action_3(page: Page, data: FrameworkTestData)'));
  assert.ok(loginPage.includes('async action_4(page: Page, data: FrameworkTestData)'));
  assert.ok(incidentPage.includes('async action_5(page: Page, data: FrameworkTestData, value: string | undefined)'));
  assert.ok(incidentPage.includes('async action_6(page: Page, data: FrameworkTestData, value: string | undefined)'));
  assert.ok(incidentPage.includes('async action_7(page: Page, data: FrameworkTestData)'));
  assert.ok(workflow.includes('pageObjects.pageObject1.action_2(pages[0] ?? page, data, params.userName)'));
  assert.ok(workflow.includes('pageObjects.pageObject1.action_3(pages[0] ?? page, data)'));
  assert.ok(workflow.includes('pageObjects.pageObject1.action_4(pages[0] ?? page, data)'));
  assert.ok(workflow.includes('pageObjects.pageObject2.action_5(pages[0] ?? page, data, params.shortDescription)'));
  assert.ok(workflow.includes('pageObjects.pageObject2.action_6(pages[0] ?? page, data, params.urgency)'));
  assert.ok(workflow.includes('pageObjects.pageObject2.action_7(pages[0] ?? page, data)'));

  const validation = await validateFrameworkProject(files);
  assert.equal(validation.status, 'PASS', JSON.stringify(validation.diagnostics, null, 2));
});

test('a workflow\'s reported intent reflects the boundary action that started the group, not its trailing action\'s own intent', () => {
  // Root-cause regression: a workflow group almost always ends with one or
  // more non-boundary (Unknown/Navigate) trailing actions after the
  // boundary-setting action itself -- e.g. a post-login page settle
  // navigation after the "Log in" click. FrameworkWorkflowMetadata.intent
  // used to be read from the group's LAST action's own classified intent,
  // which is that trailing action, not the boundary. Confirmed live: a
  // real recording's "loginIncident"-named workflow (correctly named from
  // a Login boundary) reported .intent "Unknown" because its last action
  // was a trailing navigation -- silently breaking any downstream code
  // that filters workflows by .intent (e.g. workflowMatcher.ts including
  // the Login workflow in every reused spec regardless of target entity).
  const recorded: RecordedAction[] = [
    {
      id: 'login_click',
      type: 'click',
      selector: "page.getByRole('button', { name: 'Log in' })",
      timestamp: '00:01.00',
      codeLine: "await page.getByRole('button', { name: 'Log in' }).click();",
      intent: { eventId: 'login_click', intent: 'Login', confidence: 1, signals: [] }
    },
    {
      id: 'trailing_nav',
      type: 'navigation',
      selector: 'page',
      timestamp: '00:02.00',
      codeLine: "await page.waitForURL('**/home');",
      url: 'https://example.test/home',
      intent: { eventId: 'trailing_nav', intent: 'Navigate', confidence: 1, signals: [] }
    }
  ];
  const actions = [
    optimizedAction('login_click', 'click', "page.getByRole('button', { name: 'Log in' })"),
    optimizedAction('trailing_nav', 'navigation', 'page', {
      codeLine: "await page.waitForURL('**/home');",
      url: 'https://example.test/home'
    })
  ];

  const { workflows } = generateFrameworkProject(recorded, actions, 'https://example.test/');

  assert.equal(workflows.length, 1);
  assert.equal(workflows[0].name, 'loginRecord');
  assert.equal(workflows[0].intent, 'Login');
});
