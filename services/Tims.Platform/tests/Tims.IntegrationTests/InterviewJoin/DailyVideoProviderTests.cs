using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tims.Infrastructure.InterviewJoin;

namespace Tims.IntegrationTests.InterviewJoin;

public sealed class DailyVideoProviderTests
{
    private sealed class Handler(params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses = new(responses);
        public List<(HttpMethod Method, string Url, string? Auth, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add((request.Method, request.RequestUri!.ToString(), request.Headers.Authorization?.ToString(),
                request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct)));
            return _responses.Dequeue();
        }
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

    private static DailyVideoProvider Provider(Handler handler, string? key = "daily-test-key") =>
        new(new HttpClient(handler), Options.Create(new DailyOptions { ApiKey = key }),
            NullLogger<DailyVideoProvider>.Instance);

    private static readonly DateTimeOffset Until = new(2026, 10, 1, 16, 30, 0, TimeSpan.Zero);

    [Fact]
    public async Task Creates_a_private_room_open_until_the_window_closes()
    {
        var handler = new Handler(Json(HttpStatusCode.OK, """{"name":"tims-1234abcd","url":"https://tims.daily.co/tims-1234abcd"}"""));
        var room = await Provider(handler).EnsureRoomAsync("tims-1234abcd", Until, default);
        Assert.Equal("https://tims.daily.co/tims-1234abcd", room!.Url);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://api.daily.co/v1/rooms/", request.Url);
        Assert.Equal("Bearer daily-test-key", request.Auth);
        using var body = JsonDocument.Parse(request.Body);
        Assert.Equal("private", body.RootElement.GetProperty("privacy").GetString());
        Assert.Equal(Until.ToUnixTimeSeconds(), body.RootElement.GetProperty("properties").GetProperty("exp").GetInt64());
    }

    [Fact]
    public async Task Existing_room_400_falls_back_to_get_and_extends_a_short_lived_room()
    {
        var handler = new Handler(
            Json(HttpStatusCode.BadRequest, """{"error":"invalid-request-error"}"""),
            Json(HttpStatusCode.OK, "{\"name\":\"staff-room\",\"url\":\"https://tims.daily.co/staff-room\",\"config\":{\"exp\":"
                + (Until.ToUnixTimeSeconds() - 600) + "}}"),
            Json(HttpStatusCode.OK, """{"name":"staff-room"}"""));
        var room = await Provider(handler).EnsureRoomAsync("staff-room", Until, default);
        Assert.Equal("https://tims.daily.co/staff-room", room!.Url);
        Assert.Equal(3, handler.Requests.Count);
        Assert.Equal((HttpMethod.Get, "https://api.daily.co/v1/rooms/staff-room"),
            (handler.Requests[1].Method, handler.Requests[1].Url));
        Assert.Equal("https://api.daily.co/v1/rooms/staff-room", handler.Requests[2].Url);
        Assert.Contains($"\"exp\":{Until.ToUnixTimeSeconds()}", handler.Requests[2].Body);
    }

    [Fact]
    public async Task Provider_errors_return_null_instead_of_throwing()
    {
        var handler = new Handler(Json(HttpStatusCode.Unauthorized, """{"error":"authorization-error"}"""));
        Assert.Null(await Provider(handler).EnsureRoomAsync("tims-1234abcd", Until, default));
        var tokenHandler = new Handler(Json(HttpStatusCode.InternalServerError, "{}"));
        Assert.Null(await Provider(tokenHandler).CreateGuestTokenAsync("r", "Ana", Until, Until, default));
    }

    [Fact]
    public async Task Guest_token_is_never_an_owner_and_is_bounded_in_time()
    {
        var handler = new Handler(Json(HttpStatusCode.OK, """{"token":"eyJ.guest"}"""));
        var notBefore = Until.AddMinutes(-105);
        var token = await Provider(handler).CreateGuestTokenAsync("tims-1234abcd", "Ana Pérez", notBefore, Until, default);
        Assert.Equal("eyJ.guest", token);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://api.daily.co/v1/meeting-tokens", request.Url);
        using var body = JsonDocument.Parse(request.Body);
        var properties = body.RootElement.GetProperty("properties");
        Assert.False(properties.GetProperty("is_owner").GetBoolean());
        Assert.Equal("tims-1234abcd", properties.GetProperty("room_name").GetString());
        Assert.Equal("Ana Pérez", properties.GetProperty("user_name").GetString());
        Assert.Equal(Until.ToUnixTimeSeconds(), properties.GetProperty("exp").GetInt64());
        Assert.Equal(notBefore.ToUnixTimeSeconds(), properties.GetProperty("nbf").GetInt64());
        Assert.True(properties.GetProperty("eject_at_token_exp").GetBoolean());
    }

    [Fact]
    public async Task Missing_key_is_unconfigured_and_never_calls_daily()
    {
        var handler = new Handler();
        var provider = Provider(handler, key: " ");
        Assert.False(provider.IsConfigured);
        Assert.Null(await provider.EnsureRoomAsync("tims-1234abcd", Until, default));
        Assert.Empty(handler.Requests);
    }

    [Theory]
    [InlineData("https://api.daily.co/v1", true)]
    [InlineData("http://api.daily.co/v1", false)]
    [InlineData("https://user:pw@api.daily.co/v1", false)]
    [InlineData("not a url", false)]
    public void Api_url_must_be_plain_https(string url, bool valid) =>
        Assert.Equal(valid, new DailyOptions { ApiUrl = url }.IsValid());
}
