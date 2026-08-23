import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { expect, test, type TestInfo } from "@playwright/test";

import { LOCAL_PLATFORM_HEADERS, apiRequest, readSeedState } from "./helpers";

type JsonRecord = Record<string, unknown>;

type HttpResult = {
  payload: unknown;
  response: Response;
};

const fixtureSuffix = randomUUID();
const availableRuntimeId = `e2e-runtime-available-${fixtureSuffix}`;
const availableRuntimeKey = `e2e-available-${fixtureSuffix}`;
const unavailableRuntimeId = `e2e-runtime-unavailable-${fixtureSuffix}`;
const unavailableRuntimeKey = `e2e-unavailable-${fixtureSuffix}`;
const foreignOrganizationId = `e2e-foreign-org-${fixtureSuffix}`;
const foreignRuntimeId = `e2e-foreign-runtime-${fixtureSuffix}`;
const foreignJobId = `e2e-foreign-job-${fixtureSuffix}`;
const serverOwnedFields = [
  "contextManifest",
  "organizationPolicy",
  "agentPreference",
] as const;

const codingCapabilities = {
  schemaVersion: 1,
  kinds: ["coding"],
  nativeResume: false,
  checkpoint: false,
  streaming: "none",
  interrupt: "none",
  workspace: "none",
  sandbox: "remote",
  structuredArtifacts: false,
  waitingForHuman: false,
  supportedModels: ["*"],
} as const;

test.describe.serial("Execution control plane", () => {
  test.beforeAll(async () => {
    await seedExecutionFixtures();
  });

  test("lists registered runtimes as organization-scoped capability snapshots", async ({}, testInfo) => {
    const result = await requestJson(
      baseURL(testInfo),
      "/api/execution-runtimes",
    );

    expect(result.response.status).toBe(200);
    const envelope = asRecord(result.payload);
    expect(envelope.schemaVersion).toBe(1);
    const runtimes = asArray(envelope.runtimes).map(asRecord);
    const unavailable = runtimes.find(
      (runtime) => runtime.runtimeId === unavailableRuntimeId,
    );

    expect(unavailable).toMatchObject({
      schemaVersion: 1,
      runtimeId: unavailableRuntimeId,
      organizationId: "local-org",
      key: unavailableRuntimeKey,
      name: "E2E unavailable runtime",
      driver: "e2e-fixture",
      version: "1.0.0",
      enabled: false,
      capabilities: codingCapabilities,
      health: {
        state: "offline",
        acceptingNewAttempts: false,
      },
      capacity: {
        availableSlots: 0,
        activeAttempts: 0,
        maxConcurrentAttempts: 0,
      },
    });
    expect(
      runtimes.some((runtime) => runtime.runtimeId === foreignRuntimeId),
    ).toBe(false);
    expect(
      runtimes.every((runtime) => runtime.organizationId === "local-org"),
    ).toBe(true);
  });

  test("Pi start_execution_job fails closed without human confirmation", async ({}, testInfo) => {
    const workspace = readSeedState().baseWorkspace;
    const before = await countExecutionJobs("local-org");
    const result = await requestJson(
      baseURL(testInfo),
      "/api/debug/ai/context",
      {
        body: {
          conversationId: workspace.conversationId,
          toolCalls: [
            {
              name: "start_execution_job",
              params: {
                goal: `Unconfirmed Pi execution ${fixtureSuffix}`,
                kind: "coding",
              },
            },
          ],
          workspaceId: workspace.id,
        },
        method: "POST",
      },
    );

    expect(result.response.status).toBe(403);
    expect(asRecord(result.payload)).toMatchObject({
      kind: "forbidden",
      error: expect.stringContaining("requires explicit human confirmation"),
    });
    await expect(countExecutionJobs("local-org")).resolves.toBe(before);
  });

  for (const field of serverOwnedFields) {
    test(`rejects client-authored ${field}`, async ({}, testInfo) => {
      const workspace = readSeedState().baseWorkspace;
      const result = await requestJson(
        baseURL(testInfo),
        "/api/execution-jobs",
        {
          body: {
            goal: `Rejected server-owned ${field} ${fixtureSuffix}`,
            workspaceId: workspace.id,
            projectId: workspace.id,
            kind: "coding",
            requirements: {},
            runtimeSelection: { mode: "auto" },
            [field]: {},
          },
          method: "POST",
        },
      );

      expect(result.response.status).toBe(400);
      expect(asRecord(result.payload)).toMatchObject({
        kind: "validation",
        error: `${field} is server-owned and cannot be submitted.`,
      });
    });
  }

  test("rejects a mutable workspace draft before execution admission", async ({}, testInfo) => {
    const base = baseURL(testInfo);
    const initialContent = JSON.stringify([
      { type: "h1", children: [{ text: "Execution snapshot" }] },
      {
        type: "p",
        children: [{ text: `Frozen before mutation ${fixtureSuffix}` }],
      },
    ]);
    const workspaceCreate = await requestJson(base, "/api/workspaces", {
      body: {
        content: initialContent,
        deliverableType: "document",
        goal: "Create an isolated workspace for execution context freezing.",
        title: `Execution freeze ${fixtureSuffix}`,
      },
      method: "POST",
    });
    expect(workspaceCreate.response.status).toBe(200);
    const workspaceEnvelope = asRecord(workspaceCreate.payload);
    const workspace = asRecord(workspaceEnvelope.workspace);
    const conversation = asRecord(workspaceEnvelope.conversation);
    const goal = `Freeze current draft ${fixtureSuffix}`;
    const missingFeature = `e2e-draft-freeze-${fixtureSuffix}`;

    const create = await requestJson(base, "/api/execution-jobs", {
      body: {
        goal,
        workspaceId: workspace.id,
        projectId: workspace.projectId,
        conversationId: conversation.id,
        kind: "coding",
        requirements: { features: [missingFeature] },
        runtimeSelection: { mode: "auto" },
        priority: 2,
        maxAttempts: 2,
      },
      headers: {
        "x-dao-idempotency-key": `e2e-draft-create-${fixtureSuffix}`,
      },
      method: "POST",
    });

    expect(create.response.status).toBe(400);
    expect(asRecord(create.payload)).toMatchObject({
      kind: "validation",
      error: expect.stringContaining("documentVersionId is required"),
    });
  });

  test("direct HTTP admission rejects a visible unaligned version without creating a job", async ({}, testInfo) => {
    const base = baseURL(testInfo);
    const workspace = await createExecutionWorkspace(
      base,
      `Unaligned admission ${fixtureSuffix}`,
    );
    const documentVersionId = await createVisibleVersion(
      base,
      workspace.id,
      `Visible unaligned version ${fixtureSuffix}`,
    );

    await expectExecutionAdmissionRejected(base, {
      documentVersionId,
      error: "Document version must be aligned before execution.",
      goal: `Reject unaligned version ${fixtureSuffix}`,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    });
  });

  test("direct HTTP admission rejects a version from another workspace without creating a job", async ({}, testInfo) => {
    const base = baseURL(testInfo);
    const targetWorkspace = await createExecutionWorkspace(
      base,
      `Cross-workspace target ${fixtureSuffix}`,
    );
    const sourceWorkspace = await createExecutionWorkspace(
      base,
      `Cross-workspace source ${fixtureSuffix}`,
    );
    const documentVersionId = await createAlignedVersion(
      base,
      sourceWorkspace.id,
      `Foreign workspace version ${fixtureSuffix}`,
    );

    await expectExecutionAdmissionRejected(base, {
      documentVersionId,
      error:
        "Document version must belong to the requested workspace and organization.",
      goal: `Reject cross-workspace version ${fixtureSuffix}`,
      projectId: targetWorkspace.projectId,
      workspaceId: targetWorkspace.id,
    });
  });

  test("direct HTTP admission rejects a soft-deleted version without creating a job", async ({}, testInfo) => {
    const base = baseURL(testInfo);
    const workspace = await createExecutionWorkspace(
      base,
      `Deleted-version admission ${fixtureSuffix}`,
    );
    const documentVersionId = await createAlignedVersion(
      base,
      workspace.id,
      `Soft-deleted version ${fixtureSuffix}`,
    );
    await expect(softDeleteVersion(documentVersionId)).resolves.toBe(1);

    await expectExecutionAdmissionRejected(base, {
      documentVersionId,
      error:
        "Document version must belong to the requested workspace and organization.",
      goal: `Reject soft-deleted version ${fixtureSuffix}`,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    });
  });

  test("direct HTTP admission rejects a non-visible version without creating a job", async ({}, testInfo) => {
    const base = baseURL(testInfo);
    const workspace = await createExecutionWorkspace(
      base,
      `Non-visible admission ${fixtureSuffix}`,
    );
    const documentVersionId = await createAlignedVersion(
      base,
      workspace.id,
      `Non-visible version ${fixtureSuffix}`,
    );
    await expect(hideVisibleVersionLabels(documentVersionId)).resolves.toBe(2);
    await expect(readActiveVersionLabelKinds(documentVersionId)).resolves.toEqual([
      "aligned",
    ]);

    await expectExecutionAdmissionRejected(base, {
      documentVersionId,
      error: "Document version must be an immutable visible version.",
      goal: `Reject non-visible version ${fixtureSuffix}`,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    });
  });

  test("accepts a job with a receipt and freezes the selected workspace version", async ({}, testInfo) => {
    const workspace = readSeedState().branchVersionWorkspace;
    const goal = `Freeze selected version ${fixtureSuffix}`;
    const missingFeature = `e2e-unavailable-feature-${fixtureSuffix}`;
    const versions = await requestJson(
      baseURL(testInfo),
      `/api/workspaces/${encodeURIComponent(workspace.id)}/versions?scope=all`,
    );
    expect(versions.response.status).toBe(200);
    const selectedVersion = asRecord(
      asArray(versions.payload).find(
        (version) => asRecord(version).id === workspace.versionId,
      ),
    );
    expect(selectedVersion.id).toBe(workspace.versionId);
    await alignVersion(baseURL(testInfo), workspace.id, String(workspace.versionId));

    const create = await requestJson(baseURL(testInfo), "/api/execution-jobs", {
      body: {
        goal,
        workspaceId: workspace.id,
        projectId: workspace.id,
        documentVersionId: workspace.versionId,
        kind: "coding",
        requirements: { features: [missingFeature] },
        runtimeSelection: { mode: "auto" },
        priority: 2,
        maxAttempts: 2,
      },
      headers: {
        "x-dao-idempotency-key": `e2e-create-${fixtureSuffix}`,
      },
      method: "POST",
    });

    expect(create.response.status).toBe(202);
    const createEnvelope = asRecord(create.payload);
    expect(createEnvelope.schemaVersion).toBe(1);
    const receipt = asRecord(createEnvelope.receipt);
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      status: "blocked",
      revision: 1,
      selectedRuntimeId: null,
    });
    expect(receipt.jobId).toEqual(expect.any(String));
    expect(receipt.acceptedAt).toEqual(expect.any(String));
    expect(asRecord(asRecord(receipt.selection).failure)).toMatchObject({
      code: "no-compatible-runtime",
      message: expect.any(String),
    });

    const get = await requestJson(
      baseURL(testInfo),
      `/api/execution-jobs/${encodeURIComponent(String(receipt.jobId))}`,
    );

    expect(get.response.status).toBe(200);
    const job = asRecord(asRecord(get.payload).job);
    expect(job).toMatchObject({
      schemaVersion: 1,
      id: receipt.jobId,
      organizationId: "local-org",
      teamTaskId: null,
      kind: "coding",
      status: "blocked",
      priority: 2,
      maxAttempts: 2,
      revision: 1,
      spec: { goal },
      requirements: { features: [missingFeature] },
      requestedRuntimeId: null,
      selectedRuntimeId: null,
    });
    expect(asArray(job.attempts)).toEqual([]);

    const manifest = asRecord(job.contextManifest);
    const document = asRecord(manifest.document);
    expect(workspace.versionId).toEqual(expect.any(String));
    expect(selectedVersion.content).toEqual(expect.any(String));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      goal,
      frozenAt: expect.any(String),
      source: {
        type: "document-version",
        workspaceId: workspace.id,
        conversationId: null,
        documentVersionId: workspace.versionId,
      },
      workspace: {
        id: workspace.id,
        projectId: workspace.id,
        title: expect.any(String),
        draftRevision: expect.any(Number),
        revision: expect.any(Number),
      },
      document: {
        id: workspace.id,
        title: selectedVersion.title,
        versionId: workspace.versionId,
        revision: selectedVersion.revision,
        content: selectedVersion.content,
        contentSha256: sha256(selectedVersion.content as string),
      },
      roomWatermark: {
        roomId: expect.any(String),
        messageId: expect.any(String),
        sequence: expect.any(Number),
      },
      knowledgeCommit: null,
    });
    expect(document.contentSha256).toBe(sha256(String(document.content)));

    const expectedVersionFiles = asArray(selectedVersion.files).map(asRecord);
    const manifestFiles = asArray(manifest.files).map(asRecord);
    expect(expectedVersionFiles.length).toBeGreaterThan(0);
    expect(manifestFiles).toHaveLength(expectedVersionFiles.length);
    for (const expectedFile of expectedVersionFiles) {
      const actualFile = manifestFiles.find(
        (file) => file.id === expectedFile.id,
      );
      expect(actualFile).toMatchObject({
        id: expectedFile.id,
        parentId: expectedFile.parentId,
        name: expectedFile.name,
        path: expectedFile.path,
        nodeType: expectedFile.nodeType,
        kind: expectedFile.kind,
        role: expectedFile.role,
        language: expectedFile.language,
        content: expectedFile.content,
        contentSha256: sha256(String(expectedFile.content)),
        sortOrder: expectedFile.sortOrder,
        isPrimary: expectedFile.isPrimary,
        revision: expectedFile.revision,
      });
    }
    assertContentHashes(manifestFiles);

    const foreignGet = await requestJson(
      baseURL(testInfo),
      `/api/execution-jobs/${encodeURIComponent(foreignJobId)}`,
    );
    expect(foreignGet.response.status).toBe(404);
    expect(asRecord(foreignGet.payload)).toMatchObject({
      kind: "not-found",
    });
  });

  test("preserves nullable project scope and validates direct, project, and legacy links", async ({}, testInfo) => {
    const base = baseURL(testInfo);
    const missingFeature = `e2e-manifest-scope-${fixtureSuffix}`;
    const projectlessCreate = await requestJson(base, "/api/workspaces", {
      body: {
        content: JSON.stringify([
          { type: "p", children: [{ text: "Projectless execution context" }] },
        ]),
        deliverableType: "document",
        goal: "Verify a truly nullable execution project scope.",
        title: `Projectless execution ${fixtureSuffix}`,
      },
      method: "POST",
    });
    expect(projectlessCreate.response.status).toBe(200);
    const projectlessEnvelope = asRecord(projectlessCreate.payload);
    const projectlessWorkspace = asRecord(projectlessEnvelope.workspace);
    const directConversation = asRecord(projectlessEnvelope.conversation);
    await clearProjectScope(
      String(projectlessWorkspace.id),
      String(directConversation.id),
    );
    const projectlessVersionId = await createAlignedVersion(
      base,
      String(projectlessWorkspace.id),
      `Projectless execution ${fixtureSuffix}`,
    );

    const directTaskPayload = await apiRequest<unknown>(base, "/api/tasks", {
      body: {
        description: "Direct workspace scope must remain valid without a project.",
        kind: "execution",
        title: `Direct execution task ${fixtureSuffix}`,
        workspaceId: projectlessWorkspace.id,
      },
      method: "POST",
    });
    const directTask = asRecord(asRecord(directTaskPayload).task);
    const directJob = await requestJson(base, "/api/execution-jobs", {
      body: {
        conversationId: directConversation.id,
        documentVersionId: projectlessVersionId,
        goal: `Freeze projectless workspace ${fixtureSuffix}`,
        kind: "coding",
        projectId: null,
        requirements: { features: [missingFeature] },
        runtimeSelection: { mode: "auto" },
        teamTaskId: directTask.id,
        workspaceId: projectlessWorkspace.id,
      },
      method: "POST",
    });
    expect(directJob.response.status).toBe(202);
    const directReceipt = asRecord(asRecord(directJob.payload).receipt);
    const directGet = await requestJson(
      base,
      `/api/execution-jobs/${encodeURIComponent(String(directReceipt.jobId))}`,
    );
    expect(directGet.response.status).toBe(200);
    expect(
      asRecord(asRecord(asRecord(directGet.payload).job).contextManifest),
    ).toMatchObject({
      source: {
        workspaceId: projectlessWorkspace.id,
        conversationId: directConversation.id,
      },
      workspace: {
        id: projectlessWorkspace.id,
        projectId: null,
      },
    });

    const forgedProject = await requestJson(base, "/api/execution-jobs", {
      body: {
        goal: `Reject synthesized project ${fixtureSuffix}`,
        documentVersionId: projectlessVersionId,
        kind: "coding",
        projectId: projectlessWorkspace.id,
        requirements: { features: [missingFeature] },
        runtimeSelection: { mode: "auto" },
        workspaceId: projectlessWorkspace.id,
      },
      method: "POST",
    });
    expect(forgedProject.response.status).toBe(400);
    expect(asRecord(forgedProject.payload)).toMatchObject({ kind: "validation" });

    const fakeProjectTaskPayload = await apiRequest<unknown>(base, "/api/tasks", {
      body: {
        description: "A document id is not a real nullable project scope.",
        kind: "execution",
        projectId: projectlessWorkspace.id,
        title: `Fake project task ${fixtureSuffix}`,
      },
      method: "POST",
    });
    const fakeProjectTask = asRecord(asRecord(fakeProjectTaskPayload).task);
    const fakeProjectTaskJob = await requestJson(base, "/api/execution-jobs", {
      body: {
        goal: `Reject fake project task ${fixtureSuffix}`,
        documentVersionId: projectlessVersionId,
        kind: "coding",
        projectId: null,
        requirements: { features: [missingFeature] },
        runtimeSelection: { mode: "auto" },
        teamTaskId: fakeProjectTask.id,
        workspaceId: projectlessWorkspace.id,
      },
      method: "POST",
    });
    expect(fakeProjectTaskJob.response.status).toBe(400);
    expect(asRecord(fakeProjectTaskJob.payload)).toMatchObject({
      kind: "validation",
    });

    const unscopedTaskPayload = await apiRequest<unknown>(base, "/api/tasks", {
      body: {
        description: "An unscoped task cannot own an execution manifest.",
        kind: "execution",
        title: `Unscoped execution task ${fixtureSuffix}`,
      },
      method: "POST",
    });
    const unscopedTask = asRecord(asRecord(unscopedTaskPayload).task);
    const unscopedTaskJob = await requestJson(base, "/api/execution-jobs", {
      body: {
        goal: `Reject unscoped task ${fixtureSuffix}`,
        documentVersionId: projectlessVersionId,
        kind: "coding",
        projectId: null,
        requirements: { features: [missingFeature] },
        runtimeSelection: { mode: "auto" },
        teamTaskId: unscopedTask.id,
        workspaceId: projectlessWorkspace.id,
      },
      method: "POST",
    });
    expect(unscopedTaskJob.response.status).toBe(400);
    expect(asRecord(unscopedTaskJob.payload)).toMatchObject({
      kind: "validation",
    });

    const projectWorkspace = readSeedState().baseWorkspace;
    const projectConversationId = `e2e-project-conversation-${fixtureSuffix}`;
    await insertConversationScope({
      id: projectConversationId,
      projectId: projectWorkspace.id,
      wikiId: null,
    });
    const projectTaskPayload = await apiRequest<unknown>(base, "/api/tasks", {
      body: {
        description: "A project-scoped execution task.",
        kind: "execution",
        projectId: projectWorkspace.id,
        title: `Project execution task ${fixtureSuffix}`,
      },
      method: "POST",
    });
    const projectTask = asRecord(asRecord(projectTaskPayload).task);
    const projectVersionId = await createAlignedVersion(
      base,
      projectWorkspace.id,
      `Project execution ${fixtureSuffix}`,
    );
    const projectJob = await requestJson(base, "/api/execution-jobs", {
      body: {
        conversationId: projectConversationId,
        documentVersionId: projectVersionId,
        goal: `Use real project scope ${fixtureSuffix}`,
        kind: "coding",
        projectId: projectWorkspace.id,
        requirements: { features: [missingFeature] },
        runtimeSelection: { mode: "auto" },
        teamTaskId: projectTask.id,
        workspaceId: projectWorkspace.id,
      },
      method: "POST",
    });
    expect(projectJob.response.status).toBe(202);

    const childCreate = await requestJson(base, "/api/workspaces", {
      body: {
        content: JSON.stringify([
          { type: "p", children: [{ text: "Child project node" }] },
        ]),
        deliverableType: "document",
        goal: "Verify legacy wiki scope against a real project.",
        projectId: projectWorkspace.id,
        title: `Legacy wiki child ${fixtureSuffix}`,
      },
      method: "POST",
    });
    expect(childCreate.response.status).toBe(200);
    const childWorkspace = asRecord(asRecord(childCreate.payload).workspace);
    const childVersionId = await createAlignedVersion(
      base,
      String(childWorkspace.id),
      `Legacy child execution ${fixtureSuffix}`,
    );
    const legacyConversationId = `e2e-legacy-conversation-${fixtureSuffix}`;
    await insertConversationScope({
      id: legacyConversationId,
      projectId: null,
      wikiId: projectWorkspace.id,
    });
    const legacyJob = await requestJson(base, "/api/execution-jobs", {
      body: {
        conversationId: legacyConversationId,
        documentVersionId: childVersionId,
        goal: `Use legacy wiki scope ${fixtureSuffix}`,
        kind: "coding",
        projectId: projectWorkspace.id,
        requirements: { features: [missingFeature] },
        runtimeSelection: { mode: "auto" },
        workspaceId: childWorkspace.id,
      },
      method: "POST",
    });
    expect(legacyJob.response.status).toBe(202);
  });

  test("persists explainable results for missing and ineligible explicit runtimes", async ({}, testInfo) => {
    const workspace = readSeedState().baseWorkspace;
    const documentVersionId = await createAlignedVersion(
      baseURL(testInfo),
      workspace.id,
      `Explicit runtime execution ${fixtureSuffix}`,
    );
    const missingRuntimeId = `e2e-missing-runtime-${fixtureSuffix}`;
    const commonInput = {
      goal: `Explain explicit runtime selection ${fixtureSuffix}`,
      documentVersionId,
      workspaceId: workspace.id,
      projectId: workspace.id,
      kind: "coding",
      requirements: {},
    };

    const missing = await requestJson(
      baseURL(testInfo),
      "/api/execution-jobs",
      {
        body: {
          ...commonInput,
          runtimeSelection: { mode: "explicit", runtimeId: missingRuntimeId },
        },
        method: "POST",
      },
    );
    expect(missing.response.status).toBe(202);
    const missingReceipt = asRecord(asRecord(missing.payload).receipt);
    const missingSelection = asRecord(missingReceipt.selection);
    expect(missingReceipt).toMatchObject({
      status: "blocked",
      selectedRuntimeId: null,
    });
    expect(asRecord(missingSelection.failure)).toMatchObject({
      code: "requested-runtime-not-found",
      runtimeId: missingRuntimeId,
      message: expect.any(String),
    });

    const ineligible = await requestJson(
      baseURL(testInfo),
      "/api/execution-jobs",
      {
        body: {
          ...commonInput,
          runtimeSelection: {
            mode: "explicit",
            runtimeId: unavailableRuntimeId,
          },
        },
        method: "POST",
      },
    );
    expect(ineligible.response.status).toBe(202);
    const ineligibleReceipt = asRecord(asRecord(ineligible.payload).receipt);
    const ineligibleSelection = asRecord(ineligibleReceipt.selection);
    expect(ineligibleReceipt).toMatchObject({
      status: "blocked",
      selectedRuntimeId: null,
    });
    expect(asRecord(ineligibleSelection.failure)).toMatchObject({
      code: "requested-runtime-ineligible",
      runtimeId: unavailableRuntimeId,
      message: expect.any(String),
    });

    const runtimeEvaluation = asArray(ineligibleSelection.evaluations)
      .map(asRecord)
      .find((evaluation) => {
        const candidate = asRecord(evaluation.candidate);
        return (
          asRecord(candidate.descriptor).runtimeId === unavailableRuntimeId
        );
      });
    expect(runtimeEvaluation).toMatchObject({ eligible: false });
    const rejectionReasons = asArray(
      asRecord(runtimeEvaluation).rejectionReasons,
    ).map(asRecord);
    expect(rejectionReasons.length).toBeGreaterThan(0);
    expect(
      rejectionReasons.every(
        (reason) =>
          typeof reason.code === "string" &&
          typeof reason.message === "string" &&
          reason.message.length > 0,
      ),
    ).toBe(true);
    expect(rejectionReasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "runtime-unhealthy",
        "runtime-not-accepting-attempts",
        "runtime-at-capacity",
      ]),
    );
  });

  test("replays one atomic receipt for an idempotency key and rejects payload drift", async ({}, testInfo) => {
    const base = baseURL(testInfo);
    const workspace = readSeedState().baseWorkspace;
    const documentVersionId = await createAlignedVersion(
      base,
      workspace.id,
      `Atomic replay execution ${fixtureSuffix}`,
    );
    const idempotencyKey = `e2e-atomic-replay-${fixtureSuffix}`;
    const beforeJobs = await countExecutionJobs("local-org");
    const body = {
      goal: `Atomic execution submission ${fixtureSuffix}`,
      documentVersionId,
      workspaceId: workspace.id,
      projectId: workspace.id,
      kind: "coding",
      requirements: {},
      runtimeSelection: {
        mode: "explicit",
        runtimeId: availableRuntimeId,
      },
      priority: 2,
    };

    const first = await requestJson(base, "/api/execution-jobs", {
      body,
      headers: { "x-dao-idempotency-key": idempotencyKey },
      method: "POST",
    });
    const replay = await requestJson(base, "/api/execution-jobs", {
      body,
      headers: { "x-dao-idempotency-key": idempotencyKey },
      method: "POST",
    });

    expect(first.response.status).toBe(202);
    expect(replay.response.status).toBe(202);
    expect(replay.payload).toEqual(first.payload);
    const receipt = asRecord(asRecord(first.payload).receipt);
    expect(receipt).toMatchObject({
      selectedRuntimeId: availableRuntimeId,
      status: "queued",
    });
    await expect(countExecutionJobs("local-org")).resolves.toBe(beforeJobs + 1);
    await expect(countExecutionAttempts(String(receipt.jobId))).resolves.toBe(
      1,
    );
    await expect(
      readMutationRequest("local-org", idempotencyKey),
    ).resolves.toMatchObject({
      resourceId: receipt.jobId,
      resourceType: "execution-job",
      status: "completed",
    });

    const drifted = await requestJson(base, "/api/execution-jobs", {
      body: { ...body, priority: 3 },
      headers: { "x-dao-idempotency-key": idempotencyKey },
      method: "POST",
    });
    expect(drifted.response.status).toBe(409);
    expect(asRecord(drifted.payload)).toMatchObject({ kind: "conflict" });
    await expect(countExecutionJobs("local-org")).resolves.toBe(beforeJobs + 1);
  });

  test("keeps TeamTask identity separate, projects cancellation, and replays desired state idempotently", async ({}, testInfo) => {
    const base = baseURL(testInfo);
    const workspace = readSeedState().baseWorkspace;
    const documentVersionId = await createAlignedVersion(
      base,
      workspace.id,
      `Task lifecycle execution ${fixtureSuffix}`,
    );
    const taskPayload = await apiRequest<unknown>(base, "/api/tasks", {
      body: {
        description: "ExecutionJob cancellation must not cancel this TeamTask.",
        kind: "execution",
        priority: 1,
        title: `E2E execution owner task ${fixtureSuffix}`,
        workspaceId: workspace.id,
      },
      method: "POST",
    });
    const task = asRecord(asRecord(taskPayload).task);
    expect(task).toMatchObject({
      kind: "execution",
      status: "open",
      organizationId: "local-org",
      revision: 1,
    });

    const create = await requestJson(base, "/api/execution-jobs", {
      body: {
        goal: `Cancel execution job ${fixtureSuffix}`,
        documentVersionId,
        workspaceId: workspace.id,
        projectId: workspace.id,
        kind: "coding",
        requirements: {},
        runtimeSelection: {
          mode: "explicit",
          runtimeId: `e2e-task-missing-runtime-${fixtureSuffix}`,
        },
        teamTaskId: task.id,
      },
      method: "POST",
    });
    expect(create.response.status).toBe(202);
    const receipt = asRecord(asRecord(create.payload).receipt);
    expect(receipt).toMatchObject({
      teamTaskId: task.id,
      status: "blocked",
      revision: 1,
    });
    expect(receipt.jobId).not.toBe(task.id);

    const cancelled = await requestJson(
      base,
      `/api/execution-jobs/${encodeURIComponent(String(receipt.jobId))}/cancel`,
      {
        body: { expectedRevision: receipt.revision },
        method: "POST",
      },
    );
    expect(cancelled.response.status).toBe(200);
    const cancelledJob = asRecord(asRecord(cancelled.payload).job);
    expect(cancelledJob).toMatchObject({
      id: receipt.jobId,
      teamTaskId: task.id,
      status: "cancelled",
      revision: 2,
    });
    expect(cancelledJob.cancelRequestedAt).toEqual(expect.any(String));
    expect(cancelledJob.finishedAt).toEqual(expect.any(String));

    const staleRepeat = await requestJson(
      base,
      `/api/execution-jobs/${encodeURIComponent(String(receipt.jobId))}/cancel`,
      {
        body: { expectedRevision: receipt.revision },
        method: "POST",
      },
    );
    expect(staleRepeat.response.status).toBe(200);
    expect(asRecord(asRecord(staleRepeat.payload).job)).toMatchObject({
      id: receipt.jobId,
      status: "cancelled",
      revision: cancelledJob.revision,
    });

    const terminalRepeat = await requestJson(
      base,
      `/api/execution-jobs/${encodeURIComponent(String(receipt.jobId))}/cancel`,
      {
        body: { expectedRevision: cancelledJob.revision },
        method: "POST",
      },
    );
    expect(terminalRepeat.response.status).toBe(200);
    expect(asRecord(asRecord(terminalRepeat.payload).job)).toMatchObject({
      id: receipt.jobId,
      status: "cancelled",
      revision: cancelledJob.revision,
    });

    const unchangedJob = asRecord(
      asRecord(
        (
          await requestJson(
            base,
            `/api/execution-jobs/${encodeURIComponent(String(receipt.jobId))}`,
          )
        ).payload,
      ).job,
    );
    expect(unchangedJob).toMatchObject({ status: "cancelled", revision: 2 });

    const taskAfterCancel = asRecord(
      asRecord(
        await apiRequest<unknown>(
          base,
          `/api/tasks/${encodeURIComponent(String(task.id))}`,
        ),
      ).task,
    );
    expect(taskAfterCancel).toMatchObject({
      id: task.id,
      status: "cancelled",
      revision: Number(task.revision) + 1,
    });
  });

});

function baseURL(testInfo: TestInfo) {
  return String(testInfo.project.use.baseURL);
}

async function createAlignedVersion(base: string, workspaceId: string, title: string) {
  const versionId = await createVisibleVersion(base, workspaceId, title);
  await alignVersion(base, workspaceId, versionId);
  return versionId;
}

async function createVisibleVersion(base: string, workspaceId: string, title: string) {
  const versionResult = await requestJson(
    base,
    `/api/workspaces/${encodeURIComponent(workspaceId)}/versions`,
    { body: { title }, method: "POST" },
  );
  expect(versionResult.response.status).toBe(200);
  const version = asRecord(versionResult.payload);
  expect(version).toMatchObject({ aligned: false, visible: true });
  const versionId = String(version.id || "");
  expect(versionId).not.toBe("");
  return versionId;
}

async function createExecutionWorkspace(base: string, title: string) {
  const result = await requestJson(base, "/api/workspaces", {
    body: {
      content: JSON.stringify([
        { type: "p", children: [{ text: `Fixture for ${title}` }] },
      ]),
      deliverableType: "document",
      goal: `Exercise ExecutionJob admission for ${title}.`,
      title,
    },
    method: "POST",
  });
  expect(result.response.status).toBe(200);
  const workspace = asRecord(asRecord(result.payload).workspace);
  expect(workspace.id).toEqual(expect.any(String));
  return {
    id: String(workspace.id),
    projectId:
      typeof workspace.projectId === "string" ? workspace.projectId : null,
  };
}

async function expectExecutionAdmissionRejected(
  base: string,
  input: {
    documentVersionId: string;
    error: string;
    goal: string;
    projectId: string | null;
    workspaceId: string;
  },
) {
  const jobsBeforeRequest = await countExecutionJobs("local-org");

  const result = await requestJson(base, "/api/execution-jobs", {
    body: {
      documentVersionId: input.documentVersionId,
      goal: input.goal,
      kind: "coding",
      projectId: input.projectId,
      requirements: {},
      runtimeSelection: { mode: "auto" },
      workspaceId: input.workspaceId,
    },
    method: "POST",
  });

  expect(result.response.status).toBe(400);
  expect(asRecord(result.payload)).toMatchObject({
    error: input.error,
    kind: "validation",
  });
  await expect(countExecutionJobs("local-org")).resolves.toBe(
    jobsBeforeRequest,
  );
}

async function alignVersion(base: string, workspaceId: string, versionId: string) {
  const result = await requestJson(
    base,
    `/api/workspaces/${encodeURIComponent(workspaceId)}/alignment`,
    { body: { versionId }, method: "POST" },
  );
  expect(result.response.status).toBe(200);
  expect(asRecord(asRecord(result.payload).version).aligned).toBe(true);
}

async function requestJson(
  base: string,
  pathname: string,
  init?: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: "GET" | "POST" | "PATCH";
  },
): Promise<HttpResult> {
  const response = await fetch(new URL(pathname, base), {
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...LOCAL_PLATFORM_HEADERS,
      ...init?.headers,
    },
    method: init?.method || "GET",
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `API ${init?.method || "GET"} ${pathname} returned non-JSON content (${response.status}): ${text.slice(0, 1_000)}`,
      );
    }
  }

  return { payload, response };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function assertContentHashes(files: JsonRecord[]) {
  for (const file of files) {
    expect(file.content).toEqual(expect.any(String));
    expect(file.contentSha256).toBe(sha256(String(file.content)));
  }
}

async function countExecutionJobs(organizationId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: 'SELECT COUNT(*) AS count FROM "ExecutionJob" WHERE "organizationId" = ?',
      args: [organizationId],
    });
    return Number(result.rows[0]?.count || 0);
  } finally {
    await client.close();
  }
}

async function softDeleteVersion(versionId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `UPDATE "Version"
        SET "deletedAt" = ?, "revision" = "revision" + 1
        WHERE "id" = ? AND "organizationId" = ? AND "deletedAt" IS NULL`,
      args: [new Date().toISOString(), versionId, "local-org"],
    });
    return result.rowsAffected;
  } finally {
    await client.close();
  }
}

async function hideVisibleVersionLabels(versionId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `UPDATE "Label"
        SET "deletedAt" = ?, "revision" = "revision" + 1
        WHERE "versionId" = ?
          AND "organizationId" = ?
          AND "kind" IN ('milestone', 'head')
          AND "deletedAt" IS NULL`,
      args: [new Date().toISOString(), versionId, "local-org"],
    });
    return result.rowsAffected;
  } finally {
    await client.close();
  }
}

async function readActiveVersionLabelKinds(versionId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `SELECT "kind"
        FROM "Label"
        WHERE "versionId" = ?
          AND "organizationId" = ?
          AND "deletedAt" IS NULL
        ORDER BY "kind" ASC`,
      args: [versionId, "local-org"],
    });
    return result.rows.map((row) => String(row.kind));
  } finally {
    await client.close();
  }
}

async function countExecutionAttempts(jobId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: 'SELECT COUNT(*) AS count FROM "ExecutionAttempt" WHERE "jobId" = ?',
      args: [jobId],
    });
    return Number(result.rows[0]?.count || 0);
  } finally {
    await client.close();
  }
}

async function readMutationRequest(organizationId: string, requestKey: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `SELECT "status", "resourceType", "resourceId"
        FROM "MutationRequest"
        WHERE "organizationId" = ? AND "requestKey" = ?
        LIMIT 1`,
      args: [organizationId, requestKey],
    });
    return result.rows[0] || null;
  } finally {
    await client.close();
  }
}

async function clearProjectScope(workspaceId: string, conversationId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    await client.batch(
      [
        {
          sql: 'UPDATE "Document" SET "projectId" = NULL WHERE "id" = ? AND "organizationId" = ?',
          args: [workspaceId, "local-org"],
        },
        {
          sql: 'UPDATE "Session" SET "projectId" = NULL WHERE "id" = ? AND "organizationId" = ?',
          args: [conversationId, "local-org"],
        },
      ],
      "write",
    );
  } finally {
    await client.close();
  }
}

async function insertConversationScope(input: {
  id: string;
  projectId: string | null;
  wikiId: string | null;
}) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  const now = new Date().toISOString();
  try {
    await client.execute({
      sql: `INSERT INTO "Session" (
        "id", "organizationId", "title", "wikiId", "projectId",
        "sourceType", "revision", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.id,
        "local-org",
        `Execution scope ${input.id}`,
        input.wikiId,
        input.projectId,
        "chat",
        1,
        now,
        now,
      ],
    });
  } finally {
    await client.close();
  }
}

async function seedExecutionFixtures() {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  const now = new Date().toISOString();
  const capabilitiesJson = JSON.stringify(codingCapabilities);
  const unavailableHealthJson = JSON.stringify({
    state: "offline",
    acceptingNewAttempts: false,
    observedAt: now,
    message: "The deterministic E2E runtime is intentionally unavailable.",
  });
  const foreignSelectionJson = JSON.stringify({
    schemaVersion: 1,
    matched: false,
    selected: null,
    failure: {
      code: "no-compatible-runtime",
      message: "No compatible runtime is registered.",
    },
    evaluations: [],
  });

  try {
    await client.execute({
      sql: `INSERT INTO "ExecutionRuntime" (
        "id", "organizationId", "key", "name", "driver", "version",
        "enabled", "registrationJson", "capabilitiesJson", "healthStatus",
        "healthJson", "lastHeartbeatAt", "capacityTotal", "capacityUsed",
        "capacityJson", "capacityUpdatedAt", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        availableRuntimeId,
        "local-org",
        availableRuntimeKey,
        "E2E available runtime",
        "e2e-fixture",
        "1.0.0",
        1,
        JSON.stringify({ fixture: "execution-e2e" }),
        capabilitiesJson,
        "healthy",
        JSON.stringify({
          state: "healthy",
          acceptingNewAttempts: true,
          observedAt: now,
        }),
        now,
        1,
        0,
        "{}",
        now,
        now,
        now,
      ],
    });

    await client.execute({
      sql: `INSERT INTO "ExecutionRuntime" (
        "id", "organizationId", "key", "name", "driver", "version",
        "enabled", "registrationJson", "capabilitiesJson", "healthStatus",
        "healthJson", "lastHeartbeatAt", "capacityTotal", "capacityUsed",
        "capacityJson", "capacityUpdatedAt", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        unavailableRuntimeId,
        "local-org",
        unavailableRuntimeKey,
        "E2E unavailable runtime",
        "e2e-fixture",
        "1.0.0",
        0,
        JSON.stringify({ fixture: "execution-e2e" }),
        capabilitiesJson,
        "offline",
        unavailableHealthJson,
        now,
        0,
        0,
        "{}",
        now,
        now,
        now,
      ],
    });

    await client.execute({
      sql: `INSERT INTO "Organization" (
        "id", "slug", "name", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?)`,
      args: [
        foreignOrganizationId,
        `e2e-foreign-${fixtureSuffix}`,
        "E2E Foreign Organization",
        now,
        now,
      ],
    });

    await client.execute({
      sql: `INSERT INTO "ExecutionRuntime" (
        "id", "organizationId", "key", "name", "driver", "version",
        "enabled", "registrationJson", "capabilitiesJson", "healthStatus",
        "healthJson", "capacityTotal", "capacityUsed", "capacityJson",
        "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        foreignRuntimeId,
        foreignOrganizationId,
        `foreign-runtime-${fixtureSuffix}`,
        "Foreign runtime",
        "e2e-fixture",
        "1.0.0",
        1,
        "{}",
        capabilitiesJson,
        "healthy",
        JSON.stringify({ state: "healthy", acceptingNewAttempts: true }),
        1,
        0,
        "{}",
        now,
        now,
      ],
    });

    await client.execute({
      sql: `INSERT INTO "ExecutionJob" (
        "id", "organizationId", "kind", "status", "priority",
        "specJson", "requirementsJson", "contextManifestJson",
        "selectionJson", "selectionReason", "maxAttempts", "queuedAt",
        "revision", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        foreignJobId,
        foreignOrganizationId,
        "coding",
        "blocked",
        0,
        JSON.stringify({
          schemaVersion: 1,
          kind: "coding",
          requirements: {},
        }),
        "{}",
        JSON.stringify({ schemaVersion: 1 }),
        foreignSelectionJson,
        "no-compatible-runtime",
        1,
        now,
        1,
        now,
        now,
      ],
    });
  } finally {
    await client.close();
  }
}

function resolveIterationDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const iterationRoot =
    process.env.ITERATION_ROOT ||
    path.join(process.cwd(), ".tmp", "iteration-regression");
  const appDataRoot =
    process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, "app-data");

  return `file:${path.join(appDataRoot, "dev.db")}`;
}
