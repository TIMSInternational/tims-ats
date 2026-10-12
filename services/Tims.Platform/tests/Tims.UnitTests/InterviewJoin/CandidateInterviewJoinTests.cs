using Tims.Application.InterviewJoin;

namespace Tims.UnitTests.InterviewJoin;

public sealed class CandidateInterviewJoinTests
{
    private const string Token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
    private static readonly DateTime Start = new(2026, 10, 1, 15, 0, 0, DateTimeKind.Utc);
    private static readonly Guid InterviewId = Guid.Parse("1234abcd-0000-4000-8000-000000000001");
    private static readonly Guid OrgId = Guid.Parse("00000000-0000-4000-8000-0000000000aa");

    private static CandidateJoinInterview Interview(string status = "scheduled", string type = "video",
        string? meetingUrl = null, DateTime? cancelledAt = null, DateTime? tokenExpiresAt = null,
        string? first = "Ana", string? last = "Pérez") =>
        new(InterviewId, OrgId, type, status, Start, 60, cancelledAt, tokenExpiresAt ?? Start.AddMinutes(90),
            meetingUrl, first, last);

    private sealed class Repository : ICandidateInterviewJoinRepository
    {
        public CandidateJoinInterview? Interview { get; set; } = CandidateInterviewJoinTests.Interview();
        public string? LookedUpHash { get; private set; }
        public string? StoredUrl { get; set; }
        public bool AuditSucceeds { get; set; } = true;
        public List<CandidateJoinAudit> Audits { get; } = [];
        public List<(Guid Id, Guid Org, string Url)> Claims { get; } = [];

        public Task<CandidateJoinInterview?> FindByTokenHashAsync(string tokenHash, CancellationToken ct)
        { LookedUpHash = tokenHash; return Task.FromResult(Interview); }

        public Task<string?> ClaimMeetingUrlAsync(Guid interviewId, Guid organizationId, string roomUrl,
            CancellationToken ct)
        {
            Claims.Add((interviewId, organizationId, roomUrl));
            StoredUrl ??= roomUrl;
            return Task.FromResult<string?>(StoredUrl);
        }

        public Task<bool> RecordAsync(CandidateJoinAudit audit, CancellationToken ct)
        { Audits.Add(audit); return Task.FromResult(AuditSucceeds); }

        public HashSet<string> SharedRooms { get; } = [];
        public List<(Guid Id, string Room)> SharedChecks { get; } = [];

        public Task<bool> IsRoomSharedAsync(Guid interviewId, string roomName, CancellationToken ct)
        { SharedChecks.Add((interviewId, roomName)); return Task.FromResult(SharedRooms.Contains(roomName)); }
    }

    private sealed class Video : ICandidateVideoProvider
    {
        public bool IsConfigured { get; set; } = true;
        public bool Fails { get; set; }
        public string Domain { get; set; } = "tims.daily.co";
        public List<(string Room, DateTimeOffset OpenUntil)> Ensured { get; } = [];
        public (string Room, string User, DateTimeOffset Nbf, DateTimeOffset Exp)? Minted { get; private set; }

        public Task<VideoRoom?> EnsureRoomAsync(string roomName, DateTimeOffset openUntil, CancellationToken ct)
        {
            Ensured.Add((roomName, openUntil));
            return Task.FromResult(Fails ? null : new VideoRoom(roomName, $"https://{Domain}/{roomName}"));
        }

        public Task<string?> CreateGuestTokenAsync(string roomName, string userName, DateTimeOffset notBefore,
            DateTimeOffset expiresAt, CancellationToken ct)
        {
            Minted = (roomName, userName, notBefore, expiresAt);
            return Task.FromResult<string?>("guest.token");
        }
    }

    private sealed class Clock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(now, TimeSpan.Zero);
    }

    private static async Task<(CandidateJoinResult Result, Repository Repo, Video Video)> Join(DateTime now,
        CandidateJoinInterview? interview = null, Action<Repository, Video>? setup = null, string token = Token)
    {
        var repository = new Repository { Interview = interview ?? Interview() };
        var video = new Video();
        setup?.Invoke(repository, video);
        var result = await new CandidateInterviewJoin(repository, video, new Clock(now))
            .JoinAsync(token, "203.0.113.5", "browser", default);
        return (result, repository, video);
    }

    [Theory]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd")]
    [InlineData("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdef")]
    [InlineData("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_+abcde")]
    [InlineData("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_=abcde")]
    public async Task Malformed_token_is_invalid_without_any_lookup(string token)
    {
        var (result, repository, _) = await Join(Start, token: token);
        Assert.Equal(CandidateJoinOutcomes.Invalid, result.Outcome);
        Assert.Null(repository.LookedUpHash);
        Assert.Empty(repository.Audits);
    }

    [Fact]
    public async Task Lookup_uses_the_lowercase_sha256_hex_of_the_token_never_the_token()
    {
        var (_, repository, _) = await Join(Start);
        Assert.Equal(Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(Token))), repository.LookedUpHash);
        Assert.Matches("^[0-9a-f]{64}$", repository.LookedUpHash!);
    }

    [Fact]
    public async Task Unknown_token_is_invalid_and_unaudited()
    {
        var repository = new Repository { Interview = null };
        var result = await new CandidateInterviewJoin(repository, new Video(), new Clock(Start))
            .JoinAsync(Token, null, null, default);
        Assert.Equal(CandidateJoinOutcomes.Invalid, result.Outcome);
        Assert.Empty(repository.Audits);
    }

    [Fact]
    public async Task Cancelled_by_status_or_timestamp_is_cancelled_and_audited()
    {
        var (byStatus, repo, video) = await Join(Start, Interview(status: "cancelled"));
        Assert.Equal(CandidateJoinOutcomes.Cancelled, byStatus.Outcome);
        Assert.Equal(CandidateJoinOutcomes.Cancelled, Assert.Single(repo.Audits).Outcome);
        Assert.Null(video.Minted);
        var (byTimestamp, _, _) = await Join(Start, Interview(cancelledAt: Start.AddDays(-1)));
        Assert.Equal(CandidateJoinOutcomes.Cancelled, byTimestamp.Outcome);
    }

    [Theory]
    [InlineData("completed")]
    [InlineData("no_show")]
    public async Task Finished_interview_is_expired(string status)
    {
        var (result, _, video) = await Join(Start, Interview(status: status));
        Assert.Equal(CandidateJoinOutcomes.Expired, result.Outcome);
        Assert.Null(video.Minted);
    }

    [Fact]
    public async Task Window_closes_exactly_thirty_minutes_after_the_scheduled_end()
    {
        var closes = Start.AddMinutes(60 + 30);
        Assert.Equal(CandidateJoinOutcomes.Ready, (await Join(closes.AddSeconds(-1))).Result.Outcome);
        Assert.Equal(CandidateJoinOutcomes.Expired, (await Join(closes)).Result.Outcome);
    }

    [Fact]
    public async Task An_earlier_token_expiry_closes_the_window_first()
    {
        var interview = Interview(tokenExpiresAt: Start.AddMinutes(10));
        Assert.Equal(CandidateJoinOutcomes.Expired, (await Join(Start.AddMinutes(10), interview)).Result.Outcome);
    }

    [Fact]
    public async Task Join_opens_exactly_fifteen_minutes_before_the_start()
    {
        var opens = Start.AddMinutes(-15);
        var (early, repo, video) = await Join(opens.AddSeconds(-1));
        Assert.Equal(CandidateJoinOutcomes.TooEarly, early.Outcome);
        Assert.Equal(Start, early.ScheduledAt);
        Assert.Equal(opens, early.JoinOpensAt);
        Assert.Null(early.JoinUrl);
        Assert.Null(video.Minted);
        Assert.Equal(CandidateJoinOutcomes.TooEarly, Assert.Single(repo.Audits).Outcome);
        Assert.Equal(CandidateJoinOutcomes.Ready, (await Join(opens)).Result.Outcome);
    }

    [Fact]
    public async Task Non_video_interview_is_not_video()
    {
        var (result, _, video) = await Join(Start, Interview(type: "in_person"));
        Assert.Equal(CandidateJoinOutcomes.NotVideo, result.Outcome);
        Assert.Empty(video.Ensured);
    }

    [Fact]
    public async Task Ready_creates_the_room_claims_it_tenant_filtered_and_mints_a_bounded_guest_token()
    {
        var now = Start.AddMinutes(-5);
        var (result, repository, video) = await Join(now);
        Assert.Equal(CandidateJoinOutcomes.Ready, result.Outcome);
        Assert.Equal($"https://tims.daily.co/{FullRoom}?t=guest.token", result.JoinUrl);
        var claim = Assert.Single(repository.Claims);
        Assert.Equal((InterviewId, OrgId, $"https://tims.daily.co/{FullRoom}"), claim);
        // The room just created and claimed is used as-is: one Daily room call, not a second lookup.
        Assert.Single(video.Ensured);
        var closes = new DateTimeOffset(Start.AddMinutes(90), TimeSpan.Zero);
        Assert.All(video.Ensured, e => Assert.Equal(closes, e.OpenUntil));
        var minted = video.Minted!.Value;
        Assert.Equal(FullRoom, minted.Room);
        Assert.Equal("Ana Pérez", minted.User);
        Assert.Equal(new DateTimeOffset(Start.AddMinutes(-15), TimeSpan.Zero), minted.Nbf);
        Assert.Equal(closes, minted.Exp);
        Assert.Equal(CandidateJoinOutcomes.Ready, Assert.Single(repository.Audits).Outcome);
    }

    [Fact]
    public async Task Guest_token_lifetime_is_capped_at_two_hours_on_a_long_interview()
    {
        var now = Start.AddMinutes(10);
        var longInterview = Interview(tokenExpiresAt: Start.AddHours(8)) with { DurationMinutes = 300 };
        var (_, _, video) = await Join(now, longInterview);
        Assert.Equal(new DateTimeOffset(now.AddHours(2), TimeSpan.Zero), video.Minted!.Value.Exp);
    }

    private const string FullRoom = "tims-1234abcd000040008000000000000001";
    private const string LegacyRoom = "tims-1234abcd";

    [Theory]
    [InlineData(FullRoom)]
    [InlineData(LegacyRoom)]
    public async Task The_rows_own_stored_room_is_reused_and_never_overwritten(string room)
    {
        var (result, repository, video) = await Join(Start, Interview(meetingUrl: "https://tims.daily.co/" + room));
        Assert.Equal($"https://tims.daily.co/{room}?t=guest.token", result.JoinUrl);
        Assert.Empty(repository.Claims);
        Assert.Equal(room, Assert.Single(video.Ensured).Room);
    }

    [Fact]
    public async Task A_legacy_room_that_another_interview_also_stores_is_refused()
    {
        // #329 item 1: the old "400 = exists" adoption path let two interviews (possibly in two tenants) store the
        // same 32-bit legacy room. Joining it could seat this candidate in someone else's interview.
        var (result, repository, video) = await Join(Start, Interview(meetingUrl: "https://tims.daily.co/" + LegacyRoom),
            (repo, _) => repo.SharedRooms.Add(LegacyRoom));
        Assert.Equal(CandidateJoinOutcomes.Unavailable, result.Outcome);
        Assert.Equal((InterviewId, LegacyRoom), Assert.Single(repository.SharedChecks));
        Assert.Empty(video.Ensured);
        Assert.Null(video.Minted);
        Assert.Equal(CandidateJoinOutcomes.Unavailable, Assert.Single(repository.Audits).Outcome);
    }

    [Fact]
    public async Task A_full_id_room_needs_no_collision_check()
    {
        var (result, repository, _) = await Join(Start, Interview(meetingUrl: "https://tims.daily.co/" + FullRoom),
            (repo, _) => repo.SharedRooms.Add(FullRoom));
        Assert.Equal(CandidateJoinOutcomes.Ready, result.Outcome);
        Assert.Empty(repository.SharedChecks);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public async Task A_closed_application_or_suspended_org_revokes_the_link_inside_its_window(bool applicationClosed,
        bool organizationInactive)
    {
        // #329 item 5: inside the join window, with a perfectly good room — still refused, as `cancelled` (the
        // candidate must not learn of a rejection or of the org's account state from a video link), and audited.
        var interview = Interview(meetingUrl: "https://tims.daily.co/" + FullRoom) with
        {
            ApplicationClosed = applicationClosed,
            OrganizationInactive = organizationInactive,
        };
        var (result, repository, video) = await Join(Start, interview);
        Assert.Equal(CandidateJoinOutcomes.Cancelled, result.Outcome);
        Assert.Null(result.JoinUrl);
        Assert.Empty(video.Ensured);
        Assert.Null(video.Minted);
        Assert.Equal(CandidateJoinOutcomes.Cancelled, Assert.Single(repository.Audits).Outcome);
    }

    [Fact]
    public void Revocation_outranks_every_other_window_state()
    {
        // Even before the window opens, a revoked link answers cancelled rather than too_early (which would leak
        // the schedule of an interview the candidate no longer has).
        var revoked = Interview() with { ApplicationClosed = true };
        Assert.Equal(CandidateJoinOutcomes.Cancelled,
            CandidateInterviewJoin.Evaluate(revoked, Start.AddDays(-3))!.Outcome);
    }

    [Theory]
    // Another interview's room: same 8-hex prefix (a legacy collision), a different full id, a hand-pasted name.
    [InlineData("https://tims.daily.co/tims-1234abcd000040008000000000000002")]
    [InlineData("https://tims.daily.co/tims-99999999")]
    [InlineData("https://tims.daily.co/staff-room")]
    public async Task A_stored_room_not_named_from_this_interview_is_never_joined(string meetingUrl)
    {
        var (result, _, video) = await Join(Start, Interview(meetingUrl: meetingUrl));
        Assert.Equal(CandidateJoinOutcomes.Unavailable, result.Outcome);
        Assert.Empty(video.Ensured);
        Assert.Null(video.Minted);
    }

    [Fact]
    public async Task A_stored_room_on_another_daily_domain_is_never_joined()
    {
        // The row points at evil.daily.co/<own name>; the configured account's room lives on tims.daily.co.
        var (result, _, video) = await Join(Start, Interview(meetingUrl: "https://evil.daily.co/" + FullRoom));
        Assert.Equal(CandidateJoinOutcomes.Unavailable, result.Outcome);
        Assert.Null(video.Minted);
    }

    [Fact]
    public async Task A_concurrently_stored_own_room_wins_over_the_one_just_created()
    {
        var (result, _, video) = await Join(Start, setup: (repository, _) =>
            repository.StoredUrl = "https://tims.daily.co/" + LegacyRoom);
        Assert.Equal($"https://tims.daily.co/{LegacyRoom}?t=guest.token", result.JoinUrl);
        Assert.Equal(LegacyRoom, video.Minted!.Value.Room);
    }

    [Fact]
    public async Task A_concurrently_stored_foreign_room_is_never_joined()
    {
        var (result, _, video) = await Join(Start, setup: (repository, _) =>
            repository.StoredUrl = "https://tims.daily.co/other-room");
        Assert.Equal(CandidateJoinOutcomes.Unavailable, result.Outcome);
        Assert.Null(video.Minted);
    }

    [Theory]
    [InlineData("https://zoom.us/j/123")]
    [InlineData("http://tims.daily.co/room")]
    [InlineData("https://evil.example/tims.daily.co/room")]
    [InlineData("https://tims.daily.co.evil.example/room")]
    [InlineData("https://tims.daily.co/room?redirect=x")]
    public async Task A_non_daily_meeting_url_is_never_handed_to_the_candidate(string meetingUrl)
    {
        var (result, _, video) = await Join(Start, Interview(meetingUrl: meetingUrl));
        Assert.Equal(CandidateJoinOutcomes.Unavailable, result.Outcome);
        Assert.Null(result.JoinUrl);
        Assert.Null(video.Minted);
    }

    [Fact]
    public async Task Unconfigured_or_failing_provider_is_unavailable()
    {
        Assert.Equal(CandidateJoinOutcomes.Unavailable,
            (await Join(Start, setup: (_, video) => video.IsConfigured = false)).Result.Outcome);
        Assert.Equal(CandidateJoinOutcomes.Unavailable,
            (await Join(Start, setup: (_, video) => video.Fails = true)).Result.Outcome);
    }

    [Fact]
    public async Task A_join_that_cannot_be_audited_is_not_handed_out()
    {
        var (result, _, _) = await Join(Start, setup: (repository, _) => repository.AuditSucceeds = false);
        Assert.Equal(CandidateJoinOutcomes.Unavailable, result.Outcome);
        Assert.Null(result.JoinUrl);
    }

    [Theory]
    [InlineData("Ana", "Pérez", "Ana Pérez")]
    [InlineData("  Ana\t", "\n Pérez ", "Ana Pérez")]
    [InlineData("A\u0000n\u001ba", "B‮o​b", "Ana Bob")]
    [InlineData(null, null, "Candidato")]
    [InlineData("\u0007", " ", "Candidato")]
    public void Display_name_is_sanitized_with_a_fallback(string? first, string? last, string expected) =>
        Assert.Equal(expected, CandidateInterviewJoin.DisplayName(first, last));

    [Fact]
    public void Display_name_is_bounded_without_splitting_a_surrogate_pair()
    {
        var name = CandidateInterviewJoin.DisplayName(new string('a', 59) + "\U0001F600", "x");
        Assert.True(name.Length <= CandidateInterviewJoin.MaxDisplayNameLength);
        Assert.False(char.IsHighSurrogate(name[^1]));
    }

    [Fact]
    public void Room_names_match_the_ts_video_service_convention()
    {
        // packages/api/src/services/video.service.ts roomNameFor(): 'tims-' + the id without dashes.
        Assert.Equal(FullRoom, CandidateInterviewJoin.RoomNameFor(InterviewId));
        Assert.Equal(LegacyRoom, CandidateInterviewJoin.LegacyRoomNameFor(InterviewId));
    }
}
