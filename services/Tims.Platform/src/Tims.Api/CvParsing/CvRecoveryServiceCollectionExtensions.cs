using System.Globalization;
using Amazon;
using Amazon.BedrockRuntime;
using Amazon.Runtime;
using Amazon.S3;
using Npgsql;
using Tims.Api.Configuration;
using Tims.Infrastructure.CvParsing;

namespace Tims.Api.CvParsing;

public static class CvRecoveryServiceCollectionExtensions
{
    private const string DefaultHaikuProfile = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

    public static IServiceCollection AddCvParseRecovery(this IServiceCollection services,
        IConfiguration configuration, string? databaseConnectionString)
    {
        if (!bool.TryParse(configuration[$"Platform:{nameof(PlatformOptions.CvParseRecoveryEnabled)}"],
                out var enabled) || !enabled) return services;

        var bucket = Required(configuration, "CV_UPLOADS_BUCKET");
        var s3Region = Required(configuration, "CV_UPLOADS_REGION");
        var guardrailId = Required(configuration, "BEDROCK_GUARDRAIL_ID");
        var guardrailVersion = Required(configuration, "BEDROCK_GUARDRAIL_VERSION");
        var bedrockRegion = Required(configuration, "BEDROCK_AWS_REGION");
        // The usage ledger prices Haiku 4.5. A configurable model identifier
        // could silently understate spend if switched to Sonnet/Opus.
        var modelId = DefaultHaikuProfile;
        if (string.IsNullOrWhiteSpace(databaseConnectionString) ||
            !ValidRegion(s3Region) || !ValidRegion(bedrockRegion))
            throw new InvalidOperationException("CV recovery configuration is incomplete");

        var accessKey = configuration["BEDROCK_AWS_ACCESS_KEY_ID"];
        var secretKey = configuration["BEDROCK_AWS_SECRET_ACCESS_KEY"];
        var s3AccessKey = configuration["CV_UPLOADS_AWS_ACCESS_KEY_ID"];
        var s3SecretKey = configuration["CV_UPLOADS_AWS_SECRET_ACCESS_KEY"];
        if (string.IsNullOrWhiteSpace(accessKey) != string.IsNullOrWhiteSpace(secretKey))
            throw new InvalidOperationException("CV Bedrock credentials must be supplied as a pair");
        if (string.IsNullOrWhiteSpace(s3AccessKey) != string.IsNullOrWhiteSpace(s3SecretKey))
            throw new InvalidOperationException("CV S3 credentials must be supplied as a pair");
        var budgetRaw = configuration["AI_DEFAULT_MONTHLY_BUDGET_USD"];
        var defaultBudget = 25.0;
        if (budgetRaw is not null && (!double.TryParse(budgetRaw, NumberStyles.Float,
                CultureInfo.InvariantCulture, out defaultBudget) || !double.IsFinite(defaultBudget) ||
                defaultBudget is <= 0 or > 10_000))
            throw new InvalidOperationException("CV AI default budget is invalid");

        services.AddSingleton(_ => new CvParseDataSourceHolder(
            NpgsqlDataSource.Create(databaseConnectionString)));
        services.AddSingleton(sp => new CvParseLeaseRepository(
            sp.GetRequiredService<CvParseDataSourceHolder>().DataSource));
        services.AddSingleton<ICvAiBudgetLedger>(sp => new CvAiBudgetLedger(
            sp.GetRequiredService<CvParseDataSourceHolder>().DataSource, defaultBudget));
        services.AddSingleton<IAmazonS3>(_ =>
            string.IsNullOrWhiteSpace(s3AccessKey)
                ? new AmazonS3Client(RegionEndpoint.GetBySystemName(s3Region))
                : new AmazonS3Client(new BasicAWSCredentials(s3AccessKey, s3SecretKey),
                    RegionEndpoint.GetBySystemName(s3Region)));
        services.AddSingleton<IAmazonBedrockRuntime>(_ =>
            string.IsNullOrWhiteSpace(accessKey)
                ? new AmazonBedrockRuntimeClient(RegionEndpoint.GetBySystemName(bedrockRegion))
                : new AmazonBedrockRuntimeClient(
                    new BasicAWSCredentials(accessKey, secretKey), RegionEndpoint.GetBySystemName(bedrockRegion)));
        services.AddSingleton<ICvObjectStore>(sp =>
            new S3CvObjectStore(sp.GetRequiredService<IAmazonS3>(), bucket));
        services.AddSingleton<ICvParser>(sp => new BedrockCvParser(
            sp.GetRequiredService<IAmazonBedrockRuntime>(),
            sp.GetRequiredService<ICvAiBudgetLedger>(), modelId, guardrailId, guardrailVersion));
        services.AddSingleton<CvParseRecoveryProcessor>();
        services.AddHostedService<CvParseRecoveryHostedService>();
        return services;
    }

    private static string Required(IConfiguration configuration, string key) =>
        !string.IsNullOrWhiteSpace(configuration[key]) ? configuration[key]!
            : throw new InvalidOperationException($"CV recovery requires {key}");

    private static bool ValidRegion(string region) =>
        RegionEndpoint.EnumerableAllRegions.Any(value => value.SystemName == region);
}
