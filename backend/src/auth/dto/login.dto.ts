import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

/** Trims and lowercases a string; leaves other types for the validators to reject. */
export const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * POST /api/auth/login body (v1: loginSchema). Only presence is checked, so a wrong or
 * weak password is always a 401; the strength rules belong to sign-up.
 *
 * Decorator order matters here. TypeScript applies decorators from the bottom up, so
 * class-validator runs a property's rules bottom to top, and with `stopAtFirstError`
 * the first failure is the one reported. The basic check (is it a string?) therefore
 * sits closest to the property.
 */
export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Invalid Email' })
  @IsString({ message: 'Email is required' })
  email: string;

  @MinLength(1, { message: 'Password is required' })
  @IsString({ message: 'Password is required' })
  password: string;
}
