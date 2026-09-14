using System.Net;
using Amazon;
using Amazon.Runtime;
using Amazon.SimpleEmail;
using Amazon.SimpleEmail.Model;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tims.Application.Email;
using Tims.Infrastructure.Email;

namespace Tims.IntegrationTests.Email;

public sealed class SesEmailSenderTests
{
    private const string Recipient = "recipient@example.test";
    private static readonly EmailOptions Enabled = new()
    {
        Enabled = true, Region = "us-east-1", FromAddress = "sender@example.test", TimeoutSeconds = 1,
    };

    [Fact]
    public async Task Maps_single_recipient_and_utf8_content_and_requires_provider_acceptance()
    {
        using var client = new StubSes();
        var sender = Create(client);
        Assert.True(await sender.SendEmailAsync(Recipient, "Invitación", "<p>Hola</p>", CancellationToken.None));
        Assert.Equal(1, client.Calls);
        Assert.Equal(Enabled.FromAddress, client.LastRequest!.Source);
        Assert.Equal([Recipient], client.LastRequest.Destination.ToAddresses);
        Assert.Null(client.LastRequest.Destination.CcAddresses);
        Assert.Null(client.LastRequest.Destination.BccAddresses);
        Assert.Equal("Invitación", client.LastRequest.Message.Subject.Data);
        Assert.Equal("UTF-8", client.LastRequest.Message.Subject.Charset);
        Assert.Equal("<p>Hola</p>", client.LastRequest.Message.Body.Html.Data);
        Assert.Equal("UTF-8", client.LastRequest.Message.Body.Html.Charset);
    }

    [Theory]
    [InlineData(HttpStatusCode.OK, null)]
    [InlineData(HttpStatusCode.OK, " ")]
    [InlineData(HttpStatusCode.BadRequest, "message")]
    public async Task Unconfirmed_response_is_not_success(HttpStatusCode status, string? id)
    {
        using var client = new StubSes { Handler = (_, _) => Task.FromResult(new SendEmailResponse { HttpStatusCode = status, MessageId = id }) };
        Assert.False(await Send(Create(client)));
        Assert.Equal(1, client.Calls);
    }

    [Fact]
    public async Task Provider_exception_is_fail_soft_without_retries_or_pii_in_logs()
    {
        using var client = new StubSes { Handler = (_, _) => throw new AmazonSimpleEmailServiceException("recipient@example.test secret-invitation-token") };
        var logger = new RecordingLogger();
        Assert.False(await Send(Create(client, logger)));
        Assert.Equal(1, client.Calls);
        Assert.Contains("provider_failure", logger.Output);
        Assert.DoesNotContain("recipient", logger.Output);
        Assert.DoesNotContain("secret", logger.Output);
        Assert.False(logger.HasException);
    }

    [Fact]
    public async Task Credential_resolution_failure_is_also_fail_soft()
    {
        var sender = new SesEmailSender(new Lazy<IAmazonSimpleEmailService>(() => throw new InvalidOperationException("credentials unavailable")),
            Options.Create(Enabled), NullLogger<SesEmailSender>.Instance);
        Assert.False(await Send(sender));
    }

    [Fact]
    public async Task Repeated_provider_failures_open_shared_circuit()
    {
        using var client = new StubSes { Handler = (_, _) => throw new HttpRequestException("offline") };
        var sender = Create(client);
        for (var i = 0; i < 8; i++) Assert.False(await Send(sender));
        Assert.Equal(5, client.Calls);
    }

    [Fact]
    public async Task Cancellation_before_send_does_not_call_provider()
    {
        using var client = new StubSes();
        Assert.False(await Create(client).SendEmailAsync(Recipient, "Subject", "<p>Body</p>", new CancellationToken(true)));
        Assert.Equal(0, client.Calls);
    }

    [Fact]
    public async Task Timeout_bounds_wait_and_cancels_provider_without_retry()
    {
        var pending = new TaskCompletionSource<SendEmailResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        CancellationToken observed = default;
        using var client = new StubSes { Handler = (_, ct) => { observed = ct; return pending.Task; } };
        Assert.False(await Send(Create(client)).WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.True(observed.IsCancellationRequested);
        Assert.Equal(1, client.Calls);
        // Simulate a late acceptance: callers must not assume false proves non-delivery.
        pending.SetResult(new SendEmailResponse { HttpStatusCode = HttpStatusCode.OK, MessageId = "late" });
    }

    [Fact]
    public async Task Slow_synchronous_client_initialization_is_bounded_and_never_sends_after_deadline()
    {
        using var release = new ManualResetEventSlim();
        using var client = new StubSes();
        var initialized = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sender = new SesEmailSender(new Lazy<IAmazonSimpleEmailService>(() =>
        {
            release.Wait();
            initialized.SetResult();
            return client;
        }), Options.Create(Enabled), NullLogger<SesEmailSender>.Instance);
        try { Assert.False(await Send(sender).WaitAsync(TimeSpan.FromSeconds(5))); }
        finally { release.Set(); }
        await initialized.Task.WaitAsync(TimeSpan.FromSeconds(5));
        using var idleDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (sender.OutstandingDispatchCount != 0) await Task.Delay(10, idleDeadline.Token);
        Assert.Equal(0, client.Calls);
    }

    [Fact]
    public async Task Caller_cancellation_interrupts_an_inflight_send()
    {
        using var cancellation = new CancellationTokenSource();
        using var client = new StubSes { Handler = async (_, ct) =>
        {
            cancellation.Cancel();
            await Task.Delay(Timeout.Infinite, ct);
            return new SendEmailResponse();
        } };
        Assert.False(await Create(client).SendEmailAsync(Recipient, "Subject", "Body", cancellation.Token));
        Assert.Equal(1, client.Calls);
    }

    [Theory]
    [InlineData("bad", "Subject", "Body")]
    [InlineData("A <a@example.test>", "Subject", "Body")]
    [InlineData("a@example.test,b@example.test", "Subject", "Body")]
    [InlineData("a@example.test\r\nBcc:b@example.test", "Subject", "Body")]
    [InlineData("josé@example.test", "Subject", "Body")]
    [InlineData(Recipient, "Subject\r\nInjected: yes", "Body")]
    [InlineData(Recipient, "", "Body")]
    [InlineData(Recipient, "Subject", " ")]
    public async Task Invalid_input_never_reaches_provider(string to, string subject, string html)
    {
        using var client = new StubSes();
        Assert.False(await Create(client).SendEmailAsync(to, subject, html, CancellationToken.None));
        Assert.Equal(0, client.Calls);
    }

    [Fact]
    public async Task Oversized_input_never_reaches_provider()
    {
        using var client = new StubSes();
        var sender = Create(client);
        Assert.False(await sender.SendEmailAsync(Recipient, new string('s', 201), "Body", CancellationToken.None));
        Assert.False(await sender.SendEmailAsync(Recipient, "Subject", new string('b', 256_001), CancellationToken.None));
        Assert.False(await sender.SendEmailAsync(new string('a', 255) + "@example.test", "Subject", "Body", CancellationToken.None));
        Assert.Equal(0, client.Calls);
    }

    [Fact]
    public async Task Disabled_registration_requires_no_aws_credentials_and_returns_false()
    {
        var services = new ServiceCollection().AddLogging();
        services.AddSingleton<IAmazonSimpleEmailService>(_ => throw new InvalidOperationException("must not resolve"));
        services.AddPlatformEmail(new ConfigurationBuilder().Build());
        using var provider = services.BuildServiceProvider();
        Assert.False(await Send(provider.GetRequiredService<IEmailSender>()));
    }

    [Fact]
    public async Task Enabled_registration_resolves_singleton_sender_and_shared_provider()
    {
        using var client = new StubSes();
        var services = new ServiceCollection().AddLogging();
        services.AddSingleton<IAmazonSimpleEmailService>(client);
        services.AddPlatformEmail(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Email:Enabled"] = "true", ["Email:Region"] = Enabled.Region,
            ["Email:FromAddress"] = Enabled.FromAddress,
        }).Build());
        using var provider = services.BuildServiceProvider();
        var sender = provider.GetRequiredService<IEmailSender>();
        Assert.Same(sender, provider.GetRequiredService<IEmailSender>());
        Assert.True(await Send(sender));
    }

    [Theory]
    [InlineData("", "sender@example.test", 10)]
    [InlineData("invented-region", "sender@example.test", 10)]
    [InlineData("us-east-1", "", 10)]
    [InlineData("us-east-1", "Name <sender@example.test>", 10)]
    [InlineData("us-east-1", "sender@example.test", 0)]
    [InlineData("us-east-1", "sender@example.test", 61)]
    public void Invalid_enabled_configuration_fails_validation(string region, string from, int timeout)
    {
        var services = new ServiceCollection().AddLogging();
        services.AddPlatformEmail(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Email:Enabled"] = "true", ["Email:Region"] = region,
            ["Email:FromAddress"] = from, ["Email:TimeoutSeconds"] = timeout.ToString(System.Globalization.CultureInfo.InvariantCulture),
        }).Build());
        using var provider = services.BuildServiceProvider();
        Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IOptions<EmailOptions>>().Value);
    }

    private static SesEmailSender Create(StubSes client, ILogger<SesEmailSender>? logger = null) =>
        new(new Lazy<IAmazonSimpleEmailService>(() => client), Options.Create(Enabled), logger ?? NullLogger<SesEmailSender>.Instance);

    private static Task<bool> Send(IEmailSender sender) => sender.SendEmailAsync(Recipient, "Subject", "<p>Body</p>", CancellationToken.None);

    private sealed class StubSes() : AmazonSimpleEmailServiceClient(new AnonymousAWSCredentials(), RegionEndpoint.USEast1)
    {
        public int Calls { get; private set; }
        public SendEmailRequest? LastRequest { get; private set; }
        public Func<SendEmailRequest, CancellationToken, Task<SendEmailResponse>> Handler { get; init; } =
            (_, _) => Task.FromResult(new SendEmailResponse { HttpStatusCode = HttpStatusCode.OK, MessageId = "accepted" });
        public override Task<SendEmailResponse> SendEmailAsync(SendEmailRequest request, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastRequest = request;
            return Handler(request, cancellationToken);
        }
    }

    private sealed class RecordingLogger : ILogger<SesEmailSender>
    {
        public string Output { get; private set; } = "";
        public bool HasException { get; private set; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Output += formatter(state, exception);
            HasException |= exception is not null;
        }
    }
}
