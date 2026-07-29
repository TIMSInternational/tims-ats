using FxSeedOnce;

string? connectionString = args.Length > 0 ? args[0] : Environment.GetEnvironmentVariable("FX_SEED_DATABASE_URL");

if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("Usage: dotnet run --project services/Tims.Platform/tools/FxSeedOnce -- \"<DATABASE_URL>\"");
    Console.Error.WriteLine("(or set the FX_SEED_DATABASE_URL environment variable instead of passing an argument)");
    return 1;
}

try
{
    var pinned = await FxSeedRunner.RunAsync(connectionString, CancellationToken.None).ConfigureAwait(false);
    Console.WriteLine($"fx-seed-once: pinned {pinned} rate(s).");
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"fx-seed-once: FAILED — {ex.Message}");
    return 1;
}
