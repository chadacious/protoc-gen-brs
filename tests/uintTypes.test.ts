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

    enum SampleEnum {
      SAMPLE_ENUM_UNKNOWN = 0;
      SAMPLE_ENUM_FIRST = 1;
      SAMPLE_ENUM_SECOND = 2;
    }

    message Int32Message { int32 value = 1; }
    message Uint32Message { uint32 value = 1; }
    message Uint64Message { uint64 value = 1; }
    message Sint32Message { sint32 value = 1; }
    message Sint64Message { sint64 value = 1; }
    message FloatMessage { float value = 1; }
    message EnumMessage { SampleEnum choice = 1; }
    message PackedEnumMessage { repeated SampleEnum choices = 1; }
    message PackedInt32Message { repeated int32 values = 1; }
    message PackedUint32Message { repeated uint32 values = 1; }
    message PackedBoolMessage { repeated bool values = 1; }
    message PackedFloatMessage { repeated float values = 1; }
  `;
  await fs.writeFile(protoPath, protoContents.trim() + "\n", "utf8");
  return protoPath;
}

async function generateBrightScript(protoPath: string, outputDir: string) {
  await generateBrightScriptArtifacts({
    protoPaths: [protoPath],
    outputDir,
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
    packedUint32File: await readMessage("PackedUint32Message"),
    packedBoolFile: await readMessage("PackedBoolMessage"),
    packedFloatFile: await readMessage("PackedFloatMessage"),
    enumFile: await readMessage("EnumMessage"),
    packedEnumFile: await readMessage("PackedEnumMessage")
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
    packedUint32File,
    packedBoolFile,
    packedFloatFile,
    enumFile,
    packedEnumFile
  } = await generateBrightScript(protoPath, outputDir);

  assert.ok(int32File.includes("__pb_writeVarint(bytes, 8)"), "int32 encode should emit field tag");
  assert.ok(int32File.includes("message.value = __pb_toSigned32FromString(valueResult.value)"), "int32 decode should use signed helper");
  assert.ok(uint32File.includes("__pb_writeVarint(bytes, 8)"), "uint32 encode should emit field tag");
  assert.ok(uint32File.includes("__pb_writeVarint64(bytes, value)"), "uint32 encode should use 64-bit writer to avoid Int overflow");
  assert.ok(uint32File.includes("message.value = __pb_toUnsigned32(valueResult.value)"), "uint32 decode should coerce to unsigned");
  assert.ok(!uint32File.includes("value = Int(value)"), "uint32 encode should not truncate using Int()");

  assert.ok(uint64File.includes("__pb_writeVarint(bytes, 8)"), "uint64 encode should emit field tag");
  assert.ok(uint64File.includes("__pb_writeVarint64(bytes, value)"), "uint64 encode should write via 64-bit helper");
  assert.ok(uint64File.includes("valueResult = __pb_readVarint64(bytes, cursor)"), "uint64 decode should read via 64-bit helper");
  assert.ok(uint64File.includes("message.value = valueResult.value"), "uint64 decode should keep unsigned decimal string");
  assert.ok(!uint64File.includes("__pb_toSignedInt64String"), "uint64 decode should not convert to signed representation");

  assert.ok(sint32File.includes("__pb_encodeZigZag32"), "sint32 encode should zigzag values");
  assert.ok(sint32File.includes("__pb_decodeZigZag32"), "sint32 decode should zigzag values");
  assert.ok(sint32File.includes("__pb_writeVarint64(bytes, encoded)"), "sint32 encode should write encoded varint");

  assert.ok(sint64File.includes("__pb_encodeZigZag64"), "sint64 encode should zigzag values");
  assert.ok(sint64File.includes("__pb_decodeZigZag64"), "sint64 decode should zigzag values");
  assert.ok(sint64File.includes("__pb_writeVarint64(bytes, encoded)"), "sint64 encode should write zigzagged value");

  assert.ok(floatFile.includes("__pb_writeVarint(bytes, 13)"), "float encode should emit fixed32 field tag");
  assert.ok(floatFile.includes("__pb_writeFloat32(bytes, value)"), "float encode should write via float helper");
  assert.ok(floatFile.includes("wireType = tagResult.value AND &h07"), "float decode should compute wire type");
  assert.ok(floatFile.includes("wireType = 5"), "float decode should use fixed32 wire type");
  assert.ok(floatFile.includes("floatResult = __pb_readFloat32(bytes, cursor)"), "float decode should read fixed32 chunk");
  assert.ok(floatFile.includes("message.value = floatResult.value"), "float decode should assign decoded float");

  assert.ok(packedInt32File.includes("__pb_writeVarint(bytes, 10)"), "packed int32 encode should emit length-delimited tag");
  assert.ok(packedInt32File.includes("__pb_writeVarint(packed, normalized)"), "packed int32 encode should pack values");
  assert.ok(packedInt32File.includes("else if wireType = 2 then"), "packed int32 decode should handle packed wire type");
  assert.ok(packedInt32File.includes("values.Push(__pb_toSigned32FromString"), "packed int32 decode should convert varints");

  assert.ok(packedUint32File.includes("__pb_writeVarint(bytes, 10)"), "packed uint32 encode should emit packed tag");
  assert.ok(packedUint32File.includes("values.Push(__pb_toUnsigned32"), "packed uint32 decode should convert to unsigned");

  assert.ok(packedBoolFile.includes("normalizeBool"), "packed bool encode should normalize inputs");
  assert.ok(packedBoolFile.includes("values.Push(valueResult.value <> 0)"), "packed bool decode should coerce to boolean");

  assert.ok(packedFloatFile.includes("__pb_writeFloat32(packed"), "packed float encode should write float values");
  assert.ok(packedFloatFile.includes("else if wireType = 2 then"), "packed float decode should handle packed form");
  assert.ok(packedFloatFile.includes("values.Push(valueResult.value)"), "packed float decode should push unpacked values");

  assert.ok(enumFile.includes("EnumMessageEnumValues"), "enum encode should declare value mapping");
  assert.ok(enumFile.includes("EnumMessageEnumNames"), "enum decode should declare reverse mapping");
  assert.ok(enumFile.includes("EnumMessage_normalizeEnum"), "enum encode should normalize string inputs");
  assert.ok(enumFile.includes("__pb_writeVarint(bytes, 8)"), "enum encode should write varint tag");
  assert.ok(enumFile.includes("message.choice = EnumMessage_enumName"), "enum decode should convert numbers to labels");

  assert.ok(packedEnumFile.includes("__pb_writeVarint(packed"), "packed enum encode should write packed values");
  assert.ok(packedEnumFile.includes("values.Push(PackedEnumMessage_enumName"), "packed enum decode should convert to labels");

  console.log("scalar generator tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
