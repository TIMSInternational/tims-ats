using Tims.Domain.Audit;

namespace Tims.UnitTests.Audit;

public sealed class ProctoringClassificationTests
{
    [Fact]
    public void Proctoring_evidence_is_restricted_and_requires_audit()
    {
        Assert.Equal(DataClass.Restricted, DataClassification.Of("proctoringSession"));
        Assert.True(AuditPolicy.AuditRequiredFor("proctoringSession"));
    }
}
