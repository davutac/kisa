export interface TemplateVariableContext {
  readonly accountEmail?: string;
  readonly accountName?: string;
  readonly locale?: string;
  readonly now: number;
  readonly toEmail?: string;
}

export type TemplateTextResult =
  | { readonly ok: true; readonly value: string }
  | { readonly message: string; readonly ok: false };

export interface TemplateVariableInsertion {
  readonly description: string;
  readonly emptyPreview?: string;
  readonly expression: string;
  readonly label: string;
}

export interface TemplateVariableInsertionChoice extends TemplateVariableInsertion {
  readonly group: string;
}

export interface TemplateVariableResolveRequest {
  readonly context: TemplateVariableContext;
  readonly match: RegExpExecArray;
}

export interface TemplateVariableDefinition {
  readonly group: string;
  readonly insertions?: readonly TemplateVariableInsertion[];
  readonly name: string;
  readonly pattern: RegExp;
  readonly resolve: (
    request: TemplateVariableResolveRequest
  ) => TemplateTextResult;
}
