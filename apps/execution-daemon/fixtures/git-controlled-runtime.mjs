import { writeFileSync } from "node:fs";
import path from "node:path";
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

    const scenario = readArgument("--scenario");
    const markerPath = readArgument("--marker");
    const workspacePath = fileURLToPath(envelope.workspace.uri);
    if (process.cwd() !== workspacePath) {
      throw new Error("runtime cwd does not match the trusted workspace URI");
    }
    if (!path.isAbsolute(markerPath) || isInside(workspacePath, markerPath)) {
      throw new Error("runtime marker must be outside the managed worktree");
    }

    if (scenario === "prepared-reclaim") {
      runPreparedReclaim(markerPath, envelope, workspacePath);
      return;
    }
    if (scenario === "cancel") {
      runCancellation(markerPath, envelope, workspacePath);
      return;
    }
    throw new Error("unknown controlled Git runtime scenario");
  } catch {
    process.exitCode = 2;
  }
});

function runPreparedReclaim(markerPath, envelope, workspacePath) {
  if (envelope.attempt.generation === 1) {
    writeMarker(markerPath, envelope, workspacePath);
    waitForInterrupt(markerPath, envelope);
    return;
  }
  if (envelope.attempt.generation !== 2) {
    throw new Error("reclaimed execution did not use generation 2");
  }

  writeRuntimeChange(envelope, workspacePath);
  process.stdout.write(
    `fixture-git-reclaimed:${envelope.attempt.attemptId}:generation:${envelope.attempt.generation}`,
  );
}

function runCancellation(markerPath, envelope, workspacePath) {
  if (envelope.attempt.generation !== 1) {
    throw new Error("cancel execution did not use generation 1");
  }
  writeRuntimeChange(envelope, workspacePath);
  writeMarker(markerPath, envelope, workspacePath);
  waitForInterrupt(markerPath, envelope);
}

function writeRuntimeChange(envelope, workspacePath) {
  writeFileSync(
    path.join(workspacePath, "runtime-change.txt"),
    `changed by ${envelope.attempt.attemptId} at ${envelope.workspace.revision}\n`,
    "utf8",
  );
}

function writeMarker(markerPath, envelope, workspacePath) {
  writeFileSync(
    markerPath,
    JSON.stringify({
      attemptId: envelope.attempt.attemptId,
      generation: envelope.attempt.generation,
      pid: process.pid,
      workspacePath,
    }),
    { flag: "wx" },
  );
}

function waitForInterrupt(markerPath, envelope) {
  const keepAlive = setInterval(() => {}, 1_000);
  const finish = (signal) => {
    clearInterval(keepAlive);
    writeFileSync(
      `${markerPath}.interrupted`,
      JSON.stringify({
        attemptId: envelope.attempt.attemptId,
        generation: envelope.attempt.generation,
        pid: process.pid,
        signal,
      }),
    );
    process.exit(0);
  };
  process.once("SIGTERM", () => finish("SIGTERM"));
  process.once("SIGINT", () => finish("SIGINT"));
}

function readArgument(flag) {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`missing ${flag}`);
  return value;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

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
    !Number.isSafeInteger(envelope?.attempt?.generation) ||
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
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(envelope.workspace.revision)
  ) {
    throw new Error("runtime workspace exposed fields outside uri/revision");
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
  if (Array.isArray(value)) return value.some(containsPrivateWorkspaceField);
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
