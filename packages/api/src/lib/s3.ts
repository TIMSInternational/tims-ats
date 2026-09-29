import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'node:crypto';
import { CV_ALLOWED_CONTENT_TYPES, type CvContentType } from './cv-extraction';

// CV_UPLOADS_REGION (the bucket's region) wins over AWS_REGION: on Vercel,
// AWS_REGION is the serverless function's own region and may not be visible to
// the Edge middleware, which derives the CSP connect-src origin for this bucket
// from the SAME variables (apps/web/lib/security/csp.ts). Set CV_UPLOADS_REGION
// so both resolve identically.
const s3 = new S3Client({ region: process.env.CV_UPLOADS_REGION || process.env.AWS_REGION || 'us-east-1' });

export const CV_MAX_BYTES = 5 * 1024 * 1024;

const CV_EXTENSIONS: Record<CvContentType, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function getBucket(): string {
  const bucket = process.env.CV_UPLOADS_BUCKET;
  if (!bucket) throw new Error('CV_UPLOADS_BUCKET is not configured');
  return bucket;
}

// Presigned S3 POST (not PUT): a POST policy supports a content-length-range
// condition, so the size cap and content-type are enforced by S3 itself at
// upload time, not merely trusted from the client.
export async function createCvUploadPresignedPost(
  orgId: string,
  contentType: CvContentType,
): Promise<{ url: string; fields: Record<string, string>; key: string }> {
  const key = `cv-uploads/${orgId}/${randomUUID()}.${CV_EXTENSIONS[contentType]}`;
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: getBucket(),
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
  const bucket = getBucket();
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
