import { validateEnv } from './env.validation.js';

const accessSecret = 'a'.repeat(32);
const refreshSecret = 'r'.repeat(32);

const validEnv = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/acadpath',
  ACCESS_TOKEN_SECRET: accessSecret,
  REFRESH_TOKEN_SECRET: refreshSecret,
  OPENROUTER_KEY: 'sk-or-test',
  REDIS_URL: 'redis://localhost:6379',
  OPENROUTER_VISION_MODEL: 'vendor/vision-model',
  S3_BUCKET: 'acadpath-uploads',
  S3_ACCESS_KEY_ID: 'dev-access-key',
  S3_SECRET_ACCESS_KEY: 'dev-secret-key',
};

describe('validateEnv', () => {
  it('returns the validated variables', () => {
    const env = validateEnv({ ...validEnv, PORT: '4000' });

    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.ACCESS_TOKEN_SECRET).toBe(accessSecret);
    expect(env.REFRESH_TOKEN_SECRET).toBe(refreshSecret);
    // Env values are strings; PORT is converted to a number.
    expect(env.PORT).toBe(4000);
  });

  it('defaults NODE_ENV to development and PORT to 3000', () => {
    const env = validateEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it.each([
    'DATABASE_URL',
    'ACCESS_TOKEN_SECRET',
    'REFRESH_TOKEN_SECRET',
    'OPENROUTER_KEY',
    'REDIS_URL',
    'OPENROUTER_VISION_MODEL',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ])('refuses to start without %s', (name) => {
    const env: Record<string, unknown> = { ...validEnv };
    delete env[name];

    expect(() => validateEnv(env)).toThrow(name);
  });

  it('rejects a token secret shorter than 32 characters', () => {
    expect(() =>
      validateEnv({ ...validEnv, ACCESS_TOKEN_SECRET: 'too-short' }),
    ).toThrow('ACCESS_TOKEN_SECRET must be at least 32 characters');
  });

  it('rejects identical access and refresh secrets', () => {
    expect(() =>
      validateEnv({ ...validEnv, REFRESH_TOKEN_SECRET: accessSecret }),
    ).toThrow('ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be different');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      'NODE_ENV',
    );
  });

  it('defaults the AI model to the one v1 used', () => {
    expect(validateEnv(validEnv).OPENROUTER_MODEL).toBe(
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    );
  });

  it('accepts a different AI model from the environment', () => {
    expect(
      validateEnv({ ...validEnv, OPENROUTER_MODEL: 'other/model' })
        .OPENROUTER_MODEL,
    ).toBe('other/model');
  });

  it('rejects a REDIS_URL that is not a redis:// URL', () => {
    expect(() =>
      validateEnv({ ...validEnv, REDIS_URL: 'http://localhost:6379' }),
    ).toThrow('REDIS_URL');
  });

  it('defaults the S3 region and leaves the endpoint unset (AWS)', () => {
    const env = validateEnv(validEnv);
    expect(env.S3_REGION).toBe('us-east-1');
    expect(env.S3_ENDPOINT).toBeUndefined();
  });

  it('accepts an S3-compatible endpoint URL', () => {
    expect(
      validateEnv({ ...validEnv, S3_ENDPOINT: 'http://seaweedfs:8333' })
        .S3_ENDPOINT,
    ).toBe('http://seaweedfs:8333');
  });

  it('rejects an S3 endpoint that is not an http(s) URL', () => {
    expect(() =>
      validateEnv({ ...validEnv, S3_ENDPOINT: 'seaweedfs:8333' }),
    ).toThrow('S3_ENDPOINT');
  });
});
