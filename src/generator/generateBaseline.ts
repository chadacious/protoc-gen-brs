import path from "node:path";
import { Buffer } from "node:buffer";
import fs from "fs-extra";
import { loadProtoBundle } from "./protoLoader";
import { collectSimpleScalarMessages } from "./schemaUtils";

export interface GenerateBaselineOptions {
  protoPaths: string[];
  fixtureDir: string;
}

export async function generateBaselineVectors(options: GenerateBaselineOptions) {
  const outputDir = path.resolve(options.fixtureDir);
  await fs.ensureDir(outputDir);

  const bundle = await loadProtoBundle(options.protoPaths);
  const simpleMessages = collectSimpleScalarMessages(bundle.root);

  const cases = simpleMessages.map((descriptor) => {
    let sampleValue: string | number | boolean;
    if (descriptor.scalarType === "string") {
      sampleValue = `Hello from ${descriptor.type.name}`;
    } else if (descriptor.scalarType === "int32") {
      sampleValue = descriptor.field.id * 100 + 7;
    } else {
      sampleValue = descriptor.field.id % 2 === 1;
    }

    const payload = {
      [descriptor.field.name]: sampleValue
    };
    const encodedBuffer = descriptor.type.encode(payload).finish();
    const encodedBase64 = Buffer.from(encodedBuffer).toString("base64");
    const decoded = descriptor.type.toObject(descriptor.type.decode(encodedBuffer), { defaults: true });

    return {
      type: descriptor.type.name,
      protoType: descriptor.type.fullName.replace(/^\./, ""),
      field: descriptor.field.name,
      fieldId: descriptor.field.id,
      value: sampleValue,
      valueType: descriptor.scalarType,
      encodedBase64,
      decoded
    };
  });

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

interface BaselineDocument {
  generatedAt: string;
  files: string[];
  cases: Array<{
    type: string;
    protoType: string;
    field: string;
    fieldId: number;
    value: string | number | boolean;
    valueType: string;
    encodedBase64: string;
    decoded: Record<string, unknown>;
  }>;
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
