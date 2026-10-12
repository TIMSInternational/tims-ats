using System.Diagnostics;
using Amazon.Runtime;
using Amazon.SimpleEmail;
using Amazon.SimpleEmail.Model;
using Microsoft.Extensions.Options;
using Tims.Application.PlatformHealth;
using Tims.Infrastructure.Email;

namespace Tims.Infrastructure.PlatformHealth;

/// <summary>
/// SES account state through the client the platform already sends with: <c>GetAccountSendingEnabled</c>
/// (is sending paused?) and <c>GetSendQuota</c> (24h headroom). Both are free reads; nothing is sent. Uses the
/// SES v1 API on purpose — it is the SDK already shipped (<c>AWSSDK.SimpleEmail</c>), so this adds no
/// dependency. Needs <c>ses:GetAccountSendingEnabled</c> + <c>ses:GetSendQuota</c> (neither supports
/// resource-level scoping). <c>Email:Enabled=false</c> ⇒ <c>not_configured</c>.
/// </summary>
public sealed class SesAccountProbe(IOptions<EmailOptions> emailOptions, Lazy<IAmazonSimpleEmailService> ses) : IDependencyProbe
{
    public string Id => DependencyIds.Email;

    public async Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
    {
        if (!emailOptions.Value.Enabled)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotConfigured, DependencyReason.MissingConfig);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            var client = ses.Value;
            var enabledTask = client.GetAccountSendingEnabledAsync(new GetAccountSendingEnabledRequest(), cancellationToken);
            var quotaTask = client.GetSendQuotaAsync(new GetSendQuotaRequest(), cancellationToken);
            await Task.WhenAll(enabledTask, quotaTask).ConfigureAwait(false);
            var quota = await quotaTask.ConfigureAwait(false);
            return DependencyHealthClassifier.ClassifySes(
                (await enabledTask.ConfigureAwait(false)).Enabled,
                quota.Max24HourSend,
                quota.SentLast24Hours,
                stopwatch.ElapsedMilliseconds);
        }
        catch (AmazonServiceException ex) when ((int)ex.StatusCode is 401 or 403)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotMonitored, DependencyReason.AccessDenied, stopwatch.ElapsedMilliseconds);
        }
        catch (AmazonServiceException ex) when ((int)ex.StatusCode >= 500)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.Down, DependencyReason.ErrorStatus, stopwatch.ElapsedMilliseconds);
        }
        catch (HttpRequestException)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.Down, DependencyReason.Unreachable, stopwatch.ElapsedMilliseconds);
        }
    }
}
