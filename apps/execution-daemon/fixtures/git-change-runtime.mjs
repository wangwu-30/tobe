import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const envelope = JSON.parse(input.trim());
    assertExecutionEnvelope(envelope);

    const workspacePath = fileURLToPath(envelope.workspace.uri);
    if (process.cwd() !== workspacePath) {
      throw new Error("runtime cwd does not match the trusted workspace URI");
    }

    writeFileSync(
      "runtime-change.txt",
      `changed by ${envelope.attempt.attemptId} at ${envelope.workspace.revision}\n`,
      "utf8",
    );
    process.stdout.write(
      `fixture-git-change:${envelope.attempt.attemptId}:${envelope.workspace.revision}`,
    );
  } catch {
    process.exitCode = 2;
  }
});

function assertExecutionEnvelope(envelope) {
  if (
    envelope?.schemaVersion !== 1 ||
    envelope?.operation !== "start" ||
    envelope?.executionSpec?.schemaVersion !== 1 ||
    envelope?.executionSpec?.kind !== "coding" ||
    envelope?.executionSpec?.requirements?.workspace !== "git-worktree" ||
    envelope?.contextManifest?.schemaVersion !== 1 ||
    envelope?.contextManifest?.goal !== envelope?.executionSpec?.goal ||
    typeof envelope?.attempt?.attemptId !== "string" ||
    envelope?.workspace === null ||
    typeof envelope?.workspace !== "object"
  ) {
    throw new Error("invalid execution envelope");
  }

  const workspaceKeys = Object.keys(envelope.workspace).sort();
  if (
    workspaceKeys.length !== 2 ||
    workspaceKeys[0] !== "revision" ||
    workspaceKeys[1] !== "uri" ||
    typeof envelope.workspace.uri !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(
      envelope.workspace.revision,
    )
  ) {
    throw new Error("runtime workspace exposed fields outside uri/revision");
  }

  const workspaceUrl = new URL(envelope.workspace.uri);
  if (
    workspaceUrl.protocol !== "file:" ||
    workspaceUrl.host ||
    workspaceUrl.search ||
    workspaceUrl.hash
  ) {
    throw new Error("runtime workspace URI is not a local file URI");
  }

  const knowledgeCommit = envelope.contextManifest.knowledgeCommit;
  if (
    knowledgeCommit?.baseCommit !== envelope.workspace.revision ||
    containsPrivateWorkspaceField(envelope.contextManifest)
  ) {
    throw new Error("runtime manifest exposed private workspace state");
  }
}

function containsPrivateWorkspaceField(value) {
  if (Array.isArray(value)) {
    return value.some(containsPrivateWorkspaceField);
  }
  if (!value || typeof value !== "object") return false;

  const privateFields = new Set([
    "credentialRef",
    "repoPath",
    "repoUrl",
    "repositoryPath",
    "worktreePath",
  ]);
  return Object.entries(value).some(
    ([key, nested]) =>
      privateFields.has(key) || containsPrivateWorkspaceField(nested),
  );
}
