using Tims.Application.PlatformDashboard;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// Converts an application-layer UTC instant into the form a <c>timestamp without time zone</c> column
/// will accept as a query bound (Phase-5 slice 23, issue #81, PR 2 of 3).
///
/// <para><b>This is not a formality — the wrong kind is a 500, not a wrong answer.</b> Every datetime
/// column this context maps is declared <c>HasColumnType("timestamp")</c>, so EF sends the parameter as
/// <c>NpgsqlDbType.Timestamp</c>, and Npgsql refuses a <see cref="DateTimeKind.Utc"/> value against that
/// type outright: <c>Cannot write DateTime with Kind=Utc to PostgreSQL type 'timestamp without time
/// zone'</c>. The application layer works in UTC-kind instants (that is what <c>JsNow</c> returns and what
/// day arithmetic needs), so the conversion has to happen exactly here, at the boundary.</para>
///
/// <para>This is the MAPPED-COLUMN sibling of slice 23's TRAP 10, which was the same
/// naive-versus-aware clash on a raw <c>SqlQuery</c> hole — where the failure ran the other way (a
/// bare <see cref="DateTime"/> defaulted to <c>timestamptz</c> and an Unspecified value was rejected).
/// Same root cause, opposite symptom, and both are silent until a real Postgres is involved.</para>
///
/// <para>The millisecond truncation is belt-and-braces: the callers already pass
/// <c>JsNow()</c>-derived values, whose sub-millisecond ticks are gone. Repeating it here means a future
/// caller passing a raw <see cref="DateTime.UtcNow"/> still compares against a <c>timestamp(3)</c> column
/// the way JavaScript would.</para>
/// </summary>
internal static class PlatformDashboardTimestamps
{
    public static DateTime ToNaive(DateTime utc) =>
        DateTime.SpecifyKind(PlatformDashboardReadUseCase.TruncateToMilliseconds(utc), DateTimeKind.Unspecified);
}
