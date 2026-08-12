import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

import {
  classifyWideningTarget,
  createTypeEnvironment,
  isKnownEvidenceExpression,
} from "../shared/dictionary-types.ts";
import type {
  TypeEnvironment,
  WideningTarget,
} from "../shared/dictionary-types.ts";

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;
const unwrapExpression = (expression: ESTree.Expression): ESTree.Expression => {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
};
const resolveVariable = (
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference
): Variable | null => {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) {
      return variable;
    }
    scope = scope.upper;
  }
  return null;
};
const variableDeclarator = (
  variable: Variable
): ESTree.VariableDeclarator | null => {
  if (variable.defs.length !== 1) {
    return null;
  }
  const [definition] = variable.defs;
  return definition?.type === "Variable" &&
    definition.node.type === "VariableDeclarator"
    ? definition.node
    : null;
};
const isStableConstVariable = (
  variable: Variable,
  declarator: ESTree.VariableDeclarator
): boolean =>
  declarator.parent.type === "VariableDeclaration" &&
  declarator.parent.kind === "const" &&
  variable.references.every(
    (reference) => reference.init || !reference.isWrite()
  );
const hasKnownEvidence = (
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables = new Set<Variable>()
): boolean => {
  if (isKnownEvidenceExpression(expression)) {
    return true;
  }
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== "Identifier") {
    return false;
  }
  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || visitedVariables.has(variable)) {
    return false;
  }
  const declarator = variableDeclarator(variable);
  if (
    declarator === null ||
    declarator.init === null ||
    !isStableConstVariable(variable, declarator)
  ) {
    return false;
  }
  visitedVariables.add(variable);
  return hasKnownEvidence(sourceCode, declarator.init, visitedVariables);
};
const annotationTarget = (
  annotation: ESTree.TSTypeAnnotation | null | undefined,
  environment: TypeEnvironment
): WideningTarget | null =>
  annotation === null || annotation === undefined
    ? null
    : classifyWideningTarget(annotation.typeAnnotation, environment);
const enclosingFunction = (node: ESTree.Node): FunctionExpression | null => {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
};
const sourceKeyName = (
  sourceCode: SourceCode,
  key: ESTree.PropertyKey
): string => {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") {
    return key.name;
  }
  if (key.type === "Literal") {
    return String(key.value);
  }
  return sourceCode.getText(key);
};
const functionName = (
  sourceCode: SourceCode,
  owner: FunctionExpression | null
): string => {
  if (owner === null) {
    return "anonymous function";
  }
  if (owner.id !== null) {
    return owner.id.name;
  }
  const { parent } = owner;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  if (parent.type === "MethodDefinition") {
    return sourceKeyName(sourceCode, parent.key);
  }
  return "anonymous function";
};
const isEmptyObjectExpression = (expression: ESTree.Expression): boolean => {
  const unwrapped = unwrapExpression(expression);
  return (
    unwrapped.type === "ObjectExpression" && unwrapped.properties.length === 0
  );
};
const isDictionaryAccumulatorTarget = (destination: WideningTarget): boolean =>
  destination.kind === "open dictionary" ||
  destination.kind === "generic container";
const hasParentAssertion = (node: ESTree.Node): boolean =>
  node.parent?.type === "TSAsExpression" ||
  node.parent?.type === "TSTypeAssertion";
/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWideningRule = defineRule({
  createOnce(context) {
    let environment: TypeEnvironment | null = null;
    const reportFlow = (
      expression: ESTree.Expression,
      destination: WideningTarget | null,
      subject: string,
      options: Readonly<{
        allowEmptyDictionaryAccumulator?: boolean;
      }> = {}
    ) => {
      if (destination === null) {
        return;
      }
      if (
        options.allowEmptyDictionaryAccumulator === true &&
        isDictionaryAccumulatorTarget(destination) &&
        isEmptyObjectExpression(expression)
      ) {
        return;
      }
      if (!hasKnownEvidence(context.sourceCode, expression)) {
        return;
      }
      context.report({
        data: { subject, target: destination.kind },
        messageId: "widening",
        node: expression,
      });
    };
    const targetFromAnnotation = (
      annotation: ESTree.TSTypeAnnotation | null | undefined
    ) =>
      environment === null ? null : annotationTarget(annotation, environment);
    return {
      AccessorProperty(node) {
        if (node.value === null) {
          return;
        }
        reportFlow(
          node.value,
          targetFromAnnotation(node.typeAnnotation),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``
        );
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === "BlockStatement") {
          return;
        }
        reportFlow(
          node.body,
          targetFromAnnotation(node.returnType),
          `return value of \`${functionName(context.sourceCode, node)}\``
        );
      },
      AssignmentExpression(node) {
        if (node.operator !== "=" || node.left.type !== "Identifier") {
          return;
        }
        const variable = resolveVariable(context.sourceCode, node.left);
        if (variable === null) {
          return;
        }
        const declarator = variableDeclarator(variable);
        if (declarator === null || declarator.id.type !== "Identifier") {
          return;
        }
        reportFlow(
          node.right,
          targetFromAnnotation(declarator.id.typeAnnotation),
          `binding \`${declarator.id.name}\``
        );
      },
      Program(node) {
        environment = createTypeEnvironment(node);
      },
      PropertyDefinition(node) {
        if (node.value === null) {
          return;
        }
        reportFlow(
          node.value,
          targetFromAnnotation(node.typeAnnotation),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``
        );
      },
      ReturnStatement(node) {
        if (node.argument === null) {
          return;
        }
        const owner = enclosingFunction(node);
        reportFlow(
          node.argument,
          targetFromAnnotation(owner?.returnType),
          `return value of \`${functionName(context.sourceCode, owner)}\``
        );
      },
      TSAsExpression(node) {
        if (environment === null || hasParentAssertion(node)) {
          return;
        }
        reportFlow(
          node.expression,
          classifyWideningTarget(node.typeAnnotation, environment),
          "assertion"
        );
      },
      TSTypeAssertion(node) {
        if (environment === null || hasParentAssertion(node)) {
          return;
        }
        reportFlow(
          node.expression,
          classifyWideningTarget(node.typeAnnotation, environment),
          "assertion"
        );
      },
      VariableDeclarator(node) {
        if (node.init === null || node.id.type !== "Identifier") {
          return;
        }
        reportFlow(
          node.init,
          targetFromAnnotation(node.id.typeAnnotation),
          `binding \`${node.id.name}\``,
          { allowEmptyDictionaryAccumulator: true }
        );
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.",
    },
    messages: {
      widening:
        "The known initializer supplying {{subject}} carries established type evidence, but the explicit {{target}} target type discards it. Preserve inference, use `satisfies`, or introduce/use a named owner contract; parse genuinely external data once at its boundary.",
    },
    type: "problem",
  },
});
