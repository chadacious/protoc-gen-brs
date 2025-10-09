import path from "node:path";
import fs from "fs-extra";
import { loadProtoBundle } from "./protoLoader";
import { collectSimpleScalarMessages, SimpleScalarMessageDescriptor } from "./schemaUtils";

export interface GenerateBrightScriptOptions {
  protoPaths: string[];
  outputDir: string;
  configPath?: string;
}

export async function generateBrightScriptArtifacts(options: GenerateBrightScriptOptions) {
  const resolvedOutput = path.resolve(options.outputDir);
  await fs.ensureDir(resolvedOutput);

  const bundle = await loadProtoBundle(options.protoPaths);
  const simpleMessages = collectSimpleScalarMessages(bundle.root);

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
      renderScalarMessageModule(descriptor),
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
  return String.raw`' Auto-generated BrightScript runtime helpers for protoc-gen-brs
function __pb_createByteArray() as Object
    return CreateObject("roByteArray")
end function

function __pb_writeVarint(target as Object, value as Integer) as Void
    v = value
    if v < 0 then v = 0
    while v >= 128
        byte = (v AND &h7F) OR &h80
        target.Push(byte)
        v = Int(v / 128)
    end while
    target.Push(v)
end function

function __pb_writeVarint64(target as Object, value as Dynamic) as Void
    longVal = CDbl(__pb_toLong(value))
    if longVal < 0 then
        longVal = longVal + 18446744073709551616#
    end if
    while longVal >= 128
        remainder = longVal - 128 * Fix(longVal / 128)
        byte = Int(remainder) + 128
        target.Push(byte)
        longVal = Fix(longVal / 128)
    end while
    target.Push(Int(longVal))
end function

function __pb_appendByteArray(target as Object, source as Object) as Void
    for i = 0 to source.Count() - 1
        target.Push(source[i])
    end for
end function

function __pb_toBase64(bytes as Object) as String
    return bytes.ToBase64String()
end function

function __pb_fromBase64(encoded as String) as Object
    ba = CreateObject("roByteArray")
    ba.FromBase64String(encoded)
    return ba
end function

function __pb_readVarint(bytes as Object, startIndex as Integer) as Object
    result = {}
    shift = 0
    value = 0
    index = startIndex
    count = bytes.Count()
    while index < count
        byte = bytes[index]
        value = value + ((byte AND &h7F) * (2 ^ shift))
        shift = shift + 7
        index = index + 1
        if (byte AND &h80) = 0 then exit while
    end while
    result.value = value
    result.nextIndex = index
    return result
end function

function __pb_readVarint64(bytes as Object, startIndex as Integer) as Object
    result = {}
    shift = 0
    value = 0.0
    index = startIndex
    count = bytes.Count()
    while index < count
        byte = bytes[index]
        value = value + ((byte AND &h7F) * (2 ^ shift))
        shift = shift + 7
        index = index + 1
        if (byte AND &h80) = 0 then exit while
    end while
    result.value = __pb_toDecimalString(value)
    result.nextIndex = index
    return result
end function

function __pb_readString(bytes as Object, startIndex as Integer, length as Integer) as String
    text = ""
    for i = 0 to length - 1
        text = text + Chr(bytes[startIndex + i])
    end for
    return text
end function

function __pb_readBytes(bytes as Object, startIndex as Integer, length as Integer) as Object
    slice = __pb_createByteArray()
    for i = 0 to length - 1
        slice.Push(bytes[startIndex + i])
    end for
    return slice
end function

function __pb_byteArrayToBase64(bytes as Object) as String
    if bytes = invalid then return ""
    return bytes.ToBase64String()
end function

function __pb_toLong(value as Dynamic) as Double
    if value = invalid then return 0
    valueType = Type(value)
    if valueType = "String" or valueType = "roString" then
        return Val(value)
    else if valueType = "Boolean" or valueType = "roBoolean" then
        if value = true then return 1 else return 0
    end if
    return value
end function

function __pb_toDecimalString(value as Double) as String
    if value = 0 then return "0"
    digits = ""
    current = Fix(value)
    while current > 0
        remainder = current - 10 * Fix(current / 10)
        digits = Chr(48 + Int(remainder)) + digits
        current = Fix(current / 10)
    end while
    return digits
end function

sub __pb_registerRuntime()
    globalAA = GetGlobalAA()
    if globalAA = invalid then return
    globalAA.__pb_createByteArray = __pb_createByteArray
    globalAA.__pb_writeVarint = __pb_writeVarint
    globalAA.__pb_writeVarint64 = __pb_writeVarint64
    globalAA.__pb_appendByteArray = __pb_appendByteArray
    globalAA.__pb_toBase64 = __pb_toBase64
    globalAA.__pb_fromBase64 = __pb_fromBase64
    globalAA.__pb_readVarint = __pb_readVarint
    globalAA.__pb_readVarint64 = __pb_readVarint64
    globalAA.__pb_readString = __pb_readString
    globalAA.__pb_readBytes = __pb_readBytes
    globalAA.__pb_byteArrayToBase64 = __pb_byteArrayToBase64
    globalAA.__pb_toLong = __pb_toLong
    globalAA.__pb_toDecimalString = __pb_toDecimalString
end sub`;
}

function renderScalarMessageModule(descriptor: SimpleScalarMessageDescriptor): string {
  const typeName = descriptor.type.name;
  const fieldName = descriptor.field.name;
  const fieldId = descriptor.field.id;

  if (descriptor.scalarType === "string") {
    const tag = (fieldId << 3) | 2;
    return [
      `' Auto-generated encoder/decoder for ${typeName}`,
      `function ${typeName}Encode(message as Object) as String`,
      "    value = \"\"",
      "    if message <> invalid then",
      "        if GetInterface(message, \"ifAssociativeArray\") <> invalid then",
      `            existing = message.Lookup(\"${fieldName}\")`,
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
    ].join("\n");
  }

  if (descriptor.scalarType === "int32") {
    const tag = (fieldId << 3) | 0;
    return [
      `' Auto-generated encoder/decoder for ${typeName}`,
      `function ${typeName}Encode(message as Object) as String`,
      "    value = 0",
      "    if message <> invalid then",
      "        if GetInterface(message, \"ifAssociativeArray\") <> invalid then",
      `            existing = message.Lookup(\"${fieldName}\")`,
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
      "    value = Int(value)",
      "",
      "    bytes = __pb_createByteArray()",
      `    __pb_writeVarint(bytes, ${tag})`,
      "    __pb_writeVarint(bytes, value)",
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
      `        if fieldNumber = ${fieldId} and wireType = 0 then`,
      "            valueResult = __pb_readVarint(bytes, cursor)",
      "            cursor = valueResult.nextIndex",
      `            message.${fieldName} = valueResult.value`,
      "        else",
      "            exit while",
      "        end if",
      "    end while",
      "    return message",
      "end function",
      ""
    ].join("\n");
  }

  if (descriptor.scalarType === "int64") {
    const tag = (fieldId << 3) | 0;
    return [
      `' Auto-generated encoder/decoder for ${typeName}`,
      `function ${typeName}Encode(message as Object) as String`,
      "    value = 0",
      "    if message <> invalid then",
      "        if GetInterface(message, \"ifAssociativeArray\") <> invalid then",
      `            existing = message.Lookup(\"${fieldName}\")`,
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
      "    value = __pb_toLong(value)",
      "",
      "    bytes = __pb_createByteArray()",
      `    __pb_writeVarint(bytes, ${tag})`,
      "    __pb_writeVarint64(bytes, value)",
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
      `        if fieldNumber = ${fieldId} and wireType = 0 then`,
      "            valueResult = __pb_readVarint64(bytes, cursor)",
      "            cursor = valueResult.nextIndex",
      `            message.${fieldName} = valueResult.value`,
      "        else",
      "            exit while",
      "        end if",
      "    end while",
      "    return message",
      "end function",
      ""
    ].join("\n");
  }

  if (descriptor.scalarType === "bool") {
    const tag = (fieldId << 3) | 0;
    return [
      `' Auto-generated encoder/decoder for ${typeName}`,
      `function ${typeName}Encode(message as Object) as String`,
      "    value = false",
      "    if message <> invalid then",
      "        if GetInterface(message, \"ifAssociativeArray\") <> invalid then",
      `            existing = message.Lookup(\"${fieldName}\")`,
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
      "    valueType = Type(value)",
      "    if valueType = \"String\" or valueType = \"roString\" then",
      "        lower = LCase(value)",
      "        value = (lower = \"true\") or (lower = \"1\")",
      "    else if valueType = \"Boolean\" or valueType = \"roBoolean\" then",
      "        ' keep as is",
      "    else",
      "        value = (value <> 0)",
      "    end if",
      "",
      "    bytes = __pb_createByteArray()",
      `    __pb_writeVarint(bytes, ${tag})`,
      "    boolInt = 0",
      "    if value = true then boolInt = 1",
      "    __pb_writeVarint(bytes, boolInt)",
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
      `        if fieldNumber = ${fieldId} and wireType = 0 then`,
      "            valueResult = __pb_readVarint(bytes, cursor)",
      "            cursor = valueResult.nextIndex",
      `            message.${fieldName} = (valueResult.value <> 0)`,
      "        else",
      "            exit while",
      "        end if",
      "    end while",
      "    return message",
      "end function",
      ""
    ].join("\n");
  }

  if (descriptor.scalarType === "bytes") {
    const tag = (fieldId << 3) | 2;
    return [
      `' Auto-generated encoder/decoder for ${typeName}`,
      `function ${typeName}Encode(message as Object) as String`,
      "    value = invalid",
      "    if message <> invalid then",
      "        if GetInterface(message, \"ifAssociativeArray\") <> invalid then",
      `            value = message.Lookup(\"${fieldName}\")`,
      "        else",
      `            value = message.${fieldName}`,
      "        end if",
      "    end if",
      "    dataBytes = __pb_createByteArray()",
      "    if value <> invalid then",
      "        valueType = Type(value)",
      "        if valueType = \"String\" or valueType = \"roString\" then",
      "            dataBytes.FromBase64String(value)",
      "        else if valueType = \"roByteArray\" then",
      "            __pb_appendByteArray(dataBytes, value)",
      "        end if",
      "    end if",
      "",
      "    bytes = __pb_createByteArray()",
      `    __pb_writeVarint(bytes, ${tag})`,
      "    __pb_writeVarint(bytes, dataBytes.Count())",
      "    __pb_appendByteArray(bytes, dataBytes)",
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
      "            dataLength = lengthResult.value",
      "            rawBytes = __pb_readBytes(bytes, cursor, dataLength)",
      "            cursor = cursor + dataLength",
      `            message.${fieldName} = __pb_byteArrayToBase64(rawBytes)`,
      "        else",
      "            exit while",
      "        end if",
      "    end while",
      "    return message",
      "end function",
      ""
    ].join("\n");
  }

  throw new Error(`Unsupported scalar type: ${descriptor.scalarType}`);
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
