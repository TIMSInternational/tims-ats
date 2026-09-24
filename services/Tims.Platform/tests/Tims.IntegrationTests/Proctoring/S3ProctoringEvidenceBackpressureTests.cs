using System.Reflection;
using Amazon.S3;
using Amazon.S3.Model;
using Tims.Application.Proctoring;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

public sealed class S3ProctoringEvidenceBackpressureTests
{
    private const string KmsArn = "arn:aws:kms:us-west-2:123456789012:key/11111111-1111-1111-1111-111111111111";
    private const string StagingKey = "staging/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.jpg";
    private const string SealedPrefix = "sealed/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333";

    [Fact]
    public async Task Burst_across_store_instances_bounds_s3_reads_and_releases_cancelled_waiters()
    {
        var client = DispatchProxy.Create<IAmazonS3, BlockingS3Proxy>();
        var proxy = (BlockingS3Proxy)(object)client;
        // The API registers a scoped store. These separate instances prove the
        // concurrency budget is shared by the process rather than a request.
        var stores = Enumerable.Range(0, 70)
            .Select(_ => new S3ProctoringEvidenceStore(client, "tims-proctoring-test", KmsArn))
            .ToArray();
        using var cancelledWaiter = new CancellationTokenSource();
        var tasks = stores.Select((store, index) => store.SealAsync(
            StagingKey, SealedPrefix, "image/jpeg", 4 * 1024 * 1024,
            index == 4 ? cancelledWaiter.Token : CancellationToken.None)).ToArray();

        // Four requests enter S3, 64 wait without reading an image, and two
        // immediately receive controlled backpressure.
        Assert.Equal(4, proxy.ActiveCalls);
        Assert.Equal(4, proxy.StartedCalls);
        foreach (var task in tasks.Skip(68))
        {
            var error = await Assert.ThrowsAsync<ProctoringException>(() => task);
            Assert.Equal(ProctoringError.TooManyRequests, error.Error);
            Assert.Equal("evidence_confirmation_busy", error.Code);
        }

        cancelledWaiter.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => tasks[4]);
        proxy.Release();

        foreach (var task in tasks.Take(68).Where((_, index) => index != 4))
            await Assert.ThrowsAsync<IOException>(() => task);
        Assert.Equal(67, proxy.StartedCalls);
        Assert.Equal(4, proxy.MaximumActiveCalls);

        // Failure and cancellation both returned their permits. A new scoped
        // instance can enter rather than inheriting a stuck process-wide gate.
        var retryStore = new S3ProctoringEvidenceStore(client, "tims-proctoring-test", KmsArn);
        await Assert.ThrowsAsync<IOException>(() => retryStore.SealAsync(
            StagingKey, SealedPrefix, "image/jpeg", 4 * 1024 * 1024,
            CancellationToken.None));
        Assert.Equal(68, proxy.StartedCalls);
    }

    public class BlockingS3Proxy : DispatchProxy
    {
        private readonly TaskCompletionSource _release =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _activeCalls;
        private int _startedCalls;
        private int _maximumActiveCalls;

        public int ActiveCalls => Volatile.Read(ref _activeCalls);
        public int StartedCalls => Volatile.Read(ref _startedCalls);
        public int MaximumActiveCalls => Volatile.Read(ref _maximumActiveCalls);
        public void Release() => _release.TrySetResult();

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == nameof(IAmazonS3.GetObjectMetadataAsync))
                return ReadMetadataAsync((CancellationToken)args![1]!);
            throw new NotSupportedException(method?.Name);
        }

        private async Task<GetObjectMetadataResponse> ReadMetadataAsync(CancellationToken ct)
        {
            Interlocked.Increment(ref _startedCalls);
            var active = Interlocked.Increment(ref _activeCalls);
            while (true)
            {
                var maximum = Volatile.Read(ref _maximumActiveCalls);
                if (active <= maximum ||
                    Interlocked.CompareExchange(ref _maximumActiveCalls, active, maximum) == maximum)
                    break;
            }
            try
            {
                await _release.Task.WaitAsync(ct);
                throw new IOException("Simulated S3 failure after the gate opens");
            }
            finally
            {
                Interlocked.Decrement(ref _activeCalls);
            }
        }
    }
}
