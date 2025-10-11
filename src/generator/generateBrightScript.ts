import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fs from "fs-extra";
import { loadProtoBundle } from "./protoLoader";
import {
  collectMessageDescriptors,
  MessageDescriptor,
  MessageFieldDescriptor,
  SupportedScalarType
} from "./schemaUtils";

export interface GenerateBrightScriptOptions {
  protoPaths: string[];
  outputDir: string;
  configPath?: string;
}

export async function generateBrightScriptArtifacts(options: GenerateBrightScriptOptions) {
  const resolvedOutput = path.resolve(options.outputDir);
  await fs.ensureDir(resolvedOutput);

  const bundle = await loadProtoBundle(options.protoPaths);
  const messageDescriptors = collectMessageDescriptors(bundle.root);

  const messagesDir = path.join(resolvedOutput, "messages");
  await fs.ensureDir(messagesDir);
  await fs.emptyDir(messagesDir);

  const runtimePath = path.join(resolvedOutput, "runtime.brs");
  await fs.writeFile(runtimePath, renderRuntimeModule(), "utf8");

  const registryLines: string[] = [
    "' Auto-generated registry linking proto message handlers",
    "function __pb_getMessageHandlers() as Object",
    "    handlers = {}"
  ];

  for (const descriptor of messageDescriptors) {
    const messageModule = renderMessageModule(descriptor);
    const messagePath = path.join(messagesDir, `${descriptor.name}.brs`);
    await fs.writeFile(messagePath, messageModule, "utf8");

    const handlerId = `handler${descriptor.name}`;
    const encodeFn = `${descriptor.name}Encode`;
    const decodeFn = `${descriptor.name}Decode`;
    registryLines.push(
      `    ${handlerId} = {}`,
      `    ${handlerId}.encode = ${encodeFn}`,
      `    ${handlerId}.decode = ${decodeFn}`,
      `    handlers.${descriptor.name} = ${handlerId}`,
      `    handlers["${descriptor.fullName}"] = ${handlerId}`
    );
  }

  registryLines.push("    return handlers", "end function", "");
  const registryPath = path.join(messagesDir, "__index.brs");
  await fs.writeFile(registryPath, registryLines.join("\n"), "utf8");

  const summaryPath = path.join(resolvedOutput, "README.md");
  await fs.writeFile(
    summaryPath,
    renderReadme(bundle.files, messageDescriptors.map((item) => item.fullName)),
    "utf8"
  );

  const embeddedOutputDir = path.resolve("roku-app/source/generated");
  const defaultOutputDir = path.resolve("generated/source");
  const shouldSyncEmbedded = resolvedOutput === defaultOutputDir;

  if (shouldSyncEmbedded) {
    await fs.ensureDir(embeddedOutputDir);
    await fs.emptyDir(embeddedOutputDir);
  }

  const files = await fs.readdir(resolvedOutput);
  if (shouldSyncEmbedded) {
    for (const file of files) {
      const srcPath = path.join(resolvedOutput, file);
      const destPath = path.join(embeddedOutputDir, file.replace(/\.map$/, ""));
      const stats = await fs.stat(srcPath);
      if (stats.isFile() && file.endsWith(".map")) {
        continue;
      }
      await fs.copy(srcPath, destPath);
    }
  }
}

const TEMPLATE_SEARCH_PATHS = [
  path.join(__dirname, "templates"),
  path.join(__dirname, "..", "templates"),
  path.join(__dirname, "..", "..", "templates"),
  path.join(process.cwd(), "src", "templates"),
  path.join(process.cwd(), "dist", "templates")
];

const templateCache = new Map<string, string>();

function resolveTemplatePath(relativePath: string): string {
  for (const root of TEMPLATE_SEARCH_PATHS) {
    const candidate = path.join(root, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Unable to locate template: ${relativePath}`);
}

function loadTemplate(relativePath: string): string {
  const absolute = resolveTemplatePath(relativePath);
  if (!templateCache.has(absolute)) {
    templateCache.set(absolute, readFileSync(absolute, "utf8"));
  }
  return templateCache.get(absolute)!;
}

function renderRuntimeModule(): string {
  return loadTemplate("runtime.brs");
}

function renderMessageModule(descriptor: MessageDescriptor): string {
  const sections: string[] = [];
  sections.push(`' Auto-generated encoder/decoder for ${descriptor.fullName}`);
  sections.push("");
  sections.push(...renderEncodeFunction(descriptor));

  const enumHelpers = renderEnumHelperFunctions(descriptor);
  if (enumHelpers.length > 0) {
    sections.push("");
    sections.push(...enumHelpers);
  }

  sections.push("");
  sections.push(...renderDecodeFunction(descriptor));
  sections.push("");
  return sections.join("\n");
}

function renderEncodeFunction(descriptor: MessageDescriptor): string[] {
  const lines: string[] = [];
  const fnName = `${descriptor.name}Encode`;

  lines.push(`function ${fnName}(message as Object) as String`);
  lines.push(indent("bytes = __pb_createByteArray()", 1));

  descriptor.fields.forEach((field, index) => {
    if (index > 0) {
      lines.push("");
    }
    lines.push(...renderEncodeField(descriptor, field, 1));
  });

  lines.push("");
  lines.push(indent("__pb_appendUnknownFields(bytes, message)", 1));
  lines.push(indent("return __pb_toBase64(bytes)", 1));
  lines.push("end function");

  return lines;
}

function renderEncodeField(descriptor: MessageDescriptor, field: MessageFieldDescriptor, indentLevel: number): string[] {
  if (field.kind === "message") {
    return renderMessageEncodeField(field, indentLevel);
  }
  if (field.kind === "enum") {
    return renderEnumEncodeField(descriptor, field, indentLevel);
  }
  return renderScalarEncodeField(field, indentLevel);
}

function renderMessageEncodeField(field: Extract<MessageFieldDescriptor, { kind: "message" }>, indentLevel: number): string[] {
  const lines: string[] = [];
  const names = createFieldVariableNames(field.name);
  const childEncode = `${field.childType.name}Encode`;
  const valueVar = names.value;
  const bytesVar = `${names.base}ChildBytes`;
  const encodedVar = `${names.base}Encoded`;
  const loopVar = `${names.base}Item`;
  const itemsVar = `${names.base}Items`;
  const singleVar = `${names.base}Single`;

  lines.push(...renderValueRetrieval(valueVar, field.name, indentLevel));

  if (field.isRepeated) {
    lines.push("");
    lines.push(...renderRepeatedSourceNormalization(valueVar, itemsVar, singleVar, indentLevel));
    lines.push("");
    lines.push(indent(`if ${itemsVar} <> invalid then`, indentLevel));
    lines.push(indent(`for each ${loopVar} in ${itemsVar}`, indentLevel + 1));
    lines.push(indent(`if ${loopVar} <> invalid then`, indentLevel + 2));
    lines.push(indent(`${encodedVar} = ${childEncode}(${loopVar})`, indentLevel + 3));
    lines.push(indent(`${bytesVar} = __pb_fromBase64(${encodedVar})`, indentLevel + 3));
    lines.push(indent(`__pb_writeVarint(bytes, ${field.tag})`, indentLevel + 3));
    lines.push(indent(`__pb_writeVarint(bytes, ${bytesVar}.Count())`, indentLevel + 3));
    lines.push(indent(`__pb_appendByteArray(bytes, ${bytesVar})`, indentLevel + 3));
    lines.push(indent("end if", indentLevel + 2));
    lines.push(indent("end for", indentLevel + 1));
    lines.push(indent("end if", indentLevel));
  } else {
    lines.push("");
    lines.push(indent(`if ${valueVar} <> invalid then`, indentLevel));
    lines.push(indent(`${encodedVar} = ${childEncode}(${valueVar})`, indentLevel + 1));
    lines.push(indent(`${bytesVar} = __pb_fromBase64(${encodedVar})`, indentLevel + 1));
    lines.push(indent(`__pb_writeVarint(bytes, ${field.tag})`, indentLevel + 1));
    lines.push(indent(`__pb_writeVarint(bytes, ${bytesVar}.Count())`, indentLevel + 1));
    lines.push(indent(`__pb_appendByteArray(bytes, ${bytesVar})`, indentLevel + 1));
    lines.push(indent("end if", indentLevel));
  }

  return lines;
}

function renderScalarEncodeField(field: Extract<MessageFieldDescriptor, { kind: "scalar" }>, indentLevel: number): string[] {
  const lines: string[] = [];
  const names = createFieldVariableNames(field.name);
  const valueVar = names.value;
  const itemsVar = `${names.base}Items`;
  const singleVar = `${names.base}Single`;
  const loopVar = `${names.base}Item`;

  lines.push(...renderValueRetrieval(valueVar, field.name, indentLevel));

  if (field.isRepeated) {
    lines.push("");
    lines.push(...renderRepeatedSourceNormalization(valueVar, itemsVar, singleVar, indentLevel));
    lines.push("");
    lines.push(indent(`if ${itemsVar} <> invalid then`, indentLevel));
    if (field.isPacked) {
      const packedVar = `${names.base}Packed`;
      lines.push(indent(`${packedVar} = __pb_createByteArray()`, indentLevel + 1));
      lines.push(indent(`for each ${loopVar} in ${itemsVar}`, indentLevel + 1));
      lines.push(...renderScalarPackedWrite(field.scalarType, loopVar, packedVar, indentLevel + 2));
      lines.push(indent("end for", indentLevel + 1));
      lines.push(indent(`if ${packedVar}.Count() > 0 then`, indentLevel + 1));
      lines.push(indent(`__pb_writeVarint(bytes, ${field.packedTag})`, indentLevel + 2));
      lines.push(indent(`__pb_writeVarint(bytes, ${packedVar}.Count())`, indentLevel + 2));
      lines.push(indent(`__pb_appendByteArray(bytes, ${packedVar})`, indentLevel + 2));
      lines.push(indent("end if", indentLevel + 1));
    } else {
      lines.push(indent(`for each ${loopVar} in ${itemsVar}`, indentLevel + 1));
      lines.push(...renderScalarUnpackedWrite(field.scalarType, loopVar, field.tag, indentLevel + 2));
      lines.push(indent("end for", indentLevel + 1));
    }
    lines.push(indent("end if", indentLevel));
  } else {
    lines.push("");
    lines.push(indent(`if ${valueVar} <> invalid then`, indentLevel));
    lines.push(...renderScalarSingleWrite(field.scalarType, valueVar, field.tag, indentLevel + 1));
    lines.push(indent("end if", indentLevel));
  }

  return lines;
}

function renderEnumEncodeField(descriptor: MessageDescriptor, field: Extract<MessageFieldDescriptor, { kind: "enum" }>, indentLevel: number): string[] {
  const lines: string[] = [];
  const names = createFieldVariableNames(field.name);
  const valueVar = names.value;
  const itemsVar = `${names.base}Items`;
  const singleVar = `${names.base}Single`;
  const loopVar = `${names.base}Item`;
  const normalizeFn = buildEnumNormalizeFunctionName(descriptor, field);

  lines.push(...renderValueRetrieval(valueVar, field.name, indentLevel));

  if (field.isRepeated) {
    lines.push("");
    lines.push(...renderRepeatedSourceNormalization(valueVar, itemsVar, singleVar, indentLevel));
    lines.push("");
    lines.push(indent(`if ${itemsVar} <> invalid then`, indentLevel));
    if (field.isPacked) {
      const packedVar = `${names.base}Packed`;
      lines.push(indent(`${packedVar} = __pb_createByteArray()`, indentLevel + 1));
      lines.push(indent(`for each ${loopVar} in ${itemsVar}`, indentLevel + 1));
      lines.push(indent(`numericValue = ${normalizeFn}(${loopVar})`, indentLevel + 2));
      lines.push(indent(`__pb_writeVarint(${packedVar}, numericValue)`, indentLevel + 2));
      lines.push(indent("end for", indentLevel + 1));
      lines.push(indent(`if ${packedVar}.Count() > 0 then`, indentLevel + 1));
      lines.push(indent(`__pb_writeVarint(bytes, ${field.packedTag})`, indentLevel + 2));
      lines.push(indent(`__pb_writeVarint(bytes, ${packedVar}.Count())`, indentLevel + 2));
      lines.push(indent(`__pb_appendByteArray(bytes, ${packedVar})`, indentLevel + 2));
      lines.push(indent("end if", indentLevel + 1));
    } else {
      lines.push(indent(`for each ${loopVar} in ${itemsVar}`, indentLevel + 1));
      lines.push(indent(`numericValue = ${normalizeFn}(${loopVar})`, indentLevel + 2));
      lines.push(indent(`__pb_writeVarint(bytes, ${field.tag})`, indentLevel + 2));
      lines.push(indent(`__pb_writeVarint(bytes, numericValue)`, indentLevel + 2));
      lines.push(indent("end for", indentLevel + 1));
    }
    lines.push(indent("end if", indentLevel));
  } else {
    lines.push("");
    lines.push(indent(`if ${valueVar} <> invalid then`, indentLevel));
    lines.push(indent(`numericValue = ${normalizeFn}(${valueVar})`, indentLevel + 1));
    lines.push(indent(`__pb_writeVarint(bytes, ${field.tag})`, indentLevel + 1));
    lines.push(indent(`__pb_writeVarint(bytes, numericValue)`, indentLevel + 1));
    lines.push(indent("end if", indentLevel));
  }

  return lines;
}

function renderScalarSingleWrite(
  scalarType: SupportedScalarType,
  sourceVar: string,
  tag: number,
  indentLevel: number
): string[] {
  switch (scalarType) {
    case "int32":
      return [
        indent(`normalized = Int(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint(bytes, normalized)", indentLevel)
      ];
    case "uint32":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeVarint64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "sint32":
      return [
        indent(`normalized = Int(${sourceVar})`, indentLevel),
        indent("encoded = __pb_encodeZigZag32(normalized)", indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint64(bytes, encoded)", indentLevel)
      ];
    case "int64":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeVarint64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "uint64":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeVarint64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "sint64":
      return [
        indent(`encoded = __pb_encodeZigZag64(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint64(bytes, encoded)", indentLevel)
      ];
    case "bool":
      return [
        indent(`boolValue = ${sourceVar}`, indentLevel),
        indent(`boolType = Type(boolValue)`, indentLevel),
        indent(`if boolType = "String" or boolType = "roString" then`, indentLevel),
        indent("lower = LCase(boolValue)", indentLevel + 1),
        indent("boolValue = (lower = \"true\") or (lower = \"1\")", indentLevel + 1),
        indent("else if boolType = \"Boolean\" or boolType = \"roBoolean\" then", indentLevel),
        indent("' keep as is", indentLevel + 1),
        indent("else", indentLevel),
        indent("boolValue = (boolValue <> 0)", indentLevel + 1),
        indent("end if", indentLevel),
        indent("boolInt = 0", indentLevel),
        indent("if boolValue = true then boolInt = 1", indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint(bytes, boolInt)", indentLevel)
      ];
    case "bytes":
      return [
        indent(`dataBytes = __pb_createByteArray()`, indentLevel),
        indent(`if ${sourceVar} <> invalid then`, indentLevel),
        indent("valueType = Type(" + sourceVar + ")", indentLevel + 1),
        indent('if valueType = "String" or valueType = "roString" then', indentLevel + 1),
        indent(`dataBytes.FromBase64String(${sourceVar})`, indentLevel + 2),
        indent('else if valueType = "roByteArray" then', indentLevel + 1),
        indent(`__pb_appendByteArray(dataBytes, ${sourceVar})`, indentLevel + 2),
        indent("end if", indentLevel + 1),
        indent("end if", indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint(bytes, dataBytes.Count())", indentLevel),
        indent("__pb_appendByteArray(bytes, dataBytes)", indentLevel)
      ];
    case "string":
      return [
        indent(`strValue = ${sourceVar}`, indentLevel),
        indent("valueType = Type(strValue)", indentLevel),
        indent('if valueType <> "String" and valueType <> "roString" then', indentLevel),
        indent("strValue = strValue + \"\"", indentLevel + 1),
        indent("end if", indentLevel),
        indent("strBytes = __pb_createByteArray()", indentLevel),
        indent("strBytes.FromAsciiString(strValue)", indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint(bytes, strBytes.Count())", indentLevel),
        indent("__pb_appendByteArray(bytes, strBytes)", indentLevel)
      ];
    case "float":
      return [
        indent(`normalized = __pb_toLong(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeFloat32(bytes, normalized)", indentLevel)
      ];
    case "double":
      return [
        indent(`normalized = __pb_toLong(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeFloat64(bytes, normalized)", indentLevel)
      ];
    case "fixed32":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeFixed32(bytes, ${sourceVar})`, indentLevel)
      ];
    case "sfixed32":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeFixed32(bytes, ${sourceVar})`, indentLevel)
      ];
    case "fixed64":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeFixed64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "sfixed64":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeFixed64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "enum":
      throw new Error("Enum handled separately");
  }
}

function renderScalarUnpackedWrite(
  scalarType: SupportedScalarType,
  sourceVar: string,
  tag: number,
  indentLevel: number
): string[] {
  switch (scalarType) {
    case "int32":
      return [
        indent(`normalized = Int(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint(bytes, normalized)", indentLevel)
      ];
    case "uint32":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeVarint64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "sint32":
      return [
        indent(`normalized = Int(${sourceVar})`, indentLevel),
        indent("encoded = __pb_encodeZigZag32(normalized)", indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint64(bytes, encoded)", indentLevel)
      ];
    case "int64":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeVarint64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "uint64":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeVarint64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "sint64":
      return [
        indent(`encoded = __pb_encodeZigZag64(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint64(bytes, encoded)", indentLevel)
      ];
    case "bool":
      return [
        indent(`boolValue = ${sourceVar}`, indentLevel),
        indent("valueType = Type(boolValue)", indentLevel),
        indent('if valueType = "String" or valueType = "roString" then', indentLevel),
        indent("lower = LCase(boolValue)", indentLevel + 1),
        indent("boolValue = (lower = \"true\") or (lower = \"1\")", indentLevel + 1),
        indent('else if valueType = "Boolean" or valueType = "roBoolean" then', indentLevel),
        indent("' keep as is", indentLevel + 1),
        indent("else", indentLevel),
        indent("boolValue = (boolValue <> 0)", indentLevel + 1),
        indent("end if", indentLevel),
        indent("boolInt = 0", indentLevel),
        indent("if boolValue = true then boolInt = 1", indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint(bytes, boolInt)", indentLevel)
      ];
    case "bytes":
      return [
        indent("dataBytes = __pb_createByteArray()", indentLevel),
        indent(`if ${sourceVar} <> invalid then`, indentLevel),
        indent("valueType = Type(" + sourceVar + ")", indentLevel + 1),
        indent('if valueType = "String" or valueType = "roString" then', indentLevel + 1),
        indent(`dataBytes.FromBase64String(${sourceVar})`, indentLevel + 2),
        indent('else if valueType = "roByteArray" then', indentLevel + 1),
        indent(`__pb_appendByteArray(dataBytes, ${sourceVar})`, indentLevel + 2),
        indent("end if", indentLevel + 1),
        indent("end if", indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint(bytes, dataBytes.Count())", indentLevel),
        indent("__pb_appendByteArray(bytes, dataBytes)", indentLevel)
      ];
    case "string":
      return [
        indent(`strValue = ${sourceVar}`, indentLevel),
        indent("valueType = Type(strValue)", indentLevel),
        indent('if valueType <> \"String\" and valueType <> \"roString\" then', indentLevel),
        indent("strValue = strValue + \"\"", indentLevel + 1),
        indent("end if", indentLevel),
        indent("strBytes = __pb_createByteArray()", indentLevel),
        indent("strBytes.FromAsciiString(strValue)", indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeVarint(bytes, strBytes.Count())", indentLevel),
        indent("__pb_appendByteArray(bytes, strBytes)", indentLevel)
      ];
    case "float":
      return [
        indent(`normalized = __pb_toLong(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeFloat32(bytes, normalized)", indentLevel)
      ];
    case "double":
      return [
        indent(`normalized = __pb_toLong(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent("__pb_writeFloat64(bytes, normalized)", indentLevel)
      ];
    case "fixed32":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeFixed32(bytes, ${sourceVar})`, indentLevel)
      ];
    case "sfixed32":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeFixed32(bytes, ${sourceVar})`, indentLevel)
      ];
    case "fixed64":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeFixed64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "sfixed64":
      return [
        indent(`__pb_writeVarint(bytes, ${tag})`, indentLevel),
        indent(`__pb_writeFixed64(bytes, ${sourceVar})`, indentLevel)
      ];
    case "enum":
      throw new Error("Enum handled separately");
  }
}

function renderScalarPackedWrite(
  scalarType: SupportedScalarType,
  sourceVar: string,
  targetVar: string,
  indentLevel: number
): string[] {
  switch (scalarType) {
    case "int32":
      return [
        indent(`normalized = Int(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint(${targetVar}, normalized)`, indentLevel)
      ];
    case "uint32":
      return [indent(`__pb_writeVarint64(${targetVar}, ${sourceVar})`, indentLevel)];
    case "sint32":
      return [
        indent(`normalized = Int(${sourceVar})`, indentLevel),
        indent("encoded = __pb_encodeZigZag32(normalized)", indentLevel),
        indent(`__pb_writeVarint64(${targetVar}, encoded)`, indentLevel)
      ];
    case "int64":
      return [indent(`__pb_writeVarint64(${targetVar}, ${sourceVar})`, indentLevel)];
    case "uint64":
      return [indent(`__pb_writeVarint64(${targetVar}, ${sourceVar})`, indentLevel)];
    case "sint64":
      return [
        indent(`encoded = __pb_encodeZigZag64(${sourceVar})`, indentLevel),
        indent(`__pb_writeVarint64(${targetVar}, encoded)`, indentLevel)
      ];
    case "bool":
      return [
        indent(`boolValue = ${sourceVar}`, indentLevel),
        indent("valueType = Type(boolValue)", indentLevel),
        indent('if valueType = "String" or valueType = "roString" then', indentLevel),
        indent("lower = LCase(boolValue)", indentLevel + 1),
        indent("boolValue = (lower = \"true\") or (lower = \"1\")", indentLevel + 1),
        indent('else if valueType = "Boolean" or valueType = "roBoolean" then', indentLevel),
        indent("' keep as is", indentLevel + 1),
        indent("else", indentLevel),
        indent("boolValue = (boolValue <> 0)", indentLevel + 1),
        indent("end if", indentLevel),
        indent("boolInt = 0", indentLevel),
        indent("if boolValue = true then boolInt = 1", indentLevel),
        indent(`__pb_writeVarint(${targetVar}, boolInt)`, indentLevel)
      ];
    case "float":
      return [
        indent(`normalized = __pb_toLong(${sourceVar})`, indentLevel),
        indent(`__pb_writeFloat32(${targetVar}, normalized)`, indentLevel)
      ];
    case "double":
      return [
        indent(`normalized = __pb_toLong(${sourceVar})`, indentLevel),
        indent(`__pb_writeFloat64(${targetVar}, normalized)`, indentLevel)
      ];
    case "fixed32":
      return [indent(`__pb_writeFixed32(${targetVar}, ${sourceVar})`, indentLevel)];
    case "sfixed32":
      return [indent(`__pb_writeFixed32(${targetVar}, ${sourceVar})`, indentLevel)];
    case "fixed64":
      return [indent(`__pb_writeFixed64(${targetVar}, ${sourceVar})`, indentLevel)];
    case "sfixed64":
      return [indent(`__pb_writeFixed64(${targetVar}, ${sourceVar})`, indentLevel)];
    case "bytes":
    case "string":
      throw new Error("Length-delimited scalars cannot be packed");
    default:
      throw new Error(`Unsupported packed scalar type: ${scalarType}`);
  }
}

function renderValueRetrieval(valueVar: string, fieldName: string, indentLevel: number): string[] {
  return [
    indent(`${valueVar} = invalid`, indentLevel),
    indent("if message <> invalid then", indentLevel),
    indent('if GetInterface(message, "ifAssociativeArray") <> invalid then', indentLevel + 1),
    indent(`if message.DoesExist("${fieldName}") then`, indentLevel + 2),
    indent(`${valueVar} = message.Lookup("${fieldName}")`, indentLevel + 3),
    indent("end if", indentLevel + 2),
    indent("else", indentLevel + 1),
    indent(`${valueVar} = message.${fieldName}`, indentLevel + 2),
    indent("end if", indentLevel + 1),
    indent("end if", indentLevel)
  ];
}

function renderRepeatedSourceNormalization(
  sourceVar: string,
  itemsVar: string,
  singleVar: string,
  indentLevel: number
): string[] {
  return [
    indent(`${itemsVar} = invalid`, indentLevel),
    indent(`if ${sourceVar} <> invalid then`, indentLevel),
    indent(`if GetInterface(${sourceVar}, "ifArray") <> invalid then`, indentLevel + 1),
    indent(`${itemsVar} = ${sourceVar}`, indentLevel + 2),
    indent("else", indentLevel + 1),
    indent(`${singleVar} = CreateObject("roArray", 1, true)`, indentLevel + 2),
    indent(`${singleVar}.Push(${sourceVar})`, indentLevel + 2),
    indent(`${itemsVar} = ${singleVar}`, indentLevel + 2),
    indent("end if", indentLevel + 1),
    indent("end if", indentLevel)
  ];
}

function renderDecodeFunction(descriptor: MessageDescriptor): string[] {
  const lines: string[] = [];
  const fnName = `${descriptor.name}Decode`;

  lines.push(`function ${fnName}(encoded as String) as Object`);
  lines.push(indent("bytes = __pb_fromBase64(encoded)", 1));
  lines.push(indent("cursor = 0", 1));
  lines.push(indent("limit = bytes.Count()", 1));
  lines.push(indent("message = {}", 1));
  lines.push(indent("while cursor < limit", 1));
  lines.push(indent("tagStart = cursor", 2));
  lines.push(indent("tagResult = __pb_readVarint(bytes, cursor)", 2));
  lines.push(indent("cursor = tagResult.nextIndex", 2));
  lines.push(indent("fieldNumber = Int(tagResult.value / 8)", 2));
  lines.push(indent("wireType = tagResult.value AND &h07", 2));

  if (descriptor.fields.length > 0) {
    descriptor.fields.forEach((field, index) => {
      const prefix = index === 0 ? "if" : "else if";
      lines.push(indent(`${prefix} fieldNumber = ${field.id} then`, 2));
      lines.push(...renderDecodeBody(descriptor, field, 3));
    });
    lines.push(indent("else", 2));
    lines.push(...renderUnknownFieldHandler(3));
    lines.push(indent("end if", 2));
  } else {
    lines.push(...renderUnknownFieldHandler(2));
  }

  lines.push(indent("end while", 1));
  lines.push(indent("return message", 1));
  lines.push("end function");

  return lines;
}

function renderDecodeBody(descriptor: MessageDescriptor, field: MessageFieldDescriptor, indentLevel: number): string[] {
  switch (field.kind) {
    case "message":
      return renderMessageDecodeBody(field, indentLevel);
    case "scalar":
      return renderScalarDecodeBody(field, indentLevel);
    case "enum":
      return renderEnumDecodeBody(descriptor, field, indentLevel);
  }
}

function renderMessageDecodeBody(
  field: Extract<MessageFieldDescriptor, { kind: "message" }>,
  indentLevel: number
): string[] {
  const lines: string[] = [];
  const childDecode = `${field.childType.name}Decode`;
  const lengthVar = `${sanitizeIdentifier(field.name)}Length`;
  const childBytesVar = `${sanitizeIdentifier(field.name)}ChildBytes`;
  const encodedVar = `${sanitizeIdentifier(field.name)}Child`;
  const rawArrayVar = `${sanitizeIdentifier(field.name)}Values`;

  lines.push(indent(`if wireType = ${field.wireType} then`, indentLevel));
  lines.push(indent("lengthResult = __pb_readVarint(bytes, cursor)", indentLevel + 1));
  lines.push(indent("cursor = lengthResult.nextIndex", indentLevel + 1));
  lines.push(indent(`${lengthVar} = lengthResult.value`, indentLevel + 1));
  lines.push(indent(`${childBytesVar} = __pb_readBytes(bytes, cursor, ${lengthVar})`, indentLevel + 1));
  lines.push(indent(`cursor = cursor + ${lengthVar}`, indentLevel + 1));
  lines.push(indent(`${encodedVar} = __pb_byteArrayToBase64(${childBytesVar})`, indentLevel + 1));
  if (field.isRepeated) {
    lines.push(indent(`${rawArrayVar} = invalid`, indentLevel + 1));
    lines.push(indent('if GetInterface(message, "ifAssociativeArray") <> invalid and message.DoesExist("' + field.name + '") then', indentLevel + 1));
    lines.push(indent(`${rawArrayVar} = message.${field.name}`, indentLevel + 2));
    lines.push(indent("end if", indentLevel + 1));
    lines.push(indent(`if ${rawArrayVar} = invalid then`, indentLevel + 1));
    lines.push(indent(`${rawArrayVar} = CreateObject("roArray", 0, true)`, indentLevel + 2));
    lines.push(indent(`message.${field.name} = ${rawArrayVar}`, indentLevel + 2));
    lines.push(indent("end if", indentLevel + 1));
    lines.push(indent(`${rawArrayVar}.Push(${childDecode}(${encodedVar}))`, indentLevel + 1));
  } else {
    lines.push(indent(`message.${field.name} = ${childDecode}(${encodedVar})`, indentLevel + 1));
  }
  lines.push(indent("else", indentLevel));
  lines.push(...renderUnknownFieldHandler(indentLevel + 1));
  lines.push(indent("end if", indentLevel));

  return lines;
}

function renderScalarDecodeBody(
  field: Extract<MessageFieldDescriptor, { kind: "scalar" }>,
  indentLevel: number
): string[] {
  if (field.isRepeated) {
    return renderScalarRepeatedDecode(field.scalarType, field, indentLevel);
  }
  return renderScalarSingleDecode(field.scalarType, field, indentLevel);
}

function renderScalarSingleDecode(
  scalarType: SupportedScalarType,
  field: Extract<MessageFieldDescriptor, { kind: "scalar" }>,
  indentLevel: number
): string[] {
  const lines: string[] = [];

  lines.push(indent(`if wireType = ${field.wireType} then`, indentLevel));
  lines.push(...renderScalarSingleRead(scalarType, field.name, indentLevel + 1));
  lines.push(indent("else", indentLevel));
  lines.push(...renderUnknownFieldHandler(indentLevel + 1));
  lines.push(indent("end if", indentLevel));

  return lines;
}

function renderScalarRepeatedDecode(
  scalarType: SupportedScalarType,
  field: Extract<MessageFieldDescriptor, { kind: "scalar" }>,
  indentLevel: number
): string[] {
  const lines: string[] = [];
  const valuesVar = `${sanitizeIdentifier(field.name)}Values`;
  const packEndVar = `${sanitizeIdentifier(field.name)}PackEnd`;
  const elementWireType = field.elementWireType ?? field.wireType;

  lines.push(indent(`${valuesVar} = invalid`, indentLevel));
  lines.push(indent('if GetInterface(message, "ifAssociativeArray") <> invalid and message.DoesExist("' + field.name + '") then', indentLevel));
  lines.push(indent(`${valuesVar} = message.${field.name}`, indentLevel + 1));
  lines.push(indent("end if", indentLevel));
  lines.push(indent(`if ${valuesVar} = invalid then`, indentLevel));
  lines.push(indent(`${valuesVar} = CreateObject("roArray", 0, true)`, indentLevel + 1));
  lines.push(indent(`message.${field.name} = ${valuesVar}`, indentLevel + 1));
  lines.push(indent("end if", indentLevel));

  lines.push(indent(`if wireType = ${elementWireType}`, indentLevel));
  lines.push(...renderScalarRepeatedElementRead(scalarType, valuesVar, indentLevel + 1));

  if (field.isPacked) {
    lines.push(indent("else if wireType = 2 then", indentLevel));
    lines.push(indent("lengthResult = __pb_readVarint(bytes, cursor)", indentLevel + 1));
    lines.push(indent("cursor = lengthResult.nextIndex", indentLevel + 1));
    lines.push(indent(`${packEndVar} = cursor + lengthResult.value`, indentLevel + 1));
    lines.push(indent(`while cursor < ${packEndVar}`, indentLevel + 1));
    lines.push(...renderScalarRepeatedElementRead(scalarType, valuesVar, indentLevel + 2));
    lines.push(indent("end while", indentLevel + 1));
  }

  lines.push(indent("else", indentLevel));
  lines.push(...renderUnknownFieldHandler(indentLevel + 1));
  lines.push(indent("end if", indentLevel));

  return lines;
}

function renderScalarSingleRead(scalarType: SupportedScalarType, fieldName: string, indentLevel: number): string[] {
  switch (scalarType) {
    case "int32":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = __pb_toSigned32FromString(valueResult.value)`, indentLevel)
      ];
    case "uint32":
      return [
        indent("valueResult = __pb_readVarint(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = __pb_toUnsigned32(valueResult.value)`, indentLevel)
      ];
    case "sint32":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = __pb_decodeZigZag32(valueResult.value)`, indentLevel)
      ];
    case "int64":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = __pb_toSignedInt64String(valueResult.value)`, indentLevel)
      ];
    case "uint64":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = valueResult.value`, indentLevel)
      ];
    case "sint64":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = __pb_decodeZigZag64(valueResult.value)`, indentLevel)
      ];
    case "bool":
      return [
        indent("valueResult = __pb_readVarint(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = (valueResult.value <> 0)`, indentLevel)
      ];
    case "bytes":
      return [
        indent("lengthResult = __pb_readVarint(bytes, cursor)", indentLevel),
        indent("cursor = lengthResult.nextIndex", indentLevel),
        indent("dataLength = lengthResult.value", indentLevel),
        indent("rawBytes = __pb_readBytes(bytes, cursor, dataLength)", indentLevel),
        indent("cursor = cursor + dataLength", indentLevel),
        indent(`message.${fieldName} = __pb_byteArrayToBase64(rawBytes)`, indentLevel)
      ];
    case "string":
      return [
        indent("lengthResult = __pb_readVarint(bytes, cursor)", indentLevel),
        indent("cursor = lengthResult.nextIndex", indentLevel),
        indent("strLength = lengthResult.value", indentLevel),
        indent("fieldValue = __pb_readString(bytes, cursor, strLength)", indentLevel),
        indent("cursor = cursor + strLength", indentLevel),
        indent(`message.${fieldName} = fieldValue`, indentLevel)
      ];
    case "float":
      return [
        indent("floatResult = __pb_readFloat32(bytes, cursor)", indentLevel),
        indent("cursor = floatResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = floatResult.value`, indentLevel)
      ];
    case "double":
      return [
        indent("doubleResult = __pb_readFloat64(bytes, cursor)", indentLevel),
        indent("cursor = doubleResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = doubleResult.value`, indentLevel)
      ];
    case "fixed32":
      return [
        indent("fixedResult = __pb_readFixed32(bytes, cursor)", indentLevel),
        indent("cursor = fixedResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = __pb_toUnsigned32(fixedResult.value)`, indentLevel)
      ];
    case "sfixed32":
      return [
        indent("fixedResult = __pb_readFixed32(bytes, cursor)", indentLevel),
        indent("cursor = fixedResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = __pb_toSigned32(fixedResult.value)`, indentLevel)
      ];
    case "fixed64":
      return [
        indent("fixedResult = __pb_readFixed64(bytes, cursor)", indentLevel),
        indent("cursor = fixedResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = fixedResult.value`, indentLevel)
      ];
    case "sfixed64":
      return [
        indent("fixedResult = __pb_readFixed64(bytes, cursor)", indentLevel),
        indent("cursor = fixedResult.nextIndex", indentLevel),
        indent(`message.${fieldName} = __pb_toSignedInt64String(fixedResult.value)`, indentLevel)
      ];
    case "enum":
      throw new Error("Enum handled separately");
  }
}

function renderScalarRepeatedElementRead(
  scalarType: SupportedScalarType,
  valuesVar: string,
  indentLevel: number
): string[] {
  switch (scalarType) {
    case "int32":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(__pb_toSigned32FromString(valueResult.value))`, indentLevel)
      ];
    case "uint32":
      return [
        indent("valueResult = __pb_readVarint(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(__pb_toUnsigned32(valueResult.value))`, indentLevel)
      ];
    case "sint32":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(__pb_decodeZigZag32(valueResult.value))`, indentLevel)
      ];
    case "int64":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(__pb_toSignedInt64String(valueResult.value))`, indentLevel)
      ];
    case "uint64":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(valueResult.value)`, indentLevel)
      ];
    case "sint64":
      return [
        indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(__pb_decodeZigZag64(valueResult.value))`, indentLevel)
      ];
    case "bool":
      return [
        indent("valueResult = __pb_readVarint(bytes, cursor)", indentLevel),
        indent("cursor = valueResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(valueResult.value <> 0)`, indentLevel)
      ];
    case "bytes":
      return [
        indent("lengthResult = __pb_readVarint(bytes, cursor)", indentLevel),
        indent("cursor = lengthResult.nextIndex", indentLevel),
        indent("dataLength = lengthResult.value", indentLevel),
        indent("rawBytes = __pb_readBytes(bytes, cursor, dataLength)", indentLevel),
        indent("cursor = cursor + dataLength", indentLevel),
        indent(`${valuesVar}.Push(__pb_byteArrayToBase64(rawBytes))`, indentLevel)
      ];
    case "string":
      return [
        indent("lengthResult = __pb_readVarint(bytes, cursor)", indentLevel),
        indent("cursor = lengthResult.nextIndex", indentLevel),
        indent("strLength = lengthResult.value", indentLevel),
        indent("fieldValue = __pb_readString(bytes, cursor, strLength)", indentLevel),
        indent("cursor = cursor + strLength", indentLevel),
        indent(`${valuesVar}.Push(fieldValue)`, indentLevel)
      ];
    case "float":
      return [
        indent("floatResult = __pb_readFloat32(bytes, cursor)", indentLevel),
        indent("cursor = floatResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(floatResult.value)`, indentLevel)
      ];
    case "double":
      return [
        indent("doubleResult = __pb_readFloat64(bytes, cursor)", indentLevel),
        indent("cursor = doubleResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(doubleResult.value)`, indentLevel)
      ];
    case "fixed32":
      return [
        indent("fixedResult = __pb_readFixed32(bytes, cursor)", indentLevel),
        indent("cursor = fixedResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(__pb_toUnsigned32(fixedResult.value))`, indentLevel)
      ];
    case "sfixed32":
      return [
        indent("fixedResult = __pb_readFixed32(bytes, cursor)", indentLevel),
        indent("cursor = fixedResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(__pb_toSigned32(fixedResult.value))`, indentLevel)
      ];
    case "fixed64":
      return [
        indent("fixedResult = __pb_readFixed64(bytes, cursor)", indentLevel),
        indent("cursor = fixedResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(fixedResult.value)`, indentLevel)
      ];
    case "sfixed64":
      return [
        indent("fixedResult = __pb_readFixed64(bytes, cursor)", indentLevel),
        indent("cursor = fixedResult.nextIndex", indentLevel),
        indent(`${valuesVar}.Push(__pb_toSignedInt64String(fixedResult.value))`, indentLevel)
      ];
    case "enum":
      throw new Error("Enum handled separately");
  }
}

function renderEnumDecodeBody(descriptor: MessageDescriptor, field: Extract<MessageFieldDescriptor, { kind: "enum" }>, indentLevel: number): string[] {
  const lines: string[] = [];
  const valuesVar = `${sanitizeIdentifier(field.name)}Values`;
  const packEndVar = `${sanitizeIdentifier(field.name)}PackEnd`;
  const enumNameFn = buildEnumNameFunctionName(descriptor, field);
  const elementWireType = field.elementWireType ?? field.wireType;

  if (field.isRepeated) {
    lines.push(indent(`${valuesVar} = invalid`, indentLevel));
    lines.push(indent('if GetInterface(message, "ifAssociativeArray") <> invalid and message.DoesExist("' + field.name + '") then', indentLevel));
    lines.push(indent(`${valuesVar} = message.${field.name}`, indentLevel + 1));
    lines.push(indent("end if", indentLevel));
    lines.push(indent(`if ${valuesVar} = invalid then`, indentLevel));
    lines.push(indent(`${valuesVar} = CreateObject("roArray", 0, true)`, indentLevel + 1));
    lines.push(indent(`message.${field.name} = ${valuesVar}`, indentLevel + 1));
    lines.push(indent("end if", indentLevel));
    lines.push(indent(`if wireType = ${elementWireType}`, indentLevel));
    lines.push(indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel + 1));
    lines.push(indent("cursor = valueResult.nextIndex", indentLevel + 1));
    lines.push(indent("numericValue = __pb_toSigned32FromString(valueResult.value)", indentLevel + 1));
    lines.push(indent(`${valuesVar}.Push(${enumNameFn}(numericValue))`, indentLevel + 1));
    if (field.isPacked) {
      lines.push(indent("else if wireType = 2 then", indentLevel));
      lines.push(indent("lengthResult = __pb_readVarint(bytes, cursor)", indentLevel + 1));
      lines.push(indent("cursor = lengthResult.nextIndex", indentLevel + 1));
      lines.push(indent(`${packEndVar} = cursor + lengthResult.value`, indentLevel + 1));
      lines.push(indent(`while cursor < ${packEndVar}`, indentLevel + 1));
      lines.push(indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel + 2));
      lines.push(indent("cursor = valueResult.nextIndex", indentLevel + 2));
      lines.push(indent("numericValue = __pb_toSigned32FromString(valueResult.value)", indentLevel + 2));
      lines.push(indent(`${valuesVar}.Push(${enumNameFn}(numericValue))`, indentLevel + 2));
      lines.push(indent("end while", indentLevel + 1));
    }
    lines.push(indent("else", indentLevel));
    lines.push(...renderUnknownFieldHandler(indentLevel + 1));
    lines.push(indent("end if", indentLevel));
  } else {
    lines.push(indent(`if wireType = ${field.wireType} then`, indentLevel));
    lines.push(indent("valueResult = __pb_readVarint64(bytes, cursor)", indentLevel + 1));
    lines.push(indent("cursor = valueResult.nextIndex", indentLevel + 1));
    lines.push(indent("numericValue = __pb_toSigned32FromString(valueResult.value)", indentLevel + 1));
    lines.push(indent(`message.${field.name} = ${enumNameFn}(numericValue)`, indentLevel + 1));
    lines.push(indent("else", indentLevel));
    lines.push(...renderUnknownFieldHandler(indentLevel + 1));
    lines.push(indent("end if", indentLevel));
  }

  return lines;
}

function renderUnknownFieldHandler(indentLevel: number): string[] {
  return [
    indent("nextIndex = __pb_handleUnknownField(message, bytes, tagStart)", indentLevel),
    indent("if nextIndex <= tagStart then exit while", indentLevel),
    indent("cursor = nextIndex", indentLevel)
  ];
}

function renderEnumHelperFunctions(descriptor: MessageDescriptor): string[] {
  const lines: string[] = [];
  const processed = new Set<string>();

  for (const field of descriptor.fields) {
    if (field.kind !== "enum") {
      continue;
    }
    const key = `${descriptor.name}_${field.name}`;
    if (processed.has(key)) {
      continue;
    }
    processed.add(key);

    const normalizeFn = buildEnumNormalizeFunctionName(descriptor, field);
    const nameFn = buildEnumNameFunctionName(descriptor, field);
    const valuesFn = buildEnumValuesFunctionName(descriptor, field);
    const namesFn = buildEnumNamesFunctionName(descriptor, field);

    lines.push(`function ${normalizeFn}(value as Dynamic) as Integer`);
    lines.push(indent(`values = ${valuesFn}()`, 1));
    lines.push(indent("if value = invalid then return 0", 1));
    lines.push(indent("valueType = Type(value)", 1));
    lines.push(indent('if valueType = "String" or valueType = "roString" then', 1));
    lines.push(indent("upper = UCase(value)", 2));
    lines.push(indent("if values.DoesExist(upper) then", 2));
    lines.push(indent("return values[upper]", 3));
    lines.push(indent("end if", 2));
    lines.push(indent("return 0", 2));
    lines.push(indent("end if", 1));
    lines.push(indent("return Int(value)", 1));
    lines.push("end function");
    lines.push("");

    lines.push(`function ${nameFn}(value as Integer) as Dynamic`);
    lines.push(indent(`names = ${namesFn}()`, 1));
    lines.push(indent("key = StrI(value, 10)", 1));
    lines.push(indent("if names.DoesExist(key) then", 1));
    lines.push(indent("return names[key]", 2));
    lines.push(indent("end if", 1));
    lines.push(indent("return value", 1));
    lines.push("end function");
    lines.push("");

    lines.push(`function ${valuesFn}() as Object`);
    lines.push(indent("globalAA = GetGlobalAA()", 1));
    lines.push(indent(`key = "${descriptor.name}_${field.name}_EnumValues"`, 1));
    lines.push(indent("if globalAA <> invalid and globalAA.DoesExist(key) then", 1));
    lines.push(indent("return globalAA[key]", 2));
    lines.push(indent("end if", 1));
    lines.push(indent("table = {}", 1));
    const entries = Object.entries(field.enumInfo.values).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [enumKey, value] of entries) {
      lines.push(indent(`table["${enumKey}"] = ${value}`, 1));
    }
    lines.push(indent("if globalAA <> invalid then globalAA[key] = table", 1));
    lines.push(indent("return table", 1));
    lines.push("end function");
    lines.push("");

    lines.push(`function ${namesFn}() as Object`);
    lines.push(indent("globalAA = GetGlobalAA()", 1));
    lines.push(indent(`key = "${descriptor.name}_${field.name}_EnumNames"`, 1));
    lines.push(indent("if globalAA <> invalid and globalAA.DoesExist(key) then", 1));
    lines.push(indent("return globalAA[key]", 2));
    lines.push(indent("end if", 1));
    lines.push(indent("table = {}", 1));
    const nameEntries = Object.entries(field.enumInfo.valuesById).sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [enumId, name] of nameEntries) {
      lines.push(indent(`table["${enumId}"] = "${name}"`, 1));
    }
    lines.push(indent("if globalAA <> invalid then globalAA[key] = table", 1));
    lines.push(indent("return table", 1));
    lines.push("end function");
    lines.push("");
  }

  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function buildEnumNormalizeFunctionName(descriptor: MessageDescriptor, field: Extract<MessageFieldDescriptor, { kind: "enum" }>): string {
  return `${descriptor.name}_${sanitizeIdentifier(field.name)}_normalizeEnum`;
}

function buildEnumNameFunctionName(descriptor: MessageDescriptor, field: Extract<MessageFieldDescriptor, { kind: "enum" }>): string {
  return `${descriptor.name}_${sanitizeIdentifier(field.name)}_enumName`;
}

function buildEnumValuesFunctionName(descriptor: MessageDescriptor, field: Extract<MessageFieldDescriptor, { kind: "enum" }>): string {
  return `${descriptor.name}_${sanitizeIdentifier(field.name)}_getEnumValues`;
}

function buildEnumNamesFunctionName(descriptor: MessageDescriptor, field: Extract<MessageFieldDescriptor, { kind: "enum" }>): string {
  return `${descriptor.name}_${sanitizeIdentifier(field.name)}_getEnumNames`;
}

function createFieldVariableNames(fieldName: string) {
  const base = sanitizeIdentifier(fieldName);
  return {
    base,
    value: `field_${base}`
  };
}

function sanitizeIdentifier(name: string): string {
  let cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (cleaned.length === 0) {
    cleaned = "field";
  }
  if (/^[0-9]/.test(cleaned)) {
    cleaned = `_${cleaned}`;
  }
  return cleaned;
}

function indent(line: string, level: number): string {
  if (line.length === 0) {
    return "";
  }
  return `${"    ".repeat(level)}${line}`;
}

function renderReadme(protoFiles: string[], messageNames: string[]): string {
  const lines: string[] = [
    "# Generated BrightScript code",
    "",
    "Files in this directory are produced by protoc-gen-brs.",
    "",
    "## Proto inputs",
    ...protoFiles.map((fileName) => `- ${fileName}`),
    "",
    "## Generated messages",
    messageNames.length > 0 ? messageNames.map((name) => `- ${name}`).join("\n") : "- (none detected)",
    "",
    "Regenerate with:",
    "",
    "```bash",
    "npm run generate:brs -- --proto proto",
    "```",
    ""
  ];

  return lines.join("\n");
}
