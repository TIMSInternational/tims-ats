using System.Net;
using System.Reflection;
using Amazon.SQS;
using Amazon.SQS.Model;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Proctoring;
using Tims.Application.Proctoring;

namespace Tims.UnitTests.Proctoring;

public sealed class ProctoringInferenceSqsTransportTests
{
    private static readonly Guid OrganizationId = Guid.Parse("00000000-0000-4000-8000-000000000002");
    private static readonly Guid SessionId = Guid.Parse("00000000-0000-4000-8000-000000000003");
    private static readonly Guid EvidenceId = Guid.Parse("00000000-0000-4000-8000-000000000001");
    private static readonly Guid OutboxId = Guid.Parse("00000000-0000-4000-8000-000000000004");
    private const string Sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private const string RequestQueue = "https://sqs.us-west-2.amazonaws.com/123456789012/proctoring-request";
    private const string ResultQueue = "https://sqs.us-west-2.amazonaws.com/123456789012/proctoring-result";
    private static readonly ProctoringOutboxClaim Claim = new(OutboxId, OrganizationId, EvidenceId,
        $"sealed/{OrganizationId:D}/{SessionId:D}/{EvidenceId:D}/{Sha}.jpg", Sha,
        "camera", "proctoring-v1", new DateTime(2026, 10, 1, 10, 0, 0, DateTimeKind.Utc), 2);

    private const string ResultBody = """
        {"schemaVersion":1,"organizationId":"00000000-0000-4000-8000-000000000002","evidenceId":"00000000-0000-4000-8000-000000000001","sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","modelRevision":"proctoring-v1","status":"completed","detectors":[{"name":"rekognition_detect_faces","revision":"aws-rekognition-detect-faces-v1","status":"completed","findings":[{"label":"face_count","confidence":null,"count":1}],"failureCode":null},{"name":"hf_object_detector","revision":"hustvl-yolos-tiny-da86128da961944dd8e33bb7c1baea46ed0a4753","status":"unavailable","findings":[],"failureCode":"disabled"}],"processedAt":"2026-09-24T10:01:00.000Z"}
        """;

    [Fact]
    public async Task Dispatch_marks_outbox_only_after_successful_sqs_send()
    {
        var calls = new List<string>();
        var repo = Repo((method, args) => method.Name switch
        {
            nameof(IProctoringEvidenceRepository.ListPendingOutboxOrganizationIdsAsync) =>
                Task.FromResult<IReadOnlyList<Guid>>([OrganizationId]),
            nameof(IProctoringEvidenceRepository.ClaimPendingOutboxAsync) =>
                Task.FromResult<IReadOnlyList<ProctoringOutboxClaim>>([Claim]),
            nameof(IProctoringEvidenceRepository.MarkOutboxDispatchedAsync) => Mark(),
            _ => throw new NotSupportedException(method.Name),
        });
        Task<bool> Mark()
        {
            calls.Add("mark");
            return Task.FromResult(true);
        }
        var sqs = Sqs((method, args) => method.Name switch
        {
            nameof(IAmazonSQS.SendMessageAsync) => Send(args),
            _ => throw new NotSupportedException(method.Name),
        });
        Task<SendMessageResponse> Send(object?[]? args)
        {
            var request = Assert.IsType<SendMessageRequest>(args![0]);
            Assert.Equal(RequestQueue, request.QueueUrl);
            Assert.Contains(OrganizationId.ToString("D"), request.MessageBody, StringComparison.Ordinal);
            Assert.Contains(EvidenceId.ToString("D"), request.MessageBody, StringComparison.Ordinal);
            calls.Add("send");
            return Task.FromResult(new SendMessageResponse { HttpStatusCode = HttpStatusCode.OK });
        }

        var count = await Transport(repo, sqs).DispatchOnceAsync(CancellationToken.None);
        Assert.Equal(1, count);
        Assert.Equal(["send", "mark"], calls);
    }

    [Fact]
    public async Task Dispatch_failed_send_releases_claim_for_retry_without_marking_dispatched()
    {
        var calls = new List<string>();
        var repo = Repo((method, args) => method.Name switch
        {
            nameof(IProctoringEvidenceRepository.ListPendingOutboxOrganizationIdsAsync) =>
                Task.FromResult<IReadOnlyList<Guid>>([OrganizationId]),
            nameof(IProctoringEvidenceRepository.ClaimPendingOutboxAsync) =>
                Task.FromResult<IReadOnlyList<ProctoringOutboxClaim>>([Claim]),
            nameof(IProctoringEvidenceRepository.MarkOutboxRetryAsync) => Retry(args),
            _ => throw new NotSupportedException(method.Name),
        });
        Task<bool> Retry(object?[]? args)
        {
            Assert.Equal("sqs_send_failed", args![3]);
            calls.Add("retry");
            return Task.FromResult(true);
        }
        var sqs = Sqs((method, _) => method.Name switch
        {
            nameof(IAmazonSQS.SendMessageAsync) => Task.FromException<SendMessageResponse>(
                new InvalidOperationException("transient")),
            _ => throw new NotSupportedException(method.Name),
        });

        Assert.Equal(0, await Transport(repo, sqs).DispatchOnceAsync(CancellationToken.None));
        Assert.Equal(["retry"], calls);
    }

    [Theory]
    [InlineData("applied")]
    [InlineData("duplicate")]
    [InlineData("expired")]
    [InlineData("mismatch")]
    [InlineData("not_found")]
    public async Task Consumer_deletes_only_after_durable_terminal_result(string status)
    {
        var calls = new List<string>();
        var repo = Repo((method, args) => method.Name switch
        {
            nameof(IProctoringEvidenceRepository.ApplyInferenceResultAsync) => Apply(args),
            _ => throw new NotSupportedException(method.Name),
        });
        Task<ProctoringInferenceApplyResult> Apply(object?[]? args)
        {
            Assert.Equal(OrganizationId, args![0]);
            Assert.Equal(EvidenceId, Assert.IsType<ProctoringInferenceResult>(args[1]).EvidenceId);
            calls.Add("apply");
            return Task.FromResult(new ProctoringInferenceApplyResult(status));
        }
        var sqs = Sqs((method, args) => method.Name switch
        {
            nameof(IAmazonSQS.ReceiveMessageAsync) => Receive(ResultBody),
            nameof(IAmazonSQS.DeleteMessageAsync) => Delete(args),
            _ => throw new NotSupportedException(method.Name),
        });
        Task<DeleteMessageResponse> Delete(object?[]? args)
        {
            Assert.Equal(ResultQueue, args![0]);
            Assert.Equal("receipt", args[1]);
            calls.Add("delete");
            return Task.FromResult(new DeleteMessageResponse { HttpStatusCode = HttpStatusCode.OK });
        }

        Assert.Equal(1, await Transport(repo, sqs).ConsumeOnceAsync(CancellationToken.None));
        Assert.Equal(["apply", "delete"], calls);
    }

    [Fact]
    public async Task Consumer_never_deletes_invalid_or_failed_apply_messages()
    {
        var applied = 0;
        var repo = Repo((method, _) => method.Name switch
        {
            nameof(IProctoringEvidenceRepository.ApplyInferenceResultAsync) => Apply(),
            _ => throw new NotSupportedException(method.Name),
        });
        Task<ProctoringInferenceApplyResult> Apply()
        {
            applied++;
            return Task.FromException<ProctoringInferenceApplyResult>(
                new InvalidOperationException("database unavailable"));
        }
        var body = "{\"schemaVersion\":1,\"schemaVersion\":1}";
        var sqs = Sqs((method, _) => method.Name switch
        {
            nameof(IAmazonSQS.ReceiveMessageAsync) => Receive(body),
            _ => throw new NotSupportedException(method.Name),
        });
        Assert.Equal(0, await Transport(repo, sqs).ConsumeOnceAsync(CancellationToken.None));
        Assert.Equal(0, applied);

        sqs = Sqs((method, _) => method.Name switch
        {
            nameof(IAmazonSQS.ReceiveMessageAsync) => Receive(ResultBody),
            _ => throw new NotSupportedException(method.Name),
        });
        Assert.Equal(0, await Transport(repo, sqs).ConsumeOnceAsync(CancellationToken.None));
        Assert.Equal(1, applied);
    }

    [Fact]
    public async Task Consumer_retries_after_unconfirmed_sqs_delete()
    {
        var applied = 0;
        var repo = Repo((method, _) => method.Name switch
        {
            nameof(IProctoringEvidenceRepository.ApplyInferenceResultAsync) => Apply(),
            _ => throw new NotSupportedException(method.Name),
        });
        Task<ProctoringInferenceApplyResult> Apply()
        {
            applied++;
            return Task.FromResult(new ProctoringInferenceApplyResult("applied"));
        }
        var sqs = Sqs((method, _) => method.Name switch
        {
            nameof(IAmazonSQS.ReceiveMessageAsync) => Receive(ResultBody),
            nameof(IAmazonSQS.DeleteMessageAsync) => Task.FromResult(
                new DeleteMessageResponse { HttpStatusCode = HttpStatusCode.ServiceUnavailable }),
            _ => throw new NotSupportedException(method.Name),
        });

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Transport(repo, sqs).ConsumeOnceAsync(CancellationToken.None));
        Assert.Equal(1, applied);
    }

    [Fact]
    public void Queue_url_is_rejected_when_not_https_aws_sqs()
    {
        var options = Options.Create(new PlatformOptions
        {
            ProctoringInferenceRequestQueueUrl = "https://attacker.example/queue",
        });
        Assert.Throws<InvalidOperationException>(() => new ProctoringInferenceSqsTransport(
            Repo((_, _) => throw new NotSupportedException()),
            Sqs((_, _) => throw new NotSupportedException()),
            options, NullLogger<ProctoringInferenceSqsTransport>.Instance));
        var wrongRegion = Options.Create(new PlatformOptions
        {
            ProctoringInferenceRequestQueueUrl = RequestQueue,
            ProctoringEvidenceRegion = "us-east-1",
        });
        Assert.Throws<InvalidOperationException>(() => new ProctoringInferenceSqsTransport(
            Repo((_, _) => throw new NotSupportedException()),
            Sqs((_, _) => throw new NotSupportedException()),
            wrongRegion, NullLogger<ProctoringInferenceSqsTransport>.Instance));
    }

    private static Task<ReceiveMessageResponse> Receive(string body) =>
        Task.FromResult(new ReceiveMessageResponse
        {
            Messages = [new Message { Body = body, ReceiptHandle = "receipt" }],
        });

    private static ProctoringInferenceSqsTransport Transport(
        IProctoringEvidenceRepository repo, IAmazonSQS sqs) =>
        new(repo, sqs, Options.Create(new PlatformOptions
        {
            ProctoringInferenceRequestQueueUrl = RequestQueue,
            ProctoringInferenceResultQueueUrl = ResultQueue,
            ProctoringEvidenceRegion = "us-west-2",
        }), NullLogger<ProctoringInferenceSqsTransport>.Instance);

    private static IProctoringEvidenceRepository Repo(Func<MethodInfo, object?[]?, object?> handler) =>
        Proxy<IProctoringEvidenceRepository>(handler);

    private static IAmazonSQS Sqs(Func<MethodInfo, object?[]?, object?> handler) =>
        Proxy<IAmazonSQS>(handler);

    private static T Proxy<T>(Func<MethodInfo, object?[]?, object?> handler) where T : class
    {
        var proxy = DispatchProxy.Create<T, RecordingProxy>();
        ((RecordingProxy)(object)proxy).Handler = handler;
        return proxy;
    }

    public class RecordingProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Handler { get; set; } =
            (_, _) => throw new NotSupportedException();

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) =>
            Handler(targetMethod ?? throw new InvalidOperationException(), args);
    }
}
