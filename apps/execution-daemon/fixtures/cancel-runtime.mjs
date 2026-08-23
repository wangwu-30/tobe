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
      typeof envelope?.attempt?.attemptId !== "string" ||
      Object.prototype.hasOwnProperty.call(envelope, "workspace")
    ) {
      throw new Error("invalid execution envelope");
    }

    const markerPath = readArgument("--marker");
    writeFileSync(
      markerPath,
      JSON.stringify({
        attemptId: envelope.attempt.attemptId,
        generation: envelope.attempt.generation,
        pid: process.pid,
      }),
      { flag: "wx" },
    );

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
  } catch {
    process.exitCode = 2;
  }
});

function readArgument(flag) {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`missing ${flag}`);
  return value;
}
