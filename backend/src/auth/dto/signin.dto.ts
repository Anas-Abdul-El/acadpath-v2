import { Transform } from 'class-transformer';
import {
  IsByteLength,
  IsEmail,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { normalizeEmail } from './login.dto.js';

/**
 * POST /api/auth/signin body: creates an account. The route keeps v1's name ("signin"),
 * though it is a sign-up.
 *
 * There is no role field: every account is a student, and the global ValidationPipe
 * (forbidNonWhitelisted) answers 400 if a client sends one.
 *
 * Rules run bottom to top (see LoginDto), so read each property's list upwards.
 */
export class SigninDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Invalid Email' })
  @IsString({ message: 'Email is required' })
  email: string;

  // bcrypt ignores everything past 72 bytes, so a longer password would be
  // silently truncated. Counted in UTF-8 bytes, not characters.
  @IsByteLength(0, 72, { message: 'Password is too long' })
  @Matches(/^(?=.*\d).{8,}$/, {
    message: 'Password must be at least 8 characters and contain a number',
  })
  @IsString({ message: 'Password is required' })
  password: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1, { message: 'Name is required' })
  @IsString({ message: 'Name is required' })
  name: string;
}
