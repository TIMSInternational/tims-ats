using System.Net;
using System.Security.Cryptography;
using Amazon.S3;
using Amazon.S3.Model;
using SkiaSharp;
using Tims.Application.Proctoring;

namespace Tims.Infrastructure.Proctoring;

/// <summary>
/// Browser-writable staging is never an inference input. A conditional copy to
/// a server-only key seals bytes after a bounded read and content check.
/// </summary>
public sealed class S3ProctoringEvidenceStore(
    IAmazonS3 s3, string bucketName, string kmsKeyArn) : IProctoringEvidenceStore
{
    // The store is scoped by DI, so this gate must be process-wide. Acquire it
    // before S3 reads: each seal can hold multiple 4 MB managed buffers plus a
    // native bitmap of up to 4096 x 2160 pixels. Holding the slot across S3
    // calls intentionally bounds that memory even when a remote call is slow.
    private const int ConcurrentSealLimit = 4;
    private const int WaitingSealLimit = 64;
    private static readonly TimeSpan SealWaitLimit = TimeSpan.FromSeconds(15);
    private static readonly SemaphoreSlim SealSlots = new(ConcurrentSealLimit, ConcurrentSealLimit);
    private static int _waitingSeals;

    private readonly IAmazonS3 _s3 = s3;
    private readonly string _bucketName = RequireBucket(bucketName);
    private readonly string _kmsKeyArn = RequireKmsArn(kmsKeyArn);

    public async Task<ProctoringUploadGrant> CreateUploadGrantAsync(string stagingKey,
        string contentType, int maximumBytes, DateTime expiresAt, CancellationToken ct)
    {
        RequireKey(stagingKey, "staging/");
        ValidateMedia(contentType, maximumBytes);
        if (expiresAt <= DateTime.UtcNow.AddSeconds(5)
            || expiresAt > DateTime.UtcNow.AddMinutes(3))
            throw new ArgumentOutOfRangeException(nameof(expiresAt));
        var request = new CreatePresignedPostRequest
        {
            BucketName = _bucketName,
            Key = stagingKey,
            Expires = expiresAt,
        };
        request.Fields["Content-Type"] = contentType;
        request.Fields["x-amz-server-side-encryption"] = "aws:kms";
        request.Fields["x-amz-server-side-encryption-aws-kms-key-id"] = _kmsKeyArn;
        request.Conditions.Add(S3PostCondition.ExactMatch("key", stagingKey));
        request.Conditions.Add(S3PostCondition.ExactMatch("Content-Type", contentType));
        request.Conditions.Add(S3PostCondition.ExactMatch("x-amz-server-side-encryption", "aws:kms"));
        request.Conditions.Add(S3PostCondition.ExactMatch(
            "x-amz-server-side-encryption-aws-kms-key-id", _kmsKeyArn));
        request.Conditions.Add(S3PostCondition.ContentLengthRange(1, maximumBytes));
        ct.ThrowIfCancellationRequested();
        var signed = await _s3.CreatePresignedPostAsync(request);
        return new ProctoringUploadGrant(signed.Url,
            new Dictionary<string, string>(signed.Fields, StringComparer.Ordinal), expiresAt);
    }

    public async Task<ProctoringSealedObject> SealAsync(string stagingKey,
        string sealedKeyPrefix, string contentType, int maximumBytes, CancellationToken ct)
    {
        RequireKey(stagingKey, "staging/");
        RequireKey(sealedKeyPrefix, "sealed/");
        ValidateMedia(contentType, maximumBytes);

        await EnterSealSlotAsync(ct);
        try
        {
            return await SealUnderSlotAsync(stagingKey, sealedKeyPrefix,
                contentType, maximumBytes, ct);
        }
        finally
        {
            SealSlots.Release();
        }
    }

    private static async Task EnterSealSlotAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (await SealSlots.WaitAsync(0, ct)) return;

        if (Interlocked.Increment(ref _waitingSeals) > WaitingSealLimit)
        {
            Interlocked.Decrement(ref _waitingSeals);
            throw new ProctoringException(ProctoringError.TooManyRequests,
                "evidence_confirmation_busy");
        }
        try
        {
            if (!await SealSlots.WaitAsync(SealWaitLimit, ct))
                throw new ProctoringException(ProctoringError.TooManyRequests,
                    "evidence_confirmation_busy");
        }
        finally
        {
            Interlocked.Decrement(ref _waitingSeals);
        }
    }

    private async Task<ProctoringSealedObject> SealUnderSlotAsync(string stagingKey,
        string sealedKeyPrefix, string contentType, int maximumBytes, CancellationToken ct)
    {

        // The HEAD/GET ETag guard makes the digest refer to one staging
        // version. The POST may still be valid, so copying checks that ETag
        // again before creating a key the browser cannot write.
        var head = await _s3.GetObjectMetadataAsync(new GetObjectMetadataRequest
        {
            BucketName = _bucketName,
            Key = stagingKey,
        }, ct);
        if (head.ContentLength is < 1 || head.ContentLength > maximumBytes
            || !string.Equals(head.Headers.ContentType, contentType, StringComparison.Ordinal))
            throw new InvalidDataException("evidence_size_or_type_invalid");

        var source = await ReadBoundedAsync(stagingKey, head.ETag, maximumBytes, ct);
        if (!MatchesImageMagic(source, contentType))
            throw new InvalidDataException("evidence_image_header_invalid");
        ValidateDecodedImage(source, contentType);
        var digest = Convert.ToHexStringLower(SHA256.HashData(source));
        var extension = contentType == "image/jpeg" ? ".jpg" : ".webp";
        // Each confirmation attempt owns a distinct key. A failed DB commit
        // can then delete this copy without racing a retry that seals the same
        // image, while the digest remains independently verified by the worker.
        var sealedKey = sealedKeyPrefix + "/" + digest + "-" + Guid.NewGuid().ToString("N") + extension;
        RequireKey(sealedKey, "sealed/");

        try
        {
            await _s3.CopyObjectAsync(new CopyObjectRequest
            {
                SourceBucket = _bucketName,
                SourceKey = stagingKey,
                DestinationBucket = _bucketName,
                DestinationKey = sealedKey,
                ETagToMatch = head.ETag,
                IfNoneMatch = "*",
                ServerSideEncryptionMethod = ServerSideEncryptionMethod.AWSKMS,
                ServerSideEncryptionKeyManagementServiceKeyId = _kmsKeyArn,
            }, ct);

            // Verify the sealed copy before the DB transaction marks it ready.
            var sealedBytes = await ReadBoundedAsync(sealedKey, null, maximumBytes, ct);
            if (!CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(sealedBytes), SHA256.HashData(source)))
                throw new InvalidDataException("evidence_sealed_checksum_mismatch");
            var sealedHead = await _s3.GetObjectMetadataAsync(new GetObjectMetadataRequest
            {
                BucketName = _bucketName,
                Key = sealedKey,
            }, ct);
            return new ProctoringSealedObject(sealedKey, digest, head.ETag,
                sealedHead.ETag, source.LongLength);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.PreconditionFailed)
        {
            // A random-key collision is not ours to delete. Never reuse it.
            throw new InvalidDataException("evidence_seal_key_conflict", ex);
        }
        catch
        {
            // Copy may have succeeded even if the SDK failed while reading its
            // response. Use an independent token after request cancellation.
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            try { await DeleteAsync(sealedKey, cleanup.Token); }
            catch { /* Lifecycle remains the crash/network-failure backstop. */ }
            throw;
        }
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        if (!key.StartsWith("staging/", StringComparison.Ordinal)
            && !key.StartsWith("sealed/", StringComparison.Ordinal))
            throw new ArgumentException("Invalid evidence key", nameof(key));
        RequireKey(key, key.StartsWith("staging/", StringComparison.Ordinal)
            ? "staging/" : "sealed/");
        return _s3.DeleteObjectAsync(_bucketName, key, ct);
    }

    public async Task<ProctoringReadGrant> CreateReadGrantAsync(string sealedKey,
        string contentType, DateTime expiresAt, CancellationToken ct)
    {
        RequireKey(sealedKey, "sealed/");
        if (contentType is not ("image/jpeg" or "image/webp") ||
            !sealedKey.EndsWith(contentType == "image/jpeg" ? ".jpg" : ".webp",
                StringComparison.Ordinal))
            throw new ArgumentException("Invalid evidence read type", nameof(contentType));
        var now = DateTime.UtcNow;
        if (expiresAt <= now.AddSeconds(1) || expiresAt > now.AddMinutes(1))
            throw new ArgumentOutOfRangeException(nameof(expiresAt));

        // The caller must authorize the reviewer and fail-closed audit *before*
        // asking for this bearer URL. The maximum lifetime limits exposure if
        // a browser or network log retains the URL after the review.
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucketName,
            Key = sealedKey,
            Verb = HttpVerb.GET,
            Expires = expiresAt,
        };
        request.ResponseHeaderOverrides.CacheControl = "no-store, private";
        request.ResponseHeaderOverrides.ContentType = contentType;
        request.ResponseHeaderOverrides.ContentDisposition = "inline";
        ct.ThrowIfCancellationRequested();
        var url = await _s3.GetPreSignedURLAsync(request);
        return new ProctoringReadGrant(url, expiresAt);
    }

    private async Task<byte[]> ReadBoundedAsync(string key, string? etag,
        int maximumBytes, CancellationToken ct)
    {
        using var response = await _s3.GetObjectAsync(new GetObjectRequest
        {
            BucketName = _bucketName,
            Key = key,
            EtagToMatch = etag,
        }, ct);
        if (response.ContentLength is < 1 || response.ContentLength > maximumBytes)
            throw new InvalidDataException("evidence_size_invalid");
        using var output = new MemoryStream(capacity: checked((int)response.ContentLength));
        var buffer = new byte[64 * 1024];
        while (true)
        {
            var read = await response.ResponseStream.ReadAsync(buffer, ct);
            if (read == 0) break;
            if (output.Length + read > maximumBytes)
                throw new InvalidDataException("evidence_size_invalid");
            await output.WriteAsync(buffer.AsMemory(0, read), ct);
        }
        if (output.Length != response.ContentLength)
            throw new InvalidDataException("evidence_length_mismatch");
        return output.ToArray();
    }

    internal static bool MatchesImageMagic(ReadOnlySpan<byte> bytes, string contentType) =>
        contentType == "image/jpeg"
            ? bytes.Length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff
            : bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8)
                && bytes.Slice(8, 4).SequenceEqual("WEBP"u8);

    internal static void ValidateDecodedImage(byte[] bytes, string contentType)
    {
        using var data = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(data);
        if (codec is null || codec.FrameCount > 1 ||
            codec.EncodedFormat != (contentType == "image/jpeg"
                ? SKEncodedImageFormat.Jpeg : SKEncodedImageFormat.Webp))
            throw new InvalidDataException("evidence_image_decode_invalid");
        var info = codec.Info;
        if (info.Width is < 1 or > 4096 || info.Height is < 1 or > 2160
            || (long)info.Width * info.Height > 8_847_360)
            throw new InvalidDataException("evidence_image_dimensions_invalid");
        using var bitmap = SKBitmap.Decode(codec);
        if (bitmap is null || bitmap.Width != info.Width || bitmap.Height != info.Height)
            throw new InvalidDataException("evidence_image_decode_invalid");
    }

    private static void ValidateMedia(string contentType, int maximumBytes)
    {
        if (contentType is not ("image/jpeg" or "image/webp")
            || maximumBytes is < 1 or > 4 * 1024 * 1024)
            throw new ArgumentException("Invalid evidence media bounds");
    }

    private static void RequireKey(string key, string prefix)
    {
        if (!key.StartsWith(prefix, StringComparison.Ordinal)
            || key.Length is < 30 or > 240
            || key.Split('/').Any(segment => segment.Length == 0 || segment is "." or "..")
            || key.Any(c => !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                || c is '/' or '-' or '_' or '.')))
            throw new ArgumentException("Invalid evidence key", nameof(key));
    }

    private static string RequireBucket(string bucket) =>
        !string.IsNullOrWhiteSpace(bucket) && bucket.Length <= 63
            ? bucket : throw new ArgumentException("Invalid evidence bucket", nameof(bucket));

    private static string RequireKmsArn(string arn) =>
        arn.StartsWith("arn:aws:kms:", StringComparison.Ordinal) && arn.Length <= 2048
            ? arn : throw new ArgumentException("Invalid evidence KMS key", nameof(arn));
}
