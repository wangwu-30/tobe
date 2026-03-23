import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { runChengxingBlackboxScenario } from './runner';
import {
  buildA1FirstUseScenario,
  buildA2WebFirstUseScenario,
  buildA3IntentClarifyScenario,
  buildB2ChatAdvanceScenario,
  buildB3VersionSaveScenario,
  buildB4BranchSwitchScenario,
  buildC1KnowledgeManageScenario,
  buildC2WorkflowApplyScenario,
} from './scenarios';
import {
  seedChatAdvanceBlackboxScenario,
  seedBranchSwitchBlackboxScenario,
  seedContextPanelBlackboxScenario,
  seedVersionSaveBlackboxScenario,
} from './seed';
import type { ChengxingBlackboxScenario } from './types';

test('AI inspector A1 first-use flow passes the blackbox gate', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const scenario = buildA1FirstUseScenario({
    baseURL,
    goal: `为团队撰写一份成形产品市场分析报告，包含市场机会、竞争格局和建议 ${Date.now()}`,
  });

  await expectScenarioToPass(scenario);
});

test('AI inspector A2 web first-use flow auto-starts preview', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const scenario = buildA2WebFirstUseScenario({
    baseURL,
    goal: `为成形产品创建一个官网落地页，展示核心功能、客户案例和联系入口 ${Date.now()}`,
  });

  await expectScenarioToPass(scenario);
});

test('AI inspector A3 ambiguous first-use flow surfaces intent clarify cards', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const scenario = buildA3IntentClarifyScenario({
    baseURL,
    goal: `介绍一下我们的服务 ${Date.now()}`,
  });

  await expectScenarioToPass(scenario);
});

test('AI inspector B2 chat advance flow writes directly into the live draft', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const seed = await seedChatAdvanceBlackboxScenario(baseURL);
  const scenario = buildB2ChatAdvanceScenario({
    baseURL,
    ...seed,
  });

  await expectScenarioToPass(scenario);
});

test('AI inspector B3 version save flow reaches history and compare cleanly', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const seed = await seedVersionSaveBlackboxScenario(baseURL);
  const scenario = buildB3VersionSaveScenario({
    baseURL,
    ...seed,
  });

  await expectScenarioToPass(scenario);
});

test('AI inspector B4 branch continue and switch flow keeps the current branch clear', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const seed = await seedBranchSwitchBlackboxScenario(baseURL);
  const scenario = buildB4BranchSwitchScenario({
    baseURL,
    ...seed,
  });

  await expectScenarioToPass(scenario);
});

test('AI inspector C1 context knowledge flow creates, edits, and persists a note', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const seed = await seedContextPanelBlackboxScenario(baseURL, {
    goal: '验证 Context 面板里的知识卡片可以创建、编辑并持久化。',
    titlePrefix: '黑盒-上下文知识',
  });
  const scenario = buildC1KnowledgeManageScenario({
    baseURL,
    conversationId: seed.conversationId,
    noteContent: `项目级知识初稿 ${suffix}：整体表达保持直接、可信。`,
    noteTitle: `项目语气约束 ${suffix}`,
    updatedNoteContent: `项目级知识更新 ${suffix}：整体表达保持直接、可信，并优先给出明确下一步。`,
    workspaceId: seed.workspaceId,
  });

  await expectScenarioToPass(scenario);
});

test('AI inspector C2 context workflow flow applies a builtin workflow to the current task', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const seed = await seedContextPanelBlackboxScenario(baseURL, {
    goal: '验证 Context 面板中的内置 Workflow 可以直接应用到当前任务。',
    titlePrefix: '黑盒-上下文Workflow',
  });
  const scenario = buildC2WorkflowApplyScenario({
    baseURL,
    conversationId: seed.conversationId,
    workspaceId: seed.workspaceId,
  });

  await expectScenarioToPass(scenario);
});

async function expectScenarioToPass(scenario: ChengxingBlackboxScenario) {
  const result = await runChengxingBlackboxScenario(scenario);

  expect(result.browserRun.status).toBe('passed');
  expect(result.scenarioReport.gatePassed).toBeTruthy();
  expect(result.scenarioReport.scores.average).toBeGreaterThanOrEqual(
    scenario.threshold.minAverageScore
  );
  expect(result.scenarioReport.scores.reachability).toBeGreaterThanOrEqual(
    scenario.threshold.minDimensionScore
  );
  expect(result.scenarioReport.scores.fluency).toBeGreaterThanOrEqual(
    scenario.threshold.minDimensionScore
  );
  expect(result.scenarioReport.scores.feedback).toBeGreaterThanOrEqual(
    scenario.threshold.minDimensionScore
  );
  expect(result.scenarioReport.scores.understandability).toBeGreaterThanOrEqual(
    scenario.threshold.minDimensionScore
  );
  expect(result.scenarioReport.scores.errorTolerance).toBeGreaterThanOrEqual(
    scenario.threshold.minDimensionScore
  );
  expect(fs.existsSync(result.scenarioReportPath)).toBeTruthy();
  expect(fs.existsSync(result.aggregatePaths.json)).toBeTruthy();
  expect(fs.existsSync(result.aggregatePaths.markdown)).toBeTruthy();
}
