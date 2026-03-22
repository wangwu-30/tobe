import {
  createBrowserRunArtifactPaths,
  writeBrowserObservation,
  writeBrowserOperatorJson,
} from './artifacts';
import type {
  BrowserAction,
  BrowserActionOutcome,
  BrowserEvaluator,
  BrowserObservation,
  BrowserOperatorDriver,
  BrowserOperatorDriverContext,
  BrowserRunBudget,
  BrowserRunFailure,
  BrowserRunReport,
  BrowserRunRequest,
  BrowserTranscriptEntry,
} from './types';

const DEFAULT_BROWSER_RUN_BUDGET: BrowserRunBudget = {
  maxElapsedMs: 120_000,
  maxRecoveriesPerStep: 1,
  maxSteps: 20,
};

function normalizeBrowserRunBudget(
  budget: Partial<BrowserRunBudget> | undefined
): BrowserRunBudget {
  return {
    maxElapsedMs: Math.max(5_000, budget?.maxElapsedMs ?? DEFAULT_BROWSER_RUN_BUDGET.maxElapsedMs),
    maxRecoveriesPerStep: Math.max(
      0,
      budget?.maxRecoveriesPerStep ?? DEFAULT_BROWSER_RUN_BUDGET.maxRecoveriesPerStep
    ),
    maxSteps: Math.max(1, budget?.maxSteps ?? DEFAULT_BROWSER_RUN_BUDGET.maxSteps),
  };
}

function buildDriverContext(params: {
  artifactPaths: BrowserRunReport['artifactPaths'];
  budget: BrowserRunBudget;
  latestObservation: BrowserObservation | null;
  request: BrowserRunRequest;
  startedAt: string;
  step: number;
  transcript: BrowserTranscriptEntry[];
}): BrowserOperatorDriverContext {
  return {
    artifactPaths: params.artifactPaths,
    budget: params.budget,
    latestObservation: params.latestObservation,
    request: params.request,
    startedAt: params.startedAt,
    step: params.step,
    transcript: params.transcript,
  };
}

function assertValidAction(action: BrowserAction) {
  switch (action.kind) {
    case 'goto':
      if (!action.url.trim()) {
        throw new Error('BrowserAction.goto requires a non-empty url.');
      }
      return;
    case 'click':
    case 'fill':
    case 'select':
      if (!action.target) {
        throw new Error(`BrowserAction.${action.kind} requires a target.`);
      }
      return;
    case 'press':
      if (!action.key.trim()) {
        throw new Error('BrowserAction.press requires a key.');
      }
      return;
    case 'wait_for':
      if (!action.target && !action.text && typeof action.timeMs !== 'number') {
        throw new Error(
          'BrowserAction.wait_for requires a target, text matcher, or explicit timeMs.'
        );
      }
      return;
    case 'assert':
      if (
        (action.condition === 'contains-text' ||
          action.condition === 'url-includes' ||
          action.condition === 'url-is') &&
        !action.value?.trim()
      ) {
        throw new Error(`BrowserAction.assert(${action.condition}) requires a value.`);
      }
      return;
    case 'extract':
      if (!action.schema.trim() || !action.storeAs.trim()) {
        throw new Error('BrowserAction.extract requires schema and storeAs.');
      }
      return;
    case 'finish':
      if (!action.summary.trim()) {
        throw new Error('BrowserAction.finish requires a summary.');
      }
      return;
    default: {
      const neverAction: never = action;
      throw new Error(`Unsupported browser action: ${JSON.stringify(neverAction)}`);
    }
  }
}

function buildFailure(params: {
  code: BrowserRunFailure['code'];
  message: string;
  step: number | null;
}): BrowserRunFailure {
  return {
    code: params.code,
    message: params.message,
    step: params.step,
  };
}

function finalizeRun(params: {
  artifactPaths: BrowserRunReport['artifactPaths'];
  budget: BrowserRunBudget;
  failure?: BrowserRunFailure;
  finalObservation: BrowserObservation | null;
  finishedAt: Date;
  request: BrowserRunRequest;
  startedAt: Date;
  status: BrowserRunReport['status'];
  transcript: BrowserTranscriptEntry[];
}) {
  const report: BrowserRunReport = {
    artifactPaths: params.artifactPaths,
    budget: params.budget,
    elapsedMs: params.finishedAt.getTime() - params.startedAt.getTime(),
    finalObservation: params.finalObservation,
    finishedAt: params.finishedAt.toISOString(),
    request: params.request,
    runId: params.request.id,
    startedAt: params.startedAt.toISOString(),
    status: params.status,
    transcript: params.transcript,
    ...(params.failure ? { failure: params.failure } : {}),
  };

  writeBrowserOperatorJson(params.artifactPaths.transcriptPath, params.transcript);
  writeBrowserOperatorJson(params.artifactPaths.reportPath, report);
  return report;
}

async function executeActionWithRecovery(params: {
  action: BrowserAction;
  budget: BrowserRunBudget;
  context: BrowserOperatorDriverContext;
  driver: BrowserOperatorDriver;
}): Promise<{ outcome: BrowserActionOutcome; recoveryCount: number }> {
  let recoveryCount = 0;

  while (true) {
    try {
      const outcome = await params.driver.executeAction(params.action, params.context);

      if (
        outcome.status !== 'failed' ||
        !params.driver.recover ||
        recoveryCount >= params.budget.maxRecoveriesPerStep
      ) {
        return { outcome, recoveryCount };
      }

      recoveryCount += 1;
      const recovered = await params.driver.recover({
        action: params.action,
        attempt: recoveryCount,
        context: params.context,
        error: outcome,
      });

      if (recovered) {
        return { outcome: recovered, recoveryCount };
      }
    } catch (error) {
      if (!params.driver.recover || recoveryCount >= params.budget.maxRecoveriesPerStep) {
        throw error;
      }

      recoveryCount += 1;
      const recovered = await params.driver.recover({
        action: params.action,
        attempt: recoveryCount,
        context: params.context,
        error,
      });

      if (recovered) {
        return { outcome: recovered, recoveryCount };
      }
    }
  }
}

export async function runBrowserOperator(params: {
  artifactRoot?: string;
  driver: BrowserOperatorDriver;
  evaluator: BrowserEvaluator;
  now?: () => Date;
  request: BrowserRunRequest;
}): Promise<BrowserRunReport> {
  const now = params.now || (() => new Date());
  const startedAt = now();
  const budget = normalizeBrowserRunBudget(params.request.budget);
  const artifactPaths = createBrowserRunArtifactPaths({
    artifactRoot: params.artifactRoot,
    runId: params.request.id,
    targetId: params.request.target.id,
  });

  let transcript: BrowserTranscriptEntry[] = [];
  let latestObservation =
    params.request.initialObservation ||
    (await params.driver.captureObservation(
      buildDriverContext({
        artifactPaths,
        budget,
        latestObservation: null,
        request: params.request,
        startedAt: startedAt.toISOString(),
        step: 0,
        transcript,
      })
    ));

  writeBrowserOperatorJson(artifactPaths.initialObservationPath, latestObservation);

  for (let step = 1; step <= budget.maxSteps; step += 1) {
    const stepStartedAt = now();
    const elapsedMs = stepStartedAt.getTime() - startedAt.getTime();

    if (elapsedMs > budget.maxElapsedMs) {
      return finalizeRun({
        artifactPaths,
        budget,
        failure: buildFailure({
          code: 'budget-exceeded',
          message: `Browser operator exceeded ${budget.maxElapsedMs}ms before step ${step}.`,
          step: step - 1,
        }),
        finalObservation: latestObservation,
        finishedAt: stepStartedAt,
        request: params.request,
        startedAt,
        status: 'failed',
        transcript,
      });
    }

    let action: BrowserAction;

    try {
      action = await params.evaluator.nextAction({
        budget,
        observation: latestObservation,
        request: params.request,
        startedAt: startedAt.toISOString(),
        step,
        transcript,
      });
      assertValidAction(action);
    } catch (error) {
      return finalizeRun({
        artifactPaths,
        budget,
        failure: buildFailure({
          code: 'invalid-action',
          message:
            error instanceof Error
              ? error.message
              : 'Browser evaluator returned an invalid action.',
          step,
        }),
        finalObservation: latestObservation,
        finishedAt: now(),
        request: params.request,
        startedAt,
        status: 'failed',
        transcript,
      });
    }

    if (action.kind === 'finish') {
      return finalizeRun({
        artifactPaths,
        budget,
        finalObservation: latestObservation,
        finishedAt: now(),
        request: params.request,
        startedAt,
        status: action.status || 'passed',
        transcript,
      });
    }

    const context = buildDriverContext({
      artifactPaths,
      budget,
      latestObservation,
      request: params.request,
      startedAt: startedAt.toISOString(),
      step,
      transcript,
    });

    try {
      const { outcome, recoveryCount } = await executeActionWithRecovery({
        action,
        budget,
        context,
        driver: params.driver,
      });
      const observation = outcome.observation || (await params.driver.captureObservation(context));
      const stepFinishedAt = now();
      const entry: BrowserTranscriptEntry = {
        action,
        elapsedMs: stepFinishedAt.getTime() - stepStartedAt.getTime(),
        finishedAt: stepFinishedAt.toISOString(),
        observation,
        outcome,
        recoveryCount,
        startedAt: stepStartedAt.toISOString(),
        step,
      };

      transcript = [...transcript, entry];
      latestObservation = observation;

      writeBrowserObservation(artifactPaths, step, observation);

      if (outcome.status === 'failed') {
        return finalizeRun({
          artifactPaths,
          budget,
          failure: buildFailure({
            code: 'step-failed',
            message: outcome.summary,
            step,
          }),
          finalObservation: latestObservation,
          finishedAt: stepFinishedAt,
          request: params.request,
          startedAt,
          status: 'failed',
          transcript,
        });
      }
    } catch (error) {
      return finalizeRun({
        artifactPaths,
        budget,
        failure: buildFailure({
          code: 'driver-error',
          message:
            error instanceof Error
              ? error.message
              : `Browser driver crashed on step ${step}.`,
          step,
        }),
        finalObservation: latestObservation,
        finishedAt: now(),
        request: params.request,
        startedAt,
        status: 'failed',
        transcript,
      });
    }
  }

  return finalizeRun({
    artifactPaths,
    budget,
    failure: buildFailure({
      code: 'budget-exceeded',
      message: `Browser operator hit the max step budget (${budget.maxSteps}).`,
      step: budget.maxSteps,
    }),
    finalObservation: latestObservation,
    finishedAt: now(),
    request: params.request,
    startedAt,
    status: 'failed',
    transcript,
  });
}
