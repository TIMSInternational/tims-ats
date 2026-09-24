using System.Net;
using Amazon.SQS;
using Amazon.SQS.Model;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Proctoring;

namespace Tims.Api.Proctoring;

/// <summary>
/// One bounded SQS I/O cycle. The repository owns tenant-scope transactions and
/// durable idempotency; no transaction is held over an AWS call. Standard queue
/// redelivery is expected after a send/mark or apply/delete crash.
/// </summary>
public sealed class ProctoringInferenceSqsTransport(
    IProctoringEvidenceRepository repository,
    IAmazonSQS sqs,
    IOptions<PlatformOptions> options,
    ILogger<ProctoringInferenceSqsTransport> logger)
{
    private readonly string? _requestQueue = QueueUrl(options.Value.ProctoringInferenceRequestQueueUrl,
        options.Value.ProctoringEvidenceRegion ?? "us-west-2");
    private readonly string? _resultQueue = QueueUrl(options.Value.ProctoringInferenceResultQueueUrl,
        options.Value.ProctoringEvidenceRegion ?? "us-west-2");

    public async Task<int> DispatchOnceAsync(CancellationToken ct)
    {
        if (_requestQueue is null) return 0;
        var sent = 0;
        // Enumeration uses a privileged read-only distinct-org lookup; every
        // claim and state mutation below opens its own TenantScope in the repo.
        var organizationIds = await repository.ListPendingOutboxOrganizationIdsAsync(20, ct);
        foreach (var organizationId in organizationIds)
        {
            var claims = await repository.ClaimPendingOutboxAsync(organizationId, 5, ct);
            foreach (var claim in claims)
            {
                string body;
                try { body = ProctoringInferenceWire.EncodeRequest(claim); }
                catch (ProctoringWireException)
                {
                    await repository.MarkOutboxRetryAsync(organizationId, claim.OutboxId,
                        claim.ClaimAttempt, "invalid_outbox_claim", ct);
                    logger.LogWarning("Proctoring inference outbox claim failed contract validation");
                    continue;
                }

                try
                {
                    var response = await sqs.SendMessageAsync(new SendMessageRequest
                    {
                        QueueUrl = _requestQueue,
                        MessageBody = body,
                    }, ct);
                    if (response.HttpStatusCode != HttpStatusCode.OK)
                        throw new InvalidOperationException("sqs_send_rejected");
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (Exception)
                {
                    await repository.MarkOutboxRetryAsync(organizationId, claim.OutboxId,
                        claim.ClaimAttempt, "sqs_send_failed", ct);
                    logger.LogWarning("Proctoring inference request send failed; outbox will retry");
                    continue;
                }

                // If this write fails after the SQS send, the lease expires and
                // may dispatch again. The result consumer must be idempotent.
                if (await repository.MarkOutboxDispatchedAsync(organizationId,
                    claim.OutboxId, claim.ClaimAttempt, ct)) sent++;
            }
        }
        return sent;
    }

    public async Task<int> ConsumeOnceAsync(CancellationToken ct)
    {
        if (_resultQueue is null) return 0;
        var response = await sqs.ReceiveMessageAsync(new ReceiveMessageRequest
        {
            QueueUrl = _resultQueue,
            MaxNumberOfMessages = 1,
            WaitTimeSeconds = 20,
            VisibilityTimeout = 300,
        }, ct);
        var messages = response.Messages;
        if (messages is null || messages.Count == 0) return 0;
        var applied = 0;
        foreach (var message in messages)
        {
            if (string.IsNullOrEmpty(message.Body) || string.IsNullOrEmpty(message.ReceiptHandle))
            {
                logger.LogWarning("Proctoring inference result envelope invalid; leaving for DLQ");
                continue;
            }
            ProctoringInferenceResult result;
            try { result = ProctoringInferenceWire.DecodeResult(message.Body); }
            catch (ProctoringWireException)
            {
                // Do not ack a poison message without a durable disposition.
                // SQS redrives it to the configured DLQ after bounded retries.
                logger.LogWarning("Proctoring inference result contract invalid; leaving for DLQ");
                continue;
            }

            ProctoringInferenceApplyResult outcome;
            try
            {
                // organizationId is an untrusted hint; the repository rechecks
                // evidence ID, tenant, SHA, revision, state and expiry under RLS.
                outcome = await repository.ApplyInferenceResultAsync(result.OrganizationId, result, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception)
            {
                logger.LogWarning("Proctoring inference result apply failed; SQS will retry");
                continue;
            }
            if (outcome.Status is not ("applied" or "duplicate" or "expired" or "mismatch" or "not_found"))
            {
                logger.LogWarning("Proctoring inference result had an unknown apply outcome; leaving for DLQ");
                continue;
            }
            var delete = await sqs.DeleteMessageAsync(_resultQueue, message.ReceiptHandle, ct);
            if (delete.HttpStatusCode != HttpStatusCode.OK)
                throw new InvalidOperationException("sqs_delete_rejected");
            applied++;
        }
        return applied;
    }

    private static string? QueueUrl(string? value, string region)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (region.Length is < 5 or > 32
            || region.Any(c => c is not (>= 'a' and <= 'z')
                && !char.IsAsciiDigit(c) && c != '-')
            || value.Length > 500 || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || uri.Host != $"sqs.{region}.amazonaws.com"
            || uri.Port != 443 || uri.UserInfo.Length != 0
            || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidOperationException("Invalid proctoring SQS queue URL configuration");
        var segments = uri.AbsolutePath.Trim('/').Split('/');
        if (segments.Length != 2 || segments[0].Length != 12
            || segments[0].Any(c => c is < '0' or > '9')
            || segments[1].Length is < 1 or > 80
            || segments[1].Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')))
            throw new InvalidOperationException("Invalid proctoring SQS queue URL configuration");
        return value;
    }
}
