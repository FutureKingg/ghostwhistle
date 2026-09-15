export class GhostWhistleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'GhostWhistleError';
  }
}

export const invalidInput = (message: string) => new GhostWhistleError(message, 'INVALID_INPUT');
export const policyViolation = (message: string) => new GhostWhistleError(message, 'POLICY_VIOLATION');
export const duplicateSubmission = (message = 'This submission has already been accepted.') =>
  new GhostWhistleError(message, 'DUPLICATE_SUBMISSION');
