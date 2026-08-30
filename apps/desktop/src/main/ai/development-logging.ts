const ERROR_CODE = /"code"\s*:\s*"(?<value>[^"\r\n]{1,200})"/u;
const ERROR_MESSAGE = /"message"\s*:\s*"(?<value>[^"\r\n]{1,1000})"/u;
const ERROR_PARAMETER = /"param"\s*:\s*"(?<value>[^"\r\n]{1,200})"/u;
const ERROR_STATUS = /"status"\s*:\s*(?<value>\d{3})/u;
const STRUCTURED_ERROR_MARKER = "ERROR:";

let developmentLoggingEnabled = false;

export const configureDevelopmentAiLogging = (enabled: boolean): void => {
  developmentLoggingEnabled = enabled;
};

const matchErrorField = (pattern: RegExp, value: string): string | undefined =>
  pattern.exec(value)?.groups?.["value"];

const describeCommandError = (stderr: string) => {
  const markerIndex = stderr.indexOf(STRUCTURED_ERROR_MARKER);
  const diagnostic = markerIndex === -1 ? "" : stderr.slice(markerIndex);
  return {
    code: matchErrorField(ERROR_CODE, diagnostic) ?? "[not reported]",
    message: matchErrorField(ERROR_MESSAGE, diagnostic) ?? "[not reported]",
    parameter: matchErrorField(ERROR_PARAMETER, diagnostic) ?? "[not reported]",
    status: matchErrorField(ERROR_STATUS, diagnostic) ?? "[not reported]",
  };
};

const describeError = (error: Error) => ({
  message: error.message,
  name: error.name,
  stack: error.stack,
});

export const logDevelopmentAiError = (
  operation: string,
  error: Error
): void => {
  if (!developmentLoggingEnabled) {
    return;
  }

  // oxlint-disable-next-line no-console -- explicitly development-only diagnostics
  console.error(`[Kisa AI] ${operation} failed`, describeError(error));
};

export const logDevelopmentAiCommandExit = (input: {
  readonly exitCode: number;
  readonly operation: string;
  readonly stderr: string;
}): void => {
  if (!developmentLoggingEnabled) {
    return;
  }

  // oxlint-disable-next-line no-console -- explicitly development-only diagnostics
  console.error(`[Kisa AI] ${input.operation} exited`, {
    error: describeCommandError(input.stderr),
    exitCode: input.exitCode,
  });
};
