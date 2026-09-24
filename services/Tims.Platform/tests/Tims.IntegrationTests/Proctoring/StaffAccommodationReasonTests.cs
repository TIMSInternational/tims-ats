using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

public sealed class StaffAccommodationReasonTests
{
    [Theory]
    [InlineData("technical_unavailable", true)]
    [InlineData("accessibility", true)]
    [InlineData("other", true)]
    [InlineData("missing", false)]
    [InlineData("technical_unavailable with note", false)]
    public void AccommodationReason_AcceptsOnlyFixedCodes(string reason, bool expected) =>
        Assert.Equal(expected, StaffProctoringStore.IsAccommodationReason(reason));
}
