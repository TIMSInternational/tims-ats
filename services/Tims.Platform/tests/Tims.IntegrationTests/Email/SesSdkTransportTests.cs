using System.Net;
using System.Net.Sockets;
using Amazon.Runtime;
using Amazon.SimpleEmail;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tims.Infrastructure.Email;

namespace Tims.IntegrationTests.Email;

/// <summary>Real SDK serialization/error/retry pipeline over an in-memory HTTP transport. No AWS calls.</summary>
public sealed class SesSdkTransportTests
{
    [Theory]
    [InlineData(200, true)]
    [InlineData(429, false)]
    [InlineData(500, false)]
    [InlineData(0, false)]
    public async Task Real_sdk_makes_one_attempt_even_on_throttle_server_error_or_stale_connection(int status, bool expected)
    {
        var settings = new EmailOptions { Enabled = true, Region = "us-east-1", FromAddress = "sender@example.test" };
        var configuration = EmailServiceCollectionExtensions.CreateClientConfig(settings);
        using var handler = new RecordingHandler(status);
        configuration.HttpClientFactory = new StubFactory(handler);
        Assert.Equal(0, configuration.MaxErrorRetry);
        Assert.Equal(0, configuration.MaxStaleConnectionRetries);
        using var client = new AmazonSimpleEmailServiceClient(new AnonymousAWSCredentials(), configuration);
        var sender = new SesEmailSender(new Lazy<IAmazonSimpleEmailService>(() => client),
            Options.Create(settings), NullLogger<SesEmailSender>.Instance);

        Assert.Equal(expected, await sender.SendEmailAsync("recipient@example.test", "Subject", "<p>Body</p>", CancellationToken.None));
        Assert.Equal(1, handler.Calls);
        Assert.NotNull(handler.RequestUri);
        Assert.Equal("https", handler.RequestUri.Scheme);
        Assert.Equal("email.us-east-1.amazonaws.com", handler.RequestUri.Host);
        Assert.Contains("Action=SendEmail", handler.Body);
        Assert.Contains("Destination.ToAddresses.member.1=recipient%40example.test", handler.Body);
        Assert.DoesNotContain("member.2", handler.Body);
    }

    private sealed class StubFactory(HttpMessageHandler handler) : HttpClientFactory
    {
        public override HttpClient CreateHttpClient(IClientConfig clientConfig) => new(handler, disposeHandler: false);
    }

    private sealed class RecordingHandler(int status) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public Uri? RequestUri { get; private set; }
        public string Body { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            RequestUri = request.RequestUri;
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            if (status == 0)
                throw new HttpRequestException("Connection reset", new SocketException((int)SocketError.ConnectionReset));
            var body = status == 200
                ? "<SendEmailResponse xmlns=\"http://ses.amazonaws.com/doc/2010-12-01/\"><SendEmailResult><MessageId>accepted</MessageId></SendEmailResult><ResponseMetadata><RequestId>test</RequestId></ResponseMetadata></SendEmailResponse>"
                : "<ErrorResponse xmlns=\"http://ses.amazonaws.com/doc/2010-12-01/\"><Error><Type>Receiver</Type><Code>Throttling</Code><Message>Unavailable</Message></Error><RequestId>test</RequestId></ErrorResponse>";
            return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(body, System.Text.Encoding.UTF8, "text/xml") };
        }
    }
}
