using Amazon.S3;
using Amazon.S3.Model;

namespace Tims.Infrastructure.CvParsing;

/// <summary>
/// Reads only this candidate's organization's CV prefix. Both the metadata and
/// the streamed body are size checked; If-Match prevents an object replacement
/// between the HEAD and GET from silently changing the evidence being parsed.
/// The client must be constructed for CV_UPLOADS_REGION, not the API region.
/// </summary>
public interface ICvObjectStore
{
    Task<byte[]> FetchAsync(Guid organizationId, string objectKey, CancellationToken ct);
}

public sealed class S3CvObjectStore(IAmazonS3 s3, string bucket) : ICvObjectStore
{
    public async Task<byte[]> FetchAsync(Guid organizationId, string objectKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(bucket)) throw new InvalidOperationException("CV bucket is not configured");
        // Strict: exactly the portal-generated `cv-uploads/{org}/{uuid}.{pdf|docx}`.
        if (!CvObjectKey.IsValid(organizationId, objectKey)) throw new CvDocumentException();

        var head = await s3.GetObjectMetadataAsync(new GetObjectMetadataRequest
        {
            BucketName = bucket,
            Key = objectKey
        }, ct).ConfigureAwait(false);
        if (head.ContentLength is < 1 or > CvTextExtractor.MaxFileBytes ||
            string.IsNullOrWhiteSpace(head.ETag)) throw new CvDocumentException();

        using var response = await s3.GetObjectAsync(new GetObjectRequest
        {
            BucketName = bucket,
            Key = objectKey,
            EtagToMatch = head.ETag
        }, ct).ConfigureAwait(false);
        if (response.ResponseStream is null) throw new CvDocumentException();
        using var output = new MemoryStream((int)head.ContentLength);
        var buffer = new byte[64 * 1024];
        int count;
        while ((count = await response.ResponseStream.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
        {
            if (output.Length + count > CvTextExtractor.MaxFileBytes) throw new CvDocumentException();
            await output.WriteAsync(buffer.AsMemory(0, count), ct).ConfigureAwait(false);
        }
        if (output.Length != head.ContentLength) throw new CvDocumentException();
        return output.ToArray();
    }
}
