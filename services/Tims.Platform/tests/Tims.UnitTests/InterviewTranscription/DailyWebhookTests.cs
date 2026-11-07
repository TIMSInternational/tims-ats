using System.Security.Cryptography;
using System.Text;
using Tims.Application.InterviewTranscription;

namespace Tims.UnitTests.InterviewTranscription;

public sealed class DailyWebhookTests
{
    private static readonly string Secret = Convert.ToBase64String(Encoding.UTF8.GetBytes("unit-test-hmac-secret-0123456789"));
    private static readonly DateTimeOffset Now = new(2026, 11, 6, 15, 0, 0, TimeSpan.Zero);

    private static string Sign(string secret, string timestamp, string body) =>
        Convert.ToBase64String(HMACSHA256.HashData(Convert.FromBase64String(secret),
            Encoding.UTF8.GetBytes(timestamp + "." + body)));

    private static string Ts(DateTimeOffset at) => at.ToUnixTimeSeconds().ToString();

    [Fact]
    public void A_signature_over_timestamp_dot_raw_body_with_the_decoded_secret_verifies()
    {
        const string body = """{"version":"1.1.0","type":"transcript.ready-to-download","id":"e1","payload":{}}""";
        var ts = Ts(Now);
        Assert.True(DailyWebhookSignature.Verify(Secret, ts, Sign(Secret, ts, body), Encoding.UTF8.GetBytes(body), Now));
    }

    [Fact]
    public void Tampered_body_wrong_secret_missing_headers_and_stale_timestamps_are_rejected()
    {
        const string body = """{"type":"transcript.ready-to-download"}""";
        var ts = Ts(Now);
        var signature = Sign(Secret, ts, body);
        var bytes = Encoding.UTF8.GetBytes(body);
        Assert.False(DailyWebhookSignature.Verify(Secret, ts, signature, Encoding.UTF8.GetBytes(body + " "), Now));
        var other = Convert.ToBase64String(Encoding.UTF8.GetBytes("another-secret-of-enough-length!"));
        Assert.False(DailyWebhookSignature.Verify(other, ts, signature, bytes, Now));
        Assert.False(DailyWebhookSignature.Verify(null, ts, signature, bytes, Now));
        Assert.False(DailyWebhookSignature.Verify("", ts, signature, bytes, Now));
        Assert.False(DailyWebhookSignature.Verify(Secret, null, signature, bytes, Now));
        Assert.False(DailyWebhookSignature.Verify(Secret, ts, null, bytes, Now));
        Assert.False(DailyWebhookSignature.Verify(Secret, ts, "not base64 !!", bytes, Now));
        Assert.False(DailyWebhookSignature.Verify(Secret, "abc", signature, bytes, Now));
        // The timestamp is part of the signed string: another timestamp with the same signature fails.
        Assert.False(DailyWebhookSignature.Verify(Secret, Ts(Now.AddSeconds(1)), signature, bytes, Now));
        var stale = Ts(Now - DailyWebhookSignature.Tolerance - TimeSpan.FromMinutes(1));
        Assert.False(DailyWebhookSignature.Verify(Secret, stale, Sign(Secret, stale, body), bytes, Now));
    }

    [Fact]
    public void A_millisecond_timestamp_is_read_as_milliseconds()
    {
        const string body = "{}";
        var ts = Now.ToUnixTimeMilliseconds().ToString();
        Assert.True(DailyWebhookSignature.Verify(Secret, ts, Sign(Secret, ts, body), Encoding.UTF8.GetBytes(body), Now));
    }

    [Fact]
    public void A_secret_shorter_than_16_bytes_verifies_nothing()
    {
        var weak = Convert.ToBase64String(Encoding.UTF8.GetBytes("short"));
        const string body = "{}";
        var ts = Ts(Now);
        Assert.False(DailyWebhookSignature.Verify(weak, ts, Sign(weak, ts, body), Encoding.UTF8.GetBytes(body), Now));
    }

    [Fact]
    public void Parses_the_envelope_fields_this_surface_uses()
    {
        var interview = Guid.Parse("1234abcd-0000-4000-8000-000000000001");
        var body = "{\"version\":\"1.1.0\",\"type\":\"transcript.ready-to-download\",\"id\":\"3431-tra-rtd-1\"," +
                   "\"event_ts\":1733234480.097,\"payload\":{\"id\":\"68f65d4c-a4dc-4179-bbb1-c12432afb924\"," +
                   $"\"room_name\":\"tims-{interview:N}\",\"duration\":124.4," +
                   "\"out_params\":{\"s3\":{\"bucket\":\"b\",\"key\":\"k.vtt\"}}}}";
        var parsed = DailyWebhookEvents.Parse(Encoding.UTF8.GetBytes(body))!;
        Assert.Equal(DailyWebhookEvent.TranscriptReady, parsed.Type);
        Assert.Equal("3431-tra-rtd-1", parsed.EventId);
        Assert.Equal(Guid.Parse("68f65d4c-a4dc-4179-bbb1-c12432afb924"), parsed.TranscriptId);
        Assert.Equal(interview, DailyWebhookEvents.InterviewIdOf(parsed.RoomName));
        Assert.True(parsed.IsTranscriptEvent);
    }

    [Fact]
    public void The_creation_probe_is_a_test_event_and_garbage_is_null()
    {
        Assert.True(DailyWebhookEvents.Parse("""{"test":"test"}"""u8)!.IsTest);
        Assert.Null(DailyWebhookEvents.Parse("[]"u8));
        Assert.Null(DailyWebhookEvents.Parse("not json"u8));
        Assert.Null(DailyWebhookEvents.Parse("""{"type":42}"""u8));
        Assert.False(DailyWebhookEvents.Parse("""{"type":"recording.ready-to-download","payload":{}}"""u8)!.IsTranscriptEvent);
    }

    [Theory]
    [InlineData("tims-1234abcd")] // legacy 8-hex name: not one interview
    [InlineData("tims-1234ABCD000040008000000000000001")] // uppercase is never minted
    [InlineData("other-1234abcd000040008000000000000001")]
    [InlineData("tims-1234abcd000040008000000000000001-x")]
    [InlineData("")]
    [InlineData(null)]
    public void Only_a_full_id_room_name_maps_to_an_interview(string? room) =>
        Assert.Null(DailyWebhookEvents.InterviewIdOf(room));

    [Fact]
    public void The_room_name_mapping_matches_the_join_room_naming()
    {
        var id = Guid.NewGuid();
        Assert.Equal(id, DailyWebhookEvents.InterviewIdOf(Tims.Application.InterviewJoin.CandidateInterviewJoin.RoomNameFor(id)));
    }

    [Fact]
    public void Transcript_reference_round_trips_and_rejects_anything_else()
    {
        var id = Guid.NewGuid();
        Assert.Equal(id, InterviewTranscriptionConstants.TranscriptIdOf(InterviewTranscriptionConstants.TranscriptReference(id)));
        Assert.Null(InterviewTranscriptionConstants.TranscriptIdOf("https://evil.example/v1/transcript/" + id));
        Assert.Null(InterviewTranscriptionConstants.TranscriptIdOf("https://api.daily.co/v1/transcript/" + id + "/x"));
        Assert.Null(InterviewTranscriptionConstants.TranscriptIdOf(null));
    }
}
