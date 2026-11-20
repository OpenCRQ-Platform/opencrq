export const logClientErrorToConsole = (
  error: Error,
  componentStack?: string | null,
  navigationHistory?: unknown,
): void => {
  /* eslint-disable no-console */
  console.group('Client Error Report');
  console.error('Error:', error);
  console.error('Component Stack:', componentStack);
  console.log('Navigation History:', navigationHistory);
  console.groupEnd();
  /* eslint-enable no-console */
};
