using System.Diagnostics;
using Amazon.Bedrock.Model;
using Amazon.Runtime;
using Microsoft.Extensions.Options;
using Tims.Application.PlatformHealth;

namespace Tims.Infrastructure.PlatformHealth;

/// <summary>
/// Bedrock CONTROL-PLANE <c>GetGuardrail</c> on the configured guardrail — no model inference, no token cost.
/// It proves the Bedrock API answers for this account/region and that the PII-masking guardrail every agent
/// call references is READY. It does NOT prove model quota or invocation permission; that would need an
/// inference, which this probe deliberately never makes.
///
/// <para>Needs <c>bedrock:GetGuardrail</c> on the guardrail ARN. When Bedrock lives in a different AWS account
/// than this service (the web app supports that via <c>BEDROCK_AWS_*</c>), the call is refused and the probe
/// truthfully reports <c>not_monitored / access_denied</c>.</para>
/// </summary>
public sealed class BedrockGuardrailProbe(IOptions<PlatformHealthOptions> options, IAwsHealthClientFactory clients) : IDependencyProbe
{
    public string Id => DependencyIds.Ai;

    public async Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (!settings.HasGuardrail)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotConfigured, DependencyReason.MissingConfig);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            var response = await clients.Bedrock(settings.BedrockRegion!)
                .GetGuardrailAsync(
                    new GetGuardrailRequest
                    {
                        GuardrailIdentifier = settings.BedrockGuardrailId,
                        GuardrailVersion = string.IsNullOrWhiteSpace(settings.BedrockGuardrailVersion)
                            ? "DRAFT"
                            : settings.BedrockGuardrailVersion,
                    },
                    cancellationToken)
                .ConfigureAwait(false);
            return DependencyHealthClassifier.ClassifyGuardrail(response.Status?.Value, stopwatch.ElapsedMilliseconds);
        }
        catch (ResourceNotFoundException)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.Down, DependencyReason.NotFound, stopwatch.ElapsedMilliseconds);
        }
        catch (AccessDeniedException)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotMonitored, DependencyReason.AccessDenied, stopwatch.ElapsedMilliseconds);
        }
        catch (AmazonServiceException ex) when ((int)ex.StatusCode >= 500)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.Down, DependencyReason.ErrorStatus, stopwatch.ElapsedMilliseconds);
        }
        catch (AmazonServiceException ex) when ((int)ex.StatusCode is 401 or 403)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotMonitored, DependencyReason.AccessDenied, stopwatch.ElapsedMilliseconds);
        }
        catch (HttpRequestException)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.Down, DependencyReason.Unreachable, stopwatch.ElapsedMilliseconds);
        }
    }
}
