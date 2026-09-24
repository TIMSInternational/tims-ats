using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.S3;
using Amazon.S3.Model;
using SkiaSharp;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

public sealed class S3ProctoringEvidenceStoreTests
{
    private const string KmsArn = "arn:aws:kms:us-west-2:123456789012:key/11111111-1111-1111-1111-111111111111";
    private const string StagingKey = "staging/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.jpg";
    private const string SealedKey = "sealed/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.jpg";

    [Fact]
    public async Task Upload_grant_binds_exact_key_type_encryption_and_size()
    {
        var client = DispatchProxy.Create<IAmazonS3, RecordingS3Proxy>();
        var proxy = (RecordingS3Proxy)(object)client;
        var store = new S3ProctoringEvidenceStore(client, "tims-proctoring-test", KmsArn);

        var grant = await store.CreateUploadGrantAsync(StagingKey,
            "image/jpeg", 2 * 1024 * 1024, DateTime.UtcNow.AddMinutes(2), CancellationToken.None);

        Assert.Equal("https://s3.example.test/upload", grant.Url);
        Assert.True(grant.ExpiresAt > DateTime.UtcNow.AddMinutes(1));
        var request = Assert.IsType<CreatePresignedPostRequest>(proxy.LastRequest);
        Assert.Equal(StagingKey, request.Key);
        Assert.Equal("image/jpeg", request.Fields["Content-Type"]);
        Assert.Equal("aws:kms", request.Fields["x-amz-server-side-encryption"]);
        Assert.Equal(KmsArn, request.Fields["x-amz-server-side-encryption-aws-kms-key-id"]);

        var serializedConditions = SerializeConditions(request.Conditions);
        Assert.Contains("\"key\":\"" + StagingKey + "\"", serializedConditions);
        Assert.Contains("\"Content-Type\":\"image/jpeg\"", serializedConditions);
        Assert.Contains("\"x-amz-server-side-encryption\":\"aws:kms\"", serializedConditions);
        Assert.Contains(KmsArn, serializedConditions);
        Assert.Contains("\"content-length-range\",1,2097152", serializedConditions);
    }

    [Theory]
    [InlineData("sealed/other.jpg", "image/jpeg", 1024)]
    [InlineData("staging/../other.jpg", "image/jpeg", 1024)]
    [InlineData(StagingKey, "image/png", 1024)]
    [InlineData(StagingKey, "image/jpeg", 5 * 1024 * 1024)]
    public async Task Invalid_key_type_or_bound_never_signs_upload(string key,
        string contentType, int maximumBytes)
    {
        var client = DispatchProxy.Create<IAmazonS3, RecordingS3Proxy>();
        var proxy = (RecordingS3Proxy)(object)client;
        var store = new S3ProctoringEvidenceStore(client, "tims-proctoring-test", KmsArn);

        await Assert.ThrowsAnyAsync<ArgumentException>(() =>
            store.CreateUploadGrantAsync(key, contentType, maximumBytes,
                DateTime.UtcNow.AddMinutes(2), CancellationToken.None));
        Assert.Null(proxy.LastRequest);
    }

    [Fact]
    public async Task Read_grant_is_get_only_sealed_and_lasts_at_most_one_minute()
    {
        var client = DispatchProxy.Create<IAmazonS3, RecordingS3Proxy>();
        var proxy = (RecordingS3Proxy)(object)client;
        var store = new S3ProctoringEvidenceStore(client, "tims-proctoring-test", KmsArn);
        var expiry = DateTime.UtcNow.AddSeconds(45);

        var grant = await store.CreateReadGrantAsync(SealedKey,
            "image/jpeg", expiry, CancellationToken.None);

        Assert.Equal("https://s3.example.test/read", grant.Url);
        Assert.Equal(expiry, grant.ExpiresAt);
        var request = Assert.IsType<GetPreSignedUrlRequest>(proxy.LastReadRequest);
        Assert.Equal(SealedKey, request.Key);
        Assert.Equal(HttpVerb.GET, request.Verb);
        Assert.Equal("no-store, private", request.ResponseHeaderOverrides.CacheControl);
        Assert.Equal("image/jpeg", request.ResponseHeaderOverrides.ContentType);
        Assert.Equal("inline", request.ResponseHeaderOverrides.ContentDisposition);

        await Assert.ThrowsAnyAsync<ArgumentException>(() => store.CreateReadGrantAsync(
            StagingKey, "image/jpeg", expiry, CancellationToken.None));
        await Assert.ThrowsAnyAsync<ArgumentException>(() => store.CreateReadGrantAsync(
            SealedKey, "image/webp", expiry, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => store.CreateReadGrantAsync(
            SealedKey, "image/jpeg", DateTime.UtcNow.AddMinutes(2), CancellationToken.None));
    }

    [Theory]
    [InlineData(SKEncodedImageFormat.Jpeg, "image/jpeg")]
    [InlineData(SKEncodedImageFormat.Webp, "image/webp")]
    public void Evidence_must_decode_and_match_declared_type(
        SKEncodedImageFormat format, string contentType)
    {
        using var bitmap = new SKBitmap(4, 4);
        using var encoded = bitmap.Encode(format, 80);
        var bytes = encoded.ToArray();

        Assert.True(S3ProctoringEvidenceStore.MatchesImageMagic(bytes, contentType));
        S3ProctoringEvidenceStore.ValidateDecodedImage(bytes, contentType);
        Assert.Throws<InvalidDataException>(() =>
            S3ProctoringEvidenceStore.ValidateDecodedImage(bytes,
                contentType == "image/jpeg" ? "image/webp" : "image/jpeg"));
        Assert.Throws<InvalidDataException>(() =>
            S3ProctoringEvidenceStore.ValidateDecodedImage(bytes[..12], contentType));
    }

    [Fact]
    public void Overlarge_dimensions_are_rejected_before_full_decode()
    {
        using var bitmap = new SKBitmap(4097, 1);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, 80);

        Assert.Throws<InvalidDataException>(() =>
            S3ProctoringEvidenceStore.ValidateDecodedImage(encoded.ToArray(), "image/jpeg"));
    }

    [Fact]
    public async Task Repeated_seals_use_distinct_attempt_keys_with_the_same_verified_digest()
    {
        using var bitmap = new SKBitmap(4, 4);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, 80);
        var client = DispatchProxy.Create<IAmazonS3, SealingS3Proxy>();
        var proxy = (SealingS3Proxy)(object)client;
        proxy.SourceBytes = encoded.ToArray();
        var store = new S3ProctoringEvidenceStore(client, "tims-proctoring-test", KmsArn);
        var prefix = SealedKey[..SealedKey.LastIndexOf('/')];

        var first = await store.SealAsync(StagingKey, prefix, "image/jpeg",
            1024, CancellationToken.None);
        var second = await store.SealAsync(StagingKey, prefix, "image/jpeg",
            1024, CancellationToken.None);

        Assert.NotEqual(first.Key, second.Key);
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(proxy.SourceBytes)), first.Sha256);
        Assert.Equal(first.Sha256, second.Sha256);
        Assert.StartsWith(prefix + "/" + first.Sha256 + "-", first.Key);
        Assert.Empty(proxy.DeletedKeys);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task Failed_copy_or_verification_deletes_its_private_attempt_key(
        bool failAfterCopy, bool failSealedRead)
    {
        using var bitmap = new SKBitmap(4, 4);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, 80);
        var client = DispatchProxy.Create<IAmazonS3, SealingS3Proxy>();
        var proxy = (SealingS3Proxy)(object)client;
        proxy.SourceBytes = encoded.ToArray();
        proxy.FailAfterCopy = failAfterCopy;
        proxy.FailSealedRead = failSealedRead;
        var store = new S3ProctoringEvidenceStore(client, "tims-proctoring-test", KmsArn);

        await Assert.ThrowsAsync<IOException>(() => store.SealAsync(StagingKey,
            SealedKey[..SealedKey.LastIndexOf('/')], "image/jpeg", 1024,
            CancellationToken.None));

        Assert.Equal(proxy.LastCopiedKey, Assert.Single(proxy.DeletedKeys));
    }

    private static string SerializeConditions(IEnumerable<S3PostCondition> conditions)
    {
        using var memory = new MemoryStream();
        using (var writer = new Utf8JsonWriter(memory))
        {
            writer.WriteStartArray();
            foreach (var condition in conditions) condition.WriteToJsonWriter(writer);
            writer.WriteEndArray();
        }
        return Encoding.UTF8.GetString(memory.ToArray());
    }

    public class RecordingS3Proxy : DispatchProxy
    {
        public CreatePresignedPostRequest? LastRequest { get; private set; }
        public GetPreSignedUrlRequest? LastReadRequest { get; private set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == nameof(IAmazonS3.CreatePresignedPostAsync))
            {
                LastRequest = (CreatePresignedPostRequest)args![0]!;
                var response = new CreatePresignedPostResponse
                {
                    Url = "https://s3.example.test/upload",
                };
                response.Fields["key"] = LastRequest.Key;
                return Task.FromResult(response);
            }
            if (method?.Name == nameof(IAmazonS3.GetPreSignedURLAsync))
            {
                LastReadRequest = (GetPreSignedUrlRequest)args![0]!;
                return Task.FromResult("https://s3.example.test/read");
            }
            throw new NotSupportedException(method?.Name);
        }
    }

    public class SealingS3Proxy : DispatchProxy
    {
        public byte[] SourceBytes { get; set; } = [];
        public bool FailAfterCopy { get; set; }
        public bool FailSealedRead { get; set; }
        public string? LastCopiedKey { get; private set; }
        public List<string> DeletedKeys { get; } = [];

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == nameof(IAmazonS3.GetObjectMetadataAsync))
            {
                var response = new GetObjectMetadataResponse
                {
                    ContentLength = SourceBytes.Length,
                    ETag = "source-etag",
                };
                response.Headers.ContentType = "image/jpeg";
                return Task.FromResult(response);
            }
            if (method?.Name == nameof(IAmazonS3.GetObjectAsync))
            {
                var request = (GetObjectRequest)args![0]!;
                if (request.Key != StagingKey && FailSealedRead)
                    return Task.FromException<GetObjectResponse>(new IOException("sealed read failed"));
                return Task.FromResult(new GetObjectResponse
                {
                    ContentLength = SourceBytes.Length,
                    ResponseStream = new MemoryStream(SourceBytes),
                });
            }
            if (method?.Name == nameof(IAmazonS3.CopyObjectAsync))
            {
                LastCopiedKey = ((CopyObjectRequest)args![0]!).DestinationKey;
                if (FailAfterCopy)
                    return Task.FromException<CopyObjectResponse>(new IOException("copy acknowledgement lost"));
                return Task.FromResult(new CopyObjectResponse());
            }
            if (method?.Name == nameof(IAmazonS3.DeleteObjectAsync))
            {
                DeletedKeys.Add((string)args![1]!);
                return Task.FromResult(new DeleteObjectResponse());
            }
            throw new NotSupportedException(method?.Name);
        }
    }
}
