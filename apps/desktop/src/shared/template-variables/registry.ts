import type {
  TemplateTextResult,
  TemplateVariableContext,
  TemplateVariableDefinition,
  TemplateVariableInsertionChoice,
} from "./types";
import { accountEmailVariable } from "./variables/account-email";
import { dateVariable } from "./variables/date";
import { datetimeVariable } from "./variables/datetime";
import { timeVariable } from "./variables/time";
import { toEmailVariable } from "./variables/to-email";

export const templateVariableRegistry = [
  dateVariable,
  timeVariable,
  datetimeVariable,
  accountEmailVariable,
  toEmailVariable,
] satisfies readonly TemplateVariableDefinition[];

const indexVariableDefinitions = (
  definitions: readonly TemplateVariableDefinition[]
): ReadonlyMap<string, TemplateVariableDefinition> => {
  const index = new Map<string, TemplateVariableDefinition>();
  const insertionExpressions = new Set<string>();
  for (const definition of definitions) {
    if (index.has(definition.name)) {
      throw new Error(`Duplicate template variable: ${definition.name}`);
    }
    if (definition.pattern.global || definition.pattern.sticky) {
      throw new Error(
        `Template variable regex must be stateless: ${definition.name}`
      );
    }
    for (const insertion of definition.insertions ?? []) {
      if (insertionExpressions.has(insertion.expression)) {
        throw new Error(
          `Duplicate template variable insertion: ${insertion.expression}`
        );
      }
      if (!definition.pattern.test(insertion.expression)) {
        throw new Error(
          `Invalid insertion for template variable ${definition.name}: ${insertion.expression}`
        );
      }
      insertionExpressions.add(insertion.expression);
    }
    index.set(definition.name, definition);
  }
  return index;
};

const variableDefinitionsByName = indexVariableDefinitions(
  templateVariableRegistry
);

const failure = (message: string): TemplateTextResult => ({
  message,
  ok: false,
});

export const listTemplateVariableInsertions =
  (): readonly TemplateVariableInsertionChoice[] =>
    templateVariableRegistry.flatMap((definition) =>
      definition.insertions === undefined
        ? []
        : definition.insertions.map((insertion) => ({
            ...insertion,
            group: definition.group,
          }))
    );

export const resolveTemplateVariableExpression = (
  expression: string,
  context: TemplateVariableContext
): TemplateTextResult => {
  const separator = expression.indexOf(":");
  const name = separator === -1 ? expression : expression.slice(0, separator);
  const definition = variableDefinitionsByName.get(name);
  if (definition === undefined) {
    return failure(`Unknown template variable: ${name}`);
  }
  const match = definition.pattern.exec(expression);
  if (match === null) {
    return failure(`Invalid template variable: ${expression}`);
  }
  return definition.resolve({ context, match });
};
