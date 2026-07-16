namespace Tims.Application.ExternalVendor;

/// <summary>
/// The resolved external-key caller for a vendor validation WRITE: the KEY is the principal (no staff
/// User). <see cref="OrganizationId"/> + <see cref="ApiKeyId"/> come from the authenticated ApiKey scheme;
/// <see cref="ApiKeyId"/> is BOTH the audit <c>actorId</c> and the DB provenance
/// (<c>completed_by_api_key_id</c>). IP / user-agent are carried for the audit row.
///
/// Unlike the Slice-1 read principal there is no <c>ResolvedScope</c> field: the write is a single-id,
/// org-scoped <c>updateMany</c> (INV-7) with no per-row scope narrowing, so the endpoint gate — not the
/// use case — is where the resolved scope is asserted present (fail-closed on a denied / null-scope
/// decision) before this principal is ever constructed.
/// </summary>
public sealed record ExternalValidationSubmitPrincipal(
    string OrganizationId,
    string ApiKeyId,
    string? IpAddress = null,
    string? UserAgent = null);
