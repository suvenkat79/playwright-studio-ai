import JSZip from 'jszip';
import { SuiteFile } from '../types';

export async function generateAndDownloadZip(files: SuiteFile[], isHeadless: boolean = false): Promise<boolean> {
  try {
    const zip = new JSZip();

    // Add source files
    const pagesFolder = zip.folder('pages');
    const testsFolder = zip.folder('tests');

    files.forEach((file) => {
      if (file.category === 'pom') {
        pagesFolder?.file(file.name, file.content);
        // Also provide inside tests folder so both './File' and '../pages/File' imports resolve seamlessly
        testsFolder?.file(file.name, file.content);
      } else if (file.category === 'test') {
        testsFolder?.file(file.name, file.content);
      } else {
        zip.file(file.name, file.content);
      }
    });

    // Add package.json
    const packageJson = {
      name: 'playwright-enterprise-suite',
      version: '1.2.0',
      private: true,
      scripts: {
        dev: 'playwright test --ui',
        test: isHeadless ? 'playwright test' : 'playwright test --headed',
        'test:headed': 'playwright test --headed',
        'test:headless': 'playwright test',
        'test:ui': 'playwright test --ui',
        'test:debug': 'playwright test --debug',
        'test:report': 'playwright show-report'
      },
      dependencies: {
        '@playwright/test': '^1.50.0'
      },
      devDependencies: {
        '@playwright/test': '^1.50.0',
        '@types/node': '^22.14.0',
        typescript: '^5.7.0'
      }
    };
    zip.file('package.json', JSON.stringify(packageJson, null, 2));

    // Add tsconfig.json
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        moduleResolution: 'node',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      }
    };
    zip.file('tsconfig.json', JSON.stringify(tsconfig, null, 2));

    // Add README.md
    const readme = `# Enterprise E2E Test Suite (Headed Execution: headless: ${isHeadless})

Generated with **Playwright Studio AI v2.4**.
Configured for target: **https://www.awwwards.com/websites/e-commerce/**

## Prerequisites
- Node.js >= 18
- npm or pnpm

## Installation
\`\`\`bash
npm install
npx playwright install --with-deps
\`\`\`

## Running Tests in Headed Mode (headless: false)
\`\`\`bash
# Run with visible desktop browser window (headless: false)
npx playwright test --headed

# Run specifically the Awwwards E-Commerce test suite:
npx playwright test tests/awwwards-ecommerce.spec.ts --headed

# Run with interactive UI mode (Time-travel trace debugger)
npx playwright test --ui

# Run in debug mode (Step-by-step inspector)
npx playwright test --debug

# View HTML report
npx playwright show-report
\`\`\`

## Architecture & Page Objects
- \`pages/AwwwardsEcommercePage.ts\` — Page Object Model with auto-waiting semantic locators.
- \`tests/awwwards-ecommerce.spec.ts\` — Headed E2E test specification.
- \`playwright.config.ts\` — Multi-browser config with \`headless: ${isHeadless}\`.
`;
    zip.file('README.md', readme);

    // Generate zip blob
    const content = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(content);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = 'playwright-enterprise-suite.zip';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);

    return true;
  } catch (error) {
    console.error('Failed to generate ZIP:', error);
    return false;
  }
}
