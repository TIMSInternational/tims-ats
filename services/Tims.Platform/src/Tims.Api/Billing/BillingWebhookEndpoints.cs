using System.Text;
using Tims.Application.Billing;

namespace Tims.Api.Billing;

/// <summary>
/// The Stripe billing webhook endpoint (Phase-5 Slice 4) — the C# port of
/// <c>apps/web/app/api/webhooks/stripe/route.ts</c>. It is ANONYMOUS: the Stripe SIGNATURE (verified over the
/// RAW body) is the authentication, not a JWT/ApiKey. Reads the raw request body exactly as received (before
/// any model binding) so the HMAC matches, then delegates to <see cref="BillingWebhookUseCase"/>.
///
/// Status contract (faithful to the TS route, which drives Stripe's retry semantics):
/// <list type="bullet">
///   <item>missing/invalid signature (or missing secret/header) → <b>400</b> (an unverified event is never processed);</item>
///   <item>handled (any outcome) → <b>200</b> with <c>{ received, type, handled }</c>;</item>
///   <item>handler failure → <b>500</b> so Stripe retries (the apply is idempotent under the org lock).</item>
/// </list>
/// Dark-by-default: mapped only when <c>Platform:BillingWebhookWriteEnabled</c> is on (or at build-time OpenAPI
/// generation), so deploying Tims.Api adds NO second live writer until Federico flips the flag at canary.
/// </summary>
public static class BillingWebhookEndpoints
{
    private const string SignatureHeader = "Stripe-Signature";

    public static void MapBillingWebhookEndpoints(this WebApplication app)
    {
        app.MapPost("/billing/webhooks/stripe", async (
                HttpContext httpContext,
                BillingWebhookUseCase useCase,
                ILoggerFactory loggerFactory,
                CancellationToken cancellationToken) =>
            {
                // Read the RAW body exactly as received (the HMAC is computed over these bytes). No model
                // binding — a typed/body parameter would consume + re-serialize the stream and break the signature.
                string rawBody;
                using (var reader = new StreamReader(httpContext.Request.Body, Encoding.UTF8, leaveOpen: false))
                {
                    rawBody = await reader.ReadToEndAsync(cancellationToken);
                }

                var signature = httpContext.Request.Headers[SignatureHeader].FirstOrDefault();

                try
                {
                    var result = await useCase.HandleAsync(rawBody, signature, cancellationToken);
                    return Results.Ok(result);
                }
                catch (WebhookVerificationException)
                {
                    // An unverified event is never processed — a bare 400, no internal detail leaked.
                    return Results.Text("Invalid signature", "text/plain", statusCode: StatusCodes.Status400BadRequest);
                }
                catch (Exception ex)
                {
                    // Any handler failure → 500 so Stripe retries the delivery (the apply is idempotent under
                    // the per-org advisory lock). Log without the payload (PII-free).
                    loggerFactory.CreateLogger("Tims.Api.Billing.StripeWebhook")
                        .LogError(ex, "stripe webhook handler failed");
                    return Results.Json(new { ok = false, error = "handler_failed" }, statusCode: StatusCodes.Status500InternalServerError);
                }
            })
            .AllowAnonymous()
            .Accepts<string>("application/json")
            .Produces<WebhookResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status500InternalServerError)
            .WithName("StripeBillingWebhook");
    }
}
