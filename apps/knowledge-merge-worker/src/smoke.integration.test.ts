import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { safeJsonParse } from "@/framework/resilience/safe-data";

const PROCESS_TIMEOUT_MS = 20_000;

type ProcessEvent = {
  schemaVersion?: number;
  type?: string;
  [key: string]: unknown;
};

test("built worker reports a structured missing-configuration error", async () => {
  const entry = path.resolve(
    process.cwd(),
    ".vite/knowledge-merge-worker/index.mjs",
  );
  const result = await runNode(entry, toolEnvironment());

  expect(result.exitCode).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  expect(parseStructuredLines(result.stderr)).toEqual([
    expect.objectContaining({
      schemaVersion: 1,
      type: "error",
      code: "invalid-configuration",
      message: "DAO_KNOWLEDGE_ORGANIZATION_ID is required.",
      pid: expect.any(Number),
    }),
  ]);
  expect(result.stderr).not.toContain("__dirname");
  expect(result.stderr).not.toContain("exports is not defined");
});

test("built worker never reports ready when database preflight fails", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dao-knowledge-worker-preflight-"),
  );
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const databasePath = path.join(appDataRoot, "empty.db");
  const artifactRoot = path.join(temporaryRoot, "index");
  const entry = path.resolve(
    process.cwd(),
    ".vite/knowledge-merge-worker/index.mjs",
  );

  try {
    await mkdir(appDataRoot, { recursive: true });
    await writeFile(databasePath, "");
    const result = await runNode(entry, {
      ...toolEnvironment(),
      DATABASE_URL: `file:${databasePath}`,
      DAO_APP_DATA_ROOT: appDataRoot,
      DAO_KNOWLEDGE_ORGANIZATION_ID: "preflight-org",
      DAO_KNOWLEDGE_WORKER_ID: "preflight-worker",
      DAO_KNOWLEDGE_INDEX_ROOT: artifactRoot,
      DAO_KNOWLEDGE_RUN_ONCE: "1",
      DAO_GIT_BINARY: "git",
    });

    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeNull();
    expect(parseStructuredLines(result.stdout)).toEqual([]);
    expect(parseStructuredLines(result.stderr)).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        type: "error",
        code: "knowledge-merge-worker-failed",
        message: "Knowledge merge database schema is not ready.",
        pid: expect.any(Number),
      }),
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("built worker is a Node-only artifact without browser preload code or public assets", async () => {
  const outputRoot = path.resolve(
    process.cwd(),
    ".vite/knowledge-merge-worker",
  );
  const files = await listFiles(outputRoot);
  const modules = files.filter((file) => file.endsWith(".mjs"));
  const source = (
    await Promise.all(
      modules.map((file) => readFile(path.join(outputRoot, file), "utf8")),
    )
  ).join("\n");

  expect(files).toContain("index.mjs");
  expect(files).not.toEqual(
    expect.arrayContaining([
      "file.svg",
      "globe.svg",
      "next.svg",
      "vercel.svg",
      "window.svg",
    ]),
  );
  expect(source).not.toContain("__vitePreload");
  expect(source).not.toContain("jsx-runtime");
  expect(source).not.toMatch(
    /(?:from|import\()\s*["'](?:react|next)(?:[\/"'])/,
  );
  expect(source).not.toMatch(
    /\bdocument\.(?:createElement|querySelector|getElementsByTagName)/,
  );
  expect(source).not.toMatch(/\bwindow\.(?:dispatchEvent|addEventListener)/);
});

function runNode(
  entry: string,
  environment: NodeJS.ProcessEnv,
): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, PROCESS_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new Error(
            `Knowledge merge worker timed out after ${PROCESS_TIMEOUT_MS}ms; ` +
              `stdout=${stdout}; stderr=${stderr}`,
          ),
        );
        return;
      }
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

function parseStructuredLines(output: string): ProcessEvent[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      safeJsonParse<ProcessEvent>(line, {
        type: "unstructured-output",
        line,
      }),
    );
}

function toolEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  };
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, next)));
    } else {
      files.push(next);
    }
  }
  return files.sort();
}
