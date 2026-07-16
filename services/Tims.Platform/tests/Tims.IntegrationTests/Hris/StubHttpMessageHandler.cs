using System.Net;
using System.Net.Http.Headers;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// A deterministic, in-memory <see cref="HttpMessageHandler"/> for the BambooHR resilience tests — NO
/// live network. It records every request (so the Authorization header + call count can be asserted)
/// and returns responses from a caller-supplied responder keyed on the zero-based call index, so a test
/// can script "429 → 500 → 200" or "persistent 500".
/// </summary>
internal sealed class StubHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<int, HttpResponseMessage> _responder;
    private int _callCount;

    public StubHttpMessageHandler(Func<int, HttpResponseMessage> responder)
    {
        _responder = responder;
    }

    public int CallCount => Volatile.Read(ref _callCount);

    /// <summary>The Authorization header of the most recent request (null if none carried one).</summary>
    public AuthenticationHeaderValue? LastAuthorization { get; private set; }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var index = Interlocked.Increment(ref _callCount) - 1;
        LastAuthorization = request.Headers.Authorization;
        return Task.FromResult(_responder(index));
    }

    /// <summary>A responder that plays a fixed sequence of status codes, then repeats the last one.</summary>
    public static Func<int, HttpResponseMessage> Sequence(string? okBody, params HttpStatusCode[] statuses) =>
        index =>
        {
            var status = index < statuses.Length ? statuses[index] : statuses[^1];
            var response = new HttpResponseMessage(status);
            if (status == HttpStatusCode.OK && okBody is not null)
            {
                response.Content = new StringContent(okBody, System.Text.Encoding.UTF8, "application/json");
            }

            return response;
        };

    /// <summary>A responder that always returns the same status code.</summary>
    public static Func<int, HttpResponseMessage> Always(HttpStatusCode status) =>
        _ => new HttpResponseMessage(status);
}
