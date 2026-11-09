using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tims.Application.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

public static class AssessmentProviderServiceCollectionExtensions
{
    /// <summary>
    /// Registers the assessment-provider connector: options (validated when set), the token cache, the typed client,
    /// the EF context + repository and the use cases. Registration is unconditional and inert: nothing is called until
    /// a route (mapped only when <c>Platform:AssessmentProvidersEnabled</c> is on) resolves a use case.
    /// </summary>
    public static IServiceCollection AddAssessmentProviders(
        this IServiceCollection services, IConfiguration configuration, string? databaseConnectionString)
    {
        services.AddOptions<AssessmentProviderOptions>()
            .Bind(configuration.GetSection(AssessmentProviderOptions.SectionName))
            .Validate(o => o.IsValid(),
                "AssessmentProviders: BaseUrl must be an https origin or base path, TokenUrl an https URL (no credentials, query or " +
                "fragment), PortalBaseUrl (when set) an https origin with no path, RequestTimeoutSeconds 1..30")
            .ValidateOnStart();

        services.AddHttpClient(ClientCredentialsTokenCache.HttpClientName, client =>
            {
                client.Timeout = TimeSpan.FromSeconds(30);
                client.MaxResponseContentBufferSize = 65_536;
            })
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddSingleton<ClientCredentialsTokenCache>();
        services.AddHttpClient<IAssessmentProvider, TimsAssessmentsClient>(client =>
            {
                client.Timeout = TimeSpan.FromSeconds(30); // the per-call budget is the options' RequestTimeoutSeconds
                client.MaxResponseContentBufferSize = TimsAssessmentsClient.MaxResponseBytes;
            })
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

        services.AddDbContext<AssessmentProviderDbContext>(options => options.UseNpgsql(databaseConnectionString));
        services.AddScoped<IAssessmentProviderRepository, AssessmentProviderRepository>();
        // AS-7 / AS-14 staff reads (catalog, attempts with results): the same repository class, over the same scoped context.
        services.AddScoped<IProviderStaffReadRepository, AssessmentProviderRepository>();
        services.AddScoped<ProviderStaffReadUseCase>();
        services.AddScoped<AssignProviderInstrumentsUseCase>();
        services.AddScoped<CancelProviderAttemptUseCase>();
        services.AddScoped<LaunchProviderAttemptUseCase>();
        services.AddScoped<ProviderPortalUseCase>();
        services.AddScoped<ProviderWebhookUseCase>();
        services.TryAddSingleton<ProviderInboxSignal>();
        services.AddScoped<IProviderInboxWorker, ProviderInboxWorkerUseCase>();
        services.AddScoped<ProviderBindingUseCase>();
        services.AddScoped<ProviderConsentWithdrawalUseCase>();
        services.AddScoped<ProviderSubjectRightsUseCase>();
        services.AddScoped<IProviderWithdrawalSweep, ProviderWithdrawalSweepUseCase>();
        services.AddScoped<IProviderAttemptPoll, ProviderAttemptPollUseCase>();
        services.AddScoped<IProviderAssessmentResultSource, ProviderAssessmentResultSource>();
        return services;
    }
}
