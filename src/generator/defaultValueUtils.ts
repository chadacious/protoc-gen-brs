import { Buffer } from "node:buffer";
import { Field, Type } from "protobufjs";
import { SupportedScalarType } from "./schemaUtils";

export type ScalarLikeType = SupportedScalarType | "enum";

export interface ScalarDefaultDescriptor {
  scalarType: ScalarLikeType;
  representation: "string" | "boolean";
  value: string | boolean;
}

interface EnumInfo {
  values: Record<string, number>;
  valuesById: Record<string, string>;
}

export function resolveScalarDefault(
  field: Field,
  scalarType: ScalarLikeType,
  enumInfo?: EnumInfo
): ScalarDefaultDescriptor {
  const explicit = readExplicitDefault(field);

  switch (scalarType) {
    case "bool": {
      const value = explicit !== undefined ? normalizeBoolean(explicit) : false;
      return {
        scalarType,
        representation: "boolean",
        value
      };
    }
    case "string": {
      const value = explicit !== undefined ? String(explicit) : "";
      return {
        scalarType,
        representation: "string",
        value
      };
    }
    case "bytes": {
      const value = explicit !== undefined ? normalizeBytes(explicit) : "";
      return {
        scalarType,
        representation: "string",
        value
      };
    }
    case "enum": {
      const numeric = resolveEnumDefault(explicit, enumInfo);
      return {
        scalarType,
        representation: "string",
        value: numeric
      };
    }
    default: {
      const value = explicit !== undefined ? normalizeNumeric(explicit) : "0";
      return {
        scalarType,
        representation: "string",
        value
      };
    }
  }
}

export function formatDefaultLiteral(descriptor: ScalarDefaultDescriptor): string {
  if (descriptor.representation === "boolean") {
    return descriptor.value === true ? "true" : "false";
  }
  return toBrsStringLiteral(String(descriptor.value));
}

export function valueEqualsDefault(
  value: unknown,
  scalarType: ScalarLikeType,
  descriptor: ScalarDefaultDescriptor
): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  switch (scalarType) {
    case "bool":
      return normalizeBoolean(value) === (descriptor.value === true);
    case "string":
      return String(value) === String(descriptor.value);
    case "bytes":
      return normalizeBytes(value) === String(descriptor.value);
    case "enum":
      return normalizeNumeric(value) === String(descriptor.value);
    case "float":
    case "double":
      return normalizeFloat(value) === normalizeFloat(descriptor.value);
    default:
      return normalizeNumeric(value) === String(descriptor.value);
  }
}

export function pruneDefaultsInMessage(
  type: Type,
  message: Record<string, unknown>,
  pruneRequiredFields = false
): void {
  if (!message || typeof message !== "object") {
    return;
  }

  for (const field of type.fieldsArray) {
    if (field.map) {
      continue;
    }

    const { key, value } = locateFieldValue(message, field) ?? {};
    if (key === undefined) {
      continue;
    }

    if (field.repeated) {
      if (Array.isArray(value) && value.length === 0) {
        delete (message as Record<string, unknown>)[key];
      } else if (Array.isArray(value) && field.resolvedType instanceof Type) {
        value.forEach((entry) => {
          if (entry && typeof entry === "object") {
            pruneDefaultsInMessage(field.resolvedType as Type, entry as Record<string, unknown>, pruneRequiredFields);
          }
        });
      }
      continue;
    }

    if (field.resolvedType instanceof Type) {
      if (value && typeof value === "object") {
        pruneDefaultsInMessage(field.resolvedType, value as Record<string, unknown>, pruneRequiredFields);
      }
      continue;
    }

    const scalarType = (field.resolvedType ? "enum" : (field.type as SupportedScalarType)) as ScalarLikeType;
    const descriptor = resolveScalarDefault(
      field,
      scalarType,
      field.resolvedType && "values" in field.resolvedType
        ? {
            values: (field.resolvedType as any).values ?? {},
            valuesById: (field.resolvedType as any).valuesById ?? {}
          }
        : undefined
    );

    if (!pruneRequiredFields && field.required === true) {
      continue;
    }
    if (valueEqualsDefault(value, scalarType, descriptor)) {
      delete (message as Record<string, unknown>)[key];
    }
  }
}

function readExplicitDefault(field: Field): unknown {
  if (Object.prototype.hasOwnProperty.call(field, "defaultValue")) {
    return (field as unknown as { defaultValue?: unknown }).defaultValue;
  }
  const options = field.options as Record<string, unknown> | undefined;
  if (options && Object.prototype.hasOwnProperty.call(options, "default")) {
    return options.default;
  }
  return undefined;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "true" || trimmed === "1";
  }
  return value === true;
}

function normalizeBytes(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return Buffer.from(value, "binary").toString("base64");
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("base64");
  }
  if (typeof value === "object" && typeof (value as { toString?: () => string }).toString === "function") {
    return Buffer.from((value as { toString: () => string }).toString(), "binary").toString("base64");
  }
  return String(value);
}

function normalizeNumeric(value: unknown): string {
  if (value === undefined || value === null) {
    return "0";
  }

  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return value.toString();
    }
    return "0";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "object" && value !== null) {
    if ("toString" in value && typeof (value as { toString: () => string }).toString === "function") {
      return (value as { toString: () => string }).toString();
    }
  }
  return String(value);
}

function normalizeFloat(value: unknown): string {
  if (value === undefined || value === null) {
    return "0";
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "NaN";
  }
  if (!Number.isFinite(numeric)) {
    return numeric > 0 ? "Infinity" : "-Infinity";
  }
  return numeric.toString();
}

function resolveEnumDefault(explicit: unknown, enumInfo?: EnumInfo): string {
  if (typeof explicit === "number") {
    return explicit.toString();
  }
  if (typeof explicit === "string") {
    if (!enumInfo) {
      return "0";
    }
    const lookup = enumInfo.values[explicit.toUpperCase()];
    if (typeof lookup === "number") {
      return lookup.toString();
    }
    return "0";
  }
  if (enumInfo && typeof enumInfo.valuesById["0"] === "string") {
    const fallbackKey = enumInfo.valuesById["0"];
    if (fallbackKey) {
      const value = enumInfo.values[fallbackKey.toUpperCase()];
      if (typeof value === "number") {
        return value.toString();
      }
    }
  }
  return "0";
}

function toBrsStringLiteral(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function locateFieldValue(
  message: Record<string, unknown>,
  field: Field
): { key: string; value: unknown } | undefined {
  const candidateKeys = new Set<string>();
  candidateKeys.add(field.name);
  if (typeof field.options === "object" && field.options !== null) {
    const jsonName = (field.options as Record<string, unknown>).jsonName;
    if (typeof jsonName === "string") {
      candidateKeys.add(jsonName);
    }
  }
  const camelName = toCamelCase(field.name);
  candidateKeys.add(camelName);

  for (const key of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(message, key)) {
      return { key, value: (message as Record<string, unknown>)[key] };
    }
  }

  return undefined;
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}
