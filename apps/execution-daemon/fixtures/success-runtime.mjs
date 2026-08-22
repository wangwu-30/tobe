import { writeFileSync } from "node:fs";

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const envelope = JSON.parse(input.trim());
    if (
      envelope?.schemaVersion !== 1 ||
      envelope?.operation !== "start" ||
      envelope?.executionSpec?.schemaVersion !== 1 ||
      envelope?.executionSpec?.kind !== "coding" ||
      envelope?.contextManifest?.schemaVersion !== 1 ||
      typeof envelope?.contextManifest?.frozenAt !== "string" ||
      envelope?.contextManifest?.goal !== envelope?.executionSpec?.goal ||
      typeof envelope?.attempt?.attemptId !== "string"
    ) {
      throw new Error("invalid execution envelope");
    }

    const markerFlag = process.argv.indexOf("--crash-reclaim-marker");
    const markerPath = markerFlag === -1 ? null : process.argv[markerFlag + 1];
    if (markerFlag !== -1 && !markerPath) {
      throw new Error("missing crash/reclaim marker path");
    }

    if (markerPath && claimFirstRun(markerPath, envelope)) {
      waitForParentCrash(markerPath, envelope);
      return;
    }

    if (markerPath) {
      if (envelope.attempt.generation !== 2) {
        throw new Error("reclaimed execution did not use generation 2");
      }
      process.stdout.write(
        `fixture-reclaimed:${envelope.attempt.attemptId}:generation:${envelope.attempt.generation}`,
      );
      return;
    }

    process.stdout.write(`fixture-success:${envelope.attempt.attemptId}`);
  } catch {
    process.exitCode = 2;
  }
});

function claimFirstRun(markerPath, envelope) {
  try {
    writeFileSync(
      markerPath,
      JSON.stringify({
        attemptId: envelope.attempt.attemptId,
        generation: envelope.attempt.generation,
        pid: process.pid,
        parentPid: process.ppid,
      }),
      { flag: "wx" },
    );
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

function waitForParentCrash(markerPath, envelope) {
  const parentPid = process.ppid;
  const safetyExit = setTimeout(() => process.exit(3), 30_000);
  process.stdout.on("error", () => {
    clearTimeout(safetyExit);
    process.exitCode = 0;
  });

  const parentCheck = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(parentCheck);
      clearTimeout(safetyExit);
      writeFileSync(
        `${markerPath}.late`,
        JSON.stringify({
          attemptId: envelope.attempt.attemptId,
          generation: envelope.attempt.generation,
          pid: process.pid,
        }),
      );
      process.stdout.write(
        `fixture-late:${envelope.attempt.attemptId}:generation:${envelope.attempt.generation}`,
        () => process.exit(0),
      );
      setTimeout(() => process.exit(0), 250);
    }
  }, 25);
}
