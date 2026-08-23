import {
  AssistantRunTransitionError,
  updateAssistantRun,
} from '@/objects/conversation/commands';

type AssistantRunActor = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export async function runWithAssistantRunFailureBoundary<T>(params: {
  actor: AssistantRunActor;
  assistantRunId: string;
  errorSummary?: string;
  operation: () => Promise<T>;
}) {
  try {
    return await params.operation();
  } catch (error) {
    try {
      await updateAssistantRun(params.actor, {
        finishedAt: new Date(),
        runId: params.assistantRunId,
        status: 'failed',
        summary:
          error instanceof Error
            ? error.message
            : params.errorSummary || 'AI run failed.',
      });
    } catch (transitionError) {
      if (!(transitionError instanceof AssistantRunTransitionError)) {
        throw transitionError;
      }
    }
    throw error;
  }
}
