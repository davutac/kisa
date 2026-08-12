import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  classifyUnsafeDictionary,
  classifyUnsafeDictionaryValue,
  createTypeEnvironment,
} from "../shared/dictionary-types.ts";
import type { TypeEnvironment } from "../shared/dictionary-types.ts";

const isTypeNode = (node: ESTree.Node): node is ESTree.TSType =>
  node.type.startsWith("TS") && node.type !== "TSTypeAnnotation";
const typeReferenceName = (type: ESTree.TSTypeReference): string | null =>
  type.typeName.type === "Identifier" ? type.typeName.name : null;
const isInsideTypeAliasDeclaration = (node: ESTree.Node): boolean => {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (current.type === "TSTypeAliasDeclaration") {
      return true;
    }
    current = current.parent;
  }
  return false;
};
const isPlainAliasConsumerUse = (
  node: ESTree.TSType,
  environment: TypeEnvironment
): boolean => {
  if (node.type !== "TSTypeReference" || node.typeArguments?.params.length) {
    return false;
  }
  const name = typeReferenceName(node);
  return (
    name !== null &&
    environment.aliases.has(name) &&
    !isInsideTypeAliasDeclaration(node)
  );
};
const shouldReportType = (
  node: ESTree.TSType,
  environment: TypeEnvironment
): boolean => {
  if (isPlainAliasConsumerUse(node, environment)) {
    return false;
  }
  if (classifyUnsafeDictionary(node, environment) === null) {
    return false;
  }
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (
      isTypeNode(current) &&
      classifyUnsafeDictionary(current, environment) !== null
    ) {
      return false;
    }
    current = current.parent;
  }
  return true;
};
/** Disallow object-dictionary contracts whose direct value type is an unsafe escape hatch. */
export const noUnsafeDictionaryTypeRule = defineRule({
  createOnce(context) {
    let environment: TypeEnvironment | null = null;
    const report = (node: ESTree.Node, value: string) => {
      context.report({ data: { value }, messageId: "unsafeDictionary", node });
    };
    const reportIfUnsafe = (node: ESTree.TSType) => {
      if (environment === null || !shouldReportType(node, environment)) {
        return;
      }
      const unsafe = classifyUnsafeDictionary(node, environment);
      if (unsafe === null) {
        return;
      }
      report(node, unsafe.unsafeValue);
    };
    return {
      Program(node) {
        environment = createTypeEnvironment(node);
      },
      TSIndexSignature(node) {
        if (
          environment === null ||
          node.typeAnnotation === null ||
          node.parent.type === "TSTypeLiteral"
        ) {
          return;
        }
        const unsafe = classifyUnsafeDictionaryValue(
          node.typeAnnotation.typeAnnotation,
          environment
        );
        if (unsafe !== null) {
          report(node, unsafe.unsafeValue);
        }
      },
      TSMappedType: reportIfUnsafe,
      TSTypeLiteral: reportIfUnsafe,
      TSTypeReference: reportIfUnsafe,
    };
  },
  meta: {
    docs: {
      description:
        "Disallow object-dictionary contracts whose direct value type is unknown, any, object, {}, or a union/alias containing one of those escape hatches.",
    },
    messages: {
      unsafeDictionary:
        "This object dictionary's direct value type is an unsafe {{value}} escape hatch. Replace it with a concrete owner/schema-derived value type and parse external data at its boundary.",
    },
    type: "problem",
  },
});
