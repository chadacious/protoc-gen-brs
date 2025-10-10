import { Namespace, Root, Type, Field } from "protobufjs";

export type SupportedScalarType = "string" | "int32" | "uint32" | "sint32" | "int64" | "uint64" | "sint64" | "bool" | "bytes";

export interface SimpleScalarMessageDescriptor {
  type: Type;
  field: Field;
  scalarType: SupportedScalarType;
}

const SUPPORTED_SCALAR_TYPES: SupportedScalarType[] = ["string", "int32", "uint32", "sint32", "int64", "uint64", "sint64", "bool", "bytes"];

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
      return {
        type,
        field,
        scalarType: field.type as SupportedScalarType
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
  return SUPPORTED_SCALAR_TYPES.includes(field.type as SupportedScalarType);
}
