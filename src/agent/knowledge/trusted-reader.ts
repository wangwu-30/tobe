import type { KnowledgeChangeRequestDto, KnowledgeSpaceDto } from '@/objects/knowledge';

import { LocalTrustedKnowledgeGitPortV1, type TrustedKnowledgeDiffV1 } from './trusted-merge';

export type TrustedKnowledgeDiffReadInputV1 = {
  space: Pick<KnowledgeSpaceDto, 'repoPath' | 'repoUrl' | 'defaultBranch'>;
  changeRequest: Pick<
    KnowledgeChangeRequestDto,
    'baseCommit' | 'headCommit' | 'branchName' | 'diffMetadata'
  >;
};

/** Server-only reader; repository paths are never accepted from HTTP input. */
export async function readTrustedKnowledgeDiffV1(
  input: TrustedKnowledgeDiffReadInputV1,
  git: LocalTrustedKnowledgeGitPortV1 = new LocalTrustedKnowledgeGitPortV1()
): Promise<TrustedKnowledgeDiffV1> {
  if (!input.space.repoPath || input.space.repoUrl) {
    throw new Error('Knowledge diff is available only for a configured local repository.');
  }
  const patchSha = input.changeRequest.diffMetadata.patchSha256;
  return git.readDiff({
    repositoryPath: input.space.repoPath,
    defaultBranch: input.space.defaultBranch,
    proposalBranch: input.changeRequest.branchName,
    baseCommit: input.changeRequest.baseCommit,
    headCommit: input.changeRequest.headCommit,
    expectedPatchSha256: typeof patchSha === 'string' ? patchSha : null,
  });
}
