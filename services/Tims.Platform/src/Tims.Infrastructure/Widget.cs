namespace Tims.Infrastructure;

/// <summary>
/// Minimal org-scoped entity used only to prove the RLS-through-EF-Core mechanism
/// (Phase 1 Spike A). Not a product entity.
/// </summary>
public sealed class Widget
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Name { get; set; } = string.Empty;
}
