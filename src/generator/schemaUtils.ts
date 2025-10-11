import { Namespace, Root, Type, Field, Enum } from "protobufjs";

export type SupportedScalarType =
  | "string"
  | "int32"
  | "uint32"
  | "sint32"
  | "int64"
  | "uint64"
  | "sint64"
  | "bool"
  | "bytes"
  | "float"
  | "double"
  | "fixed32"
  | "sfixed32"
  | "fixed64"
  | "sfixed64"
  | "enum";

export type FieldKind = "scalar" | "enum" | "message";

export interface SimpleScalarMessageDescriptor {
  type: Type;
  field: Field;
  scalarType: SupportedScalarType;
  isRepeated: boolean;
  isPacked?: boolean;
  enumInfo?: {
    name: string;
    values: Record<string, number>;
    valuesById: Record<string, string>;
  };
}

export interface SimpleMessageFieldDescriptor {
  type: Type;
  field: Field;
  childType: Type;
  isRepeated: boolean;
}

export interface MessageDescriptor {
  type: Type;
  fullName: string;
  name: string;
  fields: MessageFieldDescriptor[];
}

export type MessageFieldDescriptor =
  | ScalarFieldDescriptor
  | EnumFieldDescriptor
  | MessageTypeFieldDescriptor;

interface MessageFieldDescriptorBase {
  field: Field;
  name: string;
  id: number;
  kind: FieldKind;
  isRepeated: boolean;
  isRequired: boolean;
  isOptional: boolean;
  oneof?: string;
  tag: number;
  wireType: number;
}

interface ScalarFieldDescriptor extends MessageFieldDescriptorBase {
  kind: "scalar";
  scalarType: SupportedScalarType;
  isPacked: boolean;
  packedTag?: number;
  elementWireType?: number;
  defaultValue?: unknown;
}

interface EnumFieldDescriptor extends MessageFieldDescriptorBase {
  kind: "enum";
  scalarType: "enum";
  enumInfo: {
    name: string;
    values: Record<string, number>;
    valuesById: Record<string, string>;
  };
  isPacked: boolean;
  packedTag?: number;
  elementWireType?: number;
  defaultKey: string | undefined;
}

interface MessageTypeFieldDescriptor extends MessageFieldDescriptorBase {
  kind: "message";
  childType: Type;
  defaultValue?: unknown;
}

const SUPPORTED_SCALAR_TYPES: SupportedScalarType[] = [
  "string",
  "int32",
  "uint32",
  "sint32",
  "int64",
  "uint64",
  "sint64",
  "bool",
  "bytes",
  "float",
  "double",
  "fixed32",
  "sfixed32",
  "fixed64",
  "sfixed64",
  "enum"
];

export const PACKABLE_SCALAR_TYPES = new Set<SupportedScalarType>([
  "int32",
  "uint32",
  "sint32",
  "int64",
  "uint64",
  "sint64",
  "bool",
  "float",
  "double",
  "fixed32",
  "sfixed32",
  "fixed64",
  "sfixed64",
  "enum"
]);

const WIRE_TYPE_BY_SCALAR: Record<Exclude<SupportedScalarType, "enum"> | "enum", number> = {
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

export function collectMessageDescriptors(root: Root): MessageDescriptor[] {
  const types = collectTypes(root);
  return types
    .filter((type) => !isMapEntry(type))
    .map((type) => createMessageDescriptor(type))
    .filter((descriptor): descriptor is MessageDescriptor => descriptor !== undefined);
}

export function collectSimpleScalarMessages(root: Root): SimpleScalarMessageDescriptor[] {
  const descriptors = collectMessageDescriptors(root);
  const scalarMessages: SimpleScalarMessageDescriptor[] = [];

  for (const descriptor of descriptors) {
    if (descriptor.fields.length !== 1) {
      continue;
    }
    const field = descriptor.fields[0];
    if (field.kind === "scalar" || field.kind === "enum") {
      scalarMessages.push({
        type: descriptor.type,
        field: field.field,
        scalarType: field.scalarType,
        isRepeated: field.isRepeated,
        isPacked: field.kind === "scalar" || field.kind === "enum" ? field.isPacked : undefined,
        enumInfo: field.kind === "enum" ? field.enumInfo : undefined
      });
    }
  }

  return scalarMessages;
}

export function collectSimpleMessageFieldMessages(root: Root): SimpleMessageFieldDescriptor[] {
  const descriptors = collectMessageDescriptors(root);
  const messageFieldDescriptors: SimpleMessageFieldDescriptor[] = [];
  for (const descriptor of descriptors) {
    if (descriptor.fields.length !== 1) {
      continue;
    }
    const field = descriptor.fields[0];
    if (field.kind === "message") {
      messageFieldDescriptors.push({
        type: descriptor.type,
        field: field.field,
        childType: field.childType,
        isRepeated: field.isRepeated
      });
    }
  }

  return messageFieldDescriptors;
}

function collectTypes(namespace: Namespace | Root | Type): Type[] {
  const results: Type[] = [];
  const nested = namespace.nestedArray ?? [];

  for (const item of nested) {
    if (item instanceof Type) {
      results.push(item);
      results.push(...collectTypes(item));
    } else if (item instanceof Namespace) {
      results.push(...collectTypes(item));
    }
  }

  return results;
}

function isSupportedScalarField(field: Field): boolean {
  if (!field.resolvedType && typeof field.resolve === "function") {
    field.resolve();
  }
  if (field.resolvedType instanceof Enum) {
    return true;
  }
  return SUPPORTED_SCALAR_TYPES.includes(field.type as SupportedScalarType);
}

function extractEnumInfo(field: Field): EnumFieldDescriptor["enumInfo"] | undefined {
  if (!field.resolvedType && typeof field.resolve === "function") {
    field.resolve();
  }
  const enumType = field.resolvedType;
  if (!(enumType instanceof Enum)) {
    return undefined;
  }
  const values = enumType.values; // name -> number
  const valuesById = enumType.valuesById; // number -> name
  const normalizedValues: Record<string, number> = {};
  Object.keys(values).forEach((key) => {
    normalizedValues[key.toUpperCase()] = values[key];
  });
  const normalizedValuesById: Record<string, string> = {};
  Object.keys(valuesById).forEach((id) => {
    normalizedValuesById[id] = valuesById[Number(id)];
  });
  return {
    name: enumType.name,
    values: normalizedValues,
    valuesById: normalizedValuesById
  };
}

function createMessageDescriptor(type: Type): MessageDescriptor | undefined {
  const fields = type.fieldsArray?.map((field) => createFieldDescriptor(type, field)).filter(
    (field): field is MessageFieldDescriptor => field !== undefined
  );

  if (!fields || fields.length === 0) {
    return undefined;
  }

  return {
    type,
    fullName: type.fullName.replace(/^\./, ""),
    name: type.name,
    fields
  };
}

function createFieldDescriptor(parent: Type, field: Field): MessageFieldDescriptor | undefined {
  if (field.map === true) {
    return undefined;
  }

  if (!field.resolvedType && typeof field.resolve === "function") {
    field.resolve();
  }

  const oneofName = field.partOf ? field.partOf.name : undefined;
  const base: Omit<MessageFieldDescriptorBase, "kind"> = {
    field,
    name: field.name,
    id: field.id,
    isRepeated: field.repeated === true,
    isRequired: field.required === true,
    isOptional: field.optional === true,
    oneof: oneofName,
    tag: 0,
    wireType: 0
  };

  const enumInfo = extractEnumInfo(field);
  if (enumInfo) {
    const wireType = WIRE_TYPE_BY_SCALAR.enum;
    const tag = computeTag(field.id, wireType);
    const packedState = determinePackedState(field, "enum");
    const descriptor: EnumFieldDescriptor = {
      ...base,
      kind: "enum",
      scalarType: "enum",
      enumInfo,
      wireType,
      tag,
      isPacked: packedState.isPacked,
      packedTag: packedState.packedTag,
      elementWireType: PACKABLE_SCALAR_TYPES.has("enum") ? wireType : undefined,
      defaultKey: enumInfo.valuesById["0"]
    };
    return descriptor;
  }

  if (isSupportedScalarField(field)) {
    const scalarType = field.type as SupportedScalarType;
    const wireType = WIRE_TYPE_BY_SCALAR[scalarType];
    const tag = computeTag(field.id, wireType);
    const packedState = determinePackedState(field, scalarType);
    const descriptor: ScalarFieldDescriptor = {
      ...base,
      kind: "scalar",
      scalarType,
      wireType,
      tag,
      isPacked: packedState.isPacked,
      packedTag: packedState.packedTag,
      elementWireType: packedState.elementWireType,
      defaultValue: deriveDefaultValue(field)
    };
    return descriptor;
  }

  if (field.resolvedType instanceof Type) {
    const wireType = 2;
    const tag = computeTag(field.id, wireType);
    const descriptor: MessageTypeFieldDescriptor = {
      ...base,
      kind: "message",
      childType: field.resolvedType,
      wireType,
      tag,
      defaultValue: deriveDefaultValue(field)
    };
    return descriptor;
  }

  return undefined;
}

function deriveDefaultValue(field: Field): unknown {
  if (Object.prototype.hasOwnProperty.call(field, "defaultValue")) {
    return field.defaultValue;
  }
  if (field.options && Object.prototype.hasOwnProperty.call(field.options, "default")) {
    return (field.options as Record<string, unknown>).default;
  }
  return undefined;
}

function determinePackedState(field: Field, scalarType: SupportedScalarType): {
  isPacked: boolean;
  packedTag?: number;
  elementWireType?: number;
} {
  const packable = PACKABLE_SCALAR_TYPES.has(scalarType);
  if (!field.repeated || !packable) {
    return { isPacked: false };
  }

  const options = field.options as Record<string, unknown> | undefined;
  if (options && Object.prototype.hasOwnProperty.call(options, "packed")) {
    const explicit = options.packed === true;
    return {
      isPacked: explicit,
      packedTag: explicit ? computeTag(field.id, 2) : undefined,
      elementWireType: WIRE_TYPE_BY_SCALAR[scalarType]
    };
  }

  const packedProperty = (field as unknown as { packed?: boolean }).packed;
  if (packedProperty === true) {
    return {
      isPacked: true,
      packedTag: computeTag(field.id, 2),
      elementWireType: WIRE_TYPE_BY_SCALAR[scalarType]
    };
  }

  const parentEdition = (field.parent as unknown as { _edition?: string })?._edition;
  if (parentEdition === "proto3") {
    return {
      isPacked: true,
      packedTag: computeTag(field.id, 2),
      elementWireType: WIRE_TYPE_BY_SCALAR[scalarType]
    };
  }

  return {
    isPacked: false,
    elementWireType: WIRE_TYPE_BY_SCALAR[scalarType]
  };
}

function computeTag(fieldId: number, wireType: number): number {
  return (fieldId << 3) | wireType;
}

function isMapEntry(type: Type): boolean {
  const options = type.options as Record<string, unknown> | undefined;
  return options?.mapEntry === true || options?.map_entry === true;
}
