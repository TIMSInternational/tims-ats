using Tims.Application.Email;

namespace Tims.Infrastructure.Email;

internal sealed class DisabledEmailSender : IEmailSender
{
    public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct) =>
        Task.FromResult(false);
}
