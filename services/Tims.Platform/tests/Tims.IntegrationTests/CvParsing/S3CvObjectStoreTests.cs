using System.Reflection;
using Amazon.S3;
using Amazon.S3.Model;
using Tims.Infrastructure.CvParsing;

namespace Tims.IntegrationTests.CvParsing;

public sealed class S3CvObjectStoreTests
{
    [Fact]
    public async Task Reads_only_the_org_prefix_and_pins_the_object_etag()
    {
        var org = Guid.NewGuid();
        var key = $"cv-uploads/{org}/resume.pdf";
        var content = new byte[] { 1, 2, 3 };
        var s3 = DispatchProxy.Create<IAmazonS3, S3Stub>();
        var stub = (S3Stub)(object)s3;
        stub.Metadata = new GetObjectMetadataResponse { ContentLength = content.Length, ETag = "\"etag-1\"" };
        stub.Object = new GetObjectResponse { ResponseStream = new MemoryStream(content) };
        var store = new S3CvObjectStore(s3, "test-bucket");

        await Assert.ThrowsAsync<CvDocumentException>(() =>
            store.FetchAsync(Guid.NewGuid(), key, CancellationToken.None));
        Assert.Equal(0, stub.MetadataCalls);

        Assert.Equal(content, await store.FetchAsync(org, key, CancellationToken.None));
        Assert.Equal("\"etag-1\"", stub.LastGet?.EtagToMatch);
        Assert.Equal("test-bucket", stub.LastGet?.BucketName);
    }

    [Fact]
    public async Task Rejects_metadata_and_stream_size_mismatch_before_parsing()
    {
        var org = Guid.NewGuid();
        var key = $"cv-uploads/{org}/resume.docx";
        var s3 = DispatchProxy.Create<IAmazonS3, S3Stub>();
        var stub = (S3Stub)(object)s3;
        var store = new S3CvObjectStore(s3, "test-bucket");
        stub.Metadata = new GetObjectMetadataResponse
        {
            ContentLength = CvTextExtractor.MaxFileBytes + 1,
            ETag = "\"etag-2\""
        };
        await Assert.ThrowsAsync<CvDocumentException>(() => store.FetchAsync(org, key, CancellationToken.None));
        Assert.Null(stub.LastGet);

        stub.Metadata.ContentLength = 2;
        stub.Object = new GetObjectResponse { ResponseStream = new MemoryStream(new byte[] { 1, 2, 3 }) };
        await Assert.ThrowsAsync<CvDocumentException>(() => store.FetchAsync(org, key, CancellationToken.None));
    }

    public class S3Stub : DispatchProxy
    {
        public GetObjectMetadataResponse Metadata { get; set; } = null!;
        public GetObjectResponse Object { get; set; } = null!;
        public GetObjectRequest? LastGet { get; private set; }
        public int MetadataCalls { get; private set; }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == nameof(IAmazonS3.GetObjectMetadataAsync))
            {
                MetadataCalls++;
                return Task.FromResult(Metadata);
            }
            if (targetMethod?.Name == nameof(IAmazonS3.GetObjectAsync))
            {
                LastGet = (GetObjectRequest)args![0]!;
                return Task.FromResult(Object);
            }
            throw new NotSupportedException(targetMethod?.Name);
        }
    }
}
