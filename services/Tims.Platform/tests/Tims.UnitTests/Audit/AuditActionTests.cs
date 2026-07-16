using Tims.Domain.Audit;

namespace Tims.UnitTests.Audit;

/// <summary>
/// Pins <see cref="AuditAction"/> → wire string to the exact lowercase values the TS layer writes to
/// <c>data_access_logs.action</c> ('read' | 'export' | 'update').
/// </summary>
public sealed class AuditActionTests
{
    [Theory]
    [InlineData(AuditAction.Read, "read")]
    [InlineData(AuditAction.Export, "export")]
    [InlineData(AuditAction.Update, "update")]
    public void ToWire_maps_to_the_lowercase_ts_string(AuditAction action, string expected)
    {
        Assert.Equal(expected, action.ToWire());
    }
}
