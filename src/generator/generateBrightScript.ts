import path from "node:path";
import fs from "fs-extra";
import { loadProtoBundle } from "./protoLoader";
import { collectSimpleStringMessages } from "./schemaUtils";

export interface GenerateBrightScriptOptions {
  protoPaths: string[];
  outputDir: string;
  configPath?: string;
}

export async function generateBrightScriptArtifacts(options: GenerateBrightScriptOptions) {
  const resolvedOutput = path.resolve(options.outputDir);
  await fs.ensureDir(resolvedOutput);

  const bundle = await loadProtoBundle(options.protoPaths);
  const simpleMessages = collectSimpleStringMessages(bundle.root);

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

  for (const descriptor of simpleMessages) {
    const messagePath = path.join(messagesDir, `${descriptor.type.name}.brs`);
    await fs.writeFile(
      messagePath,
      renderSimpleStringMessageModule(descriptor.type.name, descriptor.field.name, descriptor.field.id),
      "utf8"
    );

    registryLines.push(
      `    handler${descriptor.type.name} = {}`,
      `    handler${descriptor.type.name}.encode = ${descriptor.type.name}Encode`,
      `    handler${descriptor.type.name}.decode = ${descriptor.type.name}Decode`,
      `    handlers.${descriptor.type.name} = handler${descriptor.type.name}`
    );
  }

  registryLines.push("    return handlers", "end function", "");
  const registryPath = path.join(resolvedOutput, "messages", "__index.brs");
  await fs.writeFile(registryPath, registryLines.join("\n"), "utf8");

  const summaryPath = path.join(resolvedOutput, "README.md");
  await fs.writeFile(summaryPath, renderReadme(bundle.files, simpleMessages.map((item) => item.type.name)), "utf8");

  const embeddedOutputDir = path.resolve("roku-app/source/generated");
  await fs.ensureDir(embeddedOutputDir);
  await fs.emptyDir(embeddedOutputDir);

  const files = await fs.readdir(resolvedOutput);
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

function renderRuntimeModule(): string {
  return [
    "' Auto-generated BrightScript runtime helpers for protoc-gen-brs",
    "function __pb_createByteArray() as Object",
    "    return CreateObject(\"roByteArray\")",
    "end function",
    "",
    "function __pb_writeVarint(target as Object, value as Integer) as Void",
    "    v = value",
    "    if v < 0 then v = 0",
    "    while v >= 128",
    "        byte = (v AND &h7F) OR &h80",
    "        target.Push(byte)",
    "        v = Int(v / 128)",
    "    end while",
    "    target.Push(v)",
    "end function",
    "",
    "function __pb_appendByteArray(target as Object, source as Object) as Void",
    "    for i = 0 to source.Count() - 1",
    "        target.Push(source[i])",
    "    end for",
    "end function",
    "",
    "function __pb_toBase64(bytes as Object) as String",
    "    return bytes.ToBase64String()",
    "end function",
    "",
    "function __pb_fromBase64(encoded as String) as Object",
    "    ba = CreateObject(\"roByteArray\")",
    "    ba.FromBase64String(encoded)",
    "    return ba",
    "end function",
    "",
    "function __pb_readVarint(bytes as Object, startIndex as Integer) as Object",
    "    result = {}",
    "    shift = 0",
    "    value = 0",
    "    index = startIndex",
    "    count = bytes.Count()",
    "    while index < count",
    "        byte = bytes[index]",
    "        value = value + ((byte AND &h7F) * (2 ^ shift))",
    "        shift = shift + 7",
    "        index = index + 1",
    "        if (byte AND &h80) = 0 then exit while",
    "    end while",
    "    result.value = value",
    "    result.nextIndex = index",
    "    return result",
    "end function",
    "",
    "function __pb_readString(bytes as Object, startIndex as Integer, length as Integer) as String",
    "    text = \"\"",
    "    for i = 0 to length - 1",
    "        text = text + Chr(bytes[startIndex + i])",
    "    end for",
    "    return text",
    "end function",
    "",
    "sub __pb_registerRuntime()",
    "    globalAA = GetGlobalAA()",
    "    if globalAA = invalid then return",
    "    globalAA.__pb_createByteArray = __pb_createByteArray",
    "    globalAA.__pb_writeVarint = __pb_writeVarint",
    "    globalAA.__pb_appendByteArray = __pb_appendByteArray",
    "    globalAA.__pb_toBase64 = __pb_toBase64",
    "    globalAA.__pb_fromBase64 = __pb_fromBase64",
    "    globalAA.__pb_readVarint = __pb_readVarint",
    "    globalAA.__pb_readString = __pb_readString",
    "end sub"
  ].join("\n");
}

function renderSimpleStringMessageModule(typeName: string, fieldName: string, fieldId: number): string {
  const tag = (fieldId << 3) | 2;
  const lines = [
    `' Auto-generated encoder/decoder for ${typeName}`,
    `function ${typeName}Encode(message as Object) as String`,
    "    value = \"\"",
    "    if message <> invalid then",
    "        if GetInterface(message, \"ifAssociativeArray\") <> invalid then",
    `            existing = message.Lookup("${fieldName}")`,
    "            if existing <> invalid then",
    "                value = existing",
    "            end if",
    "        else",
    `            candidate = message.${fieldName}`,
    "            if candidate <> invalid then",
    "                value = candidate",
    "            end if",
    "        end if",
    "    end if",
    "",
    "    bytes = __pb_createByteArray()",
    `    __pb_writeVarint(bytes, ${tag})`,
    "    strBytes = __pb_createByteArray()",
    "    strBytes.FromAsciiString(value)",
    "    __pb_writeVarint(bytes, strBytes.Count())",
    "    __pb_appendByteArray(bytes, strBytes)",
    "    return __pb_toBase64(bytes)",
    "end function",
    "",
    `function ${typeName}Decode(encoded as String) as Object`,
    "    bytes = __pb_fromBase64(encoded)",
    "    cursor = 0",
    "    limit = bytes.Count()",
    "    message = {}",
    "    while cursor < limit",
    "        tagResult = __pb_readVarint(bytes, cursor)",
    "        cursor = tagResult.nextIndex",
    "        fieldNumber = Int(tagResult.value / 8)",
    "        wireType = tagResult.value AND &h07",
    `        if fieldNumber = ${fieldId} and wireType = 2 then`,
    "            lengthResult = __pb_readVarint(bytes, cursor)",
    "            cursor = lengthResult.nextIndex",
    "            strLength = lengthResult.value",
    "            fieldValue = __pb_readString(bytes, cursor, strLength)",
    "            cursor = cursor + strLength",
    `            message.${fieldName} = fieldValue`,
    "        else",
    "            exit while",
    "        end if",
    "    end while",
    "    return message",
    "end function",
    ""
  ];

  return lines.join("\n");
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
    "## Supported messages",
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
