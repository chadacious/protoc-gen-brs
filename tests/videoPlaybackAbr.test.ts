/// <reference path="./brs-augmentations.d.ts" />

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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

function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-zA-Z0-9])/g, (_, next: string) => next.toUpperCase());
}

function toSnakeCaseKey(key: string): string {
  return key
    .replace(/([A-Z])/g, "_$1")
    .replace(/__+/g, "_")
    .toLowerCase();
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

function convertKeysToSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convertKeysToSnakeCase(item));
  }
  if (isTypedArray(value)) {
    if (value instanceof Buffer) {
      return Uint8Array.from(value);
    }
    return new Uint8Array(value as Uint8Array);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[toSnakeCaseKey(key)] = convertKeysToSnakeCase(inner);
    }
    return result;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tryConvertNumericMapToUint8Array(value: Record<string, unknown>): Uint8Array | null {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return new Uint8Array(0);
  }
  if (
    !entries.every(
      ([key, byte]) =>
        /^[0-9]+$/.test(key) &&
        typeof byte === "number" &&
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255
    )
  ) {
    return null;
  }
  const sorted = entries.sort((a, b) => Number(a[0]) - Number(b[0]));
  const buffer = new Uint8Array(sorted.length);
  for (const [index, [, byte]] of sorted.entries()) {
    buffer[index] = byte as number;
  }
  return buffer;
}

function hydrateSamplePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => hydrateSamplePayload(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const asBytes = tryConvertNumericMapToUint8Array(value);
  if (asBytes !== null) {
    return asBytes;
  }
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = hydrateSamplePayload(inner);
  }
  return result;
}

const ABR_SAMPLE_PATH = path.resolve(__dirname, "../examples/abr-sample.json");

const LONG_FIELD_TYPES = new Set(["int64", "uint64", "sint64", "fixed64", "sfixed64"]);
const NUMERIC_FIELD_TYPES = new Set([
  "int32",
  "uint32",
  "sint32",
  "fixed32",
  "sfixed32",
  "double",
  "float"
]);

function normalizeNumericString(value: string, fieldType: string): string {
  let text = value.trim();
  if (text.startsWith("+")) {
    text = text.slice(1);
  }
  const isNumericField = NUMERIC_FIELD_TYPES.has(fieldType) || LONG_FIELD_TYPES.has(fieldType);
  if (!isNumericField) {
    return text;
  }
  if (text.startsWith("-")) {
    const magnitude = text.slice(1).replace(/^0+(?!$)/, "");
    return magnitude.length === 0 ? "0" : "-" + magnitude;
  }
  const trimmed = text.replace(/^0+(?!$)/, "");
  return trimmed.length === 0 ? "0" : trimmed;
}

function getComparableDefault(field: protobuf.Field, sample: unknown): unknown {
  const base = field.defaultValue;
  if (sample === undefined || sample === null) {
    return base;
  }
  if (field.resolvedType && field.resolvedType instanceof protobuf.Enum) {
    if (typeof sample === "string") {
      if (typeof base === "number") {
        return field.resolvedType.valuesById[base] ?? "";
      }
      if (typeof base === "string") {
        return base;
      }
      return "";
    }
    if (typeof sample === "number") {
      if (typeof base === "number") {
        return base;
      }
      if (typeof base === "string") {
        const numeric = field.resolvedType.values[base];
        return numeric ?? Number(base);
      }
      return 0;
    }
    return base;
  }
  if (typeof sample === "boolean") {
    return typeof base === "boolean" ? base : false;
  }
  if (typeof sample === "number") {
    if (base && typeof (base as any).toNumber === "function") {
      return (base as any).toNumber();
    }
    if (typeof base === "number") {
      return base;
    }
    if (typeof base === "string") {
      return Number(base);
    }
    return 0;
  }
  if (typeof sample === "string") {
    if (field.type === "bytes") {
      if (typeof base === "string") {
        return base;
      }
      if (base instanceof Uint8Array) {
        return Buffer.from(base).toString("base64");
      }
      return "";
    }
    if (LONG_FIELD_TYPES.has(field.type)) {
      if (typeof base === "string") {
        return normalizeNumericString(base, field.type);
      }
      if (typeof base === "number") {
        return base.toString();
      }
      if (base && typeof (base as any).toString === "function") {
        return normalizeNumericString((base as any).toString(), field.type);
      }
      return "0";
    }
    if (NUMERIC_FIELD_TYPES.has(field.type)) {
      if (typeof base === "number") {
        return base.toString();
      }
      if (typeof base === "string") {
        return normalizeNumericString(base, field.type);
      }
      if (base && typeof (base as any).toString === "function") {
        return normalizeNumericString((base as any).toString(), field.type);
      }
      return "0";
    }
    if (typeof base === "string") {
      return base;
    }
    if (base === undefined || base === null) {
      return "";
    }
    return String(base);
  }
  if (sample instanceof Uint8Array) {
    if (base instanceof Uint8Array) {
      return base;
    }
    if (typeof base === "string") {
      return Buffer.from(base, "base64");
    }
    return new Uint8Array();
  }
  return base;
}

function isProtoDefault(field: protobuf.Field, value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  const comparableDefault = getComparableDefault(field, value);
  if (comparableDefault === undefined) {
    return false;
  }
  if (typeof value === "string" && typeof comparableDefault === "string") {
    const normalizedValue = normalizeNumericString(value, field.type);
    const normalizedDefault = normalizeNumericString(comparableDefault, field.type);
    return normalizedValue === normalizedDefault;
  }
  if (typeof value === "number" && typeof comparableDefault === "number") {
    return Object.is(value, comparableDefault);
  }
  if (typeof value === "boolean" && typeof comparableDefault === "boolean") {
    return value === comparableDefault;
  }
  if (value instanceof Uint8Array && comparableDefault instanceof Uint8Array) {
    if (value.length !== comparableDefault.length) {
      return false;
    }
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] !== comparableDefault[i]) {
        return false;
      }
    }
    return true;
  }
  return value === comparableDefault;
}

function stripProtoDefaults(messageType: protobuf.Type, rawValue: unknown): Record<string, unknown> {
  if (rawValue === null || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }
  const value = rawValue as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const field = messageType.fields[key];
    if (!field) {
      result[key] = fieldValue;
      continue;
    }
    if (field.repeated) {
      if (!Array.isArray(fieldValue) || fieldValue.length === 0) {
        continue;
      }
      if (field.resolvedType && field.resolvedType instanceof protobuf.Type) {
        const nestedType = field.resolvedType as protobuf.Type;
        result[key] = fieldValue.map((item) => stripProtoDefaults(nestedType, item));
      } else {
        result[key] = fieldValue;
      }
      continue;
    }
    if (field.map) {
      if (fieldValue === null || typeof fieldValue !== "object") {
        continue;
      }
      if (field.resolvedType && field.resolvedType instanceof protobuf.Type) {
        const nestedType = field.resolvedType as protobuf.Type;
        const mapResult: Record<string, unknown> = {};
        for (const [entryKey, entryVal] of Object.entries(fieldValue as Record<string, unknown>)) {
          mapResult[entryKey] = stripProtoDefaults(nestedType, entryVal);
        }
        result[key] = mapResult;
      } else {
        result[key] = fieldValue;
      }
      continue;
    }
    if (field.resolvedType && field.resolvedType instanceof protobuf.Type) {
      if (fieldValue === undefined || fieldValue === null) {
        continue;
      }
      const nested = stripProtoDefaults(field.resolvedType as protobuf.Type, fieldValue);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      continue;
    }
    if (isProtoDefault(field, fieldValue)) {
      continue;
    }
    result[key] = fieldValue;
  }
  return result;
}

const EXPECTED_LIVE_BASE64 =
  "CheAAbgIqAG4CLgBkK+oBJ0CAACAP8ACAhIMCIwBEJeNgKW7h5ADGisKDAiMARCXjYClu4eQAxj/////ByD/////Byj/////BzIJEP////8HGOgHKsAJCuoICucFCAAlAACAPy0zM3M/NT0Klz9YAWgBchoKFm1mczJfY21mc193ZWJfdjNfMl8wMDMYAHiPTqABAagBALgCANoCmwEQsOoBGIDd2wEgoJwBKKCcATCYdXCIJ4AB9AO4AQHgAQOYAgzAAgHQAgLoAgSAAwKIA4gnqAMDwAMByAMBgAQB0AQB2AQB4AQA+AQHgAV9wAUByAUB4AXQD+gFAfgF0A+ABgGQBgG4BgHQBgHwBgH4BgGAB9APwAcB0AcBgAgBiAgBnQjNzEw+oAjoB+AIAegI////////////AfoCtQEtAACgQjUAAKpCZQAAgEBowHCoAdCGA/0BAACAP4UCmpkZP40CAACAP5UC+u1rO7UCAACAP8AC3wPSAhGw//////////8BHjxGWlxdXugC6AL9As3MzD2QAwGdAwrXIz2gAwHVAwAAekSYBAHVBAAAIEHoBPAQoAYBtQa9N4Y1vQYzM4NAwAcByAcB5QcAgAlE8AcBgAgBoQgAAAAAAADwv6kIAAAAAAAA8L+wCN8DuAoB+BABggMAkAMBqAMBsAMD0AMB2AMBygQcChMIwKkHEJh1GOgHJQAAAAAoADAAEODUAxjQD9IEDwoICLAJELAJIAEgiCcoAdoEDQoGCPAuEPAuIPAuKAHwBQGYBgGoBoCAAtIGFAjoBxBkGg0IiCcVAAAAPx3NzEw/2AYBiAcBuAcBoAgB0ggGCAEQARgBqQkAAAAAAADwv7EJAAAAAAAA8L/QCQHaCSRFN2t1UnNsQUU0KzVkS3c3UVh3MFNJMXl1UnhxbUd5SmxJRTjqCwSLBowGgAwBqAyQAcAMAcgMAdAMAYANAYgNAdgNAeANAYAOAYgOAZgOAYgPAcgPAdAPAegQAYARAZARAbIRFENBTVNDaFVQdWJiSkRQd0VzUVk96BEB4BIB8BIB+BIBuBMBwBMB8BMBkRQAAAAAAADwv5kUAAAAAAAA8L+wFAHKFACIp6HKCwEYATIMCIkBELjYiP6+h5ADMgwI+AEQ+aP4icGHkAMyDAiPAxCkwZ+wvoeQAzIMCIgBEKvBubm+h5ADMgwI9wEQsZf2rMKHkAMyDAiOAxDDvtG0voeQAzIMCIcBEPu4o7m+h5ADMgwI9AEQycf/q8KHkAMyDAiNAxCZnIqwvoeQAzIMCIYBEImKkfe+h5ADMgwI8wEQraSDrMKHkAMyDAiMAxD5wduyvoeQAzIMCIUBEMrfrra+h5ADMgwI8gEQlsK9rMKHkAMyDAiLAxD72bK0voeQAzIMCKABELmgkLi+h5ADMgwIlgIQoNjprMKHkAMyDAiKAxCj1OCyvoeQAzIMCIwBEJeNgKW7h5ADMgwI+QEQwIix/LuHkAMyDAj6ARCTzav8u4eQAzIMCPsBENTJrPy7h5ADOgBIAFIqGgJlbigBMhhVQ3Q4VXRXakpBa1VUdmZOdDRhdWZrYmc4AEAAWABgAHgAoAEBsAEFugEDBAUxwgEIAQIDBAUIMF7QAQASTQA/FfG3MEYCIQD7A417/f3b1SiwINyvpwKCIGCfP67AX4uBNq2EyH7UeAIhAOC71fOkiaXyEWZoUox4SAIARbH1vpu8rGmvyZrwLmgNGgJlaYIBDAiMARCXjYClu4eQA4oBDAiPAxCkwZ+wvoeQA5oBZwongAEBigEQMi4yMDI1MDIyMi4xMC4wMJIBB1dpbmRvd3OaAQQxMC4wEjoiOIf/h/7vGWjzxJjzrNWq84/RzOOH0pXji8q87bC+ytO3xZXOtMSYzanSh866wJjGmM6uoszD2rS7MgA=";

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
  if (isTypedArray(value)) {
    const byteArray = new RoByteArray();
    const view = value instanceof Buffer ? new Uint8Array(value) : (value as Uint8Array);
    (byteArray as unknown as { bytes: number[] }).bytes = Array.from(view);
    return byteArray;
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

function isTypedArray(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || value instanceof Buffer;
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

  const rawSampleContents = await fs.readFile(ABR_SAMPLE_PATH, "utf8");
  const sampleCamel = hydrateSamplePayload(JSON.parse(rawSampleContents)) as SamplePayload;
  const sampleSnake = convertKeysToSnakeCase(sampleCamel) as Record<string, unknown>;

  const expectedBuffer = type.encode(type.fromObject(sampleSnake)).finish();
  const expectedBase64 = Buffer.from(expectedBuffer).toString("base64");

  const brsMessage = jsToBrs(sampleSnake);
  const encoded = callBrsFunction(encodeFn, interpreter, [brsMessage]) as BrsTypes.BrsString;
  const encodedBase64 = encoded.toString();
  assert.strictEqual(encodedBase64, expectedBase64, "BrightScript encode should match protobufjs output");

  const camelCaseMessage = jsToBrs(sampleCamel);
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

  const liveBuffer = type.encode(type.fromObject(sampleSnake)).finish();
  const liveBase64 = Buffer.from(liveBuffer).toString("base64");
  const expectedLiveDecoded = type.toObject(type.decode(liveBuffer), { longs: String, enums: String, bytes: String });
  const brsLiveMessage = jsToBrs(sampleCamel);
  const brsLiveEncoded = callBrsFunction(encodeFn, interpreter, [brsLiveMessage]) as BrsTypes.BrsString;
  const brsLiveBase64 = brsLiveEncoded.toString();

  const brsDecodedProto = type.toObject(type.decode(Buffer.from(brsLiveBase64, "base64")), {
    longs: String,
    enums: String,
    bytes: String
  });
  const normalizedExpectedLive = stripProtoDefaults(type, expectedLiveDecoded);
  const normalizedBrsEncoded = stripProtoDefaults(type, brsDecodedProto);
  assert.deepStrictEqual(
    normalizedBrsEncoded,
    normalizedExpectedLive,
    "BrightScript encode should match protobufjs payload structure"
  );

  const brsLiveDecoded = callBrsFunction(decodeFn, interpreter, [new BrsTypes.BrsString(EXPECTED_LIVE_BASE64)]);
  const brsLiveDecodedJs = brsToJs(brsLiveDecoded);
  const normalizedBrsLiveDecoded = stripProtoDefaults(type, brsLiveDecodedJs as Record<string, unknown>);
  assert.deepStrictEqual(
    normalizedBrsLiveDecoded,
    normalizedExpectedLive,
    "BrightScript decode should match protobufjs decoded object for live payload"
  );

  console.log("video playback abr parity test passed.");
}

run().catch((error: any) => {
  console.error(error);
  process.exitCode = 1;
});
