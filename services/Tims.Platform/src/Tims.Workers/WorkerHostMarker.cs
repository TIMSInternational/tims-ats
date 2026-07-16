namespace Tims.Workers;

/// <summary>
/// Public marker for the Tims.Workers host assembly. Exists ONLY so the integration tests can target
/// <c>WebApplicationFactory&lt;WorkerHostMarker&gt;</c> to boot this host — the auto-generated top-level
/// <c>Program</c> is deliberately left INTERNAL so it never collides with Tims.Api's public
/// <c>Program</c> (both assemblies are referenced by Tims.IntegrationTests; a public Workers
/// <c>Program</c> would make <c>WebApplicationFactory&lt;Program&gt;</c> ambiguous in ApiSmokeTests).
/// </summary>
public sealed class WorkerHostMarker;
