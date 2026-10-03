import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { RecordedAction } from "../types";
import type { OptimizedAction } from "./optimizer/types";
import { FrameworkProjectStorage } from "./frameworkProjectPersistence";
import {
  generateFrameworkProject,
  type FrameworkProject,
} from "./frameworkGenerator";
import {
  createAccumulatedFramework,
  mergeIntoFramework,
  toFrameworkProject,
} from "./frameworkAccumulator";
import { validateFrameworkProject } from "./frameworkValidator";
import { getMatchAvailability, matchWorkflow, resolveWorkflowRequest } from "./workflowMatcher";
import { optimizeRecordedActions, generateOptimizedSpec } from "./optimizerService";
import { frameworkContentKey, isFrameworkValidationCurrent } from "./frameworkValidationService";

function optimizedAction(
  id: string,
  type: OptimizedAction["type"],
  selector: string,
  options: Partial<OptimizedAction> = {},
): OptimizedAction {
  return {
    id,
    type,
    selector,
    timestamp: "00:01.00",
    codeLine: `await ${selector}.click();`,
    tabIndex: 0,
    locatorQuality: "semantic",
    mergedFromCount: 1,
    warnings: [],
    ...options,
  };
}

test("generate save restart load add second test validate preserve original test", async () => {
  const storageDir = mkdtempSync(path.join(tmpdir(), "framework-projects-"));
  const baseProject = generateFrameworkProject(
    [
      {
        id: "open-incident",
        type: "click",
        selector: "page.getByRole('link', { name: 'Open incident INC12345' })",
        timestamp: "00:01.00",
        codeLine:
          "await page.getByRole('link', { name: 'Open incident INC12345' }).click();",
        identitySelector: "[href='/incident/INC12345']",
        applicationMetadata: {
          application: "ServiceNow",
          confidence: 0.9,
          signals: ["host"],
        },
        pageMetadata: {
          pageType: "IncidentList",
          module: "incident",
          entity: "incident",
          confidence: 0.9,
          signals: ["url"],
        },
        intent: {
          eventId: "open-incident",
          intent: "OpenRecord",
          confidence: 0.9,
          signals: ["link"],
        },
      } as RecordedAction,
      {
        id: "fill-description",
        type: "fill",
        selector: "page.getByLabel('Short description')",
        value: "Customer-visible incident description",
        timestamp: "00:02.00",
        codeLine:
          "await page.getByLabel('Short description').fill('Customer-visible incident description');",
        smartLocator: {
          strategy: "label",
          tag: "input",
          label: "Short description",
        },
        applicationMetadata: {
          application: "ServiceNow",
          confidence: 0.9,
          signals: ["host"],
        },
        pageMetadata: {
          pageType: "IncidentForm",
          module: "incident",
          entity: "incident",
          confidence: 0.9,
          signals: ["url"],
        },
        intent: {
          eventId: "fill-description",
          intent: "UpdateRecord",
          confidence: 0.9,
          signals: ["form"],
        },
      } as RecordedAction,
    ],
    [
      optimizedAction(
        "open-incident",
        "click",
        "page.getByRole('link', { name: 'Open incident' })",
        {
          identitySelector: "[href='/incident/INC12345']",
        },
      ),
      optimizedAction(
        "fill-description",
        "fill",
        "page.getByLabel('Short description')",
        {
          value: "Customer-visible incident description",
          codeLine:
            "await page.getByLabel('Short description').fill('Customer-visible incident description');",
        },
      ),
    ],
    "https://example.test/incidents",
  );

  const store = new FrameworkProjectStorage({ baseDir: storageDir });
  const savedProject = await store.save(baseProject, {
    name: "incident-flow",
    targetUrl: "https://example.test/incidents"
  });

  const restartedStore = new FrameworkProjectStorage({ baseDir: storageDir });
  const loadedProject = await restartedStore.load(savedProject.projectId);
  assert.equal(loadedProject.projectId, savedProject.projectId);
  assert.equal(loadedProject.targetUrl, "https://example.test/incidents");
  const businessRequest = "Change Short description to revised and set Urgency to 2 and click Update";
  const loadedMatch = matchWorkflow(businessRequest, loadedProject);
  assert.equal(loadedMatch.status, "PARTIAL");
  assert.ok(loadedMatch.reusableWorkflows.length > 0);
  assert.ok(loadedMatch.missingCapabilities.some((capability) => /urgency/i.test(capability)));

  let resolutionStarted = false;
  const resolution = await resolveWorkflowRequest(
    businessRequest,
    "https://example.test/incidents",
    loadedProject,
    {
      startResolutionSession: async () => {
        resolutionStarted = true;
        return "fresh-resolution-session";
      },
      resolveIntent: async (_sessionId, instruction) => {
        assert.match(instruction, /urgency/i);
        return {
          actions: [{
            id: "set-urgency",
            type: "select",
            selector: "page.getByLabel('Urgency')",
            value: "2",
            timestamp: "00:03.00",
            codeLine: "await page.getByLabel('Urgency').selectOption('2');",
            smartLocator: { strategy: "label", tag: "select", label: "Urgency" },
            applicationMetadata: {
              application: "ServiceNow",
              confidence: 0.9,
              signals: ["host"]
            },
            pageMetadata: {
              pageType: "IncidentForm",
              module: "incident",
              entity: "incident",
              confidence: 0.9,
              signals: ["url"]
            },
            intent: {
              eventId: "set-urgency",
              intent: "UpdateRecord",
              confidence: 0.9,
              signals: ["live-resolution"]
            }
          } as RecordedAction],
          unresolved: []
        };
      },
      closeResolutionSession: async () => {},
      optimize: optimizeRecordedActions,
      generateSpec: generateOptimizedSpec,
      generateFramework: generateFrameworkProject
    },
  );
  assert.equal(resolutionStarted, true);
  assert.equal(
    resolution.capabilityResults.find((capability) => capability.label.toLowerCase() === "urgency")?.status,
    "resolved",
  );
  assert.ok(resolution.generatedProject);

  const accumulated = createAccumulatedFramework(
    loadedProject,
    "https://example.test/incidents",
  );
  const merged = mergeIntoFramework(
    accumulated,
    resolution.generatedProject!,
    businessRequest,
  );
  const mergedProject = toFrameworkProject(merged);

  assert.equal(merged.tests.length, 2);
  assert.equal(merged.tests[0].instruction, null);
  assert.equal(merged.tests[0].title, "complete the recorded user journey");
  assert.equal(merged.tests[1].instruction, businessRequest);

  const validation = await validateFrameworkProject(mergedProject.files);
  assert.equal(validation.status, "PASS", JSON.stringify(validation.diagnostics));
  const validationSnapshot = {
    status: "passed",
    contentKey: frameworkContentKey(mergedProject.files)
  };
  assert.equal(isFrameworkValidationCurrent(mergedProject.files, validationSnapshot), true);
  assert.equal(isFrameworkValidationCurrent({
    ...mergedProject.files,
    [merged.tests[1].fileName]: `${merged.tests[1].content}\n// changed`
  }, validationSnapshot), false);

  await restartedStore.save(mergedProject, {
    projectId: savedProject.projectId,
    name: savedProject.name,
  });
  const persisted = await restartedStore.load(savedProject.projectId);
  assert.equal(persisted.projectId, savedProject.projectId);
  assert.equal(persisted.targetUrl, "https://example.test/incidents");
  assert.equal(persisted.files[merged.tests[0].fileName], merged.tests[0].content);
  assert.equal(persisted.files[merged.tests[1].fileName], merged.tests[1].content);

  const reloadedAccumulation = createAccumulatedFramework(
    persisted,
    "https://example.test/incidents",
  );
  assert.equal(reloadedAccumulation.tests.length, 2);
  assert.equal(reloadedAccumulation.tests[0].fileName, merged.tests[0].fileName);
  assert.equal(reloadedAccumulation.tests[0].content, merged.tests[0].content);
  assert.equal(reloadedAccumulation.tests[1].fileName, merged.tests[1].fileName);
  assert.equal(reloadedAccumulation.tests[1].content, merged.tests[1].content);

  rmSync(storageDir, { recursive: true, force: true });
});

test("reloaded page-qualified workflow metadata matches the requested entity and resolves only Urgency", async () => {
  const storageDir = mkdtempSync(path.join(tmpdir(), "framework-project-match-"));
  const targetUrl = "https://example.test/incidents";
  const recordedActions: RecordedAction[] = [
    {
      id: "open-incident",
      type: "click",
      selector: "page.getByRole('link', { name: 'Open incident INC12345' })",
      timestamp: "00:01.00",
      codeLine: "await page.getByRole('link', { name: 'Open incident INC12345' }).click();",
      pageMetadata: { pageType: "IncidentList", module: "incident", entity: "Incident", confidence: 1, signals: [] },
      intent: { eventId: "open-incident", intent: "OpenRecord", confidence: 1, signals: [] }
    },
    {
      id: "fill-description",
      type: "fill",
      selector: "page.getByLabel('Short description')",
      value: "Original description",
      timestamp: "00:02.00",
      codeLine: "await page.getByLabel('Short description').fill('Original description');",
      smartLocator: { strategy: "label", tag: "input", label: "Short description" },
      pageMetadata: { pageType: "Incident Form", module: "incident", entity: "Incident Form", confidence: 1, signals: [] },
      intent: { eventId: "fill-description", intent: "UpdateRecord", confidence: 1, signals: [] }
    },
    {
      id: "update-incident",
      type: "click",
      selector: "page.getByRole('button', { name: 'Update' })",
      timestamp: "00:03.00",
      codeLine: "await page.getByRole('button', { name: 'Update' }).click();",
      smartLocator: { strategy: "role", tag: "button", role: "button", text: "Update" },
      pageMetadata: { pageType: "Incident Form", module: "incident", entity: "Incident Form", confidence: 1, signals: [] },
      intent: { eventId: "update-incident", intent: "UpdateRecord", confidence: 1, signals: [] }
    }
  ];
  const optimizedActions = [
    optimizedAction("open-incident", "click", "page.getByRole('link', { name: 'Open incident' })"),
    optimizedAction("fill-description", "fill", "page.getByLabel('Short description')", {
      value: "Original description",
      codeLine: "await page.getByLabel('Short description').fill('Original description');"
    }),
    optimizedAction("update-incident", "click", "page.getByRole('button', { name: 'Update' })")
  ];

  try {
    const generated = generateFrameworkProject(recordedActions, optimizedActions, targetUrl);
    const store = new FrameworkProjectStorage({ baseDir: storageDir });
    const saved = await store.save(generated, { name: "incident-workflow", targetUrl });
    const loaded = await new FrameworkProjectStorage({ baseDir: storageDir }).load(saved.projectId);
    const updateWorkflow = loaded.workflows.find((workflow) => workflow.intent === "UpdateRecord");

    assert.equal(updateWorkflow?.entity, "Incident Form");
    assert.equal(updateWorkflow?.name, "updateIncidentForm");

    const instruction = "Open the last created incident and change Urgency to 2 - Medium";
    const match = matchWorkflow(instruction, loaded);
    assert.equal(match.status, "PARTIAL");
    assert.ok(match.reusableWorkflows.some((workflow) => workflow.name === updateWorkflow?.name));
    assert.ok(match.reusedActionIds.includes("open-incident"));
    assert.ok(match.reusedActionIds.includes("update-incident"));
    assert.deepEqual(match.missingCapabilities, ["Urgency"]);

    let resolverInstruction = "";
    const resolution = await resolveWorkflowRequest(instruction, targetUrl, loaded, {
      startResolutionSession: async () => "fresh-resolution-session",
      resolveIntent: async (_sessionId, request) => {
        resolverInstruction = request;
        return {
          actions: [{
            id: "resolved-urgency",
            type: "select",
            selector: "page.getByLabel('Urgency')",
            value: "2",
            timestamp: "00:04.00",
            codeLine: "await page.getByLabel('Urgency').selectOption('2');",
            smartLocator: { strategy: "label", tag: "select", label: "Urgency" }
          } as RecordedAction],
          unresolved: []
        };
      },
      closeResolutionSession: async () => {},
      optimize: optimizeRecordedActions,
      generateSpec: generateOptimizedSpec,
      generateFramework: generateFrameworkProject
    });

    assert.equal(resolverInstruction, "set Urgency to 2 - Medium");
    assert.equal(resolution.match.status, "PARTIAL");
    assert.equal(resolution.capabilityResults[0]?.status, "resolved");
    assert.equal((await store.list()).length, 1);
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
  }
});

/**
 * Root-cause regression for "after refreshing, Awwwards loads instead of
 * ServiceNow": investigation found this was never actually a persistence
 * bug -- no FrameworkProject was EVER auto-restored (loadFrameworkProject
 * had exactly one call site, a user-driven dropdown), so a fresh page load
 * always fell back to RecordingContext's own hardcoded demo recordedUrl
 * default, which happens to be an Awwwards URL. Both saved projects were
 * intact in storage the whole time. This fixes the actual gap: an explicit
 * "active project" record, set only by save()/load(), restored on next
 * startup -- never inferred from which saved project happens to be newest.
 */
function serviceNowIncidentProject(targetUrl: string): FrameworkProject {
  return generateFrameworkProject(
    [
      {
        id: "open-incident",
        type: "click",
        selector: "page.getByRole('link', { name: 'Open incident INC0010099' })",
        timestamp: "00:01.00",
        codeLine: "await page.getByRole('link', { name: 'Open incident INC0010099' }).click();",
        identitySelector: "[href='/incident/INC0010099']",
        applicationMetadata: { application: "ServiceNow", confidence: 0.9, signals: ["host"] },
        pageMetadata: { pageType: "IncidentList", module: "incident", entity: "Incident", confidence: 0.9, signals: ["url"] },
        intent: { eventId: "open-incident", intent: "OpenRecord", confidence: 0.9, signals: ["link"] }
      } as RecordedAction,
      {
        id: "fill-urgency",
        type: "select",
        selector: "page.getByLabel('Urgency')",
        value: "2",
        timestamp: "00:02.00",
        codeLine: "await page.getByLabel('Urgency').selectOption('2');",
        smartLocator: { strategy: "label", tag: "select", label: "Urgency" },
        applicationMetadata: { application: "ServiceNow", confidence: 0.9, signals: ["host"] },
        pageMetadata: { pageType: "IncidentForm", module: "incident", entity: "Incident", confidence: 0.9, signals: ["url"] },
        intent: { eventId: "fill-urgency", intent: "UpdateRecord", confidence: 0.9, signals: ["form"] }
      } as RecordedAction,
      {
        id: "update-incident",
        type: "click",
        selector: "page.getByRole('button', { name: 'Update' })",
        timestamp: "00:03.00",
        codeLine: "await page.getByRole('button', { name: 'Update' }).click();",
        applicationMetadata: { application: "ServiceNow", confidence: 0.9, signals: ["host"] },
        pageMetadata: { pageType: "IncidentForm", module: "incident", entity: "Incident", confidence: 0.9, signals: ["url"] },
        intent: { eventId: "update-incident", intent: "UpdateRecord", confidence: 0.9, signals: ["form"] }
      } as RecordedAction
    ],
    [
      optimizedAction("open-incident", "click", "page.getByRole('link', { name: 'Open incident' })", {
        identitySelector: "[href='/incident/INC0010099']"
      }),
      optimizedAction("fill-urgency", "select", "page.getByLabel('Urgency')", {
        value: "2",
        codeLine: "await page.getByLabel('Urgency').selectOption('2');"
      }),
      optimizedAction("update-incident", "click", "page.getByRole('button', { name: 'Update' })")
    ],
    targetUrl
  );
}

function awwwardsEcommerceProject(targetUrl: string): FrameworkProject {
  return generateFrameworkProject(
    [
      {
        id: "search-site",
        type: "fill",
        selector: "page.getByPlaceholder('Search query or keywords...')",
        value: "shopify",
        timestamp: "00:01.00",
        codeLine: "await page.getByPlaceholder('Search query or keywords...').fill('shopify');",
        smartLocator: { strategy: "placeholder", tag: "input", placeholder: "Search query or keywords..." },
        applicationMetadata: { application: "Awwwards", confidence: 0.9, signals: ["host"] },
        pageMetadata: { pageType: "Gallery", module: "ecommerce", entity: "Site", confidence: 0.9, signals: ["url"] },
        intent: { eventId: "search-site", intent: "Search", confidence: 0.9, signals: ["form"] }
      } as RecordedAction
    ],
    [
      optimizedAction("search-site", "fill", "page.getByPlaceholder('Search query or keywords...')", {
        value: "shopify",
        codeLine: "await page.getByPlaceholder('Search query or keywords...').fill('shopify');"
      })
    ],
    targetUrl
  );
}

test("an explicitly saved active project is restored after a simulated provider reload, not whichever saved project happens to be newest", async () => {
  const storageDir = mkdtempSync(path.join(tmpdir(), "framework-project-active-"));
  const serviceNowUrl = "https://dev442568.service-now.com/incident_list.do";
  const awwwardsUrl = "https://www.awwwards.com/websites/e-commerce/";

  try {
    const store = new FrameworkProjectStorage({ baseDir: storageDir });

    // 1. Save ServiceNow and explicitly mark it active -- exactly what
    // saveFrameworkProject()/loadFrameworkProject() do in RecordingContext.
    const savedServiceNow = await store.save(serviceNowIncidentProject(serviceNowUrl), {
      name: "servicenow-incident",
      targetUrl: serviceNowUrl
    });
    await store.setActiveProjectId(savedServiceNow.projectId);

    // 2. Save a second, chronologically NEWER project (Awwwards) without
    // ever touching the active-project record. This is the exact shape of
    // the reported bug: a more-recently-saved project existing in storage
    // must never silently become active on its own.
    await store.save(awwwardsEcommerceProject(awwwardsUrl), {
      name: "awwwards-ecommerce",
      targetUrl: awwwardsUrl
    });

    // 3. Simulate a provider reload (fresh RecordingProvider mount) with a
    // brand new FrameworkProjectStorage instance over the same storage.
    const restartedStore = new FrameworkProjectStorage({ baseDir: storageDir });
    const activeProjectId = await restartedStore.getActiveProjectId();
    assert.equal(
      activeProjectId,
      savedServiceNow.projectId,
      "the newer Awwwards save must not have displaced the explicitly active ServiceNow project"
    );

    // 4. Restore exactly as loadFrameworkProject() does.
    const restored = await restartedStore.load(activeProjectId!);
    assert.equal(restored.projectId, savedServiceNow.projectId);
    assert.equal(restored.targetUrl, serviceNowUrl, "the ServiceNow target URL must be restored, not the Awwwards demo default");

    // 5. The restored framework remains usable for AI Test Generation --
    // same availability/matching path the live app uses, not just a raw
    // file blob.
    const availability = getMatchAvailability(false, true, true);
    assert.equal(availability.canGenerate, true);
    const match = matchWorkflow("Update incident and set Urgency to 1", restored);
    assert.ok(match.reusableWorkflows.length > 0, "restored project's workflows must still be reusable");
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
  }
});

test("a saved project is never active merely by existing in storage -- only an explicit save or load sets it", async () => {
  const storageDir = mkdtempSync(path.join(tmpdir(), "framework-project-not-active-"));

  try {
    const store = new FrameworkProjectStorage({ baseDir: storageDir });

    // Nothing has ever been marked active yet.
    assert.equal(await store.getActiveProjectId(), null);

    // Saving three projects back to back, in realistic chronological
    // order, WITHOUT ever calling setActiveProjectId for any of them --
    // mirrors generateFrameworkProject()/"Generate Framework" producing a
    // project that was never explicitly saved via Save Project.
    await store.save(awwwardsEcommerceProject("https://www.awwwards.com/websites/e-commerce/"), {
      name: "awwwards-ecommerce"
    });
    await store.save(serviceNowIncidentProject("https://dev442568.service-now.com/incident_list.do"), {
      name: "servicenow-incident"
    });
    await store.save(awwwardsEcommerceProject("https://www.awwwards.com/websites/e-commerce/"), {
      name: "awwwards-ecommerce-2"
    });

    assert.equal(
      await store.getActiveProjectId(),
      null,
      "no save() alone -- regardless of recency -- may ever make a project active"
    );
    assert.equal((await store.list()).length, 3, "all three projects remain safely persisted");
  } finally {
    rmSync(storageDir, { recursive: true, force: true });
  }
});
