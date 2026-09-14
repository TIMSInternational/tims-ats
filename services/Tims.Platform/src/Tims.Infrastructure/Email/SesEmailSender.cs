using System.Net;
using Amazon.SimpleEmail;
using Amazon.SimpleEmail.Model;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Polly;
using Polly.CircuitBreaker;
using Tims.Application.Email;

namespace Tims.Infrastructure.Email;

/// <summary>Singleton: circuit state is shared across requests within each host process.</summary>
public sealed class SesEmailSender(
    Lazy<IAmazonSimpleEmailService> client,
    IOptions<EmailOptions> options,
    ILogger<SesEmailSender> logger) : IEmailSender
{
    // Bound outstanding transport work, including SDK initialization that ignores cancellation.
    // Do not queue more work behind an unavailable provider.
    private readonly SemaphoreSlim _dispatchSlots = new(8, 8);
    internal int OutstandingDispatchCount => 8 - _dispatchSlots.CurrentCount;
    private readonly ResiliencePipeline<bool> _pipeline = new ResiliencePipelineBuilder<bool>()
        .AddCircuitBreaker(new CircuitBreakerStrategyOptions<bool>
        {
            ShouldHandle = new PredicateBuilder<bool>()
                .Handle<Exception>(exception => exception is not OperationCanceledException)
                .HandleResult(false),
            MinimumThroughput = 5,
            FailureRatio = 0.5,
            SamplingDuration = TimeSpan.FromSeconds(30),
            BreakDuration = TimeSpan.FromSeconds(30),
        }).Build();

    public async Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
    {
        if (ct.IsCancellationRequested || !EmailOptions.IsMailbox(to)
            || string.IsNullOrWhiteSpace(subject) || subject.Length > 200
            || subject.Any(char.IsControl) || string.IsNullOrWhiteSpace(html) || html.Length > 256_000)
            return false;

        try
        {
            var settings = options.Value;
            if (!settings.Enabled || !settings.IsValid()) return false;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));

            var accepted = await _pipeline.ExecuteAsync(async token =>
            {
                var request = new SendEmailRequest
                {
                    Source = settings.FromAddress,
                    Destination = new Destination { ToAddresses = [to] },
                    Message = new Message
                    {
                        Subject = new Content { Data = subject, Charset = "UTF-8" },
                        Body = new Body { Html = new Content { Data = html, Charset = "UTF-8" } },
                    },
                };
                // Bound our wait even if a transport does not honor cancellation. SES has no
                // idempotency token here: no SDK or Polly retries after an uncertain outcome.
                if (!await _dispatchSlots.WaitAsync(0, token)) return false;
                var dispatch = Task.Run(async () =>
                {
                    try
                    {
                        token.ThrowIfCancellationRequested();
                        var provider = client.Value;
                        token.ThrowIfCancellationRequested();
                        var response = await provider.SendEmailAsync(request, token);
                        return response.HttpStatusCode == HttpStatusCode.OK
                            && !string.IsNullOrWhiteSpace(response.MessageId);
                    }
                    finally { _dispatchSlots.Release(); }
                });
                try { return await dispatch.WaitAsync(token); }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    // Provider deadline failures contribute to opening the circuit; caller
                    // cancellation does not. The dispatch retains its slot until it really ends.
                    return false;
                }
            }, deadline.Token);

            if (!accepted) logger.LogWarning("Email provider acceptance was not confirmed");
            return accepted;
        }
        catch (Exception exception)
        {
            // Exception messages/provider payloads can contain recipient addresses or invitation
            // secrets. Log only a bounded category; never log the exception object or message body.
            var reason = exception switch
            {
                BrokenCircuitException => "circuit_open",
                OperationCanceledException => "cancelled_or_timed_out",
                _ => "provider_failure",
            };
            logger.LogWarning("Email provider acceptance was not confirmed: {Reason}", reason);
            return false;
        }
    }
}
