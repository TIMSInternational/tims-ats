using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Tims.Workers;
using Tims.Workers.HealthChecks;

namespace Tims.IntegrationTests.Workers;

/// <summary>
/// The Fargate container health check (`dotnet Tims.Workers.dll --healthcheck`) — pure and DB-free. Pins: the
/// flag is only recognised as the FIRST argument; the target defaults to loopback :8080/health and can never
/// be pointed off-box; 2xx ⇒ 0, non-2xx / transport failure / timeout ⇒ 1; and end-to-end against the real
/// worker host's /health it reports healthy.
/// </summary>
[Collection(WorkerHostCollection.Name)]
public sealed class ContainerHealthProbeTests
{
    [Theory]
    [InlineData(new[] { "--healthcheck" }, true)]
    [InlineData(new[] { "--healthcheck", "http://127.0.0.1:9000/health" }, true)]
    [InlineData(new string[0], false)]
    [InlineData(new[] { "--urls", "--healthcheck" }, false)]
    [InlineData(new[] { "--HEALTHCHECK" }, false)]
    public void Recognises_the_flag_only_as_the_first_argument(string[] args, bool expected) =>
        Assert.Equal(expected, ContainerHealthProbe.IsProbeInvocation(args));

    [Fact]
    public void Default_target_is_the_loopback_liveness_endpoint_on_the_image_port()
    {
        var target = ContainerHealthProbe.ResolveTarget(["--healthcheck"]);
        Assert.Equal(new Uri("http://127.0.0.1:8080/health"), target);
        Assert.True(target!.IsLoopback);
    }

    [Theory]
    [InlineData("http://localhost:8080/health")]
    [InlineData("http://127.0.0.1:9999/health")]
    [InlineData("http://[::1]:8080/health")]
    public void Accepts_a_loopback_override(string url) =>
        Assert.Equal(new Uri(url), ContainerHealthProbe.ResolveTarget(["--healthcheck", url]));

    [Theory]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("https://tims-ats.vercel.app/health")]
    [InlineData("file:///etc/passwd")]
    [InlineData("http://user:pass@127.0.0.1:8080/health")]
    [InlineData("not a url")]
    public void Rejects_any_non_loopback_or_non_http_target(string url) =>
        Assert.Null(ContainerHealthProbe.ResolveTarget(["--healthcheck", url]));

    [Theory]
    [InlineData(HttpStatusCode.OK, 0)]
    [InlineData(HttpStatusCode.NoContent, 0)]
    [InlineData(HttpStatusCode.ServiceUnavailable, 1)]
    [InlineData(HttpStatusCode.InternalServerError, 1)]
    [InlineData(HttpStatusCode.NotFound, 1)]
    public async Task Maps_the_status_code_to_the_exit_code(HttpStatusCode status, int expected)
    {
        using var client = new HttpClient(new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(status))));
        Assert.Equal(expected, await ContainerHealthProbe.ProbeAsync(client, ContainerHealthProbe.DefaultTarget, CancellationToken.None));
    }

    [Fact]
    public async Task A_refused_connection_is_unhealthy_not_a_crash()
    {
        using var client = new HttpClient(new StubHandler((_, _) => throw new HttpRequestException("connection refused")));
        Assert.Equal(1, await ContainerHealthProbe.ProbeAsync(client, ContainerHealthProbe.DefaultTarget, CancellationToken.None));
    }

    [Fact]
    public async Task A_timeout_is_unhealthy_not_a_crash()
    {
        using var client = new HttpClient(new StubHandler(async (_, ct) =>
        {
            // A hung listener: never answers; HttpClient.Timeout cancels the request token.
            await Task.Delay(TimeSpan.FromSeconds(30), ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        }))
        { Timeout = TimeSpan.FromMilliseconds(50) };
        Assert.Equal(1, await ContainerHealthProbe.ProbeAsync(client, ContainerHealthProbe.DefaultTarget, CancellationToken.None));
    }

    [Fact]
    public async Task Reports_healthy_against_the_real_worker_host_liveness_endpoint()
    {
        await using var factory = new WebApplicationFactory<WorkerHostMarker>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x;Password=x"));
        using var client = factory.CreateClient();

        Assert.Equal(0, await ContainerHealthProbe.ProbeAsync(client, new Uri(client.BaseAddress!, "/health"), CancellationToken.None));
        // And the probe really reads the status: an unmapped path on the same host is a 404 ⇒ unhealthy.
        Assert.Equal(1, await ContainerHealthProbe.ProbeAsync(client, new Uri(client.BaseAddress!, "/no-such-endpoint"), CancellationToken.None));
    }

    private sealed class StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            respond(request, cancellationToken);
    }
}
