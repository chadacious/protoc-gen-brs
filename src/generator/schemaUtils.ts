import { Namespace, Root, Type, Field, Enum } from "protobufjs";

export type SupportedScalarType = "string" | "int32" | "uint32" | "sint32" | "int64" | "uint64" | "sint64" | "bool" | "bytes" | "float" | "enum";

export interface SimpleScalarMessageDescriptor {
  type: Type;
  field: Field;
  scalarType: SupportedScalarType;
  isRepeated: boolean;
  enumInfo?: {
    name: string;
    values: Record<string, number>;
    valuesById: Record<string, string>;
  };
}

const SUPPORTED_SCALAR_TYPES: SupportedScalarType[] = ["string", "int32", "uint32", "sint32", "int64", "uint64", "sint64", "bool", "bytes", "float", "enum"];

export function collectSimpleScalarMessages(root: Root): SimpleScalarMessageDescriptor[] {
  const messages = collectTypes(root);
  return messages
    .map((type) => {
      const fields = type.fieldsArray;
      if (fields.length !== 1) {
        return undefined;
      }
      const field = fields[0];
      if (!isSupportedScalarField(field)) {
        return undefined;
      }
      const enumInfo = extractEnumInfo(field);
      return {
        type,
        field,
        scalarType: enumInfo ? "enum" : (field.type as SupportedScalarType),
        isRepeated: field.repeated === true,
        enumInfo
      };
    })
    .filter((descriptor): descriptor is SimpleScalarMessageDescriptor => Boolean(descriptor));
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
  if (field.resolvedType instanceof Enum) {
    return true;
  }
  return SUPPORTED_SCALAR_TYPES.includes(field.type as SupportedScalarType);
}

function extractEnumInfo(field: Field): SimpleScalarMessageDescriptor["enumInfo"] {
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
    normalizedValuesById[id] = valuesById[id];
  });
  return {
    name: enumType.name,
    values: normalizedValues,
    valuesById: normalizedValuesById
  };
}
