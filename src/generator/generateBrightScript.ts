import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fs from "fs-extra";
import { loadProtoBundle } from "./protoLoader";
import { collectSimpleScalarMessages, SimpleScalarMessageDescriptor, SupportedScalarType } from "./schemaUtils";

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

function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_match, key) => {
    const value = context[key];
    if (value === undefined) {
      throw new Error(`Missing template variable: ${key}`);
    }
    return value;
  });
}

const MESSAGE_TEMPLATE_MAP: Record<
  SupportedScalarType,
  { single: string; repeated?: string }
> = {
  string: {
    single: "messages/string.brs.tmpl",
    repeated: "messages/repeated/string.brs.tmpl"
  },
  int32: {
    single: "messages/int32.brs.tmpl",
    repeated: "messages/repeated/int32.brs.tmpl"
  },
  uint32: {
    single: "messages/uint32.brs.tmpl",
    repeated: "messages/repeated/uint32.brs.tmpl"
  },
  sint32: {
    single: "messages/sint32.brs.tmpl",
    repeated: "messages/repeated/sint32.brs.tmpl"
  },
  int64: {
    single: "messages/int64.brs.tmpl",
    repeated: "messages/repeated/int64.brs.tmpl"
  },
  uint64: {
    single: "messages/uint64.brs.tmpl",
    repeated: "messages/repeated/uint64.brs.tmpl"
  },
  sint64: {
    single: "messages/sint64.brs.tmpl",
    repeated: "messages/repeated/sint64.brs.tmpl"
  },
  bool: {
    single: "messages/bool.brs.tmpl",
    repeated: "messages/repeated/bool.brs.tmpl"
  },
  bytes: {
    single: "messages/bytes.brs.tmpl",
    repeated: "messages/repeated/bytes.brs.tmpl"
  },
  float: {
    single: "messages/float.brs.tmpl",
    repeated: "messages/repeated/float.brs.tmpl"
  },
  enum: {
    single: "messages/enum.brs.tmpl",
    repeated: "messages/repeated/enum.brs.tmpl"
  }
};

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
  enum: 0
};

function renderRuntimeModule(): string {
  return loadTemplate("runtime.brs");
}


function buildEnumValueAssignments(descriptor: SimpleScalarMessageDescriptor): string {
  const enumInfo = descriptor.enumInfo;
  if (!enumInfo) {
    return "";
  }
  const lines: string[] = [];
  const entries = Object.entries(enumInfo.values).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, value] of entries) {
    lines.push(`    table["${name}"] = ${value}`);
  }
  return lines.join("\n");
}

function buildEnumNameAssignments(descriptor: SimpleScalarMessageDescriptor): string {
  const enumInfo = descriptor.enumInfo;
  if (!enumInfo) {
    return "";
  }
  const lines: string[] = [];
  const entries = Object.entries(enumInfo.valuesById).sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [id, name] of entries) {
    lines.push(`    table["${id}"] = "${name}"`);
  }
  return lines.join("\n");
}

function getEnumDefaultKey(descriptor: SimpleScalarMessageDescriptor): string {
  const enumInfo = descriptor.enumInfo;
  if (!enumInfo) {
    return "";
  }
  if (enumInfo.valuesById.hasOwnProperty("0")) {
    return enumInfo.valuesById["0"];
  }
  const firstKey = Object.keys(enumInfo.valuesById)[0];
  if (firstKey) {
    return enumInfo.valuesById[firstKey];
  }
  return "";
}




function renderScalarMessageModule(descriptor: SimpleScalarMessageDescriptor): string {
  const templateEntry = MESSAGE_TEMPLATE_MAP[descriptor.scalarType];
  if (!templateEntry) {
    throw new Error(`Unsupported scalar type: ${descriptor.scalarType}`);
  }

  const wireType = WIRE_TYPE_BY_SCALAR[descriptor.scalarType];
  const tag = (descriptor.field.id << 3) | wireType;
  const templatePath = descriptor.isRepeated ? templateEntry.repeated : templateEntry.single;
  if (!templatePath) {
    throw new Error(`No template found for ${descriptor.scalarType} (repeated=${descriptor.isRepeated})`);
  }
  const template = loadTemplate(templatePath);

  const context: Record<string, string> = {
    TYPE_NAME: descriptor.type.name,
    FIELD_NAME: descriptor.field.name,
    FIELD_ID: descriptor.field.id.toString(),
    TAG: tag.toString(),
    WIRE_TYPE: wireType.toString()
  };

  if (descriptor.isRepeated) {
    const packedTag = (descriptor.field.id << 3) | 2;
    context.PACKED_TAG = packedTag.toString();
    context.PACKED_WIRE_TYPE = "2";
    context.ELEMENT_WIRE_TYPE = wireType.toString();
  }

  if (descriptor.scalarType === "enum" && descriptor.enumInfo) {
    context.ENUM_VALUE_ASSIGNMENTS = buildEnumValueAssignments(descriptor);
    context.ENUM_NAME_ASSIGNMENTS = buildEnumNameAssignments(descriptor);
    context.ENUM_DEFAULT_KEY = getEnumDefaultKey(descriptor);
  }

  return renderTemplate(template, context);
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
