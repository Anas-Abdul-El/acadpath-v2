import { Injectable, type PipeTransform } from '@nestjs/common';
import { ValidationFailedException } from '../validation/validation-failed.exception.js';

/**
 * Rejects a body with no fields set, for PATCH routes where every field is optional.
 * Use it as a parameter pipe: `@Body(AtLeastOneFieldPipe) dto: UpdateProfileDto`.
 *
 * Global pipes run before parameter pipes, so this receives the DTO the
 * ValidationPipe already validated and whitelisted. Fields are checked against
 * undefined because DTO class fields exist on the instance even when not sent.
 */
@Injectable()
export class AtLeastOneFieldPipe implements PipeTransform<object, object> {
  transform(value: object): object {
    if (Object.values(value).some((field) => field !== undefined)) return value;

    throw new ValidationFailedException([
      { path: '', message: 'Send at least one field to update' },
    ]);
  }
}
