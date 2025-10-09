import { Namespace, Root, Type, Field } from "protobufjs";

export interface SimpleStringMessageDescriptor {
  type: Type;
  field: Field;
}

export function collectSimpleStringMessages(root: Root): SimpleStringMessageDescriptor[] {
  const messages = collectTypes(root);
  return messages
    .map((type) => {
      const fields = type.fieldsArray;
      if (fields.length !== 1) {
        return undefined;
      }
      const field = fields[0];
      if (field.type !== "string") {
        return undefined;
      }
      return { type, field };
    })
    .filter((descriptor): descriptor is SimpleStringMessageDescriptor => Boolean(descriptor));
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
