/**
 * The AI provider could not be reached or answered with an error (timeout, rate limit,
 * outage) after the SDK's own retries. Usually worth trying again later.
 */
export class AiUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('The AI provider failed, try again later', options);
    this.name = 'AiUnavailableError';
  }
}

/**
 * The provider answered, but the reply was not valid JSON matching the expected DTO.
 * Never filled in or repaired: the caller treats it as "unknown".
 */
export class AiInvalidResponseError extends Error {
  constructor(message = 'The AI returned an invalid response') {
    super(message);
    this.name = 'AiInvalidResponseError';
  }
}
