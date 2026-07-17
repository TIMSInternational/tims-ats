using Microsoft.Extensions.Logging;
using Tims.Application.Billing;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// The ILogger-backed <see cref="IBillingWebhookLog"/> — emits the webhook's diagnostic warnings as
/// structured logs (the C# analog of the TS <c>logger.warn(...)</c> calls). PII-free: only opaque ids
/// (org / subscription / customer) are logged, never Stripe payloads or event bodies.
/// </summary>
public sealed class LoggerBillingWebhookLog(ILogger<LoggerBillingWebhookLog> logger) : IBillingWebhookLog
{
    private readonly ILogger<LoggerBillingWebhookLog> _logger = logger;

    public void MetadataOrgMismatch(string by, string metaOrgId, string owner) =>
        _logger.LogWarning(
            "stripe webhook: metadata orgId mismatch ({By}) meta={MetaOrgId} owner={Owner}", by, metaOrgId, owner);

    public void UnresolvedOrg(string context, string reference) =>
        _logger.LogWarning("stripe webhook: {Context} without resolvable orgId ({Reference})", context, reference);

    public void CancellingDuplicate(string orgId, string duplicateId) =>
        _logger.LogWarning("stripe webhook: cancelling duplicate subscription org={OrgId} duplicate={DuplicateId}", orgId, duplicateId);

    public void DuplicateAlreadyCancelled(string orgId, string duplicateId) =>
        _logger.LogWarning("stripe webhook: duplicate already cancelled org={OrgId} duplicate={DuplicateId}", orgId, duplicateId);

    public void EventNotApplied(string orgId, string incoming, string outcome) =>
        _logger.LogWarning("stripe webhook: subscription event not applied org={OrgId} incoming={Incoming} outcome={Outcome}", orgId, incoming, outcome);
}
