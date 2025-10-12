import path from "node:path";
import { Buffer } from "node:buffer";
import fs from "fs-extra";
import { Writer, Root } from "protobufjs";
import { loadProtoBundle } from "./protoLoader";
import {
  collectSimpleScalarMessages,
  collectSimpleMessageFieldMessages,
  SimpleScalarMessageDescriptor,
  SimpleMessageFieldDescriptor,
  SupportedScalarType,
  PACKABLE_SCALAR_TYPES
} from "./schemaUtils";

const WIRE_TYPE_BY_SCALAR: Record<SupportedScalarType, number> = {
  string: 2,
  int32: 0,
  uint32: 0,
  sint32: 0,
  int64: 0,
  uint64: 0,
  sint64: 0,
  bool: 0,
  bytes: 2,
  float: 5,
  double: 1,
  fixed32: 5,
  sfixed32: 5,
  fixed64: 1,
  sfixed64: 1,
  enum: 0
};

type SamplePrimitive = string | number | boolean | Record<string, unknown>;
type SampleValue = SamplePrimitive | SamplePrimitive[];

const CUSTOM_BASELINE_DIR = path.resolve("fixtures/parity");

export interface GenerateBaselineOptions {
  protoPaths: string[];
  fixtureDir: string;
}

export async function generateBaselineVectors(options: GenerateBaselineOptions) {
  const outputDir = path.resolve(options.fixtureDir);
  await fs.ensureDir(outputDir);

  const bundle = await loadProtoBundle(options.protoPaths);
  const simpleMessages = collectSimpleScalarMessages(bundle.root);
  const messageFieldMessages = collectSimpleMessageFieldMessages(bundle.root);
  const scalarDescriptorMap = new Map(simpleMessages.map((descriptor) => [descriptor.type.name, descriptor]));

  const cases = [] as BaselineCase[];

  for (const descriptor of simpleMessages) {
    for (const sample of buildSamples(descriptor)) {
      const payloadValue = normalizePayloadValue(descriptor, sample.value);
      const payload = {
        [descriptor.field.name]: payloadValue
      };

      const encodedBuffer = descriptor.type.encode(payload).finish();
      const encodedBase64 = Buffer.from(encodedBuffer).toString("base64");
      const decodedMessage = descriptor.type.decode(encodedBuffer);
      const decoded = descriptor.type.toObject(decodedMessage, { defaults: true, longs: String, bytes: String, enums: String });
      const alternateEncodings = buildAlternateEncodings(descriptor, sample.value);

      const baselineCase: BaselineCase = {
        type: descriptor.type.name,
        protoType: descriptor.type.fullName.replace(/^\./, ""),
        field: descriptor.field.name,
        fieldId: descriptor.field.id,
        value: sample.value,
        valueType: descriptor.scalarType,
        sampleLabel: sample.label,
        encodedBase64,
        decoded
      };

      if (alternateEncodings.length > 0) {
        baselineCase.alternateEncodings = alternateEncodings;
      }

      cases.push(baselineCase);
    }
  }

  for (const descriptor of messageFieldMessages) {
    const samples = buildMessageFieldSamples(descriptor, scalarDescriptorMap);
    for (const sample of samples) {
      const payload = {
        [descriptor.field.name]: sample.value
      };

      const encodedBuffer = descriptor.type.encode(payload).finish();
      const encodedBase64 = Buffer.from(encodedBuffer).toString("base64");
      const decodedMessage = descriptor.type.decode(encodedBuffer);
      const decoded = descriptor.type.toObject(decodedMessage, { defaults: true, longs: String, bytes: String, enums: String });

      cases.push({
        type: descriptor.type.name,
        protoType: descriptor.type.fullName.replace(/^\./, ""),
        field: descriptor.field.name,
        fieldId: descriptor.field.id,
        value: sample.value,
        valueType: descriptor.childType.name,
        sampleLabel: sample.label,
        encodedBase64,
        decoded
      });
    }
  }
  const customCases = await loadCustomBaselineCases(bundle.root);

  const metadataPath = path.join(outputDir, "baseline.json");
  const metadata: BaselineDocument = {
    generatedAt: new Date().toISOString(),
    files: bundle.files,
    cases,
    customCases
  };

  await fs.writeJson(metadataPath, metadata, { spaces: 2 });

  const embeddedDir = path.resolve("roku-app/source/generated");
  await fs.ensureDir(embeddedDir);
  const baselineBrightScriptPath = path.join(embeddedDir, "__baselineData.brs");
  await fs.writeFile(baselineBrightScriptPath, renderBaselineBrightScript(metadata), "utf8");
}

interface BaselineCase {
  type: string;
  protoType: string;
  field: string;
  fieldId: number;
  value: SampleValue;
  valueType: string;
  sampleLabel: string;
  encodedBase64: string;
  decoded: Record<string, unknown>;
  alternateEncodings?: string[];
}

interface BaselineDocument {
  generatedAt: string;
  files: string[];
  cases: BaselineCase[];
  customCases?: CustomBaselineCase[];
}

interface CustomBaselineCase {
  protoType: string;
  sampleLabel: string;
  value: Record<string, unknown>;
  encodedBase64: string;
  decoded: Record<string, unknown>;
}

interface CustomBaselineFile {
  protoType: string;
  sampleLabel?: string;
  value: Record<string, unknown>;
}

async function loadCustomBaselineCases(root: Root): Promise<CustomBaselineCase[]> {
  const cases: CustomBaselineCase[] = [];
  if (!(await fs.pathExists(CUSTOM_BASELINE_DIR))) {
    return cases;
  }
  const entries = await fs.readdir(CUSTOM_BASELINE_DIR);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(CUSTOM_BASELINE_DIR, entry);
    const raw = await fs.readFile(filePath, "utf8");
    let parsed: CustomBaselineFile;
    try {
      parsed = JSON.parse(raw) as CustomBaselineFile;
    } catch (error) {
      throw new Error(`Failed to parse custom baseline "${filePath}": ${(error as Error).message}`);
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid custom baseline structure in "${filePath}"`);
    }
    if (typeof parsed.protoType !== "string" || parsed.protoType.length === 0) {
      throw new Error(`Custom baseline "${filePath}" is missing a valid "protoType" string`);
    }
    if (parsed.value === null || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      throw new Error(`Custom baseline "${filePath}" must provide an object "value"`);
    }

    const sampleLabel =
      typeof parsed.sampleLabel === "string" && parsed.sampleLabel.length > 0
        ? parsed.sampleLabel
        : path.basename(entry, ".json");

    let type;
    try {
      type = root.lookupType(parsed.protoType);
    } catch (error) {
      console.warn(`Skipping custom baseline "${filePath}": ${(error as Error).message}`);
      continue;
    }
    const message = type.fromObject(parsed.value);
    const encodedBuffer = type.encode(message).finish();
    const encodedBase64 = Buffer.from(encodedBuffer).toString("base64");
    const decodedMessage = type.decode(encodedBuffer);
    const decoded = type.toObject(decodedMessage, { longs: String, enums: String, bytes: String });

    cases.push({
      protoType: parsed.protoType,
      sampleLabel,
      value: parsed.value,
      encodedBase64,
      decoded
    });
  }
  return cases;
}

function renderBaselineBrightScript(document: BaselineDocument): string {
  const lines: string[] = [
    "' Auto-generated baseline vector data (do not edit manually)",
    "function GetBaselineData() as Object",
    "    data = {}",
    `    data.generatedAt = "${escapeBrsString(document.generatedAt)}"`,
    "    data.files = []"
  ];

  for (const file of document.files) {
    lines.push(`    data.files.Push("${escapeBrsString(file)}")`);
  }

  lines.push("    data.cases = []");

  document.cases.forEach((testCase, index) => {
    const caseIdentifier = `case${index}`;
    lines.push(`    ${caseIdentifier} = {}`);
    lines.push(`    ${caseIdentifier}.type = "${escapeBrsString(testCase.type)}"`);
    lines.push(`    ${caseIdentifier}.protoType = "${escapeBrsString(testCase.protoType)}"`);
    lines.push(`    ${caseIdentifier}.field = "${escapeBrsString(testCase.field)}"`);
    lines.push(`    ${caseIdentifier}.fieldId = ${testCase.fieldId}`);
    lines.push(`    ${caseIdentifier}.sampleLabel = "${escapeBrsString(testCase.sampleLabel)}"`);
    lines.push(`    ${caseIdentifier}.valueType = "${escapeBrsString(testCase.valueType)}"`);
    lines.push(`    ${caseIdentifier}.value = ${formatBrsValue(testCase.value)}`);
    lines.push(`    ${caseIdentifier}.encodedBase64 = "${testCase.encodedBase64}"`);
    lines.push(`    ${caseIdentifier}.decoded = {}`);

    Object.entries(testCase.decoded).forEach(([key, rawValue]) => {
      lines.push(`    ${caseIdentifier}.decoded.${key} = ${formatBrsValue(rawValue)}`);
    });

    if (Array.isArray(testCase.alternateEncodings) && testCase.alternateEncodings.length > 0) {
      lines.push(`    ${caseIdentifier}.alternateEncodings = ${formatBrsValue(testCase.alternateEncodings)}`);
    }

    lines.push(`    data.cases.Push(${caseIdentifier})`);
  });

  lines.push("    data.customCases = []");
  (document.customCases ?? []).forEach((customCase, index) => {
    const identifier = `custom${index}`;
    lines.push(`    ${identifier} = {}`);
    lines.push(`    ${identifier}.protoType = "${escapeBrsString(customCase.protoType)}"`);
    lines.push(`    ${identifier}.sampleLabel = "${escapeBrsString(customCase.sampleLabel)}"`);
    lines.push(`    ${identifier}.value = ${formatBrsValue(customCase.value)}`);
    lines.push(`    ${identifier}.encodedBase64 = "${customCase.encodedBase64}"`);
    lines.push(`    ${identifier}.decoded = ${formatBrsValue(customCase.decoded)}`);
    lines.push(`    data.customCases.Push(${identifier})`);
  });

  lines.push("    return data", "end function", "");

  return lines.join("\n");
}


function buildSamples(descriptor: SimpleScalarMessageDescriptor): Array<{ value: SampleValue; label: string }> {
  if (descriptor.isRepeated) {
    return buildRepeatedSamples(descriptor);
  }

  switch (descriptor.scalarType) {
    case "string":
      return [{ value: `Hello from ${descriptor.type.name}`, label: "default" }];
    case "int32":
      return [
        { value: 0, label: "zero" },
        { value: descriptor.field.id * 100 + 7, label: "mid" },
        { value: 2147483647, label: "max" }
      ];
    case "sint32":
      return [
        { value: 0, label: "zero" },
        { value: descriptor.field.id * 50, label: "mid-pos" },
        { value: -descriptor.field.id * 50, label: "mid-neg" },
        { value: 2147483647, label: "max" },
        { value: -2147483648, label: "min" }
      ];
    case "int64":
      return buildInt64Samples(descriptor);
    case "uint32":
      return [
        { value: 0, label: "zero" },
        { value: descriptor.field.id * 1000 + 42, label: "mid" },
        { value: 2147483648, label: "int32-max-plus-one" },
        { value: 4294967295, label: "uint32-max" }
      ];
    case "uint64":
      return buildUint64Samples(descriptor);
    case "sint64":
      return buildSint64Samples(descriptor);
    case "bool":
      return [
        { value: false, label: "false" },
        { value: true, label: "true" }
      ];
    case "float":
      return [
        { value: 0, label: "zero" },
        { value: 1, label: "one" },
        { value: -1, label: "neg-one" },
        { value: 3.1415927, label: "pi" },
        { value: -123.456, label: "neg-mid" },
        { value: 123456.789, label: "large" },
        { value: 1.17549435e-38, label: "min-normal" }
      ];
    case "double":
      return [
        { value: 0, label: "zero" },
        { value: 1, label: "one" },
        { value: -1, label: "neg-one" },
        { value: 3.141592653589793, label: "pi" },
        { value: -987654321.1234567, label: "neg-mid" },
        { value: 9007199254740992, label: "precise-boundary" },
        { value: 2.2250738585072014e-308, label: "min-normal" }
      ];
    case "fixed32":
      return [
        { value: 0, label: "zero" },
        { value: descriptor.field.id * 5000 + 123, label: "mid" },
        { value: 2147483647, label: "int32-max" },
        { value: 4294967295, label: "uint32-max" }
      ];
    case "sfixed32":
      return [
        { value: 0, label: "zero" },
        { value: descriptor.field.id * 4000 + 99, label: "mid-pos" },
        { value: -descriptor.field.id * 4000 - 99, label: "mid-neg" },
        { value: 2147483647, label: "max" },
        { value: -2147483648, label: "min" }
      ];
    case "fixed64":
      return [
        { value: "0", label: "zero" },
        { value: "123456789", label: "mid" },
        { value: "4294967296", label: "uint32-plus-one" },
        { value: "18446744073709551615", label: "uint64-max" }
      ];
    case "sfixed64":
      return [
        { value: "0", label: "zero" },
        { value: "9876543210", label: "mid-pos" },
        { value: "-9876543210", label: "mid-neg" },
        { value: "9223372036854775807", label: "max" },
        { value: "-9223372036854775808", label: "min" }
      ];
    case "enum":
      return buildEnumSamples(descriptor);
    case "bytes":
    default:
      return [
        { value: "", label: "empty" },
        { value: Buffer.from([descriptor.field.id, descriptor.field.id + 1, descriptor.field.id + 2]).toString("base64"), label: "pattern" }
      ];
  }
}

function buildRepeatedSamples(descriptor: SimpleScalarMessageDescriptor): Array<{ value: SampleValue; label: string }> {
  const repeatedLabel = descriptor.isPacked === false ? "unpacked" : "packed";
  switch (descriptor.scalarType) {
    case "int32":
      return [{ value: [0, descriptor.field.id * 3, -descriptor.field.id * 3], label: repeatedLabel }];
    case "uint32":
      return [{ value: [0, descriptor.field.id * 10 + 5, 4294967295], label: repeatedLabel }];
    case "sint32":
      return [{ value: [0, descriptor.field.id * 4, -descriptor.field.id * 4], label: repeatedLabel }];
    case "int64":
      return [{ value: ["0", String(descriptor.field.id * 100000 + 7), "-123456789"], label: repeatedLabel }];
    case "uint64":
      return [{ value: ["0", "4294967296", "9007199254740991"], label: repeatedLabel }];
    case "sint64":
      return [{ value: ["0", "2147483647", "-2147483648"], label: repeatedLabel }];
    case "bool":
      return [{ value: [false, true, true], label: repeatedLabel }];
    case "float":
      return [{ value: [0, 1.25, -2.5], label: repeatedLabel }];
    case "double":
      return [{ value: [0, 1.5, -3.75], label: repeatedLabel }];
    case "fixed32":
      return [{ value: [0, descriptor.field.id * 200 + 7, 4294967295], label: repeatedLabel }];
    case "sfixed32":
      return [{ value: [0, descriptor.field.id * 150 + 11, -descriptor.field.id * 150 - 11], label: repeatedLabel }];
    case "fixed64":
      return [{ value: ["0", "4294967296", "1099511627776"], label: repeatedLabel }];
    case "sfixed64":
      return [{ value: ["0", "2147483647", "-2147483648"], label: repeatedLabel }];
    case "enum":
      return [{ value: buildEnumSampleValues(descriptor, 3), label: repeatedLabel }];
    case "string":
      return [{ value: [`Sample-${descriptor.type.name}-a`, `Sample-${descriptor.type.name}-b`], label: "multi" }];
    case "bytes":
      return [{ value: ["", Buffer.from([descriptor.field.id, descriptor.field.id + 1]).toString("base64")], label: "multi" }];
    default:
      return [{ value: [], label: "empty" }];
  }
}

function buildMessageFieldSamples(
  descriptor: SimpleMessageFieldDescriptor,
  scalarDescriptorMap: Map<string, SimpleScalarMessageDescriptor>
): Array<{ value: SampleValue; label: string }> {
  const childType = descriptor.childType;
  const childDescriptor = scalarDescriptorMap.get(childType.name);
  if (!childDescriptor) {
    return [];
  }
  const childSamples = buildSamples(childDescriptor);
  if (childSamples.length === 0) {
    return [];
  }

  const childFieldName = childDescriptor.field.name;

  const createChildObject = (sampleValue: SampleValue) => {
    return { [childFieldName]: sampleValue } as Record<string, unknown>;
  };

  if (descriptor.isRepeated) {
    const values: Record<string, unknown>[] = [];
    for (let i = 0; i < Math.min(childSamples.length, 2); i++) {
      values.push(createChildObject(childSamples[i].value));
    }
    if (values.length === 0) {
      values.push(createChildObject(childSamples[0].value));
    }
    return [{ value: values, label: "multi" }];
  }

  return [{ value: createChildObject(childSamples[0].value), label: "single" }];
}

function buildInt64Samples(descriptor: SimpleScalarMessageDescriptor): Array<{ value: string; label: string }> {
  const dynamicMid = String(descriptor.field.id * 1000000000 + 12345);
  const entries: Array<{ value: string; label: string }> = [
    { value: "0", label: "zero" },
    { value: "1", label: "one" },
    { value: "63", label: "one-byte-max-minus" },
    { value: "64", label: "two-byte-min" },
    { value: "127", label: "one-byte-max" },
    { value: "128", label: "two-byte-boundary" },
    { value: "255", label: "two-byte-mid" },
    { value: "256", label: "two-byte-plus-one" },
    { value: "16383", label: "two-byte-max" },
    { value: "16384", label: "three-byte-boundary" },
    { value: "2097151", label: "three-byte-max" },
    { value: "2097152", label: "four-byte-boundary" },
    { value: dynamicMid, label: "mid" },
    { value: "2147483647", label: "int32-max" },
    { value: "4294967295", label: "uint32-max" },
    { value: "9007199254740991", label: "safe-max" },
    { value: "9223372036854775807", label: "int64-max" },
    { value: "-1", label: "neg-one" },
    { value: "-63", label: "neg-one-byte-max" },
    { value: "-64", label: "neg-two-byte-min" },
    { value: "-128", label: "neg-two-byte-boundary" },
    { value: "-129", label: "neg-nine-bit" },
    { value: "-2147483648", label: "int32-min" },
    { value: "-9007199254740991", label: "neg-safe-max" },
    { value: "-9223372036854775808", label: "int64-min" }
  ];

  const seen = new Set<string>();
  const samples: Array<{ value: string; label: string }> = [];
  for (const entry of entries) {
    if (seen.has(entry.value)) {
      continue;
    }
    seen.add(entry.value);
    samples.push(entry);
  }
  return samples;
}

function buildUint64Samples(descriptor: SimpleScalarMessageDescriptor): Array<{ value: string; label: string }> {
  const dynamicMid = String(descriptor.field.id * 500000000 + 2468);
  const entries = [
    { value: "0", label: "zero" },
    { value: "1", label: "one" },
    { value: "63", label: "one-byte-max-minus" },
    { value: "64", label: "two-byte-min" },
    { value: "127", label: "one-byte-max" },
    { value: "128", label: "two-byte-boundary" },
    { value: "255", label: "two-byte-mid" },
    { value: "256", label: "two-byte-plus-one" },
    { value: "16383", label: "two-byte-max" },
    { value: "16384", label: "three-byte-boundary" },
    { value: "2097151", label: "three-byte-max" },
    { value: "2097152", label: "four-byte-boundary" },
    { value: dynamicMid, label: "mid" },
    { value: "2147483647", label: "int32-max" },
    { value: "2147483648", label: "int32-max-plus-one" },
    { value: "4294967295", label: "uint32-max" },
    { value: "8589934592", label: "uint32-double" },
    { value: "9007199254740991", label: "safe-max" },
    { value: "18446744073709551615", label: "uint64-max" }
  ];
  const seen = new Set<string>();
  const samples: Array<{ value: string; label: string }> = [];
  for (const entry of entries) {
    if (seen.has(entry.value)) {
      continue;
    }
    seen.add(entry.value);
    samples.push(entry);
  }
  return samples;
}

function buildEnumSamples(descriptor: SimpleScalarMessageDescriptor): Array<{ value: SampleValue; label: string }> {
  const enumInfo = descriptor.enumInfo;
  if (!enumInfo) {
    return [{ value: 0, label: "default" }];
  }
  const names = Object.keys(enumInfo.values);
  if (names.length === 0) {
    return [{ value: 0, label: "default" }];
  }
  const first = names[0];
  const second = names.length > 1 ? names[1] : names[0];
  return [
    { value: first, label: "first" },
    { value: second, label: "second" }
  ];
}

function buildEnumSampleValues(descriptor: SimpleScalarMessageDescriptor, count: number): SampleValue {
  const enumInfo = descriptor.enumInfo;
  if (!enumInfo) {
    return [0];
  }
  const names = Object.keys(enumInfo.values);
  if (names.length === 0) {
    return [0];
  }
  const values: string[] = [];
  for (let i = 0; i < count; i++) {
    values.push(names[i % names.length]);
  }
  return values;
}

function normalizePayloadValue(descriptor: SimpleScalarMessageDescriptor, sampleValue: SampleValue): unknown {
  if (descriptor.isRepeated) {
    const arrayValues = Array.isArray(sampleValue) ? sampleValue : [sampleValue];
    switch (descriptor.scalarType) {
      case "bytes":
        return arrayValues.map((item) => Buffer.from(String(item), "base64"));
      case "int64":
      case "uint64":
      case "sint64":
      case "fixed64":
      case "sfixed64":
        return arrayValues.map((item) => String(item));
      case "int32":
      case "uint32":
      case "sint32":
      case "fixed32":
      case "sfixed32":
      case "float":
      case "double":
        return arrayValues.map((item) => Number(item));
      case "bool":
        return arrayValues.map((item) => normalizeBoolSample(item as string | number | boolean));
      case "enum":
        return arrayValues.map((item) => normalizeEnumSample(descriptor, item));
      case "string":
      default:
        return arrayValues.map((item) => String(item));
    }
  }

  switch (descriptor.scalarType) {
    case "bytes":
      return Buffer.from(String(sampleValue), "base64");
    case "int64":
    case "uint64":
    case "sint64":
    case "fixed64":
    case "sfixed64":
      return sampleValue;
    case "float":
    case "double":
    case "int32":
    case "uint32":
    case "sint32":
    case "fixed32":
    case "sfixed32":
      return Number(sampleValue);
    case "bool":
      return normalizeBoolSample(sampleValue as string | number | boolean);
    case "enum":
      return normalizeEnumSample(descriptor, sampleValue);
    case "string":
    default:
      return String(sampleValue);
  }
}

function buildAlternateEncodings(descriptor: SimpleScalarMessageDescriptor, sampleValue: SampleValue): string[] {
  if (!descriptor.isRepeated) {
    return [];
  }
  if (!PACKABLE_SCALAR_TYPES.has(descriptor.scalarType)) {
    return [];
  }

  const arrayValues = (Array.isArray(sampleValue) ? sampleValue : [sampleValue]) as Array<string | number | boolean>;
  if (arrayValues.length === 0) {
    return [];
  }

  const preferPacked = descriptor.isPacked !== false;
  if (!preferPacked) {
    return [];
  }

  const writer = Writer.create();
  const tag = (descriptor.field.id << 3) | WIRE_TYPE_BY_SCALAR[descriptor.scalarType];

  switch (descriptor.scalarType) {
    case "int32":
      arrayValues.forEach((value) => writer.uint32(tag).int32(Number(value)));
      break;
    case "uint32":
      arrayValues.forEach((value) => writer.uint32(tag).uint32(Number(value)));
      break;
    case "sint32":
      arrayValues.forEach((value) => writer.uint32(tag).sint32(Number(value)));
      break;
    case "int64":
      arrayValues.forEach((value) => writer.uint32(tag).int64(String(value)));
      break;
    case "uint64":
      arrayValues.forEach((value) => writer.uint32(tag).uint64(String(value)));
      break;
    case "sint64":
      arrayValues.forEach((value) => writer.uint32(tag).sint64(String(value)));
      break;
    case "bool":
      arrayValues.forEach((value) => writer.uint32(tag).bool(normalizeBoolSample(value)));
      break;
    case "float":
      arrayValues.forEach((value) => writer.uint32(tag).float(Number(value)));
      break;
    case "double":
      arrayValues.forEach((value) => writer.uint32(tag).double(Number(value)));
      break;
    case "fixed32":
      arrayValues.forEach((value) => writer.uint32(tag).fixed32(Number(value)));
      break;
    case "sfixed32":
      arrayValues.forEach((value) => writer.uint32(tag).sfixed32(Number(value)));
      break;
    case "fixed64":
      arrayValues.forEach((value) => writer.uint32(tag).fixed64(String(value)));
      break;
    case "sfixed64":
      arrayValues.forEach((value) => writer.uint32(tag).sfixed64(String(value)));
      break;
    case "enum":
      arrayValues.forEach((value) => writer.uint32(tag).int32(normalizeEnumSample(descriptor, value)));
      break;
    default:
      return [];
  }

  const buffer = writer.finish();
  if (buffer.length === 0) {
    return [];
  }
  return [Buffer.from(buffer).toString("base64")];
}

function normalizeBoolSample(value: string | number | boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const lower = value.toLowerCase();
  return lower === "true" || lower === "1";
}

function normalizeEnumSample(descriptor: SimpleScalarMessageDescriptor, value: SampleValue): number {
  const enumInfo = descriptor.enumInfo;
  if (!enumInfo) {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  const name = String(value).toUpperCase();
  if (enumInfo.values.hasOwnProperty(name)) {
    return enumInfo.values[name];
  }
  const parsed = Number(value);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  return 0;
}

function buildSint64Samples(descriptor: SimpleScalarMessageDescriptor): Array<{ value: string; label: string }> {
  const dynamicPos = String(descriptor.field.id * 750000000 + 1357);
  const dynamicNeg = "-" + dynamicPos;
  const entries = [
    { value: "0", label: "zero" },
    { value: "1", label: "one" },
    { value: "-1", label: "neg-one" },
    { value: "63", label: "one-byte-max-minus" },
    { value: "-63", label: "neg-one-byte-max-minus" },
    { value: "64", label: "two-byte-min" },
    { value: "-64", label: "neg-two-byte-min" },
    { value: "127", label: "one-byte-max" },
    { value: "-128", label: "neg-two-byte-boundary" },
    { value: "255", label: "two-byte-mid" },
    { value: "-255", label: "neg-two-byte-mid" },
    { value: "16383", label: "two-byte-max" },
    { value: "-16384", label: "neg-two-byte-max" },
    { value: "2097151", label: "three-byte-max" },
    { value: "-2097152", label: "neg-three-byte-max" },
    { value: dynamicPos, label: "mid-pos" },
    { value: dynamicNeg, label: "mid-neg" },
    { value: "2147483647", label: "int32-max" },
    { value: "-2147483648", label: "int32-min" },
    { value: "9007199254740991", label: "safe-max" },
    { value: "-9007199254740991", label: "neg-safe-max" },
    { value: "9223372036854775807", label: "int64-max" },
    { value: "-9223372036854775808", label: "int64-min" }
  ];
  const seen = new Set<string>();
  const samples: Array<{ value: string; label: string }> = [];
  for (const entry of entries) {
    if (seen.has(entry.value)) {
      continue;
    }
    seen.add(entry.value);
    samples.push(entry);
  }
  return samples;
}

function escapeBrsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, "\"\"");
}

function formatBrsValue(value: unknown): string {
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    const jsonString = JSON.stringify(value);
    return `ParseJson("${escapeBrsString(jsonString)}")`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return formatNumericValue(value);
  }
  return `"${escapeBrsString(String(value))}"`;
}

function formatNumericValue(value: number): string {
  if (!Number.isFinite(value)) {
    return value.toString();
  }
  if (value !== 0 && Math.abs(value) < 1e-300) {
    const { high, low } = float64ToUint32Parts(value);
    return `__pb_uint64PartsToDouble(${high}, ${low})`;
  }
  return value.toString();
}

function float64ToUint32Parts(value: number): { high: number; low: number } {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, true);
  const low = view.getUint32(0, true);
  const high = view.getUint32(4, true);
  return { high, low };
}
