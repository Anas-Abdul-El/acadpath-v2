import { IsArray, IsUrl } from 'class-validator';

/** The source-discovery AI reply: { sources: ["https://..."] } (v1: sourcesSchema). */
export class SourcesDto {
  @IsArray()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { each: true },
  )
  sources: string[];
}
