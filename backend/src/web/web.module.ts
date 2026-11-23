import { Module } from '@nestjs/common';
import { PageReader } from './page-reader.service.js';
import { fetchPublicUrl } from './safe-fetch.js';
import { WEB_FETCH } from './web.constants.js';

/**
 * Reading pages from the internet. WEB_FETCH is a value provider: Nest injects the
 * fetchPublicUrl function itself, and tests swap it for a fake.
 * Docs: https://docs.nestjs.com/fundamentals/custom-providers#value-providers-usevalue
 */
@Module({
  providers: [PageReader, { provide: WEB_FETCH, useValue: fetchPublicUrl }],
  exports: [PageReader],
})
export class WebModule {}
