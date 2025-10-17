import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateBrightScriptArtifacts } from "../src/generator/generateBrightScript";

async function createProto(tempDir: string) {
  const protoDir = path.join(tempDir, "proto");
  await fs.mkdir(protoDir, { recursive: true });
  const protoPath = path.join(protoDir, "uint_sample.proto");
  const protoContents = `
    syntax = "proto3";
    package samples;

    message Int32Message { int32 value = 1; }
    message Uint32Message { uint32 value = 1; }
    message Uint64Message { uint64 value = 1; }
    message Sint32Message { sint32 value = 1; }
    message Sint64Message { sint64 value = 1; }
    message FloatMessage { float value = 1; }
    message PackedInt32Message { repeated int32 values = 1; }
    message UnpackedInt32Message { repeated int32 values = 1 [packed = false]; }
    message PackedUint32Message { repeated uint32 values = 1; }
    message UnpackedUint32Message { repeated uint32 values = 1 [packed = false]; }
    message PackedBoolMessage { repeated bool values = 1; }
    message UnpackedBoolMessage { repeated bool values = 1 [packed = false]; }
    message PackedFloatMessage { repeated float values = 1; }
    message UnpackedFloatMessage { repeated float values = 1 [packed = false]; }
    enum SampleEnum {
      SAMPLE_ENUM_UNKNOWN = 0;
      SAMPLE_ENUM_FIRST = 1;
      SAMPLE_ENUM_SECOND = 2;
    }
    message EnumMessage { SampleEnum choice = 1; }
    message PackedEnumMessage { repeated SampleEnum choices = 1; }
    message UnpackedEnumMessage { repeated SampleEnum choices = 1 [packed = false]; }
    message ChildMessage { int32 value = 1; }
    message ParentMessage { ChildMessage child = 1; }
    message ParentRepeatedMessage { repeated ChildMessage children = 1; }
    message CamelCaseMessage {
      int32 sample_value = 1;
      repeated string sample_values = 2;
    }
  `;
  await fs.writeFile(protoPath, protoContents.trim() + "\n", "utf8");
  return protoPath;
}

type DecodeCaseMode = "snake" | "camel" | "both";

async function generateBrightScript(protoPath: string, outputDir: string, decodeCase: DecodeCaseMode = "snake") {
  await generateBrightScriptArtifacts({
    protoPaths: [protoPath],
    outputDir,
    decodeFieldCase: decodeCase
  });
  const readMessage = async (name: string) =>
    fs.readFile(path.join(outputDir, "messages", `${name}.brs`), "utf8");
  return {
    int32File: await readMessage("Int32Message"),
    uint32File: await readMessage("Uint32Message"),
    uint64File: await readMessage("Uint64Message"),
    sint32File: await readMessage("Sint32Message"),
    sint64File: await readMessage("Sint64Message"),
    floatFile: await readMessage("FloatMessage"),
    packedInt32File: await readMessage("PackedInt32Message"),
    unpackedInt32File: await readMessage("UnpackedInt32Message"),
    packedUint32File: await readMessage("PackedUint32Message"),
    unpackedUint32File: await readMessage("UnpackedUint32Message"),
    packedBoolFile: await readMessage("PackedBoolMessage"),
    unpackedBoolFile: await readMessage("UnpackedBoolMessage"),
    packedFloatFile: await readMessage("PackedFloatMessage"),
    unpackedFloatFile: await readMessage("UnpackedFloatMessage"),
    enumFile: await readMessage("EnumMessage"),
    packedEnumFile: await readMessage("PackedEnumMessage"),
    unpackedEnumFile: await readMessage("UnpackedEnumMessage"),
    childMessageFile: await readMessage("ChildMessage"),
    parentMessageFile: await readMessage("ParentMessage"),
    parentRepeatedMessageFile: await readMessage("ParentRepeatedMessage"),
    camelCaseMessageFile: await readMessage("CamelCaseMessage")
  };
}

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brs-uint-"));
  const protoPath = await createProto(tempRoot);
  const outputDir = path.join(tempRoot, "generated");
  const {
    int32File,
    uint32File,
    uint64File,
    sint32File,
    sint64File,
    floatFile,
    packedInt32File,
    unpackedInt32File,
    packedUint32File,
    unpackedUint32File,
    packedBoolFile,
    unpackedBoolFile,
    packedFloatFile,
    unpackedFloatFile,
    enumFile,
    packedEnumFile,
    unpackedEnumFile,
    childMessageFile,
    parentMessageFile,
    parentRepeatedMessageFile,
    camelCaseMessageFile
  } = await generateBrightScript(protoPath, outputDir);

  assert.ok(int32File.includes("__pb_writeVarint(bytes, 8)"), "int32 encode should emit field tag");
  assert.ok(int32File.includes("valueValue = __pb_toSigned32FromString(valueResult.value)"), "int32 decode should compute signed helper value");
  assert.ok(int32File.includes('message["value"] = valueValue'), "int32 decode should assign normalized value to field");
  assert.ok(uint32File.includes("__pb_writeVarint(bytes, 8)"), "uint32 encode should emit field tag");
  assert.ok(uint32File.includes("__pb_writeVarint64(bytes"), "uint32 encode should use 64-bit writer to avoid Int overflow");
  assert.ok(uint32File.includes("valueValue = __pb_toUnsigned32(valueResult.value)"), "uint32 decode should coerce to unsigned value");
  assert.ok(uint32File.includes('message["value"] = valueValue'), "uint32 decode should assign coerced value");
  assert.ok(!uint32File.includes("value = Int(value)"), "uint32 encode should not truncate using Int()");

  assert.ok(uint64File.includes("__pb_writeVarint(bytes, 8)"), "uint64 encode should emit field tag");
  assert.ok(uint64File.includes("__pb_writeVarint64(bytes, field_value)"), "uint64 encode should write via 64-bit helper");
  assert.ok(uint64File.includes("valueResult = __pb_readVarint64(bytes, cursor)"), "uint64 decode should read via 64-bit helper");
  assert.ok(uint64File.includes("valueValue = valueResult.value"), "uint64 decode should keep unsigned decimal string");
  assert.ok(uint64File.includes('message["value"] = valueValue'), "uint64 decode should assign unsigned string");
  assert.ok(!uint64File.includes("__pb_toSignedInt64String"), "uint64 decode should not convert to signed representation");

  assert.ok(sint32File.includes("__pb_encodeZigZag32"), "sint32 encode should zigzag values");
  assert.ok(sint32File.includes("__pb_decodeZigZag32"), "sint32 decode should zigzag values");
  assert.ok(sint32File.includes("__pb_writeVarint64(bytes, encoded)"), "sint32 encode should write encoded varint");

  assert.ok(sint64File.includes("__pb_encodeZigZag64"), "sint64 encode should zigzag values");
  assert.ok(sint64File.includes("__pb_decodeZigZag64"), "sint64 decode should zigzag values");
  assert.ok(sint64File.includes("__pb_writeVarint64(bytes, encoded)"), "sint64 encode should write zigzagged value");

  assert.ok(floatFile.includes("__pb_writeVarint(bytes, 13)"), "float encode should emit fixed32 field tag");
  assert.ok(floatFile.includes("__pb_writeFloat32(bytes, normalized)"), "float encode should write via float helper");
  assert.ok(floatFile.includes("wireType = tagResult.value AND &h07"), "float decode should compute wire type");
  assert.ok(floatFile.includes("wireType = 5"), "float decode should use fixed32 wire type");
  assert.ok(floatFile.includes("floatResult = __pb_readFloat32(bytes, cursor)"), "float decode should read fixed32 chunk");
  assert.ok(floatFile.includes("valueValue = floatResult.value"), "float decode should capture decoded float");
  assert.ok(floatFile.includes('message["value"] = valueValue'), "float decode should assign decoded float");

  assert.ok(packedInt32File.includes("__pb_writeVarint(bytes, 10)"), "packed int32 encode should emit length-delimited tag");
  assert.ok(packedInt32File.includes("valuesPacked = __pb_createByteArray()"), "packed int32 encode should allocate packed buffer");
  assert.ok(packedInt32File.includes("__pb_writeVarint(valuesPacked, normalized)"), "packed int32 encode should pack values");
  assert.ok(packedInt32File.includes("while cursor < valuesPackEnd"), "packed int32 decode should handle packed wire type");
  assert.ok(packedInt32File.includes("valuesValues.Push(__pb_toSigned32FromString"), "packed int32 decode should convert varints");

  assert.ok(unpackedInt32File.includes("for each valuesItem in valuesItems"), "unpacked int32 encode should iterate each value");
  assert.ok(unpackedInt32File.includes("__pb_writeVarint(bytes, 8)"), "unpacked int32 encode should emit element tag per value");
  assert.ok(unpackedInt32File.includes("__pb_writeVarint(bytes, normalized)"), "unpacked int32 encode should write varint per element");

  assert.ok(packedUint32File.includes("__pb_writeVarint(bytes, 10)"), "packed uint32 encode should emit packed tag");
  assert.ok(packedUint32File.includes("__pb_writeVarint64(valuesPacked"), "packed uint32 encode should pack unsigned values");
  assert.ok(packedUint32File.includes("valuesValues.Push(__pb_toUnsigned32"), "packed uint32 decode should convert to unsigned");

  assert.ok(unpackedUint32File.includes("for each valuesItem in valuesItems"), "unpacked uint32 encode should iterate each value");
  assert.ok(unpackedUint32File.includes("__pb_writeVarint(bytes, 8)"), "unpacked uint32 encode should emit element tag");
  assert.ok(unpackedUint32File.includes("__pb_writeVarint64(bytes, normalized)"), "unpacked uint32 encode should write each value individually");

  assert.ok(packedBoolFile.includes("lower = LCase(boolValue)"), "packed bool encode should normalize string inputs");
  assert.ok(packedBoolFile.includes("__pb_writeVarint(valuesPacked, boolInt)"), "packed bool encode should pack bool integers");
  assert.ok(packedBoolFile.includes("valuesValues.Push(valueResult.value <> 0)"), "packed bool decode should coerce to boolean");

  assert.ok(unpackedBoolFile.includes("boolInt = 0"), "unpacked bool encode should compute integer representation");
  assert.ok(unpackedBoolFile.includes("__pb_writeVarint(bytes, boolInt)"), "unpacked bool encode should write per element");

  assert.ok(packedFloatFile.includes("valuesPacked = __pb_createByteArray()"), "packed float encode should write packed buffer");
  assert.ok(packedFloatFile.includes("__pb_writeFloat32(valuesPacked, normalized)"), "packed float encode should write float values");
  assert.ok(packedFloatFile.includes("while cursor < valuesPackEnd"), "packed float decode should handle packed form");
  assert.ok(packedFloatFile.includes("valuesValues.Push(floatResult.value)"), "packed float decode should push unpacked values");

  assert.ok(unpackedFloatFile.includes("__pb_writeFloat32(bytes, normalized)"), "unpacked float encode should write each float");

  assert.ok(enumFile.includes("EnumMessage_choice_getEnumValues"), "enum encode should declare value mapping");
  assert.ok(enumFile.includes("EnumMessage_choice_getEnumNames"), "enum decode should declare reverse mapping");
  assert.ok(enumFile.includes("EnumMessage_choice_normalizeEnum"), "enum encode should normalize string inputs");
  assert.ok(enumFile.includes("__pb_writeVarint(bytes, 8)"), "enum encode should write varint tag");
  assert.ok(enumFile.includes("choiceEnumValue = EnumMessage_choice_enumName(numericValue)"), "enum decode should convert numbers to labels");
  assert.ok(enumFile.includes('message["choice"] = choiceEnumValue'), "enum decode should assign enum label to field");

  assert.ok(packedEnumFile.includes("__pb_writeVarint(choicesPacked, numericValue)"), "packed enum encode should write packed values");
  assert.ok(packedEnumFile.includes("choicesValues.Push(PackedEnumMessage_choices_enumName"), "packed enum decode should convert to labels");

  assert.ok(unpackedEnumFile.includes("__pb_writeVarint(bytes, numericValue)"), "unpacked enum encode should write each value");

  assert.ok(parentMessageFile.includes("ChildMessageEncode"), "message encode should call child encoder");
  assert.ok(parentMessageFile.includes("ChildMessageDecode"), "message decode should call child decoder");
  assert.ok(parentMessageFile.includes("__pb_writeVarint(bytes, 10)"), "message encode should use length-delimited tag");

  assert.ok(parentRepeatedMessageFile.includes("for each childrenItem in childrenItems"), "repeated message encode should iterate children");
  assert.ok(parentRepeatedMessageFile.includes("childrenValues = CreateObject(\"roArray\", 0, true)"), "repeated message decode should create resizable array");
  assert.ok(parentRepeatedMessageFile.includes("ChildMessageDecode"), "repeated message decode should decode child messages");

  assert.ok(camelCaseMessageFile.includes('else if message.DoesExist("sampleValue") then'), "camelCase support should check associative camel key for scalar fields");
  assert.ok(camelCaseMessageFile.includes('field_sample_value = message["sampleValue"]'), "camelCase support should read object camelCase property when snake is missing");
  assert.ok(camelCaseMessageFile.includes('else if message.DoesExist("sampleValues") then'), "camelCase support should check associative camel key for repeated fields");
  assert.ok(camelCaseMessageFile.includes('message["sample_value"] = sample_valueValue'), "camelCase decode should continue assigning snake_cased scalar field");
  assert.ok(camelCaseMessageFile.includes('message["sample_values"] = sample_valuesValues'), "camelCase decode should continue assigning snake_cased repeated field");

  const camelOutputDir = path.join(tempRoot, "generated-camel");
  const { camelCaseMessageFile: camelDecodedFile } = await generateBrightScript(protoPath, camelOutputDir, "camel");
  assert.ok(
    camelDecodedFile.includes('message["sampleValue"] = sample_valueValue'),
    "camelCase decode option should assign camelCase scalar fields"
  );
  assert.ok(
    camelDecodedFile.includes('message["sampleValues"] = sample_valuesValues'),
    "camelCase decode option should assign camelCase repeated fields"
  );
  assert.ok(
    !camelDecodedFile.includes('message["sample_value"] = sample_valueValue'),
    "camelCase decode option should omit snake_case scalar assignment"
  );

  const bothOutputDir = path.join(tempRoot, "generated-both");
  const { camelCaseMessageFile: camelBothFile } = await generateBrightScript(protoPath, bothOutputDir, "both");
  assert.ok(
    camelBothFile.includes('message["sample_value"] = sample_valueValue'),
    "both decode option should retain snake_case scalar assignment"
  );
  assert.ok(
    camelBothFile.includes('message["sampleValue"] = sample_valueValue'),
    "both decode option should add camelCase scalar assignment"
  );
  assert.ok(
    camelBothFile.includes('message["sample_values"] = sample_valuesValues'),
    "both decode option should retain snake_case repeated assignment"
  );
  assert.ok(
    camelBothFile.includes('message["sampleValues"] = sample_valuesValues'),
    "both decode option should include camelCase repeated assignment"
  );

  console.log("generator tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
