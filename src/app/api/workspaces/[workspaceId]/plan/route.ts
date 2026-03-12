import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  getWorkspacePlan,
  updateWorkspacePlan,
  upsertWorkspacePlan,
} from '@/lib/workspace/planning';
import type { WorkspacePlanStageData } from '@/types';

function parsePlanStages(value: unknown): WorkspacePlanStageData[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const stages = value
    .map((stage) => {
      if (!stage || typeof stage !== 'object') {
        return null;
      }

      const record = stage as Record<string, unknown>;
      if (
        typeof record.id !== 'string' ||
        typeof record.kind !== 'string' ||
        typeof record.title !== 'string'
      ) {
        return null;
      }

      return {
        id: record.id.trim(),
        kind: record.kind.trim(),
        title: record.title.trim(),
        description:
          typeof record.description === 'string' ? record.description.trim() : '',
        status:
          record.status === 'completed' ||
          record.status === 'blocked' ||
          record.status === 'in_progress'
            ? record.status
            : 'pending',
        checkpoint: Boolean(record.checkpoint),
      } satisfies WorkspacePlanStageData;
    })
    .filter((stage): stage is WorkspacePlanStageData => Boolean(stage));

  return stages.length > 0 ? stages : undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const plan = await getWorkspacePlan({
    organizationId: actor.organizationId,
    workspaceId,
  });

  return NextResponse.json(plan);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));
  const deliverableType =
    body.deliverableType === 'web' ||
    body.deliverableType === 'code' ||
    body.deliverableType === 'slides'
      ? body.deliverableType
      : 'document';

  const plan = await upsertWorkspacePlan(actor, {
    activeStageId:
      typeof body.activeStageId === 'string' ? body.activeStageId : undefined,
    constraints: body.constraints,
    deliverableType,
    goal: body.goal || 'Create a new deliverable',
    lastProgressNote:
      typeof body.lastProgressNote === 'string' ? body.lastProgressNote : undefined,
    stages: parsePlanStages(body.stages),
    status: body.status || 'drafting',
    styleGuide: body.styleGuide,
    workspaceId,
  });

  return NextResponse.json(plan);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  const plan = await updateWorkspacePlan(actor, {
    activeStageId:
      body.activeStageId === null || typeof body.activeStageId === 'string'
        ? body.activeStageId
        : undefined,
    constraints:
      body.constraints === null || typeof body.constraints === 'string'
        ? body.constraints
        : undefined,
    deliverableType:
      body.deliverableType === 'web' ||
      body.deliverableType === 'code' ||
      body.deliverableType === 'slides'
        ? body.deliverableType
        : undefined,
    incrementVersion: body.incrementVersion === true,
    lastProgressNote:
      body.lastProgressNote === null || typeof body.lastProgressNote === 'string'
        ? body.lastProgressNote
        : undefined,
    stages: parsePlanStages(body.stages),
    goal: typeof body.goal === 'string' ? body.goal : undefined,
    status: typeof body.status === 'string' ? body.status : undefined,
    styleGuide:
      body.styleGuide === null || typeof body.styleGuide === 'string'
        ? body.styleGuide
        : undefined,
    workspaceId,
  });

  return NextResponse.json(plan);
}
