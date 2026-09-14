using System.Net;
using Amazon;
using Amazon.Runtime;
using Amazon.SimpleEmail;
using Amazon.SimpleEmail.Model;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tims.Application.Email;
using Tims.Infrastructure.Email;

namespace Tims.IntegrationTests.Email;

public sealed class EmailResilienceTests
{
    [Fact]
    public async Task Same_registered_sender_recovers_after_first_client_initialization_fails()
    {
        using var client = new ControlledSes();
        var services = new ServiceCollection().AddLogging();
        var constructions = 0;
        services.AddSingleton<IAmazonSimpleEmailService>(_ =>
            Interlocked.Increment(ref constructions) == 1 ? throw new InvalidOperationException("temporary") : client);
        services.AddPlatformEmail(Configuration());
        using var provider = services.BuildServiceProvider();
        var sender = provider.GetRequiredService<IEmailSender>();
        Assert.False(await Send(sender));
        Assert.True(await Send(sender));
        Assert.Equal(2, constructions);
        Assert.Equal(1, client.Calls);
    }

    [Fact]
    public async Task Saturated_dispatch_has_no_queue_and_timed_out_operations_keep_slots_until_done()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var allStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var starts = 0;
        using var client = new ControlledSes { Handler = async _ =>
        {
            if (Interlocked.Increment(ref starts) == 8) allStarted.SetResult();
            await release.Task; // deliberately ignore cancellation to test retained capacity
            return Accepted();
        } };
        var sender = Create(client);
        var sends = Enumerable.Range(0, 8).Select(_ => Send(sender)).ToArray();
        try
        {
            await allStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(await Send(sender));
            Assert.Equal(8, client.Calls);
            Assert.All(await Task.WhenAll(sends).WaitAsync(TimeSpan.FromSeconds(5)), result => Assert.False(result));
            Assert.Equal(8, sender.OutstandingDispatchCount);
            Assert.False(await Send(sender));
            Assert.Equal(8, client.Calls);
        }
        finally
        {
            release.TrySetResult();
            await Task.WhenAll(sends);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            while (sender.OutstandingDispatchCount != 0) await Task.Delay(10, deadline.Token);
        }
    }

    [Fact]
    public async Task Repeated_inflight_caller_cancellation_does_not_open_circuit()
    {
        CancellationTokenSource? cancellation = null;
        using var client = new ControlledSes { Handler = ct =>
        {
            cancellation?.Cancel();
            ct.ThrowIfCancellationRequested();
            return Task.FromResult(Accepted());
        } };
        var sender = Create(client);
        for (var index = 0; index < 8; index++)
        {
            using var current = new CancellationTokenSource();
            cancellation = current;
            Assert.False(await Send(sender, current.Token));
        }
        cancellation = null;
        Assert.True(await Send(sender));
        Assert.Equal(9, client.Calls);
    }

    [Fact]
    public async Task Invalid_enabled_configuration_prevents_host_startup()
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Email:Enabled"] = "true" });
        builder.Services.AddPlatformEmail(builder.Configuration);
        using var host = builder.Build();
        await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
    }

    private static IConfiguration Configuration() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Email:Enabled"] = "true", ["Email:Region"] = "us-east-1", ["Email:FromAddress"] = "sender@example.test",
    }).Build();

    private static SesEmailSender Create(ControlledSes client) => new(new Lazy<IAmazonSimpleEmailService>(() => client),
        Options.Create(new EmailOptions { Enabled = true, Region = "us-east-1", FromAddress = "sender@example.test", TimeoutSeconds = 1 }),
        NullLogger<SesEmailSender>.Instance);

    private static Task<bool> Send(IEmailSender sender, CancellationToken ct = default) =>
        sender.SendEmailAsync("recipient@example.test", "Subject", "Body", ct);

    private static SendEmailResponse Accepted() => new() { HttpStatusCode = HttpStatusCode.OK, MessageId = "accepted" };

    private sealed class ControlledSes() : AmazonSimpleEmailServiceClient(new AnonymousAWSCredentials(), RegionEndpoint.USEast1)
    {
        private int _calls;
        public int Calls => Volatile.Read(ref _calls);
        public Func<CancellationToken, Task<SendEmailResponse>> Handler { get; init; } = _ => Task.FromResult(Accepted());
        public override Task<SendEmailResponse> SendEmailAsync(SendEmailRequest request, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _calls);
            return Handler(cancellationToken);
        }
    }
}
