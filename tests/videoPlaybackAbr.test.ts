/// <reference path="./brs-augmentations.d.ts" />

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { generateBrightScriptArtifacts } from "../src/generator/generateBrightScript";
import protobuf from "protobufjs";
import { lexParseSync, types as BrsTypes } from "brs";
import { Interpreter } from "brs/lib/interpreter";
import { ReturnValue } from "brs/lib/parser/BlockEndReason";
import { extendBrsObjects } from "brs/lib/brsTypes/components/BrsObjects";
import { BrsComponent } from "brs/lib/brsTypes/components/BrsComponent";
import { Callable, StdlibArgument } from "brs/lib/brsTypes/Callable";
import { Int32 } from "brs/lib/brsTypes/Int32";

const GOOGLE_VIDEO_PROTO_ROOT = "/Users/chad/Projects/Temp/googlevideo/protos";
const VIDEO_STREAMING_DIR = path.join(GOOGLE_VIDEO_PROTO_ROOT, "video_streaming");
const MISC_DIR = path.join(GOOGLE_VIDEO_PROTO_ROOT, "misc");
const ENTRY_PROTO = path.join(VIDEO_STREAMING_DIR, "video_playback_abr_request.proto");
const MESSAGE_TYPE = "video_streaming.VideoPlaybackAbrRequest";
const REQUIRED_PROTOS = [
  path.join(MISC_DIR, "common.proto"),
  path.join(VIDEO_STREAMING_DIR, "time_range.proto"),
  path.join(VIDEO_STREAMING_DIR, "buffered_range.proto"),
  path.join(VIDEO_STREAMING_DIR, "video_playback_abr_request.proto"),
  path.join(VIDEO_STREAMING_DIR, "media_capabilities.proto"),
  path.join(VIDEO_STREAMING_DIR, "client_abr_state.proto"),
  path.join(VIDEO_STREAMING_DIR, "streamer_context.proto")
];

interface SamplePayload {
  [key: string]: unknown;
}

type BrightScriptValue = any;

const SAMPLE_OBJECT: SamplePayload = {
  client_abr_state: {
    playback_rate: 1,
    player_time_ms: "0",
    client_viewport_is_flexible: false,
    bandwidth_estimate: "4950000",
    drc_enabled: false,
    enabled_track_types_bitfield: 2,
    sticky_resolution: 1080,
    last_manual_selected_resolution: 1080
  },
  buffered_ranges: [
    {
      format_id: {
        itag: 140,
        last_modified: "1759475037898391"
      },
      start_time_ms: "0",
      duration_ms: "2147483647",
      start_segment_index: 2147483008,
      end_segment_index: 2147483008,
      time_range: {
        duration_ticks: "2147483647",
        start_ticks: "0",
        timescale: 1000
      }
    }
  ],
  selected_format_ids: [
    {
      itag: 140,
      last_modified: "1759475037898391"
    }
  ],
  preferred_audio_format_ids: [
    {
      itag: 140,
      last_modified: "1759475037898391"
    }
  ],
  preferred_video_format_ids: [
    {
      itag: 399,
      last_modified: "1759475866788004"
    }
  ],
  streamer_context: {
    client_info: {
      os_name: "Windows",
      os_version: "10.0",
      client_name: 1,
      client_version: "2.20250222.10.00"
    },
    sabr_contexts: [],
    unsent_sabr_contexts: []
  }
};

function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-zA-Z0-9])/g, (_, next: string) => next.toUpperCase());
}

function convertKeysToCamelCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convertKeysToCamelCase(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[toCamelCaseKey(key)] = convertKeysToCamelCase(inner);
    }
    return result;
  }
  return value;
}

const SAMPLE_OBJECT_CAMEL = convertKeysToCamelCase(SAMPLE_OBJECT) as SamplePayload;

let byteArrayRegistered = false;

class RoByteArray extends BrsComponent {
  public readonly kind = BrsTypes.ValueKind.Object;
  private bytes: number[] = [];
  private readonly pushCallable: Callable;
  private readonly countCallable: Callable;
  private readonly fromAsciiCallable: Callable;
  private readonly toAsciiCallable: Callable;
  private readonly fromBase64Callable: Callable;
  private readonly toBase64Callable: Callable;

  constructor() {
    super("roByteArray");

    this.pushCallable = new Callable("push", {
      signature: {
        args: [new StdlibArgument("value", BrsTypes.ValueKind.Dynamic)],
        returns: BrsTypes.ValueKind.Void
      },
      impl: (_interpreter, raw) => {
        const byte = this.toByte(raw);
        this.bytes.push(byte);
        return BrsTypes.BrsInvalid.Instance;
      }
    });

    this.countCallable = new Callable("count", {
      signature: {
        args: [],
        returns: BrsTypes.ValueKind.Int32
      },
      impl: () => new Int32(this.bytes.length)
    });

    this.fromAsciiCallable = new Callable("fromasciistring", {
      signature: {
        args: [new StdlibArgument("text", BrsTypes.ValueKind.String)],
        returns: BrsTypes.ValueKind.Void
      },
      impl: (_interpreter, text) => {
        const str = text.toString();
        this.bytes = [];
        for (let i = 0; i < str.length; i++) {
          this.bytes.push(str.charCodeAt(i) & 0xff);
        }
        return BrsTypes.BrsInvalid.Instance;
      }
    });

    this.toAsciiCallable = new Callable("toasciistring", {
      signature: {
        args: [],
        returns: BrsTypes.ValueKind.String
      },
      impl: () => new BrsTypes.BrsString(String.fromCharCode(...this.bytes))
    });

    this.fromBase64Callable = new Callable("frombase64string", {
      signature: {
        args: [new StdlibArgument("text", BrsTypes.ValueKind.String)],
        returns: BrsTypes.ValueKind.Void
      },
      impl: (_interpreter, text) => {
        const buffer = Buffer.from(text.toString(), "base64");
        this.bytes = Array.from(buffer.values());
        return BrsTypes.BrsInvalid.Instance;
      }
    });

    this.toBase64Callable = new Callable("tobase64string", {
      signature: {
        args: [],
        returns: BrsTypes.ValueKind.String
      },
      impl: () => new BrsTypes.BrsString(Buffer.from(this.bytes).toString("base64"))
    });

    this.appendMethods([
      this.pushCallable,
      this.countCallable,
      this.fromAsciiCallable,
      this.toAsciiCallable,
      this.fromBase64Callable,
      this.toBase64Callable
    ]);

    (this as any).push = this.pushCallable;
    (this as any).count = this.countCallable;
    (this as any).Push = this.pushCallable;
    (this as any).Count = this.countCallable;
    (this as any).fromasciistring = this.fromAsciiCallable;
    (this as any).toasciistring = this.toAsciiCallable;
    (this as any).frombase64string = this.fromBase64Callable;
    (this as any).tobase64string = this.toBase64Callable;
    (this as any).FromAsciiString = this.fromAsciiCallable;
    (this as any).ToAsciiString = this.toAsciiCallable;
    (this as any).FromBase64String = this.fromBase64Callable;
    (this as any).ToBase64String = this.toBase64Callable;
  }

  equalTo(other: BrightScriptValue) {
    return BrsTypes.BrsBoolean.from(other === this);
  }

  toString() {
    return "<Component: roByteArray>";
  }

  get(index: BrightScriptValue): BrightScriptValue {
    const idx = this.toIndex(index);
    if (typeof idx === "number" && !Number.isNaN(idx)) {
      if (idx < 0 || idx >= this.bytes.length) {
        return BrsTypes.BrsInvalid.Instance;
      }
      return new Int32(this.bytes[idx]);
    }
    if (BrsTypes.isBrsString(index)) {
      const method = (this as any)[index.toString()];
      return method ?? BrsTypes.BrsInvalid.Instance;
    }
    return BrsTypes.BrsInvalid.Instance;
  }

  getElements() {
    return this.bytes.map((byte) => new Int32(byte));
  }

  set(index: BrightScriptValue, value: BrightScriptValue): BrightScriptValue {
    const idx = this.toIndex(index);
    if (Number.isNaN(idx) || idx < 0) {
      return BrsTypes.BrsInvalid.Instance;
    }
    this.ensureLength(idx + 1);
    this.bytes[idx] = this.toByte(value);
    return BrsTypes.BrsInvalid.Instance;
  }

  private ensureLength(length: number) {
    if (this.bytes.length >= length) {
      return;
    }
    this.bytes.length = length;
  }

  private toIndex(value: BrightScriptValue): number {
    if (BrsTypes.isBrsString(value)) {
      return Number.NaN;
    }
    if (BrsTypes.isBrsNumber(value)) {
      return value.getValue() | 0;
    }
    return Number(value.toString()) | 0;
  }

  private toByte(value: BrightScriptValue): number {
    if (BrsTypes.isBrsNumber(value)) {
      return Math.max(0, Math.min(255, value.getValue() & 0xff));
    }
    if (BrsTypes.isBrsBoolean(value)) {
      return value.toBoolean() ? 1 : 0;
    }
    if (BrsTypes.isBrsString(value)) {
      const str = value.toString();
      return str.length > 0 ? str.charCodeAt(0) & 0xff : 0;
    }
    return 0;
  }
}

function ensureRoByteArray() {
  if (byteArrayRegistered) {
    return;
  }

  extendBrsObjects([
    ["robytearray", () => new RoByteArray()]
  ]);
  byteArrayRegistered = true;
}

function jsToBrs(value: unknown): BrightScriptValue {
  if (value === null || value === undefined) {
    return BrsTypes.BrsInvalid.Instance;
  }
  if (typeof value === "string") {
    return new BrsTypes.BrsString(value);
  }
  if (typeof value === "boolean") {
    return BrsTypes.BrsBoolean.from(value);
  }
  if (typeof value === "number") {
    return new BrsTypes.Double(value);
  }
  if (Array.isArray(value)) {
    return new BrsTypes.RoArray(value.map((item) => jsToBrs(item)));
  }
  if (typeof value === "object") {
    const members = Object.entries(value as Record<string, unknown>).map(([key, val]) => ({
      name: new BrsTypes.BrsString(key),
      value: jsToBrs(val)
    }));
    return new BrsTypes.RoAssociativeArray(members);
  }
  return new BrsTypes.BrsString(String(value));
}

function brsToJs(value: BrightScriptValue): unknown {
  if (value === BrsTypes.BrsInvalid.Instance) {
    return null;
  }
  if (BrsTypes.isBrsNumber(value)) {
    return value.getValue();
  }
  if (BrsTypes.isBrsBoolean(value)) {
    return value.toBoolean();
  }
  if (BrsTypes.isBrsString(value)) {
    return value.toString();
  }
  if (value instanceof BrsTypes.RoArray) {
    return value.getElements().map((element) => brsToJs(element));
  }
  if (value instanceof BrsTypes.RoAssociativeArray) {
    const result: Record<string, unknown> = {};
    value.getValue().forEach((innerValue, key) => {
      result[key] = brsToJs(innerValue);
    });
    return result;
  }
  return value.toString();
}

function callBrsFunction(callable: BrsTypes.Callable | undefined, interpreter: Interpreter, args: BrightScriptValue[]) {
  assert.ok(callable, "BrightScript callable should be defined");
  try {
    return callable!.call(interpreter, ...args);
  } catch (error: any) {
    if (error instanceof ReturnValue && error.value !== undefined) {
      return error.value;
    }
    throw error;
  }
}

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brs-video-abr-"));
  const outputDir = path.join(tempRoot, "generated");

  await generateBrightScriptArtifacts({
    protoPaths: [ENTRY_PROTO],
    outputDir
  });

  ensureRoByteArray();

  const runtimePath = path.join(outputDir, "runtime.brs");
  const messagesDir = path.join(outputDir, "messages");
  const messageEntries = await fs.readdir(messagesDir);
  const messageFiles = messageEntries
    .filter((name) => name.endsWith(".brs"))
    .map((name) => path.join(messagesDir, name));

  const brsFiles = [runtimePath, ...messageFiles];
  const statements = lexParseSync(brsFiles, { root: outputDir });
  const interpreter = new Interpreter({
    root: outputDir,
    stdout: new PassThrough() as unknown as NodeJS.WriteStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
    generateCoverage: false,
    componentDirs: [],
    isComponentLibrary: false
  });
  interpreter.exec(statements);

  const registerFn = interpreter.getCallableFunction("__pb_registerRuntime");
  callBrsFunction(registerFn, interpreter, []);

  const encodeFn = interpreter.getCallableFunction("VideoPlaybackAbrRequestEncode");
  const decodeFn = interpreter.getCallableFunction("VideoPlaybackAbrRequestDecode");

  const root = new protobuf.Root();
  for (const protoPath of REQUIRED_PROTOS) {
    const raw = await fs.readFile(protoPath, "utf8");
    const sanitized = raw
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("import ");
      })
      .join("\n");
    protobuf.parse(sanitized, root, { keepCase: true });
  }
  root.resolveAll();
  const type = root.lookupType(MESSAGE_TYPE);

  const expectedBuffer = type.encode(SAMPLE_OBJECT).finish();
  const expectedBase64 = Buffer.from(expectedBuffer).toString("base64");

  const brsMessage = jsToBrs(SAMPLE_OBJECT);
  const encoded = callBrsFunction(encodeFn, interpreter, [brsMessage]) as BrsTypes.BrsString;
  const encodedBase64 = encoded.toString();
  assert.strictEqual(encodedBase64, expectedBase64, "BrightScript encode should match protobufjs output");

  const camelCaseMessage = jsToBrs(SAMPLE_OBJECT_CAMEL);
  const camelEncoded = callBrsFunction(encodeFn, interpreter, [camelCaseMessage]) as BrsTypes.BrsString;
  const camelEncodedBase64 = camelEncoded.toString();
  assert.strictEqual(
    camelEncodedBase64,
    expectedBase64,
    "BrightScript encode should match protobufjs output when using camelCase keys"
  );

  const decoded = callBrsFunction(decodeFn, interpreter, [new BrsTypes.BrsString(expectedBase64)]);
  const decodedJs = brsToJs(decoded);
  const expectedDecoded = type.toObject(type.decode(expectedBuffer), { longs: String, enums: String, bytes: String });
  assert.deepStrictEqual(decodedJs, expectedDecoded, "BrightScript decode should match protobufjs object representation");

  console.log("video playback abr parity test passed.");
}

run().catch((error: any) => {
  console.error(error);
  process.exitCode = 1;
});
