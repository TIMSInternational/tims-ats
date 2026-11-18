import { serializeJsonLd, type JsonLdObject } from '../../_lib/job-posting';

/**
 * Server-rendered schema.org JobPosting data block. The JSON is the element's text child: React writes a
 * script's string child as-is (no HTML entity escaping), and serializeJsonLd has already escaped `<`, `>` and
 * `&`, so the body can never end the element early. A data block is not executed, so the CSP is unaffected.
 */
export function JobPostingJsonLd({ posting }: { posting: JsonLdObject }) {
  return <script type="application/ld+json">{serializeJsonLd(posting)}</script>;
}
