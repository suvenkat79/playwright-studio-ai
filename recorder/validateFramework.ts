import { validateFrameworkProject } from '../src/services/frameworkValidator';

/**
 * One-shot CLI entry point for "Validate Framework": reads a single JSON
 * payload ({"files": {...}}) from stdin, runs the deterministic tsc
 * --noEmit check via validateFrameworkProject (the one place this logic
 * lives), and writes a single JSON result line to stdout. Spawned by the
 * Java backend's FrameworkValidationService via ProcessBuilder, the same
 * way recorder/dist/cli.js is spawned for recording sessions -- but this
 * is a short-lived request/response process, not a long-running session.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const input = await readStdin();
  const { files } = JSON.parse(input) as { files: Record<string, string> };
  const result = await validateFrameworkProject(files);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({
    status: 'FAIL',
    diagnostics: [{ file: '', message }],
    checkedAt: Date.now()
  })}\n`);
  process.exitCode = 1;
});
