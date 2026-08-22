import { ExecutionJobDetailPage } from '@/components/execution/execution-job-detail-page';

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <ExecutionJobDetailPage jobId={jobId} />;
}
