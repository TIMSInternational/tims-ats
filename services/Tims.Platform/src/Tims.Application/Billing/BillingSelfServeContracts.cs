using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// The deploy's self-serve billing config (the subset of Stripe config the use case needs), supplied by
/// Program.cs from <c>StripeBillingOptions</c> so the Application layer never references the Api layer. Mirrors
/// the TS <c>isBillingConfigured</c> / <c>planToPriceId</c> / <c>appOrigin</c> helpers.
/// </summary>
public sealed record BillingSelfServeConfig(
    string? SecretKey,
    string? PriceStarter,
    string? PriceProfessional,
    string AppUrl,
    string? PortalConfigurationId)
{
    /// <summary>Config-presence gate: secret key AND both self-serve price ids present (fail-closed otherwise).</summary>
    public bool IsConfigured => StripeBillingConfig.IsConfigured(SecretKey, PriceStarter, PriceProfessional);

    /// <summary>The configured Stripe price id for a self-serve plan, or null for an unknown/unconfigured plan.</summary>
    public string? PlanToPriceId(string plan) => plan switch
    {
        "starter" => NullIfEmpty(PriceStarter),
        "professional" => NullIfEmpty(PriceProfessional),
        _ => null,
    };

    /// <summary>
    /// The absolute app origin for return URLs (NEXT_PUBLIC_APP_URL), trailing slash stripped. Falls back to
    /// the known prod origin when unset OR empty (TS parity: <c>process.env.NEXT_PUBLIC_APP_URL || fallback</c>)
    /// so an explicit empty value never yields a relative URL Stripe would reject.
    /// </summary>
    public string Origin => (string.IsNullOrEmpty(AppUrl) ? "https://tims-ats.vercel.app" : AppUrl).TrimEnd('/');

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}

/// <summary>Who a billing action is attributed to — the REAL operator (impersonator when impersonating), with the impersonated account carried in metadata.</summary>
public sealed record BillingAuditActor(string Id, string? ImpersonatedUserId);

/// <summary>
/// A self-serve billing failure carrying the HTTP status the endpoint returns + the (Spanish, TS-parity)
/// message. Mirrors the TRPCError codes: 412 PRECONDITION_FAILED, 404 NOT_FOUND, 409 CONFLICT, 500 INTERNAL.
/// </summary>
public sealed class BillingSelfServeException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;

    public static BillingSelfServeException NotConfigured() =>
        new(412, "El pago con Stripe no esta configurado.");

    public static BillingSelfServeException PlanUnavailable() =>
        new(412, "Plan no disponible.");

    public static BillingSelfServeException OrgNotFound() =>
        new(404, "Organizacion no encontrada.");

    public static BillingSelfServeException CheckoutConflict() =>
        new(409, "Ya tienes una suscripcion activa. Administra tu plan desde el portal de facturacion.");

    public static BillingSelfServeException CheckoutUrlMissing() =>
        new(500, "No se pudo crear la sesion de pago.");

    public static BillingSelfServeException NoStripeCustomer() =>
        new(412, "Aun no tienes una cuenta de facturacion de Stripe.");

    public static BillingSelfServeException NoActiveSubscription() =>
        new(412, "No hay una suscripcion de Stripe activa para cancelar.");
}
