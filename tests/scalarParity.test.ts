/// <reference path="./brs-augmentations.d.ts" />

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import * as protobuf from "protobufjs";
import { generateBrightScriptArtifacts } from "../src/generator/generateBrightScript";
import { lexParseSync, types as BrsTypes } from "brs";
import { Interpreter } from "brs/lib/interpreter";
import { ReturnValue } from "brs/lib/parser/BlockEndReason";
import { extendBrsObjects } from "brs/lib/brsTypes/components/BrsObjects";
import { BrsComponent } from "brs/lib/brsTypes/components/BrsComponent";
import { Callable, StdlibArgument } from "brs/lib/brsTypes/Callable";
import { Int32 } from "brs/lib/brsTypes/Int32";

interface ScalarCase {
  protoType: keyof typeof SAMPLE_VALUES;
  single: {
    message: string;
    field: string;
  };
  repeated: {
    message: string;
    field: string;
  };
}

const SCALAR_CASES: ScalarCase[] = [
  {
    protoType: "double",
    single: { message: "DoubleMessage", field: "value" },
    repeated: { message: "RepeatedDoubleMessage", field: "values" }
  },
  {
    protoType: "float",
    single: { message: "FloatMessage", field: "value" },
    repeated: { message: "RepeatedFloatMessage", field: "values" }
  },
  {
    protoType: "fixed32",
    single: { message: "Fixed32Message", field: "value" },
    repeated: { message: "RepeatedFixed32Message", field: "values" }
  },
  {
    protoType: "sfixed32",
    single: { message: "Sfixed32Message", field: "value" },
    repeated: { message: "RepeatedSfixed32Message", field: "values" }
  },
  {
    protoType: "fixed64",
    single: { message: "Fixed64Message", field: "value" },
    repeated: { message: "RepeatedFixed64Message", field: "values" }
  },
  {
    protoType: "sfixed64",
    single: { message: "Sfixed64Message", field: "value" },
    repeated: { message: "RepeatedSfixed64Message", field: "values" }
  },
  {
    protoType: "uint32",
    single: { message: "Uint32Message", field: "value" },
    repeated: { message: "RepeatedUint32Message", field: "values" }
  },
  {
    protoType: "uint64",
    single: { message: "Uint64Message", field: "value" },
    repeated: { message: "RepeatedUint64Message", field: "values" }
  },
  {
    protoType: "sint32",
    single: { message: "Sint32Message", field: "value" },
    repeated: { message: "RepeatedSint32Message", field: "values" }
  },
  {
    protoType: "sint64",
    single: { message: "Sint64Message", field: "value" },
    repeated: { message: "RepeatedSint64Message", field: "values" }
  }
];

const SAMPLE_VALUES = {
  double: {
    single: [0, 1, -1, 3.141592653589793, -123456.7891234, 1234567.8901234],
    repeated: [
      [0, 1.5, -3.75],
      [12345.678, -12345.678]
    ]
  },
  float: {
    single: [0, 1, -1, 3.1415927, -123.456, 123456.789, 1.17549435e-38],
    repeated: [
      [0, 1.25, -2.5],
      [65504, -65504],
      [1.17549435e-38, -1.17549435e-38]
    ]
  },
  fixed32: {
    single: [0, 1, 255, 2147483647, 4294967295],
    repeated: [
      [0, 65535, 4294967295],
      [123456789, 4000000000]
    ]
  },
  sfixed32: {
    single: [0, 2147483647, -2147483648, -123456789],
    repeated: [
      [0, -1, 1],
      [2147483647, -2147483648]
    ]
  },
  fixed64: {
    single: ["0", "1", "255", "4294967296", "18446744073709551615"],
    repeated: [
      ["0", "4294967296", "1099511627776"],
      ["18446744073709551615", "1"]
    ]
  },
  sfixed64: {
    single: ["0", "9876543210", "-9876543210", "9223372036854775807", "-9223372036854775808"],
    repeated: [
      ["0", "2147483647", "-2147483648"],
      ["9223372036854775807", "-9223372036854775808"]
    ]
  },
  uint32: {
    single: [0, 12345, 2147483647, 4294967295],
    repeated: [
      [0, 1, 255, 4294967295],
      [4294967295]
    ]
  },
  uint64: {
    single: ["0", "63", "4294967295", "18446744073709551615"],
    repeated: [
      ["0", "4294967296", "9007199254740991"],
      ["18446744073709551615", "1"]
    ]
  },
  sint32: {
    single: [0, 321, -321, 2147483647, -2147483648],
    repeated: [
      [0, 7, -7],
      [2147483647, -2147483648]
    ]
  },
  sint64: {
    single: ["0", "123456789", "-123456789", "9223372036854775807", "-9223372036854775808"],
    repeated: [
      ["0", "2147483647", "-2147483648"],
      ["9223372036854775807", "-9223372036854775808"]
    ]
  }
} as const;

async function createProto(tempDir: string) {
  const protoDir = path.join(tempDir, "proto");
  await fs.mkdir(protoDir, { recursive: true });
  const protoPath = path.join(protoDir, "scalar_parity.proto");

  const lines: string[] = ['syntax = "proto3";', "package samples;", ""];
  SCALAR_CASES.forEach((entry, index) => {
    const tag = index + 1;
    lines.push(
      `message ${entry.single.message} { ${entry.protoType} ${entry.single.field} = ${tag}; }`,
      `message ${entry.repeated.message} { repeated ${entry.protoType} ${entry.repeated.field} = ${tag}; }`,
      ""
    );
  });
  await fs.writeFile(protoPath, lines.join("\n"), "utf8");
  return protoPath;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>) } as unknown as T;
  }
  return value;
}

let byteArrayRegistered = false;

function ensureRoByteArray() {
  if (byteArrayRegistered) {
    return;
  }

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
        const method = this.getMethod(index.toString());
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

function createMessageObject(fieldName: string, value: unknown) {
  return new BrsTypes.RoAssociativeArray([
    {
      name: new BrsTypes.BrsString(fieldName),
      value: jsToBrs(value)
    }
  ]);
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
  } catch (error) {
    if (error instanceof ReturnValue && error.value !== undefined) {
      return error.value;
    }
    throw error;
  }
}

function withinNumericTolerance(actual: number, expected: number, mode: "float" | "double"): boolean {
  if (Number.isNaN(actual) && Number.isNaN(expected)) {
    return true;
  }
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return actual === expected;
  }
  const absDiff = Math.abs(actual - expected);
  const relDiff = Math.abs(expected) > 0 ? absDiff / Math.abs(expected) : absDiff;
  const limits = mode === "float"
    ? { abs: 1e-4, rel: 1e-5 }
    : { abs: 1e-9, rel: 1e-12 };
  return absDiff <= limits.abs || relDiff <= limits.rel;
}

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brs-runtime-parity-"));
  const protoPath = await createProto(tempRoot);
  const generatedDir = path.join(tempRoot, "generated");

  await generateBrightScriptArtifacts({
    protoPaths: [protoPath],
    outputDir: generatedDir
  });

  ensureRoByteArray();

  const runtimePath = path.join(generatedDir, "runtime.brs");
  const messageNames = new Set<string>();
  SCALAR_CASES.forEach((entry) => {
    messageNames.add(entry.single.message);
    messageNames.add(entry.repeated.message);
  });
  const messageFiles = Array.from(messageNames).map((name) => path.join(generatedDir, "messages", `${name}.brs`));
  const brsFiles = [runtimePath, ...messageFiles];

  const statements = lexParseSync(brsFiles, { root: generatedDir });
  const interpreter = new Interpreter({
    root: generatedDir,
    stdout: new PassThrough() as unknown as NodeJS.WriteStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
    generateCoverage: false,
    componentDirs: [],
    isComponentLibrary: false
  });
  interpreter.exec(statements);

  const registerFn = interpreter.getCallableFunction("__pb_registerRuntime");
  assert.ok(registerFn, "runtime registration callable should exist");
  callBrsFunction(registerFn, interpreter, []);

  const root = await protobuf.load(protoPath);

  for (const scalar of SCALAR_CASES) {
    const samples = SAMPLE_VALUES[scalar.protoType];
    const singleType = root.lookupType(`samples.${scalar.single.message}`);
    const repeatedType = root.lookupType(`samples.${scalar.repeated.message}`);

    const singleEncode = interpreter.getCallableFunction(`${scalar.single.message}Encode`);
    const singleDecode = interpreter.getCallableFunction(`${scalar.single.message}Decode`);
    const repeatedEncode = interpreter.getCallableFunction(`${scalar.repeated.message}Encode`);
    const repeatedDecode = interpreter.getCallableFunction(`${scalar.repeated.message}Decode`);

    samples.single.forEach((sample) => {
      const payloadValue = cloneValue(sample);
      const payload = { [scalar.single.field]: payloadValue };
      const buffer = singleType.encode(payload).finish();
      const expectedBase64 = Buffer.from(buffer).toString("base64");

      const messageObject = createMessageObject(scalar.single.field, payloadValue);
      const encoded = callBrsFunction(singleEncode, interpreter, [messageObject]);
      const encodedString = encoded.toString();
      if (scalar.protoType === "float" || scalar.protoType === "double") {
        const mode: "float" | "double" = scalar.protoType;
        const brsBuffer = Buffer.from(encodedString, "base64");
        const decodedViaProto = singleType.toObject(singleType.decode(brsBuffer), { enums: String, longs: String });
        const actualValue = Number(decodedViaProto[scalar.single.field]);
        const expectedValue = Number(payloadValue);
        assert.ok(
          withinNumericTolerance(actualValue, expectedValue, mode),
          `${scalar.single.message} encode numeric mismatch for ${JSON.stringify(sample)} (expected ${expectedValue}, got ${actualValue})`
        );
      } else {
        assert.strictEqual(encodedString, expectedBase64, `${scalar.single.message} encode mismatch for ${JSON.stringify(sample)}`);
      }

      const decoded = callBrsFunction(singleDecode, interpreter, [new BrsTypes.BrsString(encodedString)]);
      const decodedJs = brsToJs(decoded);
      const expectedDecoded = singleType.toObject(singleType.decode(buffer), { longs: String, defaults: false });
      if (scalar.protoType === "float" || scalar.protoType === "double") {
        const mode: "float" | "double" = scalar.protoType;
        const actualValue = Number((decodedJs as Record<string, unknown>)[scalar.single.field]);
        const expectedValue = Number(expectedDecoded[scalar.single.field]);
        assert.ok(
          withinNumericTolerance(actualValue, expectedValue, mode),
          `${scalar.single.message} decode numeric mismatch for ${JSON.stringify(sample)} (expected ${expectedValue}, got ${actualValue})`
        );
      } else {
        assert.deepStrictEqual(decodedJs, expectedDecoded, `${scalar.single.message} decode mismatch for ${JSON.stringify(sample)}`);
      }
    });

    samples.repeated.forEach((sample) => {
      const cloned = cloneValue(sample);
      const payloadArray = Array.isArray(cloned)
        ? Array.from(cloned as ReadonlyArray<unknown>)
        : [cloned];
      const payload = { [scalar.repeated.field]: payloadArray };
      const buffer = repeatedType.encode(payload).finish();
      const expectedBase64 = Buffer.from(buffer).toString("base64");

      const messageObject = createMessageObject(scalar.repeated.field, payloadArray);
      const encoded = callBrsFunction(repeatedEncode, interpreter, [messageObject]);
      const encodedString = encoded.toString();
      if (scalar.protoType === "float" || scalar.protoType === "double") {
        const mode: "float" | "double" = scalar.protoType;
        const brsBuffer = Buffer.from(encodedString, "base64");
        const decodedViaProto = repeatedType.toObject(repeatedType.decode(brsBuffer), { enums: String, longs: String });
        const actualValues = Array.from(decodedViaProto[scalar.repeated.field] as unknown[], (item) => Number(item));
        const expectedValues = payloadArray.map((item) => Number(item));
        actualValues.forEach((actual, index) => {
          const expected = expectedValues[index];
          assert.ok(
            withinNumericTolerance(actual, expected, mode),
            `${scalar.repeated.message} encode numeric mismatch for ${JSON.stringify(sample)} at index ${index} (expected ${expected}, got ${actual})`
          );
        });
      } else {
        assert.strictEqual(encodedString, expectedBase64, `${scalar.repeated.message} encode mismatch for ${JSON.stringify(sample)}`);
      }

      const decoded = callBrsFunction(repeatedDecode, interpreter, [new BrsTypes.BrsString(encodedString)]);
      const decodedJs = brsToJs(decoded);
      const expectedDecoded = repeatedType.toObject(repeatedType.decode(buffer), { longs: String, defaults: false });
      if (scalar.protoType === "float" || scalar.protoType === "double") {
        const mode: "float" | "double" = scalar.protoType;
        const actualValues = Array.from((decodedJs as Record<string, unknown>)[scalar.repeated.field] as unknown[], (item) => Number(item));
        const expectedValues = Array.from(expectedDecoded[scalar.repeated.field] as unknown[], (item) => Number(item));
        actualValues.forEach((actual, index) => {
          const expected = expectedValues[index];
          assert.ok(
            withinNumericTolerance(actual, expected, mode),
            `${scalar.repeated.message} decode numeric mismatch for ${JSON.stringify(sample)} at index ${index} (expected ${expected}, got ${actual})`
          );
        });
      } else {
        assert.deepStrictEqual(decodedJs, expectedDecoded, `${scalar.repeated.message} decode mismatch for ${JSON.stringify(sample)}`);
      }
    });
  }

  console.log("scalar parity runtime tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
type BrightScriptValue = any;
