using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Sentry;
using Sentry.AspNetCore;
using Sentry.Extensibility;
using Serilog;
using Tims.Api.ErrorReporting;
using Tims.Api.Http;

namespace Tims.IntegrationTests.ErrorReporting;

/// <summary>
/// The Sentry SDK keeps process-wide static state (SentrySdk), so every test that can initialise it runs in this one
/// non-parallel collection.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class ErrorReportingCollection
{
    public const string Name = "ErrorReporting (process-wide Sentry SDK state)";
}

[Collection(ErrorReportingCollection.Name)]
public sealed class ErrorReportingTests
{
    private const string Credential = "s3cr3t-credential-value";

    private static WebApplicationBuilder Builder(IDictionary<string, string?> settings)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Production" });
        builder.Configuration.AddInMemoryCollection(settings);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        return builder;
    }

    private static bool IsSentryService(ServiceDescriptor descriptor) =>
        (descriptor.ServiceType.Namespace ?? string.Empty).StartsWith("Sentry", StringComparison.Ordinal)
        || (descriptor.ImplementationType?.Namespace ?? string.Empty).StartsWith("Sentry", StringComparison.Ordinal);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task WithoutADsnNothingIsRegisteredAndTheSdkIsNeverInitialised(string? dsn)
    {
        var builder = Builder(new Dictionary<string, string?> { [ErrorReportingExtensions.DsnKey] = dsn });

        Assert.False(ErrorReportingExtensions.IsEnabled(builder.Configuration));
        builder.AddErrorReporting();

        Assert.DoesNotContain(builder.Services, IsSentryService);

        await using var app = builder.Build();
        await app.StartAsync();
        try
        {
            Assert.Null(app.Services.GetService<IHub>());
            Assert.False(SentrySdk.IsEnabled);
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public void AMalformedDsnFailsStartupWithoutEchoingIt()
    {
        var builder = Builder(new Dictionary<string, string?> { [ErrorReportingExtensions.DsnKey] = "not-a-dsn-" + Credential });

        var error = Assert.Throws<InvalidOperationException>(() => builder.AddErrorReporting());

        Assert.Contains(ErrorReportingExtensions.DsnKey, error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(Credential, error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task WithADsnTheSdkIsRegisteredAndConfigurationCannotLoosenThePrivacySettings()
    {
        var builder = Builder(new Dictionary<string, string?>
        {
            // Trailing whitespace, as a secret pasted with a newline would carry.
            [ErrorReportingExtensions.DsnKey] = "https://publickey@o0.ingest.example.test/42\n",
            ["Sentry:SendDefaultPii"] = "true",
            ["Sentry:MaxRequestBodySize"] = "Always",
            ["Sentry:CaptureFailedRequests"] = "true",
        });

        builder.AddErrorReporting();
        Assert.Contains(builder.Services, IsSentryService);

        await using var app = builder.Build();
        try
        {
            var options = app.Services.GetRequiredService<IOptions<SentryAspNetCoreOptions>>().Value;
            Assert.Equal("https://publickey@o0.ingest.example.test/42", options.Dsn);
            Assert.False(options.SendDefaultPii);
            Assert.Equal(RequestSize.None, options.MaxRequestBodySize);
            Assert.False(options.CaptureFailedRequests);
            Assert.True(options.DisableSentryHttpMessageHandler);
            Assert.Equal("production", options.Environment);
        }
        finally
        {
            await app.DisposeAsync();
        }
    }

    [Fact]
    public async Task AnExceptionSwallowedByTheSecurityHeadersMiddlewareIsReportedWithoutCredentialsOrPersonalData()
    {
        await using var ingest = await FakeIngest.StartAsync();
        var builder = Builder(new Dictionary<string, string?>
        {
            [ErrorReportingExtensions.DsnKey] = $"http://publickey@127.0.0.1:{ingest.Port}/42",
            ["Sentry:Release"] = "0123456789abcdef0123456789abcdef01234567",
        });
        builder.AddErrorReporting();
        builder.Host.UseSerilog(
            (context, _, configuration) => configuration.WriteToErrorReporting(context.Configuration),
            preserveStaticLogger: true);

        await using var app = builder.Build();
        // The production pipeline's outermost app middleware: turns the exception into a logged, empty 500.
        app.UseMiddleware<SecurityHeadersMiddleware>();
        app.MapPost(
            "/tenant/candidates/{candidateId:guid}/consent",
            (Func<IResult>)(() => throw new InvalidOperationException("consent write failed")));
        await app.StartAsync();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                new Uri("/tenant/candidates/7d6f0d7e-3a52-4d0e-9c8a-2b1f1e9b8c11/consent?token=" + Credential, UriKind.Relative))
            {
                Content = new StringContent("{\"email\":\"person@example.test\"}", Encoding.UTF8, "application/json"),
            };
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Credential);
            request.Headers.Add("Cookie", "sb-access-token=" + Credential);
            request.Headers.Add("x-api-key", Credential);
            request.Headers.Add("x-tims-relay-attribution", Credential);
            request.Headers.Add("x-real-ip", "203.0.113.7");

            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);

            await app.Services.GetRequiredService<IHub>().FlushAsync(TimeSpan.FromSeconds(10));
            var sent = await ingest.WaitForAsync("consent write failed", TimeSpan.FromSeconds(10));

            Assert.Contains("InvalidOperationException", sent, StringComparison.Ordinal);
            Assert.Contains("\"environment\":\"production\"", sent, StringComparison.Ordinal);
            Assert.Contains("\"release\":\"0123456789abcdef0123456789abcdef01234567\"", sent, StringComparison.Ordinal);
            Assert.Contains("/tenant/candidates/7d6f0d7e-3a52-4d0e-9c8a-2b1f1e9b8c11/consent", sent, StringComparison.Ordinal);
            Assert.DoesNotContain(Credential, sent, StringComparison.Ordinal);
            Assert.DoesNotContain("person@example.test", sent, StringComparison.Ordinal);
            Assert.DoesNotContain("203.0.113.7", sent, StringComparison.Ordinal);
            Assert.DoesNotContain("\"authorization\"", sent, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("query_string", sent, StringComparison.Ordinal);
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public async Task WithoutADsnTheSamePipelineSendsNothing()
    {
        await using var ingest = await FakeIngest.StartAsync();
        var builder = Builder(new Dictionary<string, string?>());
        builder.AddErrorReporting();
        builder.Host.UseSerilog(
            (context, _, configuration) => configuration.WriteToErrorReporting(context.Configuration),
            preserveStaticLogger: true);

        await using var app = builder.Build();
        app.UseMiddleware<SecurityHeadersMiddleware>();
        app.MapGet("/boom", (Func<IResult>)(() => throw new InvalidOperationException("boom")));
        await app.StartAsync();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
            using var response = await client.GetAsync(new Uri("/boom", UriKind.Relative));
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);

            Assert.False(SentrySdk.IsEnabled);
            Assert.Null(app.Services.GetService<IHub>());
            await Task.Delay(TimeSpan.FromMilliseconds(500));
            Assert.Equal(0, ingest.RequestCount);
        }
        finally
        {
            await app.StopAsync();
        }
    }

    /// <summary>A local stand-in for Sentry's ingest endpoint that records every envelope it is sent.</summary>
    private sealed class FakeIngest : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly ConcurrentQueue<string> _bodies;

        private FakeIngest(WebApplication app, ConcurrentQueue<string> bodies)
        {
            _app = app;
            _bodies = bodies;
        }

        public int Port => new Uri(_app.Urls.First()).Port;

        public int RequestCount => _bodies.Count;

        public static async Task<FakeIngest> StartAsync()
        {
            var bodies = new ConcurrentQueue<string>();
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            var app = builder.Build();
            app.Run(async context =>
            {
                Stream body = context.Request.Body;
                if (string.Equals(context.Request.Headers.ContentEncoding, "gzip", StringComparison.OrdinalIgnoreCase))
                {
                    body = new GZipStream(body, CompressionMode.Decompress);
                }

                using var reader = new StreamReader(body, Encoding.UTF8);
                bodies.Enqueue(await reader.ReadToEndAsync());
                context.Response.StatusCode = StatusCodes.Status200OK;
            });
            await app.StartAsync();
            return new FakeIngest(app, bodies);
        }

        public async Task<string> WaitForAsync(string marker, TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                var all = string.Join("\n", _bodies);
                if (all.Contains(marker, StringComparison.Ordinal))
                {
                    return all;
                }

                await Task.Delay(50);
            }

            throw new TimeoutException($"No envelope containing '{marker}' arrived; {_bodies.Count} request(s) received.");
        }

        public async ValueTask DisposeAsync()
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
