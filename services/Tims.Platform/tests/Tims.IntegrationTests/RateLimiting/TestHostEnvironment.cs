using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>Minimal <see cref="IHostEnvironment"/> to drive the Development/Production fail-open branch.</summary>
internal sealed class TestHostEnvironment(string environmentName) : IHostEnvironment
{
    public string EnvironmentName { get; set; } = environmentName;
    public string ApplicationName { get; set; } = "Tims.Api.Tests";
    public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}
