import type OpenAI from 'openai';

/** Injection token for the OpenAI SDK client (pointed at OpenRouter). */
export const AI_CLIENT = Symbol('AI_CLIENT');

/** The one SDK method AiService uses, so tests only have to fake that. */
export type AiClient = Pick<OpenAI, 'post'>;

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** One AI call may take this long before the SDK gives up (v1: aiConfig.timeoutMs). */
export const AI_TIMEOUT_MS = 60_000;

/**
 * Retries for transient failures only: the SDK retries connection errors, 408, 409, 429
 * and 5xx, with exponential backoff. A 400 or 401 fails at once.
 */
export const AI_MAX_RETRIES = 2;
