import type { ESTree } from "@oxlint/plugins";

const BUILT_INS = new Set([
  "Record",
  "Readonly",
  "Partial",
  "Required",
  "Pick",
  "Omit",
  "PropertyKey",
  "NonNullable",
]);
const TRANSPARENT_WRAPPERS = new Set([
  "Readonly",
  "Partial",
  "Required",
  "NonNullable",
]);
type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;
interface ResolvedType {
  readonly type: ESTree.TSType;
  readonly substitutions: TypeAliasEnvironment;
}
export interface UnsafeDictionary {
  readonly kind: "unsafe-dictionary";
  readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
}
export type WideningTargetKind =
  | "anonymous object"
  | "generic container"
  | "object"
  | "open dictionary"
  | "unknown";
export interface WideningTarget {
  readonly kind: WideningTargetKind;
}
export interface TypeEnvironment {
  readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
  readonly interfaces: ReadonlyMap<
    string,
    readonly ESTree.TSInterfaceDeclaration[]
  >;
  readonly shadowedBuiltIns: ReadonlySet<string>;
}
const declaredStatement = (statement: ESTree.Statement): ESTree.Node | null =>
  statement.type === "ExportNamedDeclaration" ||
  statement.type === "ExportDefaultDeclaration"
    ? (statement.declaration ?? null)
    : statement;
interface TypeEnvironmentRegistry {
  readonly aliases: Map<string, ESTree.TSTypeAliasDeclaration>;
  readonly interfaces: Map<string, ESTree.TSInterfaceDeclaration[]>;
  readonly shadowedBuiltIns: Set<string>;
}
const markShadowedBuiltIn = (
  name: string,
  registry: TypeEnvironmentRegistry
): void => {
  if (BUILT_INS.has(name)) {
    registry.shadowedBuiltIns.add(name);
  }
};
const registerDeclaration = (
  declaration: ESTree.Node | null,
  registry: TypeEnvironmentRegistry
): void => {
  if (declaration?.type === "ImportDeclaration") {
    for (const specifier of declaration.specifiers) {
      if (BUILT_INS.has(specifier.local.name)) {
        registry.shadowedBuiltIns.add(specifier.local.name);
      }
    }
    return;
  }
  if (declaration?.type === "TSTypeAliasDeclaration") {
    const existing = registry.aliases.get(declaration.id.name);
    if (existing === undefined) {
      registry.aliases.set(declaration.id.name, declaration);
    } else {
      registry.shadowedBuiltIns.add(declaration.id.name);
    }
    markShadowedBuiltIn(declaration.id.name, registry);
    return;
  }
  if (declaration?.type === "TSInterfaceDeclaration") {
    const declarations = registry.interfaces.get(declaration.id.name) ?? [];
    declarations.push(declaration);
    registry.interfaces.set(declaration.id.name, declarations);
    markShadowedBuiltIn(declaration.id.name, registry);
    return;
  }
  if (declaration?.type === "TSEnumDeclaration") {
    markShadowedBuiltIn(declaration.id.name, registry);
    return;
  }
  if (
    (declaration?.type === "ClassDeclaration" ||
      declaration?.type === "FunctionDeclaration") &&
    declaration.id !== null &&
    BUILT_INS.has(declaration.id.name)
  ) {
    registry.shadowedBuiltIns.add(declaration.id.name);
  }
};
export const createTypeEnvironment = (
  program: ESTree.Program
): TypeEnvironment => {
  const registry: TypeEnvironmentRegistry = {
    aliases: new Map(),
    interfaces: new Map(),
    shadowedBuiltIns: new Set(),
  };
  for (const statement of program.body) {
    registerDeclaration(declaredStatement(statement), registry);
  }
  return registry;
};
const typeReferenceName = (type: ESTree.TSTypeReference): string | null =>
  type.typeName.type === "Identifier" ? type.typeName.name : null;
const isBuiltIn = (name: string, environment: TypeEnvironment): boolean =>
  BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
const unwrapTransparentType = (type: ESTree.TSType): ESTree.TSType => {
  let current = type;
  while (
    current.type === "TSParenthesizedType" ||
    (current.type === "TSTypeOperator" && current.operator === "readonly")
  ) {
    current = current.typeAnnotation;
  }
  return current;
};
const isUnappliedReferenceTo = (type: ESTree.TSType, name: string): boolean => {
  const unwrapped = unwrapTransparentType(type);
  return (
    unwrapped.type === "TSTypeReference" &&
    typeReferenceName(unwrapped) === name &&
    (unwrapped.typeArguments === null ||
      unwrapped.typeArguments === undefined ||
      unwrapped.typeArguments.params.length === 0)
  );
};
const isNeverType = (type: ESTree.TSType): boolean =>
  unwrapTransparentType(type).type === "TSNeverKeyword";
const isEffectivelyEmptyMember = (member: ESTree.TSSignature): boolean =>
  member.type === "TSPropertySignature" &&
  member.optional === true &&
  member.typeAnnotation !== null &&
  member.typeAnnotation !== undefined &&
  isNeverType(member.typeAnnotation.typeAnnotation);
const isEffectivelyEmptyTypeLiteral = (type: ESTree.TSTypeLiteral): boolean =>
  type.members.length === 0 || type.members.every(isEffectivelyEmptyMember);
const isEffectivelyEmptyInterface = (
  declarations: readonly ESTree.TSInterfaceDeclaration[]
): boolean => {
  if (declarations.length !== 1) {
    return false;
  }
  const [type] = declarations;
  return (
    type !== undefined &&
    type.extends.length === 0 &&
    (type.body.body.length === 0 ||
      type.body.body.every(isEffectivelyEmptyMember))
  );
};
const resolvedSubstitutionArgument = (
  type: ESTree.TSType,
  base: TypeAliasEnvironment
): ESTree.TSType => {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type !== "TSTypeReference") {
    return type;
  }
  const name = typeReferenceName(unwrapped);
  if (name === null) {
    return type;
  }
  const substitution = base.get(name);
  return substitution === undefined
    ? type
    : resolvedSubstitutionArgument(substitution, base);
};
const aliasSubstitution = (
  alias: ESTree.TSTypeAliasDeclaration,
  type: ESTree.TSTypeReference,
  base: TypeAliasEnvironment
): TypeAliasEnvironment | null => {
  const parameters = alias.typeParameters?.params ?? [];
  const arguments_ = type.typeArguments?.params ?? [];
  const next = new Map(base);
  for (const [index, parameter] of parameters.entries()) {
    const argument = arguments_[index] ?? parameter.default;
    if (argument === null || argument === undefined) {
      return null;
    }
    next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
  }
  return next;
};
const unsafeSimpleValue = (
  type: ESTree.TSType
): UnsafeDictionary["unsafeValue"] | null | undefined => {
  if (type.type === "TSUnknownKeyword") {
    return "unknown";
  }
  if (type.type === "TSAnyKeyword") {
    return "any";
  }
  if (type.type === "TSObjectKeyword") {
    return "object";
  }
  if (type.type === "TSTypeLiteral" && isEffectivelyEmptyTypeLiteral(type)) {
    return "empty-object";
  }
  return type.type === "TSUnionType" ||
    type.type === "TSIntersectionType" ||
    type.type === "TSTypeReference"
    ? undefined
    : null;
};
const unsafeIntersectionValue = (
  types: readonly ESTree.TSType[],
  resolve: (type: ESTree.TSType) => UnsafeDictionary["unsafeValue"] | null
): UnsafeDictionary["unsafeValue"] | null => {
  const unsafeMembers = types.map(resolve);
  if (unsafeMembers.includes("any")) {
    return "any";
  }
  return unsafeMembers.length > 0 &&
    unsafeMembers.every((member) => member !== null)
    ? unsafeMembers[0]
    : null;
};
const unsafeDirectValue = (
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>
): UnsafeDictionary["unsafeValue"] | null => {
  const unwrapped = unwrapTransparentType(type);
  const simpleValue = unsafeSimpleValue(unwrapped);
  if (simpleValue !== undefined) {
    return simpleValue;
  }
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some(
      (member) =>
        unsafeDirectValue(
          member,
          environment,
          substitutions,
          resolvingAliases
        ) !== null
    )
      ? "union"
      : null;
  }
  if (unwrapped.type === "TSIntersectionType") {
    return unsafeIntersectionValue(unwrapped.types, (member) =>
      unsafeDirectValue(member, environment, substitutions, resolvingAliases)
    );
  }
  if (unwrapped.type !== "TSTypeReference") {
    return null;
  }
  const name = typeReferenceName(unwrapped);
  if (name === null) {
    return null;
  }
  if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : unsafeDirectValue(
          wrapped,
          environment,
          substitutions,
          resolvingAliases
        );
  }
  const substitution = substitutions.get(name);
  if (substitution !== undefined) {
    return isUnappliedReferenceTo(substitution, name)
      ? null
      : unsafeDirectValue(
          substitution,
          environment,
          substitutions,
          resolvingAliases
        );
  }
  const interfaceDeclarations = environment.interfaces.get(name);
  if (interfaceDeclarations !== undefined) {
    return isEffectivelyEmptyInterface(interfaceDeclarations)
      ? "empty-object"
      : null;
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) {
    return null;
  }
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
  if (nextSubstitutions === null) {
    return null;
  }
  const nextResolving = new Set([...resolvingAliases, name]);
  return unsafeDirectValue(
    alias.typeAnnotation,
    environment,
    nextSubstitutions,
    nextResolving
  );
};
const immediateDictionaryValueTypes = (
  type: ESTree.TSType,
  substitutions: TypeAliasEnvironment
): readonly ResolvedType[] | undefined => {
  if (type.type === "TSTypeLiteral") {
    return type.members.flatMap((member): readonly ResolvedType[] =>
      member.type === "TSIndexSignature" && member.typeAnnotation !== null
        ? [{ substitutions, type: member.typeAnnotation.typeAnnotation }]
        : []
    );
  }
  if (type.type === "TSMappedType") {
    return type.typeAnnotation === null
      ? []
      : [{ substitutions, type: type.typeAnnotation }];
  }
  return type.type === "TSTypeReference" ? undefined : [];
};
interface DictionaryReferenceResolution {
  readonly environment: TypeEnvironment;
  readonly resolvingAliases: ReadonlySet<string>;
  readonly substitutions: TypeAliasEnvironment;
}
const standardDictionaryReference = (
  type: ESTree.TSTypeReference,
  name: string,
  resolution: DictionaryReferenceResolution,
  resolve: (type: ESTree.TSType) => readonly ResolvedType[]
): readonly ResolvedType[] | undefined => {
  const substitution = resolution.substitutions.get(name);
  if (substitution !== undefined) {
    return isUnappliedReferenceTo(substitution, name)
      ? []
      : resolve(substitution);
  }
  if (
    TRANSPARENT_WRAPPERS.has(name) &&
    isBuiltIn(name, resolution.environment)
  ) {
    const wrapped = type.typeArguments?.params[0];
    return wrapped === undefined ? [] : resolve(wrapped);
  }
  if (name === "Record" && isBuiltIn(name, resolution.environment)) {
    const value = type.typeArguments?.params[1] ?? null;
    return value === null
      ? []
      : [{ substitutions: resolution.substitutions, type: value }];
  }
  if (
    (name === "Pick" || name === "Omit") &&
    isBuiltIn(name, resolution.environment)
  ) {
    const source = type.typeArguments?.params[0];
    return source === undefined ? [] : resolve(source);
  }
  return undefined;
};
const dictionaryValueTypes = (
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>
): readonly ResolvedType[] => {
  const unwrapped = unwrapTransparentType(type);
  const immediate = immediateDictionaryValueTypes(unwrapped, substitutions);
  if (immediate !== undefined) {
    return immediate;
  }
  if (unwrapped.type !== "TSTypeReference") {
    return [];
  }
  const name = typeReferenceName(unwrapped);
  if (name === null) {
    return [];
  }
  const standardValues = standardDictionaryReference(
    unwrapped,
    name,
    { environment, resolvingAliases, substitutions },
    (referencedType) =>
      dictionaryValueTypes(
        referencedType,
        environment,
        substitutions,
        resolvingAliases
      )
  );
  if (standardValues !== undefined) {
    return standardValues;
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) {
    return [];
  }
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
  if (nextSubstitutions === null) {
    return [];
  }
  const nextResolving = new Set([...resolvingAliases, name]);
  return dictionaryValueTypes(
    alias.typeAnnotation,
    environment,
    nextSubstitutions,
    nextResolving
  );
};
export const classifyUnsafeDictionaryValue = (
  valueType: ESTree.TSType,
  environment: TypeEnvironment
): UnsafeDictionary | null => {
  const unsafeValue = unsafeDirectValue(
    valueType,
    environment,
    new Map(),
    new Set()
  );
  return unsafeValue === null
    ? null
    : { kind: "unsafe-dictionary", unsafeValue };
};
export const classifyUnsafeDictionary = (
  type: ESTree.TSType,
  environment: TypeEnvironment
): UnsafeDictionary | null => {
  for (const valueType of dictionaryValueTypes(
    type,
    environment,
    new Map(),
    new Set()
  )) {
    const unsafeValue = unsafeDirectValue(
      valueType.type,
      environment,
      valueType.substitutions,
      new Set()
    );
    if (unsafeValue !== null) {
      return { kind: "unsafe-dictionary", unsafeValue };
    }
  }
  return null;
};
const resolvesToDictionary = (
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>
): boolean =>
  dictionaryValueTypes(type, environment, substitutions, resolvingAliases)
    .length > 0;
const directWideningTarget = (
  type: ESTree.TSType
): WideningTarget | null | undefined => {
  if (type.type === "TSUnknownKeyword") {
    return { kind: "unknown" };
  }
  if (type.type === "TSObjectKeyword") {
    return { kind: "object" };
  }
  if (type.type === "TSTypeLiteral") {
    if (type.members.some((member) => member.type === "TSIndexSignature")) {
      return { kind: "open dictionary" };
    }
    return type.members.length > 0 ? { kind: "anonymous object" } : null;
  }
  if (type.type === "TSMappedType") {
    return { kind: "open dictionary" };
  }
  return type.type === "TSTypeReference" ? undefined : null;
};
const classifyAliasBroadTarget = (
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>
): WideningTarget | null => {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnknownKeyword") {
    return { kind: "unknown" };
  }
  if (unwrapped.type === "TSObjectKeyword") {
    return { kind: "object" };
  }
  if (unwrapped.type !== "TSTypeReference") {
    return null;
  }
  const name = typeReferenceName(unwrapped);
  if (name === null) {
    return null;
  }
  const substitution = substitutions.get(name);
  if (substitution !== undefined) {
    return classifyAliasBroadTarget(
      substitution,
      environment,
      substitutions,
      resolvingAliases
    );
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) {
    return null;
  }
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
  if (nextSubstitutions === null) {
    return null;
  }
  return classifyAliasBroadTarget(
    alias.typeAnnotation,
    environment,
    nextSubstitutions,
    new Set([...resolvingAliases, name])
  );
};
export const classifyWideningTarget = (
  type: ESTree.TSType,
  environment: TypeEnvironment
): WideningTarget | null => {
  const unwrapped = unwrapTransparentType(type);
  const directTarget = directWideningTarget(unwrapped);
  if (directTarget !== undefined) {
    return directTarget;
  }
  if (unwrapped.type !== "TSTypeReference") {
    return null;
  }
  const name = typeReferenceName(unwrapped);
  if (name === null) {
    return null;
  }
  if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : classifyWideningTarget(wrapped, environment);
  }
  if (name === "Record" && isBuiltIn(name, environment)) {
    return { kind: "open dictionary" };
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined) {
    return null;
  }
  if ((alias.typeParameters?.params.length ?? 0) > 0) {
    const substitutions = aliasSubstitution(alias, unwrapped, new Map());
    return substitutions !== null &&
      resolvesToDictionary(
        alias.typeAnnotation,
        environment,
        substitutions,
        new Set([name])
      )
      ? { kind: "generic container" }
      : null;
  }
  const substitutions = aliasSubstitution(alias, unwrapped, new Map());
  if (substitutions === null) {
    return null;
  }
  const resolved = classifyAliasBroadTarget(
    alias.typeAnnotation,
    environment,
    substitutions,
    new Set([name])
  );
  return resolved;
};
export const isPopulatedObjectExpression = (
  expression: ESTree.Expression
): boolean => {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current.type === "ObjectExpression" && current.properties.length > 0;
};
export const isKnownEvidenceExpression = (
  expression: ESTree.Expression
): boolean => {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression"
  ) {
    current = current.expression;
  }
  if (current.type === "ObjectExpression") {
    return true;
  }
  return (
    current.type === "ArrayExpression" ||
    current.type === "ArrowFunctionExpression" ||
    current.type === "ClassExpression" ||
    current.type === "FunctionExpression" ||
    current.type === "NewExpression" ||
    current.type === "Literal" ||
    current.type === "TemplateLiteral" ||
    current.type === "UnaryExpression"
  );
};
