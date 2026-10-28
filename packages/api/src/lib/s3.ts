import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { CV_ALLOWED_CONTENT_TYPES, type CvContentType } from './cv-extraction';

// CV_UPLOADS_REGION (the bucket's own region) is REQUIRED whenever
// CV_UPLOADS_BUCKET is set, with no AWS_REGION fallback and no default. On
// Vercel, AWS_REGION is the serverless function's own region and may not be
// visible to the Edge middleware, which derives the CSP connect-src origin for
// this bucket from CV_UPLOADS_BUCKET + CV_UPLOADS_REGION
// (apps/web/lib/security/csp.ts). A fallback here would let the two runtimes
// silently resolve different regions: the presigned POST URL would then not be
// in connect-src and every CV upload would be blocked by the browser.
let cachedClient: { region: string; client: S3Client } | undefined;

export const CV_MAX_BYTES = 5 * 1024 * 1024;

const CV_EXTENSIONS: Record<CvContentType, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function getCvStorage(): { bucket: string; s3: S3Client } {
  const bucket = process.env.CV_UPLOADS_BUCKET;
  if (!bucket) throw new Error('CV_UPLOADS_BUCKET is not configured');
  const region = process.env.CV_UPLOADS_REGION;
  if (!region) {
    throw new Error(
      "CV_UPLOADS_REGION is not configured (required with CV_UPLOADS_BUCKET; set it to the bucket's region)",
    );
  }
  if (cachedClient?.region !== region) cachedClient = { region, client: new S3Client({ region }) };
  return { bucket, s3: cachedClient.client };
}

// Presigned S3 POST (not PUT): a POST policy supports a content-length-range
// condition, so the size cap and content-type are enforced by S3 itself at
// upload time, not merely trusted from the client.
export async function createCvUploadPresignedPost(
  orgId: string,
  contentType: CvContentType,
): Promise<{ url: string; fields: Record<string, string>; key: string }> {
  const key = `cv-uploads/${orgId}/${randomUUID()}.${CV_EXTENSIONS[contentType]}`;
  const { bucket, s3 } = getCvStorage();
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: bucket,
    Key: key,
    Conditions: [
      ['content-length-range', 0, CV_MAX_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: 300,
  });
  return { url, fields, key };
}

export async function fetchCvObject(key: string): Promise<{ buffer: Buffer; sizeBytes: number }> {
  const { bucket, s3 } = getCvStorage();
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const sizeBytes = head.ContentLength ?? 0;
  if (sizeBytes <= 0 || sizeBytes > CV_MAX_BYTES) {
    throw new Error(`CV object failed server-side size check: ${key} (${sizeBytes} bytes)`);
  }
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) throw new Error(`CV object has no body: ${key}`);
  const buffer = Buffer.from(await obj.Body.transformToByteArray());
  return { buffer, sizeBytes };
}

// ---------------------------------------------------------------------------
// Staff CV download — a short-lived presigned GET for one stored CV object.
// ---------------------------------------------------------------------------

/** Lifetime of a staff CV download link. Long enough to open it, short enough not to circulate. */
export const CV_DOWNLOAD_URL_TTL_SECONDS = 300;

const CV_DOWNLOAD_TYPES: Record<string, { contentType: string; disposition: 'inline' | 'attachment' }> = {
  // A PDF renders in the browser's own viewer on the S3 origin, never on the app origin.
  pdf: { contentType: 'application/pdf', disposition: 'inline' },
  docx: {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    disposition: 'attachment',
  },
};

/**
 * The file extension of a key that lies inside this org's CV upload prefix, or null.
 *
 * Mirrors the shape createCvUploadPresignedPost writes (`cv-uploads/<orgId>/<uuid>.<ext>`). Anything
 * else is refused: another org's prefix, a legacy non-S3 URL, a nested path, or `..` segments. The
 * single-segment name pattern cannot contain `/`, so it cannot climb out of the org prefix.
 */
export function cvKeyExtensionForOrg(orgId: string, key: string): 'pdf' | 'docx' | null {
  const prefix = `cv-uploads/${orgId}/`;
  if (!key.startsWith(prefix)) return null;
  const match = /^[A-Za-z0-9-]{1,64}\.(pdf|docx)$/.exec(key.slice(prefix.length));
  return match ? (match[1] as 'pdf' | 'docx') : null;
}

/**
 * A Content-Disposition value with a header-safe filename: control characters, quotes, backslashes,
 * semicolons, path separators and lone surrogates are removed and the name is capped at 150 code
 * points; the `filename` fallback is ASCII-only and the RFC 5987 `filename*` carries the UTF-8 name.
 */
export function contentDispositionFor(disposition: 'inline' | 'attachment', fileName: string, ext: string): string {
  const cleaned = fileName
    .normalize('NFKC')
    // Lone UTF-16 surrogates make encodeURIComponent throw; a stored name may carry one.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/;]/g, '')
    .trim();
  // Truncate by code point, never mid surrogate pair.
  const base = Array.from(cleaned).slice(0, 150).join('');
  const name = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base || 'cv'}.${ext}`;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Presigned GET for a CV object the caller has already authorized. The key is re-checked here against
 * the org prefix (defence in depth: this function must never sign an arbitrary key).
 */
export async function createCvDownloadUrl(orgId: string, key: string, fileName: string): Promise<string> {
  const ext = cvKeyExtensionForOrg(orgId, key);
  if (!ext) throw new Error('CV key is outside the organization upload prefix');
  const { contentType, disposition } = CV_DOWNLOAD_TYPES[ext];
  const { bucket, s3 } = getCvStorage();
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: contentDispositionFor(disposition, fileName, ext),
    }),
    { expiresIn: CV_DOWNLOAD_URL_TTL_SECONDS },
  );
}
