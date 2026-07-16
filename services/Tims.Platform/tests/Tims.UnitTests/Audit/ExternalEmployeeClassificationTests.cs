using Tims.Domain.Audit;

namespace Tims.UnitTests.Audit;

/// <summary>
/// WP3.3 — pins the C#-ONLY <c>external_employee</c> data classification. This entry is deliberately NOT
/// in the cross-stack audit golden (contracts/audit-fixtures/*.json) or TS classification.ts: HRIS is a
/// greenfield C# domain with no TS reader, so the shared golden covers only the five entities BOTH stacks
/// have, and this test alone pins the C#-side entry. It asserts external_employee is Confidential (so a
/// sync read/write is audit-required) and — being Confidential, not Restricted — its audit is fail-soft.
/// </summary>
public sealed class ExternalEmployeeClassificationTests
{
    [Fact]
    public void External_employee_is_confidential()
    {
        Assert.Equal(DataClass.Confidential, DataClassification.Of("external_employee"));
    }

    [Fact]
    public void External_employee_read_or_write_is_audit_required()
    {
        Assert.True(AuditPolicy.AuditRequiredFor("external_employee"));
    }

    [Fact]
    public void External_employee_is_confidential_not_restricted_so_audit_is_fail_soft()
    {
        // The audit writer's fail-closed default is (class == Restricted); Confidential ⇒ fail-soft.
        Assert.NotEqual(DataClass.Restricted, DataClassification.Of("external_employee"));
    }
}
