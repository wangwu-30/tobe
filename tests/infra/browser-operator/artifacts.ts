import fs from 'node:fs';
import path from 'node:path';
import type { BrowserObservation, BrowserRunArtifactPaths } from './types';

function sanitizeArtifactSegment(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
  const collapsed = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return collapsed || 'run';
}

export function getDefaultBrowserOperatorArtifactRoot() {
  return (
    process.env.BROWSER_OPERATOR_ARTIFACT_ROOT ||
    path.join(process.cwd(), '.tmp', 'browser-operator')
  );
}

export function createBrowserRunArtifactPaths(params: {
  artifactRoot?: string;
  runId: string;
  targetId: string;
}): BrowserRunArtifactPaths {
  const rootDir = path.join(
    params.artifactRoot || getDefaultBrowserOperatorArtifactRoot(),
    sanitizeArtifactSegment(params.targetId),
    sanitizeArtifactSegment(params.runId)
  );
  const observationsDir = path.join(rootDir, 'observations');
  const evidenceDir = path.join(rootDir, 'evidence');

  fs.mkdirSync(observationsDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  return {
    rootDir,
    evidenceDir,
    observationsDir,
    initialObservationPath: path.join(observationsDir, 'step-0000-initial.json'),
    reportPath: path.join(rootDir, 'report.json'),
    transcriptPath: path.join(rootDir, 'transcript.json'),
  };
}

export function getBrowserObservationPath(
  artifactPaths: BrowserRunArtifactPaths,
  step: number
) {
  return path.join(
    artifactPaths.observationsDir,
    `step-${String(step).padStart(4, '0')}.json`
  );
}

export function writeBrowserOperatorJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeBrowserObservation(
  artifactPaths: BrowserRunArtifactPaths,
  step: number,
  observation: BrowserObservation
) {
  writeBrowserOperatorJson(getBrowserObservationPath(artifactPaths, step), observation);
}
