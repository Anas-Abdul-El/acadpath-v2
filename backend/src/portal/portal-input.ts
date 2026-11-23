import { plainToInstance, type ClassConstructor } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/** Keys the viewer may press. Anything typed as a character is sent as "text" instead. */
export const PORTAL_KEYS = [
  'Enter',
  'Backspace',
  'Tab',
  'Escape',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
] as const;

const FINITE = { allowNaN: false, allowInfinity: false };

// One class per message type (v1: a Zod discriminated union). class-validator has no
// discriminated unions, so parsePortalInput picks the class from `type` first.

class ClickInput {
  @IsIn(['click']) type: 'click';
  @IsNumber(FINITE) @Min(0) @Max(4000) x: number;
  @IsNumber(FINITE) @Min(0) @Max(4000) y: number;
}

class ScrollInput {
  @IsIn(['scroll']) type: 'scroll';
  @IsNumber(FINITE) deltaY: number;
}

class KeyInput {
  @IsIn(['key']) type: 'key';
  @IsIn(PORTAL_KEYS) key: (typeof PORTAL_KEYS)[number];
}

class TextInput {
  @IsIn(['text']) type: 'text';
  @IsString() @MinLength(1) @MaxLength(500) text: string;
}

class BackInput {
  @IsIn(['back']) type: 'back';
}

class ReloadInput {
  @IsIn(['reload']) type: 'reload';
}

class ResizeInput {
  @IsIn(['resize']) type: 'resize';
  @IsNumber(FINITE) width: number;
  @IsNumber(FINITE) height: number;
}

const INPUT_CLASSES = {
  click: ClickInput,
  scroll: ScrollInput,
  key: KeyInput,
  text: TextInput,
  back: BackInput,
  reload: ReloadInput,
  resize: ResizeInput,
};

export type PortalInput =
  | ClickInput
  | ScrollInput
  | KeyInput
  | TextInput
  | BackInput
  | ReloadInput
  | ResizeInput;

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/**
 * Validates one message from the viewer's WebSocket. Returns null for anything that
 * isn't exactly one of the known messages: the socket ignores it. Extra fields are
 * dropped, and scroll and resize values are clamped to sane ranges.
 */
export function parsePortalInput(raw: unknown): PortalInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type } = raw as { type?: unknown };
  if (typeof type !== 'string' || !Object.hasOwn(INPUT_CLASSES, type))
    return null;

  const cls: ClassConstructor<PortalInput> =
    INPUT_CLASSES[type as keyof typeof INPUT_CLASSES];
  const instance = plainToInstance(cls, raw);
  if (validateSync(instance, { whitelist: true }).length > 0) return null;

  // The validated instance is the result (whitelist already stripped extra fields).
  const input = instance;
  if (input.type === 'scroll') input.deltaY = clamp(input.deltaY, -3000, 3000);
  if (input.type === 'resize') {
    input.width = Math.round(clamp(input.width, 320, 1920));
    input.height = Math.round(clamp(input.height, 240, 1200));
  }
  return input;
}
