import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import rokuDeploy from "roku-deploy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const OUT_DIR = path.join(projectRoot, "out");
const LOG_PATH = path.join(OUT_DIR, "roku-log.txt");
const DEFAULT_VIDEO_PROTO_ROOT = "/Users/chad/Projects/Temp/googlevideo/protos";
const VIDEO_PROTO_FILES = [
  "misc/common.proto",
  "video_streaming/time_range.proto",
  "video_streaming/media_capabilities.proto",
  "video_streaming/client_abr_state.proto",
  "video_streaming/streamer_context.proto",
  "video_streaming/buffered_range.proto",
  "video_streaming/video_playback_abr_request.proto"
];

const host = process.env.ROKU_HOST;
const password = process.env.ROKU_PASSWORD;
const username = process.env.ROKU_USERNAME ?? "rokudev";
const telnetTimeoutMs = Number(process.env.ROKU_TELNET_TIMEOUT_MS ?? 5000);

if (!host || !password) {
  console.error("ROKU_HOST and ROKU_PASSWORD environment variables are required.");
  process.exit(1);
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function ensureGeneratedArtifacts() {
  const videoProtoRoot = process.env.VIDEO_PROTO_ROOT ?? DEFAULT_VIDEO_PROTO_ROOT;
  try {
    await fsPromises.access(videoProtoRoot);
  } catch {
    throw new Error(
      `Video proto directory not found at "${videoProtoRoot}". ` +
        "Set VIDEO_PROTO_ROOT to the root containing the googlevideo protos."
    );
  }

  const protoFiles = VIDEO_PROTO_FILES.map((relative) => path.join(videoProtoRoot, relative));
  for (const filePath of protoFiles) {
    try {
      await fsPromises.access(filePath);
    } catch {
      throw new Error(`Unable to locate required proto at "${filePath}"`);
    }
  }

  const generateArgs = ["run", "generate:brs", "--", "--proto", "proto/simple.proto", "--pruneDefaults"];
  for (const filePath of protoFiles) {
    generateArgs.push("--proto", filePath);
  }

  await runCommand(
    "npm",
    generateArgs,
    { cwd: projectRoot }
  );

  const baselineArgs = ["run", "generate:baseline", "--", "--proto", "proto/simple.proto", "--pruneDefaults"];
  for (const filePath of protoFiles) {
    baselineArgs.push("--proto", filePath);
  }

  await runCommand("npm", baselineArgs, {
    cwd: projectRoot
  });
}


async function buildRokuBundle() {
  await runCommand("npm", ["run", "build:roku"], { cwd: projectRoot });
}

async function deployToDevice() {
  const deployOptions = {
    host,
    password,
    username,
    rootDir: OUT_DIR,
    outDir: path.join(projectRoot, ".roku-deploy"),
    files: ["**/*"],
    retainStagingFolder: true
  };
  await rokuDeploy.deploy(deployOptions);
}

async function captureTelnetLog() {
  await fsPromises.mkdir(OUT_DIR, { recursive: true });
  await fsPromises.writeFile(LOG_PATH, '', 'utf8');

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 8085 });
    let logStream = null;
    let buffer = '';
    let summaryMatched = false;
    let failures = [];
    let passCount = 0;
    let totalCount = 0;
    let startDetected = false;
    let finalized = false;

    let timeout = null;

    function refreshTimeout() {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        finalize(new Error('Timed out waiting for Roku console output.'));
      }, telnetTimeoutMs);
    }

    refreshTimeout();

    function finalize(result) {
      if (finalized) {
        return;
      }
      finalized = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      try {
        if (logStream) {
          logStream.end();
        }
      } catch {
        // ignore
      }
      try {
        socket.destroy();
      } catch {
        // ignore
      }

      if (result instanceof Error) {
        reject(result);
        return;
      }

      if (!summaryMatched) {
        reject(new Error('Did not capture Summary line from Roku console. See roku-log.txt for details.'));
        return;
      }
      if (passCount !== totalCount || failures.length > 0) {
        const error = new Error(`Roku device reported failures. Summary: ${passCount}/${totalCount} passed.`);
        error.failures = failures;
        error.passCount = passCount;
        error.totalCount = totalCount;
        reject(error);
        return;
      }
      resolve({ passCount, totalCount, logPath: LOG_PATH });
    }

    function handleLine(line) {
      if (finalized) {
        return false;
      }
      const trimmed = line.trim();

      if (!trimmed) {
        return false;
      }

      if (line.includes("------ Running dev 'protoc-gen-brs' main ------")) {
        startDetected = true;
        summaryMatched = false;
        failures = [];
        passCount = 0;
        totalCount = 0;
        if (logStream) {
          logStream.end();
          logStream = null;
        }
        return true;
      }

      if (!startDetected) {
        return false;
      }

      if (!summaryMatched) {
        const summaryMatch = line.match(/Summary:\s+(\d+)\s+of\s+(\d+)/i);
        if (summaryMatch) {
          summaryMatched = true;
          passCount = Number(summaryMatch[1]);
          totalCount = Number(summaryMatch[2]);
          return true;
        }
      }

      if (line.includes('FAIL')) {
        failures.push(line.trim());
      }

      if (line.includes('exit code=')) {
        if (summaryMatched) {
          finalize({ passCount, totalCount, logPath: LOG_PATH });
        }
        return true;
      }

      return true;
    }

    socket.on('connect', () => {
      socket.write("\r\n");
    });

    socket.on('data', (chunk) => {
      refreshTimeout();

      const text = chunk.toString();
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const shouldWrite = handleLine(line);
        if (shouldWrite && startDetected && !finalized) {
          if (!logStream) {
            logStream = fs.createWriteStream(LOG_PATH, { flags: 'w' });
          }
          logStream.write(`${line}\n`);
        }
      }
    });

    socket.on('end', () => {
      if (!finalized) {
        finalize({ passCount, totalCount, logPath: LOG_PATH });
      }
    });

    socket.on('close', () => {
      if (!finalized) {
        finalize({ passCount, totalCount, logPath: LOG_PATH });
      }
    });

    socket.on('error', (error) => {
      finalize(error);
    });
  });
}

async function main() {
  console.log("Building Roku bundle…");
  await ensureGeneratedArtifacts();
  await buildRokuBundle();

  console.log(`Deploying to Roku device at ${host}…`);
  await deployToDevice();

  console.log("Capturing telnet output…");
  try {
    const result = await captureTelnetLog();
    console.log(`Roku tests passed (${result.passCount}/${result.totalCount}). Full log: ${result.logPath}`);
  } catch (error) {
    console.error(error.message);
    if (error.failures && error.failures.length > 0) {
      console.error("Failures:");
      for (const failure of error.failures) {
        console.error(`  ${failure}`);
      }
    }
    if (typeof error.passCount === "number" && typeof error.totalCount === "number") {
      console.error(`Summary: ${error.passCount} of ${error.totalCount} passed.`);
    }
    console.error(`Full log captured at ${LOG_PATH}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("roku:test script failed:", error);
  process.exitCode = 1;
});
