export type BrowserOperatorPrimitive = boolean | number | string | null;

export type BrowserOperatorValue =
  | BrowserOperatorPrimitive
  | BrowserOperatorValue[]
  | { [key: string]: BrowserOperatorValue };

export type BrowserLocator =
  | {
      kind: 'css';
      value: string;
      description?: string;
    }
  | {
      kind: 'label';
      value: string;
      exact?: boolean;
      description?: string;
    }
  | {
      kind: 'role';
      role: string;
      name?: string;
      exact?: boolean;
      description?: string;
    }
  | {
      kind: 'test-id';
      value: string;
      description?: string;
    }
  | {
      kind: 'text';
      value: string;
      exact?: boolean;
      description?: string;
    };

export type BrowserTargetReadiness = {
  locator?: BrowserLocator;
  text?: string;
  urlIncludes?: string;
};

export type BrowserOperatorTarget = {
  id: string;
  label: string;
  baseURL: string;
  bootstrap?: {
    appDataRoot?: string | null;
    description: string;
    seedName?: string | null;
  };
  readiness?: BrowserTargetReadiness;
  locators?: Record<string, BrowserLocator>;
  metadata?: Record<string, BrowserOperatorValue>;
};

export type BrowserObservationElementState = {
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
};

export type BrowserObservationElement = {
  id: string;
  locator?: BrowserLocator | null;
  name?: string | null;
  role: string;
  state?: BrowserObservationElementState;
  text?: string | null;
};

export type BrowserObservationDialog = {
  description?: string | null;
  kind?: 'alertdialog' | 'dialog' | 'sheet';
  title: string | null;
};

export type BrowserObservationNotice = {
  level: 'error' | 'info' | 'success' | 'warning';
  text: string;
};

export type BrowserObservation = {
  dialogs?: BrowserObservationDialog[];
  formFields?: BrowserObservationElement[];
  metadata?: Record<string, BrowserOperatorValue>;
  notices?: BrowserObservationNotice[];
  primaryActions?: BrowserObservationElement[];
  readyState: 'complete' | 'interactive' | 'loading';
  screenshotPath?: string | null;
  summary?: string | null;
  title: string | null;
  url: string;
  visibleText?: string[];
};

export type BrowserRunBudget = {
  maxElapsedMs: number;
  maxRecoveriesPerStep: number;
  maxSteps: number;
};

export type BrowserRunRequest = {
  budget?: Partial<BrowserRunBudget>;
  id: string;
  initialObservation?: BrowserObservation;
  metadata?: Record<string, BrowserOperatorValue>;
  startURL?: string;
  target: BrowserOperatorTarget;
  task: string;
};

type BrowserActionBase = {
  label?: string;
  reason?: string;
  timeoutMs?: number;
};

export type BrowserGotoAction = BrowserActionBase & {
  kind: 'goto';
  url: string;
  waitFor?: 'domcontentloaded' | 'load' | 'networkidle';
};

export type BrowserClickAction = BrowserActionBase & {
  button?: 'left' | 'middle' | 'right';
  clickCount?: 1 | 2;
  kind: 'click';
  target: BrowserLocator;
};

export type BrowserFillAction = BrowserActionBase & {
  clear?: boolean;
  kind: 'fill';
  submit?: boolean;
  target: BrowserLocator;
  value: string;
};

export type BrowserSelectAction = BrowserActionBase & {
  kind: 'select';
  target: BrowserLocator;
  values: string[];
};

export type BrowserPressAction = BrowserActionBase & {
  key: string;
  kind: 'press';
  target?: BrowserLocator;
};

export type BrowserWaitForAction = BrowserActionBase & {
  kind: 'wait_for';
  state?: 'attached' | 'detached' | 'hidden' | 'visible';
  target?: BrowserLocator;
  text?: string;
  timeMs?: number;
};

export type BrowserAssertAction = BrowserActionBase & {
  condition:
    | 'contains-text'
    | 'disabled'
    | 'enabled'
    | 'hidden'
    | 'url-includes'
    | 'url-is'
    | 'visible';
  kind: 'assert';
  target?: BrowserLocator;
  value?: string;
};

export type BrowserExtractAction = BrowserActionBase & {
  kind: 'extract';
  schema: string;
  storeAs: string;
  target?: BrowserLocator;
};

export type BrowserFinishAction = BrowserActionBase & {
  kind: 'finish';
  status?: 'blocked' | 'passed';
  summary: string;
};

export type BrowserAction =
  | BrowserAssertAction
  | BrowserClickAction
  | BrowserExtractAction
  | BrowserFillAction
  | BrowserFinishAction
  | BrowserGotoAction
  | BrowserPressAction
  | BrowserSelectAction
  | BrowserWaitForAction;

export type BrowserActionOutcome = {
  details?: Record<string, BrowserOperatorValue>;
  evidencePaths?: string[];
  extracted?: Record<string, BrowserOperatorValue>;
  observation?: BrowserObservation;
  status: 'failed' | 'ok' | 'recovered';
  summary: string;
};

export type BrowserRunArtifactPaths = {
  evidenceDir: string;
  initialObservationPath: string;
  observationsDir: string;
  reportPath: string;
  rootDir: string;
  transcriptPath: string;
};

export type BrowserTranscriptEntry = {
  action: BrowserAction;
  elapsedMs: number;
  finishedAt: string;
  observation: BrowserObservation;
  outcome: BrowserActionOutcome;
  recoveryCount: number;
  startedAt: string;
  step: number;
};

export type BrowserRunFailure = {
  code: 'budget-exceeded' | 'driver-error' | 'invalid-action' | 'step-failed';
  message: string;
  step: number | null;
};

export type BrowserRunStatus = 'blocked' | 'failed' | 'passed';

export type BrowserRunReport = {
  artifactPaths: BrowserRunArtifactPaths;
  budget: BrowserRunBudget;
  elapsedMs: number;
  failure?: BrowserRunFailure;
  finalObservation: BrowserObservation | null;
  finishedAt: string;
  request: BrowserRunRequest;
  runId: string;
  startedAt: string;
  status: BrowserRunStatus;
  transcript: BrowserTranscriptEntry[];
};

export type BrowserOperatorDriverContext = {
  artifactPaths: BrowserRunArtifactPaths;
  budget: BrowserRunBudget;
  latestObservation: BrowserObservation | null;
  request: BrowserRunRequest;
  startedAt: string;
  step: number;
  transcript: BrowserTranscriptEntry[];
};

export type BrowserRecoveryInput = {
  action: BrowserAction;
  attempt: number;
  context: BrowserOperatorDriverContext;
  error: unknown;
};

export interface BrowserOperatorDriver {
  captureObservation(context: BrowserOperatorDriverContext): Promise<BrowserObservation>;
  executeAction(
    action: BrowserAction,
    context: BrowserOperatorDriverContext
  ): Promise<BrowserActionOutcome>;
  recover?(input: BrowserRecoveryInput): Promise<BrowserActionOutcome | null>;
}

export type BrowserEvaluatorInput = {
  budget: BrowserRunBudget;
  observation: BrowserObservation;
  request: BrowserRunRequest;
  startedAt: string;
  step: number;
  transcript: BrowserTranscriptEntry[];
};

export interface BrowserEvaluator {
  nextAction(input: BrowserEvaluatorInput): Promise<BrowserAction>;
}
