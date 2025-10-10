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
  const base = String.raw`' Auto-generated BrightScript runtime helpers for protoc-gen-brs
function __pb_createByteArray() as Object
    return CreateObject("roByteArray")
end function

function __pb_truncate(value as Double) as Double
    if value = invalid then return 0
    remainder = value MOD 1
    return value - remainder
end function

function __pb_writeVarint(target as Object, value as Dynamic) as Void
    if target = invalid then return
    if value = invalid then return
    v = __pb_truncate(value)
    if v < 0 then
        unsigned32 = 4294967296# + v
        __pb_writeVarint64(target, unsigned32)
        return
    end if
    decimalValue = __pb_doubleToDecimalString(v)
    __pb_writeVarint64(target, decimalValue)
end function

function __pb_trimLeadingZeros(value as String) as String
    if value = invalid then return "0"
    valueType = Type(value)
    if valueType <> "String" and valueType <> "roString" then
        value = value + ""
    end if
    digits = CreateObject("roByteArray")
    digits.FromAsciiString(value)
    count = digits.Count()
    if count = 0 then return "0"
    zero = 48
    index = 0
    while index < count and digits[index] = zero
        index = index + 1
    end while
    if index >= count then return "0"
    if index = 0 then return value
    trimmed = CreateObject("roByteArray")
    for i = index to count - 1
        trimmed.Push(digits[i])
    end for
    return trimmed.ToAsciiString()
end function

function __pb_allDigits(value as String) as Boolean
    if value = invalid then return false
    valueType = Type(value)
    if valueType <> "String" and valueType <> "roString" then
        value = value + ""
    end if
    digits = CreateObject("roByteArray")
    digits.FromAsciiString(value)
    count = digits.Count()
    if count = 0 then return false
    zero = 48
    nine = 57
    for i = 0 to count - 1
        code = digits[i]
        if code < zero or code > nine then return false
    end for
    return true
end function

function __pb_doubleToDecimalString(num as Double) as String
    if num = 0 then return "0"
    strValue = FormatJson(num)
    strType = Type(strValue)
    if strType = "String" or strType = "roString" then
        cleaned = strValue.Trim()
        cleaned = cleaned.Replace(Chr(13), "")
        cleaned = cleaned.Replace(Chr(10), "")
        if cleaned <> "" then
            first = Left(cleaned, 1)
            if first = "+"
                cleaned = Mid(cleaned, 2)
            else if first = "-"
                cleaned = Mid(cleaned, 2)
                ' negative numbers handled by caller
            end if
            if InStr(1, LCase(cleaned), "e") = 0 and InStr(1, cleaned, ".") = 0 and __pb_allDigits(cleaned) then
                return __pb_trimLeadingZeros(cleaned)
            end if
        end if
    end if
    current = __pb_truncate(num)
    digits = ""
    while current > 0
        remainder = current MOD 10
        digits = Chr(remainder + 48) + digits
        current = __pb_truncate(current / 10)
    end while
    if digits = "" then digits = "0"
    return __pb_trimLeadingZeros(digits)
end function

function __pb_normalizeUnsignedDecimal(value as Dynamic) as Dynamic
    if value = invalid then return invalid
    valueType = Type(value)
    if valueType = "String" or valueType = "roString" then
        str = value.Trim()
        if str = "" then return invalid
        first = Left(str, 1)
        if first = "+"
            str = Mid(str, 2)
        else if first = "-"
            return invalid
        end if
        if not __pb_allDigits(str) then return invalid
        return __pb_trimLeadingZeros(str)
    else if valueType = "Boolean" or valueType = "roBoolean" then
        if value = true then return "1" else return "0"
    end if
    num = __pb_toLong(value)
    if num < 0 then return invalid
    return __pb_doubleToDecimalString(num)
end function

function __pb_decimalDivMod(value as String, divisor as Integer) as Object
    valueType = Type(value)
    if valueType <> "String" and valueType <> "roString" then
        value = value + ""
    end if
    digits = CreateObject("roByteArray")
    digits.FromAsciiString(value)
    remainder = 0
    quotient = CreateObject("roByteArray")
    count = digits.Count()
    zero = 48
    for i = 0 to count - 1
        digit = digits[i] - zero
        remainder = remainder * 10 + digit
        qdigit = 0
        while remainder >= divisor
            remainder = remainder - divisor
            qdigit = qdigit + 1
        end while
        if quotient.Count() > 0 or qdigit <> 0 then
            quotient.Push(qdigit + zero)
        end if
    end for
    if quotient.Count() = 0 then
        quotient.Push(zero)
    end if
    result = {}
    result.quotient = quotient.ToAsciiString()
    result.remainder = remainder
    return result
end function

function __pb_buildVarintFromDecimal(value as String) as Object
    bytes = []
    if value = "0" then
        bytes.Push(0)
        return bytes
    end if
    current = value
    while current <> "0"
        parts = __pb_decimalDivMod(current, 128)
        bytes.Push(__pb_truncate(parts.remainder))
        current = parts.quotient
    end while
    count = bytes.Count()
    for i = 0 to count - 2
        bytes[i] = (bytes[i] OR &h80) AND &hFF
    end for
    return bytes
end function

function __pb_writeVarint64(target as Object, value as Dynamic) as Void
    if target = invalid then return
    normalized = __pb_normalizeUnsignedDecimal(value)
    if normalized = invalid then
        valueType = Type(value)
        if valueType = "String" or valueType = "roString" then
            str = value.Trim()
            if str = "" then return
            negative = false
            first = Left(str, 1)
            if first = "-"
                negative = true
                str = Mid(str, 2)
            else if first = "+"
                str = Mid(str, 2)
            end if
            str = str.Trim()
            if str = "" then return
            if not __pb_allDigits(str) then return
            trimmed = __pb_trimLeadingZeros(str)
            if trimmed = "0" then
                normalized = "0"
            else if negative then
                normalized = __pb_decimalSubtract("18446744073709551616", trimmed)
            else
                normalized = trimmed
            end if
        else
            num = __pb_toLong(value)
            if num < 0 then
                magnitude = __pb_doubleToDecimalString(0 - num)
                normalized = __pb_decimalSubtract("18446744073709551616", magnitude)
            else
                normalized = __pb_doubleToDecimalString(num)
            end if
        end if
    end if
    bytes = __pb_buildVarintFromDecimal(normalized)
    for i = 0 to bytes.Count() - 1
        target.Push(bytes[i])
    end for
end function

function __pb_encodeZigZag32(value as Integer) as String
    if value >= 0 then
        magnitude = __pb_doubleToDecimalString(value)
        return __pb_trimLeadingZeros(__pb_decimalMultiplyBySmall(magnitude, 2))
    end if
    magnitude = __pb_doubleToDecimalString(0 - value)
    doubled = __pb_decimalMultiplyBySmall(magnitude, 2)
    return __pb_trimLeadingZeros(__pb_decimalSubtract(doubled, "1"))
end function

function __pb_decodeZigZag32(value as String) as Double
    if value = invalid then return 0
    unsignedStr = __pb_trimLeadingZeros(value)
    parts = __pb_decimalDivMod(unsignedStr, 2)
    quotient = __pb_trimLeadingZeros(parts.quotient)
    if parts.remainder = 0 then
        return __pb_parseDecimalToDouble(quotient)
    end if
    negMag = __pb_decimalAdd(quotient, "1")
    return 0 - __pb_parseDecimalToDouble(negMag)
end function

function __pb_toUnsigned32(value as Dynamic) as Double
    if value = invalid then return 0
    result = value + 0.0
    if result < 0 then
        result = result + 4294967296#
    end if
    return result
end function

function __pb_toSigned32(value as Dynamic) as Double
    if value = invalid then return 0
    result = __pb_toUnsigned32(value)
    if result >= 2147483648# then
        result = result - 4294967296#
    end if
    return result
end function

function __pb_toSigned32FromString(value as String) as Double
    trimmed = __pb_trimLeadingZeros(value)
    if trimmed = "0" then return 0
    if __pb_decimalCompare(trimmed, "2147483647") <= 0 then
        return __pb_parseDecimalToDouble(trimmed)
    end if
    magnitude = __pb_decimalSubtract("4294967296", trimmed)
    return 0 - __pb_parseDecimalToDouble(magnitude)
end function

function __pb_parseDecimalToDouble(value as String) as Double
    if value = invalid then return 0
    str = value.Trim()
    if str = "" then return 0
    sign = 1.0
    if Left(str, 1) = "-" then
        sign = -1.0
        str = Mid(str, 2)
    else if Left(str, 1) = "+" then
        str = Mid(str, 2)
    end if
    digitsStr = __pb_trimLeadingZeros(str)
    if digitsStr = "0" then return 0
    result = 0.0
    length = Len(digitsStr)
    for i = 0 to length - 1
        digitChar = Mid(digitsStr, i + 1, 1)
        digitVal = Asc(digitChar) - Asc("0")
        result = result * 10 + digitVal
    end for
    return sign * result
end function

function __pb_encodeZigZag64(value as Dynamic) as String
    valueType = Type(value)
    valueStr = "0"
    if valueType = "String" or valueType = "roString" then
        valueStr = value.Trim()
        if valueStr = "" then valueStr = "0"
    else
        valueStr = __pb_toDecimalString(value)
    end if
    if Left(valueStr, 1) = "+" then
        valueStr = Mid(valueStr, 2)
    end if
    if Left(valueStr, 1) = "-" then
        magnitude = Mid(valueStr, 2)
        magnitude = __pb_trimLeadingZeros(magnitude)
        twice = __pb_decimalMultiplyBySmall(magnitude, 2)
        encoded = __pb_decimalSubtract(twice, "1")
    else
        magnitude = __pb_trimLeadingZeros(valueStr)
        encoded = __pb_decimalMultiplyBySmall(magnitude, 2)
    end if
    return __pb_trimLeadingZeros(encoded)
end function

function __pb_decodeZigZag64(value as String) as String
    trimmed = __pb_trimLeadingZeros(value)
    if trimmed = "0" then return "0"
    parts = __pb_decimalDivMod(trimmed, 2)
    if parts.remainder = 0 then
        return __pb_trimLeadingZeros(parts.quotient)
    end if
    incremented = __pb_decimalAdd(trimmed, "1")
    halfParts = __pb_decimalDivMod(incremented, 2)
    return "-" + __pb_trimLeadingZeros(halfParts.quotient)
end function

function __pb_decimalAdd(a as String, b as String) as String
    aTrim = __pb_trimLeadingZeros(a)
    bTrim = __pb_trimLeadingZeros(b)
    aBytes = CreateObject("roByteArray")
    aBytes.FromAsciiString(aTrim)
    bBytes = CreateObject("roByteArray")
    bBytes.FromAsciiString(bTrim)
    zero = 48
    carry = 0
    digits = []
    i = aBytes.Count() - 1
    j = bBytes.Count() - 1
    while i >= 0 or j >= 0 or carry > 0
        digitA = 0
        if i >= 0 then
            digitA = aBytes[i] - zero
            i = i - 1
        end if
        digitB = 0
        if j >= 0 then
            digitB = bBytes[j] - zero
            j = j - 1
        end if
        total = digitA + digitB + carry
        digits.Push((total MOD 10) + zero)
        carry = Int(total / 10)
    end while
    resultBytes = CreateObject("roByteArray")
    for k = digits.Count() - 1 to 0 step -1
        resultBytes.Push(digits[k])
    end for
    return resultBytes.ToAsciiString()
end function

function __pb_decimalCompare(a as String, b as String) as Integer
    aTrim = __pb_trimLeadingZeros(a)
    bTrim = __pb_trimLeadingZeros(b)
    aBytes = CreateObject("roByteArray")
    aBytes.FromAsciiString(aTrim)
    bBytes = CreateObject("roByteArray")
    bBytes.FromAsciiString(bTrim)
    lenA = aBytes.Count()
    lenB = bBytes.Count()
    if lenA > lenB then return 1
    if lenA < lenB then return -1
    for i = 0 to lenA - 1
        digitA = aBytes[i]
        digitB = bBytes[i]
        if digitA > digitB then return 1
        if digitA < digitB then return -1
    end for
    return 0
end function

function __pb_decimalSubtract(a as String, b as String) as String
    if __pb_decimalCompare(a, b) < 0 then return "0"
    aTrim = __pb_trimLeadingZeros(a)
    bTrim = __pb_trimLeadingZeros(b)
    aBytes = CreateObject("roByteArray")
    aBytes.FromAsciiString(aTrim)
    bBytes = CreateObject("roByteArray")
    bBytes.FromAsciiString(bTrim)
    zero = 48
    borrow = 0
    digits = []
    i = aBytes.Count() - 1
    j = bBytes.Count() - 1
    while i >= 0
        digitA = aBytes[i] - zero - borrow
        borrow = 0
        digitB = 0
        if j >= 0 then
            digitB = bBytes[j] - zero
            j = j - 1
        end if
        digitA = digitA - digitB
        if digitA < 0 then
            digitA = digitA + 10
            borrow = 1
        end if
        digits.Push(digitA + zero)
        i = i - 1
    end while
    while digits.Count() > 1 and digits[digits.Count() - 1] = zero
        digits.Pop()
    end while
    resultBytes = CreateObject("roByteArray")
    for k = digits.Count() - 1 to 0 step -1
        resultBytes.Push(digits[k])
    end for
    return resultBytes.ToAsciiString()
end function

function __pb_decimalMultiplyBySmall(value as String, factor as Integer) as String
    base = __pb_trimLeadingZeros(value)
    if factor = 0 or base = "0" then return "0"
    digits = CreateObject("roByteArray")
    digits.FromAsciiString(base)
    carry = 0
    zero = 48
    resultDigits = []
    for i = digits.Count() - 1 to 0 step -1
        digit = digits[i] - zero
        total = digit * factor + carry
        resultDigits.Push((total MOD 10) + zero)
        carry = Int(total / 10)
    end for
    while carry > 0
        resultDigits.Push((carry MOD 10) + zero)
        carry = Int(carry / 10)
    end while
    resultBytes = CreateObject("roByteArray")
    for k = resultDigits.Count() - 1 to 0 step -1
        resultBytes.Push(resultDigits[k])
    end for
    return resultBytes.ToAsciiString()
end function

function __pb_decimalMultiplyBy128(value as String) as String
    result = __pb_trimLeadingZeros(value)
    if result = "0" then return "0"
    for i = 1 to 7
        result = __pb_decimalMultiplyBySmall(result, 2)
    end for
    return __pb_trimLeadingZeros(result)
end function

function __pb_toSignedInt64String(unsigned as String) as String
    if unsigned = invalid then return "0"
    trimmed = __pb_trimLeadingZeros(unsigned)
    if trimmed = "0" then return "0"
    threshold = "9223372036854775807"
    comparison = __pb_decimalCompare(trimmed, threshold)
    if comparison <= 0 then return trimmed
    diff = __pb_decimalSubtract("18446744073709551616", trimmed)
    if diff = "0" then return "0"
    return "-" + diff
end function

function __pb_decodeVarintToDecimalString(bytes as Object) as String
    result = "0"
    multiplier = "1"
    count = bytes.Count()
    for i = 0 to count - 1
        byteVal = bytes[i]
        chunk = byteVal AND &h7F
        if chunk > 0 then
            term = __pb_decimalMultiplyBySmall(multiplier, chunk)
            result = __pb_decimalAdd(result, term)
        end if
        if (byteVal AND &h80) = 0 then exit for
        multiplier = __pb_decimalMultiplyBy128(multiplier)
    end for
    return __pb_trimLeadingZeros(result)
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
    chunk = []
    index = startIndex
    count = bytes.Count()
    while index < count
        byte = bytes[index]
        chunk.Push(byte)
        index = index + 1
        if (byte AND &h80) = 0 then exit while
    end while
    result.value = __pb_decodeVarintToDecimalString(chunk)
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
    if value < 0 then
        positive = __pb_doubleToDecimalString(0 - value)
        if positive = "0" then return "0"
        return "-" + positive
    end if
    return __pb_doubleToDecimalString(value)
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
    globalAA.__pb_truncate = __pb_truncate
    globalAA.__pb_toSignedInt64String = __pb_toSignedInt64String
    globalAA.__pb_encodeZigZag32 = __pb_encodeZigZag32
    globalAA.__pb_decodeZigZag32 = __pb_decodeZigZag32
    globalAA.__pb_encodeZigZag64 = __pb_encodeZigZag64
    globalAA.__pb_decodeZigZag64 = __pb_decodeZigZag64
    globalAA.__pb_toUnsigned32 = __pb_toUnsigned32
    globalAA.__pb_toSigned32 = __pb_toSigned32
    globalAA.__pb_toSigned32FromString = __pb_toSigned32FromString
    globalAA.__pb_parseDecimalToDouble = __pb_parseDecimalToDouble
end sub`;

  return base;
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
      "            valueResult = __pb_readVarint64(bytes, cursor)",
      "            cursor = valueResult.nextIndex",
      `            message.${fieldName} = __pb_toSigned32FromString(valueResult.value)`,
      "        else",
      "            exit while",
      "        end if",
      "    end while",
      "    return message",
      "end function",
      ""
    ].join("\n");
  }

  if (descriptor.scalarType === "sint32") {
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
      "    encoded = __pb_encodeZigZag32(value)",
      "",
      "    bytes = __pb_createByteArray()",
      `    __pb_writeVarint(bytes, ${tag})`,
      "    __pb_writeVarint64(bytes, encoded)",
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
      `            message.${fieldName} = __pb_decodeZigZag32(valueResult.value)`,
      "        else",
      "            exit while",
      "        end if",
      "    end while",
      "    return message",
      "end function",
      ""
    ].join("\n");
  }

  if (descriptor.scalarType === "uint32") {
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
      "            valueResult = __pb_readVarint(bytes, cursor)",
      "            cursor = valueResult.nextIndex",
      `            message.${fieldName} = __pb_toUnsigned32(valueResult.value)`,
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
      `            message.${fieldName} = __pb_toSignedInt64String(valueResult.value)`,
      "        else",
      "            exit while",
      "        end if",
      "    end while",
      "    return message",
      "end function",
      ""
    ].join("\n");
  }

  if (descriptor.scalarType === "sint64") {
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
      "    encoded = __pb_encodeZigZag64(value)",
      "",
      "    bytes = __pb_createByteArray()",
      `    __pb_writeVarint(bytes, ${tag})`,
      "    __pb_writeVarint64(bytes, encoded)",
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
      `            message.${fieldName} = __pb_decodeZigZag64(valueResult.value)`,
      "        else",
      "            exit while",
      "        end if",
      "    end while",
      "    return message",
      "end function",
      ""
    ].join("\n");
  }

  if (descriptor.scalarType === "uint64") {
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
