import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

interface ConditionalEmptyObjectSpread {
  readonly conditional: ESTree.ConditionalExpression;
  readonly property: ESTree.ObjectProperty | null;
}
interface UndefinedCheckedExpression {
  readonly expression: ESTree.Expression;
  readonly isDefinedWhenTrue: boolean;
}
const unwrapParentheses = (node: ESTree.Expression): ESTree.Expression => {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
};
const isEmptyObjectExpression = (node: ESTree.Expression): boolean =>
  node.type === "ObjectExpression" && node.properties.length === 0;
const singleObjectProperty = (
  node: ESTree.Expression
): ESTree.ObjectProperty | null => {
  if (node.type !== "ObjectExpression" || node.properties.length !== 1) {
    return null;
  }
  const [property] = node.properties;
  if (
    property?.type !== "Property" ||
    property.kind !== "init" ||
    property.method ||
    property.computed
  ) {
    return null;
  }
  return property;
};
const conditionalEmptyObjectSpread = (
  node: ESTree.Expression
): ConditionalEmptyObjectSpread | null => {
  const conditional = unwrapParentheses(node);
  if (conditional.type !== "ConditionalExpression") {
    return null;
  }
  if (isEmptyObjectExpression(conditional.consequent)) {
    return {
      conditional,
      property: singleObjectProperty(conditional.alternate),
    };
  }
  if (isEmptyObjectExpression(conditional.alternate)) {
    return {
      conditional,
      property: singleObjectProperty(conditional.consequent),
    };
  }
  return null;
};
const undefinedCheckedExpression = (
  test: ESTree.Expression
): UndefinedCheckedExpression | null => {
  const binary = unwrapParentheses(test);
  if (binary.type !== "BinaryExpression") {
    return null;
  }
  if (binary.operator !== "===" && binary.operator !== "!==") {
    return null;
  }
  const left = unwrapParentheses(binary.left);
  const right = unwrapParentheses(binary.right);
  const leftIsUndefined =
    left.type === "Identifier" && left.name === "undefined";
  const rightIsUndefined =
    right.type === "Identifier" && right.name === "undefined";
  if (leftIsUndefined === rightIsUndefined) {
    return null;
  }
  return {
    expression: leftIsUndefined ? right : left,
    isDefinedWhenTrue: binary.operator === "!==",
  };
};
const canAutofixConditionalEmptyObjectSpread = (
  sourceCode: SourceCode,
  conditional: ESTree.ConditionalExpression,
  property: ESTree.ObjectProperty
): boolean => {
  const checked = undefinedCheckedExpression(conditional.test);
  if (checked === null) {
    return false;
  }
  const propertyIsConsequent = conditional.consequent === property.parent;
  if (propertyIsConsequent !== checked.isDefinedWhenTrue) {
    return false;
  }
  return (
    sourceCode.getText(unwrapParentheses(checked.expression)) ===
    sourceCode.getText(property.value)
  );
};
/** Ban conditional empty-object spreads and autofix equivalent direct property declarations. */
export const noConditionalEmptyObjectSpreadRule = defineRule({
  create(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") {
          return;
        }
        const match = conditionalEmptyObjectSpread(node.argument);
        if (match === null) {
          return;
        }
        const { conditional, property } = match;
        if (
          property !== null &&
          canAutofixConditionalEmptyObjectSpread(
            context.sourceCode,
            conditional,
            property
          )
        ) {
          context.report({
            fix: (fixer) =>
              fixer.replaceText(node, context.sourceCode.getText(property)),
            messageId: "avoid",
            node,
          });
          return;
        }
        context.report({ messageId: "avoid", node });
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow object spreads that conditionally spread an empty object to omit fields.",
    },
    fixable: "code",
    messages: {
      avoid:
        "Do not use conditional empty-object spreads. Prefer a direct property or build the object in separate statements.",
    },
    type: "suggestion",
  },
});
