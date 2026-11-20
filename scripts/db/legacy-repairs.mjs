/**
 * Frozen historical migration probes and drift-repair strategy resolvers for
 * pre-v1 local SQLite databases.
 *
 * New migrations should NOT register bespoke repair routines here; they are
 * applied forward directly by scripts/bootstrap-local-db.mjs.
 */
import {
  AGENT_PROFILE_MANAGEMENT_MIGRATION,
  ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION,
  DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION,
  DOCUMENT_PROPOSAL_CAS_MIGRATION,
  CANVAS_TABLES_MIGRATION,
  TEAM_SCOPED_CONVERSATIONS_MIGRATION,
  TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN,
  TEAM_SCOPED_CONVERSATION_LEGACY_DOCUMENT_COLUMN,
  TEAM_SCOPED_CONVERSATION_CURRENT_DOCUMENT_COLUMN,
  TEAM_SCOPED_CONVERSATION_SESSION_INDEX,
  TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES,
  TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS,
  TEAM_SCOPED_CONVERSATION_STAGING_TABLE,
  TEAM_SCOPED_CONVERSATION_RESUME_SQL,
  CANVAS_TABLES,
  DOCUMENT_PROPOSAL_CAS_COLUMNS,
  DOCUMENT_PROPOSAL_CAS_INDEXES,
  DOCUMENT_PROPOSAL_CAS_FOREIGN_KEYS,
  VERSION_IMMUTABLE_TRIGGER,
  AGENT_PROFILE_MANAGEMENT_COLUMNS,
  ROOM_TOOL_CONFIRMATION_REQUEST_COLUMNS,
  ROOM_TOOL_CONFIRMATION_REQUEST_INDEXES,
  LEGACY_ROOM_DELEGATION_GRANT_COLUMNS,
  DURABLE_ROOM_DELEGATION_GRANT_ADDED_COLUMNS,
  ROOM_DELEGATION_GRANT_INDEXES,
  LEGACY_ROOM_DELEGATION_GRANT_CHECKS,
  DURABLE_ROOM_DELEGATION_TABLES,
  DURABLE_ROOM_DELEGATION_DATA_VALIDATION_QUERIES,
  DURABLE_ROOM_DELEGATION_REPAIR_SQL,
  EMPTY_AGENT_CAPABILITIES,
  AGENT_PROFILE_MANAGEMENT_REPAIR_SQL,
  DOCUMENT_PROPOSAL_CAS_REPAIR_SQL,
  MIGRATION_ACTION_MARK,
  MIGRATION_ACTION_APPLY,
  MIGRATION_ACTION_REPAIR,
} from "./legacy-repair-specs.mjs";

export {
  MIGRATION_ACTION_APPLY,
  MIGRATION_ACTION_MARK,
  MIGRATION_ACTION_REPAIR,
};

export const MIGRATION_PROBES = {
  "20260312090000_current_schema_baseline": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("Organization"),
        inspector.hasTable("User"),
        inspector.hasTable("Session"),
        inspector.hasTable("Document"),
        inspector.hasTable("Version"),
        inspector.hasTable("WorkspacePlan"),
      ])
    ).every(Boolean),
  "20260313100000_add_project_root_path": async (inspector) =>
    inspector.hasColumn("Document", "projectRootPath"),
  "20260314093000_add_workspace_project_fields": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "projectId"),
        inspector.hasColumn("Document", "projectTitle"),
        inspector.hasColumn("Document", "parentDocumentId"),
      ])
    ).every(Boolean),
  "20260314112000_add_project_folders": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "projectFolderId"),
        inspector.hasTable("ProjectFolder"),
      ])
    ).every(Boolean),
  "20260314143000_add_project_tree_sort_order": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "treeSortOrder"),
        inspector.hasColumn("ProjectFolder", "treeSortOrder"),
      ])
    ).every(Boolean),
  "20260314160000_rename_version_snapshot_type": async (inspector) =>
    inspector.hasColumn("Version", "versionType"),
  "20260314190000_add_workflow_playbooks": async (inspector) =>
    inspector.hasTable("WorkflowPlaybook"),
  "20260314193000_add_active_workflow_playbook_to_workspace_plan": async (
    inspector,
  ) => inspector.hasColumn("WorkspacePlan", "activeWorkflowPlaybookId"),
  "20260314203000_add_workflow_playbook_structure_fields": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("WorkflowPlaybook", "steps"),
        inspector.hasColumn("WorkflowPlaybook", "constraints"),
        inspector.hasColumn("WorkflowPlaybook", "checklist"),
      ])
    ).every(Boolean),
  "20260314210000_add_workflow_playbook_archiving": async (inspector) =>
    inspector.hasColumn("WorkflowPlaybook", "archivedAt"),
  "20260314220000_finalize_workspace_status_and_playbook_lifecycle": async (
    inspector,
  ) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "draftRevision"),
        inspector.hasColumn("WorkflowPlaybook", "status"),
      ])
    ).every(Boolean),
  "20260316120000_add_comment_agents": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("CommentThread", "agentBindingsJson"),
        inspector.hasColumn("CommentMessage", "mentionedAgentsJson"),
        inspector.hasColumn("CommentMessage", "agentId"),
        inspector.hasColumn("CommentMessage", "agentLabel"),
      ])
    ).every(Boolean),
  "20260316153000_add_comment_research_state": async (inspector) =>
    inspector.hasColumn("CommentThread", "researchStateJson"),
  "20260317193000_add_workspace_draft_base_version": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Document", "draftBaseVersionId"),
        inspector.hasIndex("Document_draftBaseVersionId_idx"),
      ])
    ).every(Boolean),
  "20260318170000_add_workflow_playbook_extension_hints": async (inspector) =>
    inspector.hasColumn("WorkflowPlaybook", "extensionHints"),
  "20260321120000_add_state_labels": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("Label"),
        inspector.hasColumn("Label", "organizationId"),
        inspector.hasColumn("Label", "versionId"),
        inspector.hasColumn("Label", "kind"),
        inspector.hasColumn("Label", "name"),
        inspector.hasIndex("Label_organizationId_createdAt_idx"),
        inspector.hasIndex("Label_versionId_createdAt_idx"),
      ])
    ).every(Boolean),
  "20260321143000_backfill_milestone_labels": async (inspector) =>
    inspector.hasNoRows(`
      SELECT 1
      FROM "Version"
      WHERE "Version"."deletedAt" IS NULL
        AND "Version"."versionType" = 'manual'
        AND NOT EXISTS (
          SELECT 1
          FROM "Label"
          WHERE "Label"."deletedAt" IS NULL
            AND "Label"."kind" = 'milestone'
            AND "Label"."versionId" = "Version"."id"
        )
      LIMIT 1
    `),
  "20260321150000_backfill_head_labels": async (inspector) =>
    inspector.hasNoRows(`
      SELECT 1
      FROM "Version"
      WHERE "Version"."deletedAt" IS NULL
        AND "Version"."versionType" = 'manual'
        AND NOT EXISTS (
          SELECT 1
          FROM "Version" AS "ChildVersion"
          WHERE "ChildVersion"."deletedAt" IS NULL
            AND "ChildVersion"."organizationId" = "Version"."organizationId"
            AND "ChildVersion"."parentVersionId" = "Version"."id"
            AND "ChildVersion"."versionType" NOT IN ('checkpoint', 'checkpoint_pinned')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "Label"
          WHERE "Label"."deletedAt" IS NULL
            AND "Label"."kind" = 'head'
            AND "Label"."versionId" = "Version"."id"
        )
      LIMIT 1
    `),
  "20260321170000_backfill_recovery_labels": async (inspector) =>
    inspector.hasNoRows(`
      SELECT 1
      FROM "Version"
      WHERE "Version"."deletedAt" IS NULL
        AND (
          (
            "Version"."versionType" IN ('checkpoint', 'checkpoint_pinned')
            AND NOT EXISTS (
              SELECT 1
              FROM "Label"
              WHERE "Label"."deletedAt" IS NULL
                AND "Label"."kind" = 'recovery'
                AND "Label"."versionId" = "Version"."id"
            )
          )
          OR (
            "Version"."versionType" = 'checkpoint_pinned'
            AND NOT EXISTS (
              SELECT 1
              FROM "Label"
              WHERE "Label"."deletedAt" IS NULL
                AND "Label"."kind" = 'pinned'
                AND "Label"."versionId" = "Version"."id"
            )
          )
        )
      LIMIT 1
    `),
  "20260321190000_unify_notes": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("Note"),
        inspector.hasColumn("Note", "scope"),
        inspector.hasColumn("Note", "scopeId"),
        inspector.hasColumn("Note", "kind"),
        inspector.hasColumn("Note", "source"),
        inspector.hasIndex("Note_organizationId_createdAt_idx"),
        inspector.hasIndex("Note_organizationId_scope_scopeId_createdAt_idx"),
        inspector.lacksTable("KnowledgeItem"),
        inspector.lacksTable("Memory"),
      ])
    ).every(Boolean),
  "20260323015000_add_project_scoped_conversation_fields": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("Session", "projectId"),
        inspector.hasColumn("ChatMessage", "focusNodeId"),
      ])
    ).every(Boolean),
  "20260323043000_add_project_mounts": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("ProjectMount"),
        inspector.hasColumn("ProjectMount", "sourceProjectId"),
        inspector.hasColumn("ProjectMount", "targetProjectId"),
      ])
    ).every(Boolean),
  "20260324040000_add_canvas_meta": async (inspector) =>
    inspector.hasColumn("Document", "canvasMetaJson"),
  "20260820120000_add_team_tasks": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("AgentProfile"),
        inspector.hasTable("TeamTask"),
        inspector.hasTable("TaskActivity"),
        inspector.hasColumn("TeamTask", "workspaceId"),
        inspector.hasColumn("TaskActivity", "metadataJson"),
      ])
    ).every(Boolean),
  "20260820123000_add_team_task_revision": async (inspector) =>
    inspector.hasColumn("TeamTask", "revision"),
  "20260821020000_add_execution_engine": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("ExecutionRuntime"),
        inspector.hasTable("ExecutionJob"),
        inspector.hasTable("ExecutionAttempt"),
        inspector.hasTable("ExecutionEvent"),
        inspector.hasTable("ExecutionArtifact"),
        inspector.hasColumn("ExecutionAttempt", "generation"),
        inspector.hasColumn("ExecutionJob", "contextManifestJson"),
      ])
    ).every(Boolean),
  "20260821030000_add_git_knowledge_control_plane": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("KnowledgeSpace"),
        inspector.hasTable("KnowledgeBinding"),
        inspector.hasTable("KnowledgeSnapshot"),
        inspector.hasTable("KnowledgeChangeRequest"),
        inspector.hasColumn("KnowledgeSpace", "readPolicy"),
        inspector.hasColumn("KnowledgeSnapshot", "changeRequestId"),
        inspector.hasColumn("KnowledgeChangeRequest", "revision"),
      ])
    ).every(Boolean),
  "20260821040000_add_attempt_workspace_lifecycle": async (inspector) =>
    inspector.hasColumn("ExecutionAttempt", "workspaceLifecycleJson"),
  "20260821050000_add_knowledge_merge_operations": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("KnowledgeMergeOperation"),
        inspector.hasColumn("KnowledgeSpace", "activeSnapshotId"),
        inspector.hasColumn("KnowledgeSnapshot", "artifactPath"),
        inspector.hasColumn("KnowledgeSnapshot", "artifactSha256"),
        inspector.hasColumn("KnowledgeSnapshot", "readyAt"),
      ])
    ).every(Boolean),
  "20260821060000_add_project_rooms": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("Room"),
        inspector.hasTable("RoomMessage"),
        inspector.hasTable("RoomMention"),
        inspector.hasTable("RoomAgentSession"),
        inspector.hasTable("RoomInboxDelivery"),
        inspector.hasTable("RoomEvent"),
        inspector.hasTable("RoomOutbox"),
        inspector.hasTable("RoomDelegationGrant"),
        inspector.hasColumn("RoomAgentSession", "generation"),
        inspector.hasColumn("RoomAgentSession", "checkpointJson"),
      ])
    ).every(Boolean),
  "20260821070000_add_execution_input_requests": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("ExecutionInputRequest"),
        inspector.hasColumn("ExecutionInputRequest", "requestKey"),
        inspector.hasColumn("ExecutionInputRequest", "responseJson"),
        inspector.hasColumn("ExecutionInputRequest", "revision"),
      ])
    ).every(Boolean),
  "20260821080000_harden_execution_waiting_input": async (inspector) =>
    (
      await Promise.all([
        inspector.hasColumn("ExecutionAttempt", "capacityReserved"),
        inspector.hasColumn("ExecutionInputRequest", "responseId"),
      ])
    ).every(Boolean),
  "20260821090000_add_execution_room_projection": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("ExecutionOutbox"),
        inspector.hasColumn("ExecutionJob", "originRoomId"),
        inspector.hasColumn("ExecutionJob", "originRoomMessageId"),
      ])
    ).every(Boolean),
  "20260821100000_add_room_tool_confirmation_grants": async (inspector) =>
    (await inspector.hasTable("RoomToolConfirmationGrant")) ||
    (await inspector.hasTable("RoomToolConfirmationRequest")),
  "20260821110000_add_execution_recovery_incidents": async (inspector) =>
    inspector.hasTable("ExecutionRecoveryIncident"),
  "20260821120000_add_room_context_summary_cache": async (inspector) =>
    (
      await Promise.all([
        inspector.hasTable("RoomContextSummaryCache"),
        inspector.hasColumn("RoomContextSummaryCache", "sourceHash"),
        inspector.hasColumn("RoomContextSummaryCache", "aclHash"),
        inspector.hasColumn("RoomContextSummaryCache", "configVersion"),
      ])
    ).every(Boolean),
  "20260821150000_add_aligned_label_atomicity": async (inspector) =>
    (await inspector.hasPartialUniqueIndex(
      "Label",
      ["versionId"],
      `WHERE "kind" = 'aligned' AND "deletedAt" IS NULL`,
    )) &&
    (await inspector.hasNoRows(`
      SELECT 1
      FROM "Label"
      WHERE "kind" = 'aligned'
        AND "deletedAt" IS NULL
      GROUP BY "versionId"
      HAVING COUNT(*) > 1
      LIMIT 1
    `)),
  [AGENT_PROFILE_MANAGEMENT_MIGRATION]: async (inspector) =>
    hasCompleteAgentProfileManagementSchema(inspector),
  [ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION]: async (inspector) =>
    (await hasCompleteRoomToolConfirmationRequestSchema(inspector)) &&
    (await inspector.lacksTable("RoomToolConfirmationGrant")),
  [DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION]: async (inspector) =>
    hasCompleteDurableRoomDelegationLedgerSchema(inspector),
  [DOCUMENT_PROPOSAL_CAS_MIGRATION]: async (inspector) =>
    hasCompleteDocumentProposalCasSchema(inspector),
  [CANVAS_TABLES_MIGRATION]: async (inspector) =>
    (
      await Promise.all(
        CANVAS_TABLES.map((table) =>
          hasCompleteTableSchema(inspector, table),
        ),
      )
    ).every(Boolean),
  [TEAM_SCOPED_CONVERSATIONS_MIGRATION]: async (inspector) =>
    hasCompleteTeamScopedConversationSchema(inspector),
};

async function hasCompleteTeamScopedConversationSchema(inspector) {
  const [sessionChecks, assistantRunChecks, lacksTemporaryAssistantRunTable] =
    await Promise.all([
      Promise.all([
        inspector.hasColumnDefinition(
          "Session",
          TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN,
        ),
        inspector.hasNamedIndexOnColumns(
          TEAM_SCOPED_CONVERSATION_SESSION_INDEX.table,
          TEAM_SCOPED_CONVERSATION_SESSION_INDEX.name,
          TEAM_SCOPED_CONVERSATION_SESSION_INDEX.columns,
          TEAM_SCOPED_CONVERSATION_SESSION_INDEX.unique,
        ),
      ]),
      Promise.all([
        inspector.hasColumnDefinition(
          "AssistantRun",
          TEAM_SCOPED_CONVERSATION_CURRENT_DOCUMENT_COLUMN,
        ),
        inspector.hasColumnDefinition(
          "AssistantRun",
          TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN,
        ),
        ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS.map(
          (foreignKey) => inspector.hasForeignKey("AssistantRun", foreignKey),
        ),
        ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES.map((index) =>
          inspector.hasNamedIndexOnColumns(
            index.table,
            index.name,
            index.columns,
            index.unique,
          ),
        ),
      ]),
      inspector.lacksTable("new_AssistantRun"),
    ]);

  return (
    lacksTemporaryAssistantRunTable &&
    sessionChecks.every(Boolean) &&
    assistantRunChecks.every(Boolean)
  );
}

async function hasUntouchedLegacyTeamScopedConversationSchema(inspector) {
  const [sessionChecks, assistantRunChecks] = await Promise.all([
    Promise.all([
      inspector.hasTable("Session"),
      inspector.hasColumn("Session", TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN.name),
      inspector.hasIndex(TEAM_SCOPED_CONVERSATION_SESSION_INDEX.name),
    ]),
    Promise.all([
      inspector.hasTable("AssistantRun"),
      inspector.hasColumnDefinition(
        "AssistantRun",
        TEAM_SCOPED_CONVERSATION_LEGACY_DOCUMENT_COLUMN,
      ),
      inspector.hasColumn(
        "AssistantRun",
        TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN.name,
      ),
      inspector.hasIndex("AssistantRun_organizationId_scopeKind_startedAt_idx"),
      ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS.map((foreignKey) =>
        inspector.hasForeignKey("AssistantRun", foreignKey),
      ),
      ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES
        .filter(
          (index) =>
            index.name !== "AssistantRun_organizationId_scopeKind_startedAt_idx",
        )
        .map((index) =>
          inspector.hasNamedIndexOnColumns(
            index.table,
            index.name,
            index.columns,
            index.unique,
          ),
        ),
    ]),
  ]);

  const [hasSessionTable, hasSessionScopeColumn, hasSessionScopeIndex] =
    sessionChecks;
  const [
    hasAssistantRunTable,
    hasLegacyDocumentColumn,
    hasAssistantRunScopeColumn,
    hasAssistantRunScopeIndex,
    ...assistantRunIntegrityChecks
  ] = assistantRunChecks;

  return (
    hasSessionTable &&
    hasAssistantRunTable &&
    hasLegacyDocumentColumn &&
    !hasSessionScopeColumn &&
    !hasSessionScopeIndex &&
    !hasAssistantRunScopeColumn &&
    !hasAssistantRunScopeIndex &&
    assistantRunIntegrityChecks.every(Boolean)
  );
}

async function hasCompleteAgentProfileManagementSchema(inspector) {
  const [hasAgentProfileTable, hasRoomAgentSessionTable, ...columnPresence] =
    await Promise.all([
      inspector.hasTable("AgentProfile"),
      inspector.hasTable("RoomAgentSession"),
      ...AGENT_PROFILE_MANAGEMENT_COLUMNS.map((column) =>
        inspector.hasColumn("AgentProfile", column),
      ),
    ]);

  if (
    !hasAgentProfileTable ||
    !hasRoomAgentSessionTable ||
    !columnPresence.every(Boolean)
  ) {
    return false;
  }

  return !(await hasRepairableAgentProfileManagementData(inspector));
}

async function hasCompleteRoomToolConfirmationRequestSchema(inspector) {
  if (!(await inspector.hasTable("RoomToolConfirmationRequest"))) {
    return false;
  }

  const columnChecks = await Promise.all(
    ROOM_TOOL_CONFIRMATION_REQUEST_COLUMNS.map((column) =>
      inspector.hasColumn("RoomToolConfirmationRequest", column),
    ),
  );
  if (!columnChecks.every(Boolean)) {
    return false;
  }

  const indexChecks = await Promise.all(
    ROOM_TOOL_CONFIRMATION_REQUEST_INDEXES.map((index) =>
      inspector.hasIndexOnColumns(
        "RoomToolConfirmationRequest",
        index.columns,
        index.unique,
      ),
    ),
  );
  return indexChecks.every(Boolean);
}

async function hasCompleteDurableRoomDelegationLedgerSchema(inspector) {
  const [tableChecks, lacksTemporaryGrantTable] = await Promise.all([
    Promise.all(
      DURABLE_ROOM_DELEGATION_TABLES.map((table) =>
        hasCompleteTableSchema(inspector, table),
      ),
    ),
    inspector.lacksTable("new_RoomDelegationGrant"),
  ]);
  return lacksTemporaryGrantTable && tableChecks.every(Boolean);
}

async function hasCompleteDocumentProposalCasSchema(inspector) {
  const [
    hasChangeSetTable,
    hasVersionTable,
    ...schemaChecks
  ] = await Promise.all([
    inspector.hasTable("StagedChangeSet"),
    inspector.hasTable("Version"),
    ...DOCUMENT_PROPOSAL_CAS_COLUMNS.map((column) =>
      inspector.hasColumn("StagedChangeSet", column),
    ),
    ...DOCUMENT_PROPOSAL_CAS_INDEXES.map((index) =>
      inspector.hasIndexOnColumns(
        "StagedChangeSet",
        index.columns,
        index.unique,
      ),
    ),
    ...DOCUMENT_PROPOSAL_CAS_FOREIGN_KEYS.map((foreignKey) =>
      inspector.hasForeignKey("StagedChangeSet", foreignKey),
    ),
    inspector.hasTrigger(VERSION_IMMUTABLE_TRIGGER, "Version"),
  ]);
  if (!hasChangeSetTable || !hasVersionTable || !schemaChecks.every(Boolean)) {
    return false;
  }

  return !(await hasLegacyPendingDocumentProposals(inspector));
}

async function hasCompleteTableSchema(inspector, table) {
  if (
    !(await inspector.hasTable(table.name)) ||
    !(await inspector.hasExactColumns(table.name, table.columns))
  ) {
    return false;
  }

  const [indexChecks, foreignKeyChecks, constraintChecks] = await Promise.all([
    Promise.all(
      table.indexes.map((index) =>
        index.name === undefined
          ? inspector.hasIndexOnColumns(
              table.name,
              index.columns,
              index.unique,
            )
          : inspector.hasNamedIndexOnColumns(
              table.name,
              index.name,
              index.columns,
              index.unique,
            ),
      ),
    ),
    Promise.all(
      (table.foreignKeys ?? []).map((foreignKey) =>
        inspector.hasForeignKey(table.name, foreignKey),
      ),
    ),
    Promise.all(
      table.checks.map((check) =>
        inspector.hasCheckConstraint(
          table.name,
          check.name,
          check.expression,
        ),
      ),
    ),
  ]);

  return [...indexChecks, ...foreignKeyChecks, ...constraintChecks].every(Boolean);
}

async function hasCompleteTableShapeWithoutChecks(inspector, table) {
  if (
    !(await inspector.hasTable(table.name)) ||
    !(await inspector.hasExactColumns(table.name, table.columns))
  ) {
    return false;
  }

  const indexChecks = await Promise.all(
    table.indexes.map((index) =>
      inspector.hasIndexOnColumns(table.name, index.columns, index.unique),
    ),
  );
  return indexChecks.every(Boolean);
}

async function hasCompleteLegacyRoomDelegationGrantSchema(inspector) {
  if (
    !(await inspector.hasTable("RoomDelegationGrant")) ||
    !(await inspector.hasExactColumns(
      "RoomDelegationGrant",
      LEGACY_ROOM_DELEGATION_GRANT_COLUMNS,
    ))
  ) {
    return false;
  }

  const [indexChecks, constraintChecks] = await Promise.all([
    Promise.all(
      ROOM_DELEGATION_GRANT_INDEXES.map((index) =>
        inspector.hasIndexOnColumns(
          "RoomDelegationGrant",
          index.columns,
          index.unique,
        ),
      ),
    ),
    Promise.all(
      LEGACY_ROOM_DELEGATION_GRANT_CHECKS.map((check) =>
        inspector.hasCheckConstraint(
          "RoomDelegationGrant",
          check.name,
          check.expression,
        ),
      ),
    ),
  ]);

  return [...indexChecks, ...constraintChecks].every(Boolean);
}

async function hasRepairableAgentProfileManagementData(inspector) {
  const [hasLegacyCapabilitiesRows, hasLegacyRoomSessionRows] =
    await Promise.all([
      inspector.hasAnyRows(`
        SELECT 1
        FROM "AgentProfile"
        WHERE CASE
          WHEN json_valid("skillsJson")
            AND json_type("skillsJson") = 'array'
            AND json_valid("capabilitiesJson")
          THEN json("capabilitiesJson") = json('${EMPTY_AGENT_CAPABILITIES}')
            AND json("capabilitiesJson") <> json(json_object(
              'schemaVersion', 1,
              'skills', json("skillsJson")
            ))
          ELSE 0
        END
        LIMIT 1
      `),
      inspector.hasAnyRows(`
        SELECT 1
        FROM "RoomAgentSession"
        WHERE "agentConfigVersion" = 'v1'
        LIMIT 1
      `),
    ]);

  return hasLegacyCapabilitiesRows || hasLegacyRoomSessionRows;
}

async function hasLegacyPendingDocumentProposals(inspector) {
  return inspector.hasAnyRows(`
    SELECT 1
    FROM "StagedChangeSet"
    WHERE "status" = 'pending'
      AND (
        "baseDraftRevision" IS NULL
        OR "patchSchemaVersion" IS NULL
        OR "patchSha256" IS NULL
        OR ("baseVersionId" IS NOT NULL AND "baseVersionSha256" IS NULL)
      )
    LIMIT 1
  `);
}

export async function resolveMigrationStrategy(migrationName, inspector) {
  if (migrationName === AGENT_PROFILE_MANAGEMENT_MIGRATION) {
    return resolveAgentProfileManagementStrategy(inspector);
  }
  if (migrationName === ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION) {
    return resolveRoomToolConfirmationRequestStrategy(inspector);
  }
  if (migrationName === DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION) {
    return resolveDurableRoomDelegationLedgerStrategy(inspector);
  }
  if (migrationName === DOCUMENT_PROPOSAL_CAS_MIGRATION) {
    return resolveDocumentProposalCasStrategy(inspector);
  }
  if (migrationName === TEAM_SCOPED_CONVERSATIONS_MIGRATION) {
    return resolveTeamScopedConversationsStrategy(inspector);
  }

  const probe = MIGRATION_PROBES[migrationName];
  if (probe && (await probe(inspector))) {
    return { action: MIGRATION_ACTION_MARK };
  }
  return { action: MIGRATION_ACTION_APPLY };
}

async function resolveAgentProfileManagementStrategy(inspector) {
  const [hasAgentProfileTable, hasRoomAgentSessionTable, ...columnPresence] =
    await Promise.all([
      inspector.hasTable("AgentProfile"),
      inspector.hasTable("RoomAgentSession"),
      ...AGENT_PROFILE_MANAGEMENT_COLUMNS.map((column) =>
        inspector.hasColumn("AgentProfile", column),
      ),
    ]);

  if (!hasAgentProfileTable || !hasRoomAgentSessionTable) {
    throw new Error(
      `${AGENT_PROFILE_MANAGEMENT_MIGRATION} requires AgentProfile and RoomAgentSession tables to exist before compatibility checks.`,
    );
  }

  const presentColumns = columnPresence.filter(Boolean).length;
  if (
    presentColumns > 0 &&
    presentColumns < AGENT_PROFILE_MANAGEMENT_COLUMNS.length
  ) {
    throw new Error(
      `${AGENT_PROFILE_MANAGEMENT_MIGRATION} detected a partial AgentProfile schema. Refusing to rerun ALTER TABLE against a mixed state.`,
    );
  }

  if (presentColumns === 0) {
    return { action: MIGRATION_ACTION_APPLY };
  }

  if (await hasRepairableAgentProfileManagementData(inspector)) {
    return {
      action: MIGRATION_ACTION_REPAIR,
      sql: AGENT_PROFILE_MANAGEMENT_REPAIR_SQL,
    };
  }

  return { action: MIGRATION_ACTION_MARK };
}

async function resolveRoomToolConfirmationRequestStrategy(inspector) {
  const [hasRequestTable, hasGrantTable] = await Promise.all([
    inspector.hasTable("RoomToolConfirmationRequest"),
    inspector.hasTable("RoomToolConfirmationGrant"),
  ]);

  if (hasRequestTable) {
    if (!(await hasCompleteRoomToolConfirmationRequestSchema(inspector))) {
      throw new Error(
        `${ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION} detected a partial RoomToolConfirmationRequest schema. Refusing to rerun CREATE TABLE against a mixed state.`,
      );
    }
    if (hasGrantTable) {
      throw new Error(
        `${ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION} detected mixed legacy/current room tool confirmation tables. Refusing to guess whether RoomToolConfirmationGrant should be dropped.`,
      );
    }
    return { action: MIGRATION_ACTION_MARK };
  }

  if (hasGrantTable) {
    return { action: MIGRATION_ACTION_APPLY };
  }

  throw new Error(
    `${ROOM_TOOL_CONFIRMIRMATION_REQUESTS_MIGRATION} could not find either the legacy RoomToolConfirmationGrant table or the current RoomToolConfirmationRequest schema.`,
  );
}

async function resolveDurableRoomDelegationLedgerStrategy(inspector) {
  if (await hasCompleteDurableRoomDelegationLedgerSchema(inspector)) {
    return { action: MIGRATION_ACTION_MARK };
  }

  const [currentTableShapes, lacksTemporaryGrantTable] = await Promise.all([
    Promise.all(
      DURABLE_ROOM_DELEGATION_TABLES.map((table) =>
        hasCompleteTableShapeWithoutChecks(inspector, table),
      ),
    ),
    inspector.lacksTable("new_RoomDelegationGrant"),
  ]);
  if (lacksTemporaryGrantTable && currentTableShapes.every(Boolean)) {
    const invalidDataChecks = await Promise.all(
      DURABLE_ROOM_DELEGATION_DATA_VALIDATION_QUERIES.map((query) =>
        inspector.hasAnyRows(query),
      ),
    );
    if (invalidDataChecks.some(Boolean)) {
      throw new Error(
        `${DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION} found data that violates durable delegation constraints. Refusing to rebuild or record the migration.`,
      );
    }

    return {
      action: MIGRATION_ACTION_REPAIR,
      sql: DURABLE_ROOM_DELEGATION_REPAIR_SQL,
    };
  }

  const [
    hasGrantTable,
    hasRootBudgetTable,
    hasInvocationTable,
    hasTemporaryGrantTable,
    legacyGrantSchemaComplete,
    ...durableGrantColumnPresence
  ] = await Promise.all([
    inspector.hasTable("RoomDelegationGrant"),
    inspector.hasTable("RoomDelegationRootBudget"),
    inspector.hasTable("RoomDelegationInvocation"),
    inspector.hasTable("new_RoomDelegationGrant"),
    hasCompleteLegacyRoomDelegationGrantSchema(inspector),
    ...DURABLE_ROOM_DELEGATION_GRANT_ADDED_COLUMNS.map((column) =>
      inspector.hasColumn("RoomDelegationGrant", column),
    ),
  ]);

  const hasDurableArtifacts =
    hasRootBudgetTable ||
    hasInvocationTable ||
    hasTemporaryGrantTable ||
    durableGrantColumnPresence.some(Boolean);

  if (
    hasGrantTable &&
    legacyGrantSchemaComplete &&
    !hasDurableArtifacts
  ) {
    return { action: MIGRATION_ACTION_APPLY };
  }

  if (hasGrantTable || hasDurableArtifacts) {
    throw new Error(
      `${DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION} detected a partial durable room delegation ledger schema. Refusing to rebuild RoomDelegationGrant or create ledger tables against a mixed state.`,
    );
  }

  throw new Error(
    `${DURABLE_ROOM_DELEGATION_LEDGER_MIGRATION} requires the legacy RoomDelegationGrant table before compatibility checks.`,
  );
}

async function resolveDocumentProposalCasStrategy(inspector) {
  const [hasChangeSetTable, hasVersionTable, ...columnPresence] =
    await Promise.all([
      inspector.hasTable("StagedChangeSet"),
      inspector.hasTable("Version"),
      ...DOCUMENT_PROPOSAL_CAS_COLUMNS.map((column) =>
        inspector.hasColumn("StagedChangeSet", column),
      ),
    ]);

  if (!hasChangeSetTable || !hasVersionTable) {
    throw new Error(
      `${DOCUMENT_PROPOSAL_CAS_MIGRATION} requires StagedChangeSet and Version tables before compatibility checks.`,
    );
  }

  const presentColumns = columnPresence.filter(Boolean).length;
  if (presentColumns === 0) {
    return { action: MIGRATION_ACTION_APPLY };
  }
  if (presentColumns < DOCUMENT_PROPOSAL_CAS_COLUMNS.length) {
    throw new Error(
      `${DOCUMENT_PROPOSAL_CAS_MIGRATION} detected a partial StagedChangeSet CAS schema. Refusing to rebuild or record the migration against a mixed state.`,
    );
  }

  const [indexChecks, foreignKeyChecks, hasImmutableTrigger] =
    await Promise.all([
      Promise.all(
        DOCUMENT_PROPOSAL_CAS_INDEXES.map((index) =>
          inspector.hasIndexOnColumns(
            "StagedChangeSet",
            index.columns,
            index.unique,
          ),
        ),
      ),
      Promise.all(
        DOCUMENT_PROPOSAL_CAS_FOREIGN_KEYS.map((foreignKey) =>
          inspector.hasForeignKey("StagedChangeSet", foreignKey),
        ),
      ),
      inspector.hasTrigger(VERSION_IMMUTABLE_TRIGGER, "Version"),
    ]);

  if (!indexChecks.every(Boolean) || !foreignKeyChecks.every(Boolean)) {
    throw new Error(
      `${DOCUMENT_PROPOSAL_CAS_MIGRATION} detected CAS columns without the expected indexes or Version relations. Refusing to repair an ambiguous StagedChangeSet schema.`,
    );
  }

  if (
    !hasImmutableTrigger ||
    (await hasLegacyPendingDocumentProposals(inspector))
  ) {
    return {
      action: MIGRATION_ACTION_REPAIR,
      sql: DOCUMENT_PROPOSAL_CAS_REPAIR_SQL,
    };
  }

  return { action: MIGRATION_ACTION_MARK };
}

async function inspectInterruptedTeamScopedConversationStage(inspector) {
  const [
    sessionHasCurrentScope,
    sessionHasCurrentIndex,
    assistantRunHasLegacyDocument,
    assistantRunHasScopeColumn,
    assistantRunHasScopeIndex,
    assistantRunIntegrityChecks,
  ] =
    await Promise.all([
      inspector.hasColumnDefinition("Session", TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN),
      inspector.hasNamedIndexOnColumns(
        TEAM_SCOPED_CONVERSATION_SESSION_INDEX.table,
        TEAM_SCOPED_CONVERSATION_SESSION_INDEX.name,
        TEAM_SCOPED_CONVERSATION_SESSION_INDEX.columns,
        TEAM_SCOPED_CONVERSATION_SESSION_INDEX.unique,
      ),
      inspector.hasColumnDefinition(
        "AssistantRun",
        TEAM_SCOPED_CONVERSATION_LEGACY_DOCUMENT_COLUMN,
      ),
      inspector.hasColumn(
        "AssistantRun",
        TEAM_SCOPED_CONVERSATION_SCOPE_COLUMN.name,
      ),
      inspector.hasIndex("AssistantRun_organizationId_scopeKind_startedAt_idx"),
      Promise.all([
        ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_FOREIGN_KEYS.map((foreignKey) =>
          inspector.hasForeignKey("AssistantRun", foreignKey),
        ),
        ...TEAM_SCOPED_CONVERSATION_ASSISTANT_RUN_INDEXES
          .filter(
            (index) =>
              index.name !== "AssistantRun_organizationId_scopeKind_startedAt_idx",
          )
          .map((index) =>
            inspector.hasNamedIndexOnColumns(
              index.table,
              index.name,
              index.columns,
              index.unique,
            ),
          ),
      ]),
    ]);

  if (
    !sessionHasCurrentScope ||
    !sessionHasCurrentIndex ||
    !assistantRunHasLegacyDocument ||
    assistantRunHasScopeColumn ||
    assistantRunHasScopeIndex ||
    !assistantRunIntegrityChecks.every(Boolean)
  ) {
    return {
      resumable: false,
      reason:
        "found new_AssistantRun but Session/AssistantRun are not in the exact interrupted team-scoped migration state.",
    };
  }

  if (
    !(await hasCompleteTableSchema(
      inspector,
      TEAM_SCOPED_CONVERSATION_STAGING_TABLE,
    ))
  ) {
    return {
      resumable: false,
      reason:
        "found new_AssistantRun but its schema does not match the expected team-scoped AssistantRun staging table.",
    };
  }

  const [rowCountsMatch, hasMismatchedRows, hasLegacyExtraRows] = await Promise.all([
    inspector.scalarEquals(
      `
        SELECT COUNT(*) FROM "AssistantRun"
      `,
      `
        SELECT COUNT(*) FROM "new_AssistantRun"
      `,
    ),
    inspector.hasAnyRows(`
      SELECT 1
      FROM "AssistantRun" AS legacy
      LEFT JOIN "new_AssistantRun" AS staged
        ON staged."id" = legacy."id"
      WHERE staged."id" IS NULL
         OR staged."organizationId" <> legacy."organizationId"
         OR staged."sessionId" <> legacy."sessionId"
         OR NOT (
           (staged."documentId" IS NULL AND legacy."documentId" IS NULL)
           OR staged."documentId" = legacy."documentId"
         )
         OR staged."scopeKind" <> 'wiki'
         OR NOT (
           (staged."requestMessageId" IS NULL AND legacy."requestMessageId" IS NULL)
           OR staged."requestMessageId" = legacy."requestMessageId"
         )
         OR staged."mode" <> legacy."mode"
         OR staged."title" <> legacy."title"
         OR staged."status" <> legacy."status"
         OR NOT (
           (staged."summary" IS NULL AND legacy."summary" IS NULL)
           OR staged."summary" = legacy."summary"
         )
         OR NOT (
           (staged."payloadJson" IS NULL AND legacy."payloadJson" IS NULL)
           OR staged."payloadJson" = legacy."payloadJson"
         )
         OR NOT (
           (staged."createdByUserId" IS NULL AND legacy."createdByUserId" IS NULL)
           OR staged."createdByUserId" = legacy."createdByUserId"
         )
         OR NOT (
           (staged."originDeviceId" IS NULL AND legacy."originDeviceId" IS NULL)
           OR staged."originDeviceId" = legacy."originDeviceId"
         )
         OR staged."revision" <> legacy."revision"
         OR NOT (
           (staged."deletedAt" IS NULL AND legacy."deletedAt" IS NULL)
           OR staged."deletedAt" = legacy."deletedAt"
         )
         OR staged."startedAt" <> legacy."startedAt"
         OR NOT (
           (staged."finishedAt" IS NULL AND legacy."finishedAt" IS NULL)
           OR staged."finishedAt" = legacy."finishedAt"
         )
         OR staged."createdAt" <> legacy."createdAt"
         OR staged."updatedAt" <> legacy."updatedAt"
      LIMIT 1
    `),
    inspector.hasAnyRows(`
      SELECT 1
      FROM "new_AssistantRun" AS staged
      LEFT JOIN "AssistantRun" AS legacy
        ON legacy."id" = staged."id"
      WHERE legacy."id" IS NULL
      LIMIT 1
    `),
  ]);

  if (!rowCountsMatch || hasMismatchedRows || hasLegacyExtraRows) {
    return {
      resumable: false,
      reason:
        "found new_AssistantRun but its rows do not exactly match legacy AssistantRun data for deterministic resume.",
    };
  }

  return { resumable: true };
}

async function resolveTeamScopedConversationsStrategy(inspector) {
  const [hasSessionTable, hasAssistantRunTable, hasTemporaryAssistantRunTable] =
    await Promise.all([
      inspector.hasTable("Session"),
      inspector.hasTable("AssistantRun"),
      inspector.hasTable("new_AssistantRun"),
    ]);

  if (!hasSessionTable || !hasAssistantRunTable) {
    throw new Error(
      `${TEAM_SCOPED_CONVERSATIONS_MIGRATION} requires Session and AssistantRun tables before compatibility checks.`,
    );
  }

  if (hasTemporaryAssistantRunTable) {
    const interruptedStage = await inspectInterruptedTeamScopedConversationStage(
      inspector,
    );
    if (interruptedStage.resumable) {
      return {
        action: MIGRATION_ACTION_REPAIR,
        sql: TEAM_SCOPED_CONVERSATION_RESUME_SQL,
      };
    }
    throw new Error(
      `${TEAM_SCOPED_CONVERSATIONS_MIGRATION} detected an ambiguous leftover new_AssistantRun table and will not guess how to recover it: ${interruptedStage.reason} Drop the stray staging table and restore a clean legacy or complete target schema before retrying bootstrap.`,
    );
  }

  if (await hasCompleteTeamScopedConversationSchema(inspector)) {
    return { action: MIGRATION_ACTION_MARK };
  }

  if (await hasUntouchedLegacyTeamScopedConversationSchema(inspector)) {
    return { action: MIGRATION_ACTION_APPLY };
  }

  throw new Error(
    `${TEAM_SCOPED_CONVERSATIONS_MIGRATION} detected a partial or mixed team-scoped conversation schema. Refusing to rebuild AssistantRun against a mixed state.`,
  );
}
