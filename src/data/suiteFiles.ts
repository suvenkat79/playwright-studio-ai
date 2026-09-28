import { SuiteFile, TestRun } from '../types';

export const INITIAL_SUITE_FILES: SuiteFile[] = [
  {
    id: 'AwwwardsEcommercePage.ts',
    name: 'AwwwardsEcommercePage.ts',
    category: 'pom',
    description: 'Awwwards E-Commerce Page Object Model (Headed)',
    locCount: 36,
    healingActive: true,
    content: `import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object Model for Awwwards E-Commerce Gallery
 * Target: https://www.awwwards.com/websites/e-commerce/
 */
export class AwwwardsEcommercePage {
  readonly page: Page;
  readonly pageHeading: Locator;
  readonly filterCategoryBtn: Locator;
  readonly searchInput: Locator;
  readonly nomineeCards: Locator;
  readonly voteButtons: Locator;
  readonly submitSiteBtn: Locator;
  readonly platformFilterShopify: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageHeading = page.getByRole('heading', { name: /E-Commerce Websites/i });
    this.filterCategoryBtn = page.getByRole('button', { name: /Categories|Filters/i });
    this.searchInput = page.getByPlaceholder(/Search Websites, Designers/i);
    this.nomineeCards = page.locator('.box-item, [data-testid="award-card"], article.card');
    this.voteButtons = page.getByRole('button', { name: /Vote Now|Vote/i });
    this.submitSiteBtn = page.getByRole('link', { name: /Submit your Site/i });
    this.platformFilterShopify = page.getByRole('button', { name: /Shopify|Headless/i });
  }

  async navigate() {
    // Navigate with headed browser window visible
    await this.page.goto('https://www.awwwards.com/websites/e-commerce/', {
      waitUntil: 'domcontentloaded'
    });
    await expect(this.pageHeading).toBeVisible({ timeout: 10000 });
  }

  async inspectFeaturedAwardWinner(cardIndex: number = 0) {
    const card = this.nomineeCards.nth(cardIndex);
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await expect(card).toBeVisible();
    return card;
  }

  async verifyNomineesGridLoaded() {
    await expect(this.nomineeCards.first()).toBeVisible();
    const count = await this.nomineeCards.count();
    expect(count).toBeGreaterThan(0);
    return count;
  }
}`
  },
  {
    id: 'awwwards-ecommerce.spec.ts',
    name: 'awwwards-ecommerce.spec.ts',
    category: 'test',
    description: 'Headed E2E spec (headless: false) on Awwwards',
    locCount: 42,
    healingActive: true,
    content: `import { test, expect } from '@playwright/test';
import { AwwwardsEcommercePage } from './AwwwardsEcommercePage';

// Configure test to run in headed mode with visible browser window
test.use({
  headless: false,
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    slowMo: 100 // Slow down actions by 100ms so they are easily visible on screen
  }
});

test.describe('Awwwards E-Commerce Showcase (Headed Execution: headless: false)', () => {
  let awwwardsPage: AwwwardsEcommercePage;

  test.beforeEach(async ({ page }) => {
    awwwardsPage = new AwwwardsEcommercePage(page);
    await test.step('Launch visible browser window and navigate to e-commerce category', async () => {
      await awwwardsPage.navigate();
    });
  });

  test('should inspect award-winning e-commerce nominees in headed window', async ({ page }) => {
    await test.step('Verify E-Commerce category header and title', async () => {
      await expect(awwwardsPage.pageHeading).toBeVisible();
      await expect(page).toHaveTitle(/E-Commerce.*Awwwards/i);
    });

    await test.step('Inspect featured e-commerce nominee card', async () => {
      const winnerCard = await awwwardsPage.inspectFeaturedAwardWinner(0);
      await expect(winnerCard).toBeVisible();
    });

    await test.step('Confirm submission CTA and navigation filters are accessible', async () => {
      await expect(awwwardsPage.submitSiteBtn).toBeVisible();
    });
  });
});`
  },
  {
    id: 'IncidentManagementPage.ts',
    name: 'IncidentManagementPage.ts',
    category: 'pom',
    description: 'Incident Management Page Object Model',
    locCount: 24,
    healingActive: true,
    content: `import { Page, Locator, expect } from '@playwright/test';

export class IncidentManagementPage {
  readonly page: Page;
  readonly createIncidentBtn: Locator;
  readonly shortDescriptionInput: Locator;
  readonly urgencySelect: Locator;
  readonly submitBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createIncidentBtn = page.getByRole('button', { name: 'New Incident' });
    this.shortDescriptionInput = page.getByLabel('Short description');
    this.urgencySelect = page.getByRole('combobox', { name: 'Urgency' });
    this.submitBtn = page.getByTestId('submit-incident-action');
  }

  async createTicket(description: string, urgency: 'Low' | 'Medium' | 'High' = 'High') {
    await this.createIncidentBtn.click();
    await this.shortDescriptionInput.fill(description);
    await this.urgencySelect.selectOption(urgency);
    await this.submitBtn.click();
    await expect(this.page.getByText('Incident created successfully')).toBeVisible();
  }
}`
  },
  {
    id: 'incident-e2e.spec.ts',
    name: 'incident-e2e.spec.ts',
    category: 'test',
    description: 'Enterprise Incident E2E suite',
    locCount: 38,
    healingActive: true,
    content: `import { test, expect } from '@playwright/test';
import { IncidentManagementPage } from './IncidentManagementPage';

test.describe('Enterprise Incident Management E2E', () => {
  let incidentPage: IncidentManagementPage;

  test.beforeEach(async ({ page }) => {
    incidentPage = new IncidentManagementPage(page);
    await page.goto('/incidents/dashboard');
  });

  test('should create high-priority outage ticket with telemetry trace', async ({ page }) => {
    await test.step('Fill and submit new high priority incident', async () => {
      await incidentPage.createTicket(
        'Database Latency Spike - Checkout Services Degraded',
        'High'
      );
    });

    await test.step('Verify ticket displays in active triage queue', async () => {
      const activeItem = page.getByRole('row', { name: /Checkout Services Degraded/ });
      await expect(activeItem).toBeVisible();
      await expect(activeItem.getByText('HIGH')).toBeVisible();
    });
  });
});`
  },
  {
    id: 'playwright.config.ts',
    name: 'playwright.config.ts',
    category: 'config',
    description: 'Playwright Config with Headless: false (Headed Window Visible)',
    locCount: 35,
    healingActive: false,
    content: `import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Enterprise Configuration
 * Configured with headless: false (Headed mode)
 * Target: https://www.awwwards.com/websites/e-commerce/
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],
  use: {
    // RUN WITH HEADED BROWSER WINDOW VISIBLE
    headless: false,
    baseURL: 'https://www.awwwards.com/websites/e-commerce/',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: false, // Window will be visible on screen
        launchOptions: {
          slowMo: 100, // 100ms pause between actions for visual inspection
          args: ['--start-maximized']
        }
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        headless: false,
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        headless: false,
      },
    },
  ],
});`
  }
];

export const MOCK_TEST_RUNS: TestRun[] = [
  {
    id: 'run-409',
    runNumber: 409,
    suiteName: 'Awwwards E-Commerce Suite (Headed)',
    branch: 'main',
    commitSha: 'b4c8109',
    timestamp: 'Just now',
    status: 'passed',
    durationMs: 542,
    browser: 'chromium',
    totalSteps: 7,
    healedCount: 0
  },
  {
    id: 'run-408',
    runNumber: 408,
    suiteName: 'Enterprise E2E Suite',
    branch: 'main',
    commitSha: 'a9e4f2b',
    timestamp: '2 mins ago',
    status: 'passed',
    durationMs: 412,
    browser: 'chromium',
    totalSteps: 7,
    healedCount: 1
  },
  {
    id: 'run-407',
    runNumber: 407,
    suiteName: 'Enterprise E2E Suite',
    branch: 'feat/self-healing-v2',
    commitSha: '78b19d4',
    timestamp: '24 mins ago',
    status: 'passed',
    durationMs: 456,
    browser: 'chromium',
    totalSteps: 7,
    healedCount: 2
  },
  {
    id: 'run-406',
    runNumber: 406,
    suiteName: 'Enterprise E2E Suite',
    branch: 'main',
    commitSha: '61a0c88',
    timestamp: '1 hour ago',
    status: 'flaky',
    durationMs: 620,
    browser: 'firefox',
    totalSteps: 7,
    healedCount: 1
  }
];
