import path from "node:path";
import { Buffer } from "node:buffer";
import fs from "fs-extra";
import { loadProtoBundle } from "./protoLoader";
import { collectSimpleScalarMessages, SimpleScalarMessageDescriptor } from "./schemaUtils";

export interface GenerateBaselineOptions {
  protoPaths: string[];
  fixtureDir: string;
}

export async function generateBaselineVectors(options: GenerateBaselineOptions) {
  const outputDir = path.resolve(options.fixtureDir);
  await fs.ensureDir(outputDir);

  const bundle = await loadProtoBundle(options.protoPaths);
  const simpleMessages = collectSimpleScalarMessages(bundle.root);

  const cases = [] as BaselineCase[];

  for (const descriptor of simpleMessages) {
    for (const sample of buildSamples(descriptor)) {
      const payloadValue = (() => {
        if (descriptor.scalarType === "bytes") {
          return Buffer.from(sample.value as string, "base64");
        }
        if (descriptor.scalarType === "int64") {
          return sample.value;
        }
        return sample.value;
      })();

      const payload = {
        [descriptor.field.name]: payloadValue
      };
      const encodedBuffer = descriptor.type.encode(payload).finish();
      const encodedBase64 = Buffer.from(encodedBuffer).toString("base64");
      const decoded = descriptor.type.toObject(descriptor.type.decode(encodedBuffer), { defaults: true, longs: String, bytes: String });

      cases.push({
        type: descriptor.type.name,
        protoType: descriptor.type.fullName.replace(/^\./, ""),
        field: descriptor.field.name,
        fieldId: descriptor.field.id,
        value: sample.value,
        valueType: descriptor.scalarType,
        sampleLabel: sample.label,
        encodedBase64,
        decoded
      });
    }
  }
  const metadataPath = path.join(outputDir, "baseline.json");
  const metadata = {
    generatedAt: new Date().toISOString(),
    files: bundle.files,
    cases
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
  value: string | number | boolean;
  valueType: string;
  sampleLabel: string;
  encodedBase64: string;
  decoded: Record<string, unknown>;
}

interface BaselineDocument {
  generatedAt: string;
  files: string[];
  cases: BaselineCase[];
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

    lines.push(`    data.cases.Push(${caseIdentifier})`);
  });

  lines.push("    return data", "end function", "");

  return lines.join("\n");
}


function buildSamples(descriptor: SimpleScalarMessageDescriptor): Array<{ value: string | number | boolean; label: string }> {
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
    case "bytes":
    default:
      return [
        { value: "", label: "empty" },
        { value: Buffer.from([descriptor.field.id, descriptor.field.id + 1, descriptor.field.id + 2]).toString("base64"), label: "pattern" }
      ];
  }
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
  return value.replace(/\"/g, "\"\"");
}

function formatBrsValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return value.toString();
  }
  return `"${escapeBrsString(String(value))}"`;
}
