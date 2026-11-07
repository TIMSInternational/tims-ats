using System.Text.Json.Nodes;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

public sealed record ProviderBindingInput(Guid OrganizationId, IReadOnlyList<string> Instruments, string DefaultLocale);

public sealed record ProviderBindingView(
    string OrganizationId, string ProviderTenantId, IReadOnlyList<string> EnabledInstruments, string DefaultLocale);

public enum ProviderBindingOutcome
{
    Bound,
    OrganizationNotFound,
    ProviderUnconfigured,
    ProviderUnavailable,
    ProviderRefused,

    /// <summary>An instrument the catalog does not offer for selection (hiring) was requested.</summary>
    InstrumentNotOffered,
}

public sealed record ProviderBindingResult(ProviderBindingOutcome Outcome, ProviderBindingView? Binding, string? Detail);

/// <summary>
/// Platform owner binds an ATS organization to the provider (creates or re-uses the provider tenant, idempotent on the
/// org id) and sets which instruments the org may assign. Only instruments the provider's catalog offers for
/// <c>selection</c> can be enabled: a development-only instrument (for example MI, if the provider marks it so) is never
/// assignable for hiring. An empty list keeps the binding but disables every instrument.
/// </summary>
public sealed class ProviderBindingUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    public async Task<ProviderBindingResult> BindOrganizationAsync(
        Guid actorId, ProviderBindingInput input, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!_provider.IsConfigured)
        {
            return new ProviderBindingResult(ProviderBindingOutcome.ProviderUnconfigured, null, null);
        }

        var name = await _repository.GetActiveOrganizationNameAsync(input.OrganizationId, cancellationToken)
            .ConfigureAwait(false);
        if (name is null)
        {
            return new ProviderBindingResult(ProviderBindingOutcome.OrganizationNotFound, null, null);
        }

        if (input.Instruments.Count > 0)
        {
            var catalog = await _provider.ListInstrumentsAsync(cancellationToken).ConfigureAwait(false);
            if (!catalog.Ok)
            {
                return Failed(catalog.Failure!);
            }

            var offered = catalog.Value!.Where(i => i.OfferedForSelection).Select(i => i.Instrument).ToHashSet(StringComparer.Ordinal);
            var missing = input.Instruments.FirstOrDefault(i => !offered.Contains(i));
            if (missing is not null)
            {
                return new ProviderBindingResult(ProviderBindingOutcome.InstrumentNotOffered, null, missing);
            }
        }

        var displayName = name.Length <= 200 ? name : name[..200];
        var tenantRequest = new ProviderTenantRequest(input.OrganizationId.ToString(), displayName, input.DefaultLocale);
        var tenant = await _provider.EnsureTenantAsync(
            tenantRequest, IdempotencyKeys.Tenant(input.OrganizationId, tenantRequest), cancellationToken).ConfigureAwait(false);
        if (!tenant.Ok)
        {
            return Failed(tenant.Failure!);
        }

        if (tenant.Value!.ExternalOrgRef != input.OrganizationId.ToString())
        {
            return new ProviderBindingResult(ProviderBindingOutcome.ProviderRefused, null, ProviderFailure.ContractViolation);
        }

        var row = await _repository.UpsertBindingAsync(
            input.OrganizationId, tenant.Value.TenantId, input.Instruments, input.DefaultLocale, actorId, now, cancellationToken)
            .ConfigureAwait(false);
        return new ProviderBindingResult(
            ProviderBindingOutcome.Bound,
            new ProviderBindingView(row.OrganizationId.ToString(), row.ProviderTenantId.ToString(), row.EnabledInstruments,
                row.DefaultLocale),
            null);
    }

    private static ProviderBindingResult Failed(ProviderFailure failure) =>
        new(failure.Transient ? ProviderBindingOutcome.ProviderUnavailable : ProviderBindingOutcome.ProviderRefused, null,
            failure.Code);

    /// <summary>Strict body: <c>{ organizationId, instruments: [...] (0..6, distinct), defaultLocale }</c>.</summary>
    public static bool TryParseBody(JsonNode? node, out ProviderBindingInput input)
    {
        input = null!;
        if (node is not JsonObject body || body.Any(p => p.Key is not ("organizationId" or "instruments" or "defaultLocale")))
        {
            return false;
        }

        if (body["organizationId"] is not JsonValue orgValue || !orgValue.TryGetValue(out string? rawOrg)
            || !Guid.TryParseExact(rawOrg, "D", out var organizationId) || organizationId == Guid.Empty
            || body["defaultLocale"] is not JsonValue localeValue || !localeValue.TryGetValue(out string? locale)
            || !ProviderFormats.IsLocale(locale)
            || body["instruments"] is not JsonArray array || array.Count > ProviderInstruments.All.Count)
        {
            return false;
        }

        var instruments = new List<string>();
        foreach (var entry in array)
        {
            if (entry is not JsonValue value || !value.TryGetValue(out string? instrument)
                || !ProviderInstruments.IsKnown(instrument) || instruments.Contains(instrument!))
            {
                return false;
            }

            instruments.Add(instrument!);
        }

        input = new ProviderBindingInput(organizationId, instruments, locale!);
        return true;
    }
}

/// <summary>
/// The provider side of FIT v2's result source. FIT v2 (<c>feat/fit-v2-per-instrument</c>, not merged when this was
/// written) defines <c>IAssessmentResultSource</c> with this exact signature and a stub
/// <c>ProviderAssessmentResultSource</c> that returns nothing. This minimal port lets that stub become a one-line
/// adapter (copy each <see cref="ProviderInstrumentResult"/> field into FIT's <c>InstrumentResult</c>) once both land.
/// </summary>
public interface IProviderAssessmentResultSource
{
    Task<IReadOnlyList<ProviderInstrumentResult>> GetResultsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);
}

/// <summary>Read-only: stored attempts and results of one tenant, candidate and vacancy, mapped by
/// <see cref="ProviderFitMapping"/>. Writes nothing and calls no provider.</summary>
public sealed class ProviderAssessmentResultSource(IAssessmentProviderRepository repository) : IProviderAssessmentResultSource
{
    private readonly IAssessmentProviderRepository _repository = repository;

    public async Task<IReadOnlyList<ProviderInstrumentResult>> GetResultsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        var rows = await _repository.GetFitRowsAsync(organizationId, candidateId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        return ProviderFitMapping.Map(rows);
    }
}
