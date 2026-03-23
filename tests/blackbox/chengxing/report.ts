import fs from 'node:fs';
import path from 'node:path';
import type { BrowserRunReport } from '../../infra/browser-operator';
import {
  writeBrowserOperatorJson,
} from '../../infra/browser-operator';
import type {
  BlackboxScoreCard,
  ChengxingBlackboxAggregateReport,
  ChengxingBlackboxScenario,
  ChengxingBlackboxScenarioReport,
} from './types';

const AI_INSPECTOR_DIR = 'ai-inspector';

export function getBlackboxAcceptanceRoot() {
  return (
    process.env.BLACKBOX_ACCEPTANCE_ROOT ||
    path.join(process.cwd(), '.tmp', 'blackbox-acceptance')
  );
}

export function getBlackboxArtifactsRoot() {
  return (
    process.env.BLACKBOX_ARTIFACTS_ROOT ||
    path.join(getBlackboxAcceptanceRoot(), 'artifacts')
  );
}

export function getAiInspectorArtifactRoot() {
  return path.join(getBlackboxArtifactsRoot(), AI_INSPECTOR_DIR);
}

export function getAiInspectorScenarioRoot(scenarioId: string) {
  return path.join(getAiInspectorArtifactRoot(), 'scenarios', scenarioId.toLowerCase());
}

export function getAiInspectorAggregatePaths() {
  const rootDir = getAiInspectorArtifactRoot();
  return {
    json: path.join(rootDir, 'report.json'),
    markdown: path.join(rootDir, 'report.md'),
    rootDir,
  };
}

export function writeChengxingBlackboxReport(params: {
  browserRun: BrowserRunReport;
  scenario: ChengxingBlackboxScenario;
}) {
  const scenarioReport = buildScenarioReport(params);
  const scenarioReportPath = path.join(
    getAiInspectorScenarioRoot(params.scenario.id),
    'scenario-report.json'
  );

  writeBrowserOperatorJson(scenarioReportPath, scenarioReport);
  const aggregate = upsertAggregateReport(scenarioReport);

  return {
    aggregate,
    aggregatePaths: getAiInspectorAggregatePaths(),
    scenarioReport,
    scenarioReportPath,
  };
}

function buildScenarioReport(params: {
  browserRun: BrowserRunReport;
  scenario: ChengxingBlackboxScenario;
}): ChengxingBlackboxScenarioReport {
  const scores = scoreScenario(params.browserRun, params.scenario);
  const gatePassed =
    scores.average >= params.scenario.threshold.minAverageScore &&
    scores.reachability >= params.scenario.threshold.minDimensionScore &&
    scores.fluency >= params.scenario.threshold.minDimensionScore &&
    scores.feedback >= params.scenario.threshold.minDimensionScore &&
    scores.understandability >= params.scenario.threshold.minDimensionScore &&
    scores.errorTolerance >= params.scenario.threshold.minDimensionScore;

  return {
    browserRun: {
      artifactPaths: params.browserRun.artifactPaths,
      elapsedMs: params.browserRun.elapsedMs,
      failure: params.browserRun.failure,
      finishedAt: params.browserRun.finishedAt,
      runId: params.browserRun.runId,
      startedAt: params.browserRun.startedAt,
      status: params.browserRun.status,
    },
    gatePassed,
    generatedAt: new Date().toISOString(),
    scenario: {
      acceptanceFocus: params.scenario.acceptanceFocus,
      id: params.scenario.id,
      journey: params.scenario.journey,
      title: params.scenario.title,
    },
    scores,
    summary: buildScenarioSummary(params.browserRun, scores, gatePassed),
  };
}

function upsertAggregateReport(
  scenarioReport: ChengxingBlackboxScenarioReport
): ChengxingBlackboxAggregateReport {
  const aggregatePaths = getAiInspectorAggregatePaths();
  const existing = readExistingAggregate(aggregatePaths.json);
  const scenarios = [
    ...existing.scenarios.filter((entry) => entry.scenario.id !== scenarioReport.scenario.id),
    scenarioReport,
  ].sort((left, right) => left.scenario.id.localeCompare(right.scenario.id));

  const passedScenarios = scenarios.filter((entry) => entry.gatePassed).length;
  const averageScore =
    scenarios.length > 0
      ? Number(
          (
            scenarios.reduce((sum, entry) => sum + entry.scores.average, 0) /
            scenarios.length
          ).toFixed(1)
        )
      : 0;
  const aggregate: ChengxingBlackboxAggregateReport = {
    generatedAt: new Date().toISOString(),
    scenarios,
    summary: {
      averageScore,
      failedScenarios: scenarios.length - passedScenarios,
      gatePassed: passedScenarios === scenarios.length && scenarios.length > 0,
      passedScenarios,
      totalScenarios: scenarios.length,
    },
  };

  writeBrowserOperatorJson(aggregatePaths.json, aggregate);
  fs.mkdirSync(path.dirname(aggregatePaths.markdown), { recursive: true });
  fs.writeFileSync(aggregatePaths.markdown, formatAggregateMarkdown(aggregate), 'utf8');

  return aggregate;
}

function readExistingAggregate(filePath: string): ChengxingBlackboxAggregateReport {
  if (!fs.existsSync(filePath)) {
    return {
      generatedAt: new Date(0).toISOString(),
      scenarios: [],
      summary: {
        averageScore: 0,
        failedScenarios: 0,
        gatePassed: false,
        passedScenarios: 0,
        totalScenarios: 0,
      },
    };
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ChengxingBlackboxAggregateReport;
  } catch {
    return {
      generatedAt: new Date(0).toISOString(),
      scenarios: [],
      summary: {
        averageScore: 0,
        failedScenarios: 0,
        gatePassed: false,
        passedScenarios: 0,
        totalScenarios: 0,
      },
    };
  }
}

function scoreScenario(
  browserRun: BrowserRunReport,
  scenario: ChengxingBlackboxScenario
): BlackboxScoreCard {
  const recoveryCount = browserRun.transcript.reduce(
    (sum, entry) => sum + entry.recoveryCount,
    0
  );
  const expectedVisibleText = scenario.expectedVisibleText?.trim();
  const visibleText = browserRun.finalObservation?.visibleText || [];
  const hasExpectedVisibleText = expectedVisibleText
    ? visibleText.some((entry) => entry.includes(expectedVisibleText))
    : browserRun.status === 'passed';

  const reachability = browserRun.status === 'passed' ? 5 : browserRun.status === 'blocked' ? 2 : 1;

  let fluency = browserRun.status === 'passed' ? 5 : 2;
  if (browserRun.transcript.length > 8) {
    fluency -= 1;
  }
  if (browserRun.elapsedMs > 45_000) {
    fluency -= 1;
  }
  if (recoveryCount > 0) {
    fluency -= Math.min(2, recoveryCount);
  }

  let feedback = browserRun.status === 'passed' ? 3 : 1;
  if (hasExpectedVisibleText) {
    feedback = 5;
  } else if (visibleText.length > 0) {
    feedback = 4;
  }

  let understandability = browserRun.status === 'passed' ? 3 : 1;
  if (hasExpectedVisibleText) {
    understandability = 5;
  } else if (browserRun.finalObservation?.title || visibleText.length > 0) {
    understandability = 4;
  }

  let errorTolerance = browserRun.failure ? 1 : 5;
  if (!browserRun.failure && recoveryCount > 0) {
    errorTolerance = 4;
  }
  if (browserRun.failure?.code === 'budget-exceeded') {
    errorTolerance = 2;
  }

  const normalized: BlackboxScoreCard = {
    errorTolerance: clampScore(errorTolerance),
    feedback: clampScore(feedback),
    fluency: clampScore(fluency),
    reachability: clampScore(reachability),
    understandability: clampScore(understandability),
    average: 0,
  };

  normalized.average = Number(
    (
      (normalized.reachability +
        normalized.fluency +
        normalized.feedback +
        normalized.understandability +
        normalized.errorTolerance) /
      5
    ).toFixed(1)
  );

  return normalized;
}

function clampScore(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function buildScenarioSummary(
  browserRun: BrowserRunReport,
  scores: BlackboxScoreCard,
  gatePassed: boolean
) {
  const failure = browserRun.failure?.message ? `失败原因：${browserRun.failure.message}` : '';
  const summary = [
    gatePassed ? '黑盒门禁通过。' : '黑盒门禁未通过。',
    `状态：${browserRun.status}，总耗时 ${browserRun.elapsedMs}ms，平均分 ${scores.average}。`,
    failure,
  ]
    .filter(Boolean)
    .join(' ');

  return summary;
}

function formatAggregateMarkdown(aggregate: ChengxingBlackboxAggregateReport) {
  const rows = aggregate.scenarios.map((scenario) =>
    [
      scenario.scenario.id,
      scenario.scenario.title,
      scenario.gatePassed ? 'passed' : 'failed',
      scenario.scores.average.toFixed(1),
      scenario.scores.reachability,
      scenario.scores.fluency,
      scenario.scores.feedback,
      scenario.scores.understandability,
      scenario.scores.errorTolerance,
    ].join(' | ')
  );

  return [
    '# 成形 AI Inspector 报告',
    '',
    `生成时间：${aggregate.generatedAt}`,
    '',
    `总场景：${aggregate.summary.totalScenarios}，通过：${aggregate.summary.passedScenarios}，失败：${aggregate.summary.failedScenarios}，平均分：${aggregate.summary.averageScore.toFixed(1)}`,
    '',
    '| 场景 | 标题 | 结果 | 平均分 | 可达性 | 流畅度 | 反馈性 | 可理解性 | 错误容忍 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
}
