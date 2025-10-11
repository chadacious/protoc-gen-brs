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

export function collectSimpleScalarMessages(root: Root): SimpleScalarMessageDescriptor[] {
  const messages = collectTypes(root);
  return messages
    .map((type) => createScalarDescriptorForType(type))
    .filter((descriptor): descriptor is SimpleScalarMessageDescriptor => descriptor !== undefined);
}

function createScalarDescriptorForType(type: Type): SimpleScalarMessageDescriptor | undefined {
  const fields = type.fieldsArray;
  if (fields.length !== 1) {
    return undefined;
  }
  const field = fields[0];
  const enumInfo = extractEnumInfo(field);
  if (!enumInfo && !isSupportedScalarField(field)) {
    return undefined;
  }
  const scalarType: SupportedScalarType = enumInfo ? "enum" : (field.type as SupportedScalarType);
  let isPacked: boolean | undefined;
  if (field.repeated === true && PACKABLE_SCALAR_TYPES.has(scalarType)) {
    isPacked = field.packed !== false;
  }
  return {
    type,
    field,
    scalarType,
    isRepeated: field.repeated === true,
    isPacked,
    enumInfo
  };
}

export function collectSimpleMessageFieldMessages(root: Root): SimpleMessageFieldDescriptor[] {
  const messages = collectTypes(root);
  return messages
    .map((type) => createMessageFieldDescriptor(type))
    .filter((descriptor): descriptor is SimpleMessageFieldDescriptor => descriptor !== undefined);
}

function createMessageFieldDescriptor(type: Type): SimpleMessageFieldDescriptor | undefined {
  const fields = type.fieldsArray;
  if (fields.length !== 1) {
    return undefined;
  }
  const field = fields[0];
  if (!field.resolvedType && typeof field.resolve === "function") {
    field.resolve();
  }
  if (!(field.resolvedType instanceof Type)) {
    return undefined;
  }
  return {
    type,
    field,
    childType: field.resolvedType,
    isRepeated: field.repeated === true
  };
}

function collectTypes(namespace: Namespace | Root): Type[] {
  const results: Type[] = [];
  const nested = namespace.nestedArray ?? [];

  for (const item of nested) {
    if (item instanceof Type) {
      results.push(item);
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

function extractEnumInfo(field: Field): SimpleScalarMessageDescriptor["enumInfo"] {
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
