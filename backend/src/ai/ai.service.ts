import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { AI_CLIENT, type AiClient } from './ai.constants.js';
import { AiInvalidResponseError, AiUnavailableError } from './ai.errors.js';

/** OpenRouter's server-side web search (v1: the same tool in libs/model.ts). */
const WEB_SEARCH_TOOL = {
  type: 'openrouter:web_search',
  parameters: { engine: 'exa', max_results: 5 },
} as const;

/** Removes a ```json ... ``` fence some models wrap their JSON in. */
function parseJsonReply(reply: string): unknown {
  try {
    return JSON.parse(reply.replace(/^```(?:json)?|```$/g, '').trim());
  } catch {
    return undefined;
  }
}

/** Reads choices[0].message.content without trusting the response's shape. */
function replyText(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const { choices } = response as { choices?: unknown };
  if (!Array.isArray(choices)) return null;
  const message: unknown = (choices[0] as { message?: unknown } | undefined)
    ?.message;
  const content: unknown = (message as { content?: unknown } | undefined)
    ?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * The only place the app calls the AI provider (v1: libs/model.ts + services/shared/ai.ts).
 * The key and model come from validated config; replies are validated against a
 * class-validator DTO and never repaired or guessed.
 */
@Injectable()
export class AiService {
  private readonly model: string;

  constructor(
    @Inject(AI_CLIENT) private readonly client: AiClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.model = config.getOrThrow('OPENROUTER_MODEL', { infer: true });
  }

  /**
   * Sends `prompt` as the system message and `payload` as JSON in the user message,
   * then returns the reply parsed into `dto`.
   *
   * @throws AiUnavailableError when the provider fails (after the SDK's retries)
   * @throws AiInvalidResponseError when the reply isn't valid JSON for `dto`
   */
  async askForJson<T extends object>(
    prompt: string,
    payload: unknown,
    dto: ClassConstructor<T>,
    { webSearch = false }: { webSearch?: boolean } = {},
  ): Promise<T> {
    let response: unknown;
    try {
      // client.post instead of chat.completions.create: OpenRouter's web-search tool
      // isn't in the SDK's types. post() goes through the same timeout and retries.
      response = await this.client.post('/chat/completions', {
        body: {
          model: this.model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: JSON.stringify(payload) },
          ],
          ...(webSearch && { tools: [WEB_SEARCH_TOOL] }),
        },
      });
    } catch (error) {
      throw new AiUnavailableError({ cause: error });
    }

    const text = replyText(response);
    const json = text === null ? undefined : parseJsonReply(text);
    if (typeof json !== 'object' || json === null) {
      throw new AiInvalidResponseError();
    }

    const instance = plainToInstance(dto, json);
    // whitelist drops anything the DTO doesn't declare; forbidUnknownValues rejects
    // values that aren't DTO instances at all.
    const errors = await validate(instance, {
      whitelist: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) throw new AiInvalidResponseError();
    return instance;
  }
}
