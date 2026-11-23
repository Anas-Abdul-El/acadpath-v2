import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';
import { AI_CLIENT } from './ai.constants.js';
import { AiInvalidResponseError, AiUnavailableError } from './ai.errors.js';
import { AiService } from './ai.service.js';

class ItemDto {
  @IsString()
  code: string;

  @IsInt()
  credits: number;
}

class ReplyDto {
  // @ValidateNested alone lets `undefined` through; @IsArray makes the field required.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];
}

/** A chat completion as OpenRouter returns it, with `content` as the model's reply. */
const completion = (content: string | null) => ({
  choices: [{ message: { content } }],
});

describe('AiService', () => {
  // The OpenAI SDK client, mocked: no real (paid) AI call ever happens in tests.
  const client = { post: vi.fn() };
  let ai: AiService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: AI_CLIENT, useValue: client },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            OPENROUTER_MODEL: 'test/model',
            OPENROUTER_VISION_MODEL: 'test/vision',
          }),
        },
      ],
    }).compile();
    ai = moduleRef.get(AiService);
  });

  const ask = (options: { webSearch?: boolean } = {}) =>
    ai.askForJson('SYSTEM PROMPT', { major: 'CS' }, ReplyDto, options);

  it('sends the system prompt and the JSON payload to the configured model', async () => {
    client.post.mockResolvedValue(completion('{"items":[]}'));

    await ask();

    expect(client.post).toHaveBeenCalledWith('/chat/completions', {
      body: {
        model: 'test/model',
        messages: [
          { role: 'system', content: 'SYSTEM PROMPT' },
          { role: 'user', content: '{"major":"CS"}' },
        ],
      },
    });
  });

  it("adds OpenRouter's web-search tool only when asked", async () => {
    client.post.mockResolvedValue(completion('{"items":[]}'));

    await ask({ webSearch: true });

    const [, { body }] = client.post.mock.calls[0] as [
      string,
      { body: { tools: unknown } },
    ];
    expect(body.tools).toEqual([
      {
        type: 'openrouter:web_search',
        parameters: { engine: 'exa', max_results: 5 },
      },
    ]);
  });

  it('returns the reply validated and turned into DTO instances', async () => {
    client.post.mockResolvedValue(
      completion('{"items":[{"code":"CSCI 250","credits":3}]}'),
    );

    const reply = await ask();

    expect(reply).toBeInstanceOf(ReplyDto);
    expect(reply.items[0]).toBeInstanceOf(ItemDto);
    expect(reply.items[0]).toEqual({ code: 'CSCI 250', credits: 3 });
  });

  it('accepts JSON wrapped in a ```json code fence', async () => {
    client.post.mockResolvedValue(
      completion('```json\n{"items":[{"code":"X 1","credits":0}]}\n```'),
    );

    await expect(ask()).resolves.toEqual({
      items: [{ code: 'X 1', credits: 0 }],
    });
  });

  it('drops fields the DTO does not declare', async () => {
    client.post.mockResolvedValue(
      completion('{"items":[{"code":"X 1","credits":1,"secret":"x"}]}'),
    );

    const reply = await ask();
    expect(reply.items[0]).not.toHaveProperty('secret');
  });

  it.each([
    ['not JSON', 'Sure! Here are the courses: ...'],
    ['an empty reply', null],
    [
      'JSON that breaks the DTO rules',
      '{"items":[{"code":"X 1","credits":"three"}]}',
    ],
    ['JSON missing a required field', '{"courses":[]}'],
  ])('rejects %s as an invalid response', async (_case, content) => {
    client.post.mockResolvedValue(completion(content));

    await expect(ask()).rejects.toThrow(AiInvalidResponseError);
  });

  it('reports a provider failure as unavailable, keeping the cause', async () => {
    const cause = new Error('503 Service Unavailable');
    client.post.mockRejectedValue(cause);

    const error: unknown = await ask().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).cause).toBe(cause);
  });

  describe('with attachments (images, scanned PDFs)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const pdf = Buffer.from('%PDF-1.4');

    it('switches to the vision model and sends the files as content parts', async () => {
      client.post.mockResolvedValue(completion('{"items":[]}'));

      await ai.askForJson('SYSTEM PROMPT', { major: 'CS' }, ReplyDto, {
        attachments: [
          { data: png, mimeType: 'image/png', fileName: 'page1.png' },
          { data: pdf, mimeType: 'application/pdf', fileName: 'scan.pdf' },
        ],
      });

      expect(client.post).toHaveBeenCalledWith('/chat/completions', {
        body: {
          model: 'test/vision',
          messages: [
            { role: 'system', content: 'SYSTEM PROMPT' },
            {
              role: 'user',
              content: [
                { type: 'text', text: '{"major":"CS"}' },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${png.toString('base64')}`,
                  },
                },
                {
                  type: 'file',
                  file: {
                    filename: 'scan.pdf',
                    file_data: `data:application/pdf;base64,${pdf.toString('base64')}`,
                  },
                },
              ],
            },
          ],
        },
      });
    });

    it('keeps the text model and a plain string message when nothing is attached', async () => {
      client.post.mockResolvedValue(completion('{"items":[]}'));

      await ai.askForJson('P', {}, ReplyDto, { attachments: [] });

      const [, { body }] = client.post.mock.calls[0] as [
        string,
        { body: { model: string; messages: { content: unknown }[] } },
      ];
      expect(body.model).toBe('test/model');
      expect(body.messages[1].content).toBe('{}');
    });
  });
});
