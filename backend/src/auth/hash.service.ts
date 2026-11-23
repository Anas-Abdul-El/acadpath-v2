import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { BCRYPT_SALT_ROUNDS } from './auth.constants.js';

/**
 * bcrypt hashing for passwords and refresh-token signatures (v1: utils/hash.ts).
 * A provider rather than plain functions so tests can spy on it and the cost factor
 * lives in one place.
 */
@Injectable()
export class HashService {
  hash(data: string): Promise<string> {
    return bcrypt.hash(data, BCRYPT_SALT_ROUNDS);
  }

  compare(data: string, hash: string): Promise<boolean> {
    return bcrypt.compare(data, hash);
  }
}
