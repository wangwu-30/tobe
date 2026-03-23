import type {
  BrowserEvaluator,
  BrowserOperatorTarget,
  BrowserRunReport,
} from '../../infra/browser-operator';

export type BlackboxScoreCard = {
  average: number;
  errorTolerance: number;
  feedback: number;
  fluency: number;
  reachability: number;
  understandability: number;
};

export type BlackboxThreshold = {
  minAverageScore: number;
  minDimensionScore: number;
};

export type ChengxingBlackboxScenario = {
  acceptanceFocus: string;
  createEvaluator(): BrowserEvaluator;
  expectedVisibleText?: string | null;
  id: string;
  journey: string;
  target: BrowserOperatorTarget;
  task: string;
  threshold: BlackboxThreshold;
  title: string;
};

export type ChengxingBlackboxScenarioSummary = {
  acceptanceFocus: string;
  id: string;
  journey: string;
  title: string;
};

export type ChengxingBlackboxScenarioReport = {
  browserRun: Pick<
    BrowserRunReport,
    'artifactPaths' | 'elapsedMs' | 'failure' | 'finishedAt' | 'runId' | 'startedAt' | 'status'
  >;
  gatePassed: boolean;
  generatedAt: string;
  scenario: ChengxingBlackboxScenarioSummary;
  scores: BlackboxScoreCard;
  summary: string;
};

export type ChengxingBlackboxAggregateReport = {
  generatedAt: string;
  scenarios: ChengxingBlackboxScenarioReport[];
  summary: {
    averageScore: number;
    failedScenarios: number;
    gatePassed: boolean;
    passedScenarios: number;
    totalScenarios: number;
  };
};
