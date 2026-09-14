using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Tims.Api.Authentication;
using Tims.Application.Audit;
using Tims.Domain.Identity;

namespace Tims.IntegrationTests.Monitoring;

public sealed class SecurityAuditCancellationTests
{
    [Fact]
    public async Task Disconnect_after_denial_does_not_cancel_audit_write()
    {
        using var aborted = new CancellationTokenSource();
        var writer = new RecordingWriter();
        using var services = new ServiceCollection().AddSingleton<ISecurityEventWriter>(writer).BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services, RequestAborted = aborted.Token };
        context.Request.Method = HttpMethods.Get;
        context.Request.Path = "/protected";
        context.Items[ResolvedPrincipal.HttpContextKey] = new ResolvedPrincipal(
            new TenantContext(PrincipalType.OrgUser, Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), []));
        var middleware = new SecurityDenialAuditMiddleware(ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            aborted.Cancel();
            return Task.CompletedTask;
        });

        await middleware.InvokeAsync(context);

        Assert.True(context.RequestAborted.IsCancellationRequested);
        Assert.Equal("authz_denied", Assert.Single(writer.Events).Action);
        Assert.False(writer.Token.IsCancellationRequested);
        Assert.Equal(StatusCodes.Status403Forbidden, context.Response.StatusCode);
    }

    private sealed class RecordingWriter : ISecurityEventWriter
    {
        public List<SecurityEvent> Events { get; } = [];
        public CancellationToken Token { get; private set; }
        public Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Token = cancellationToken;
            Events.Add(securityEvent);
            return Task.CompletedTask;
        }
    }
}
