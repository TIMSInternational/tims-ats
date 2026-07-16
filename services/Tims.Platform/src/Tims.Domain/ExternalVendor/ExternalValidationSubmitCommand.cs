using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tims.Domain.ExternalVendor;

/// <summary>
/// A VALIDATED value object for an inbound vendor validation submission — the C# port of the Zod
/// <c>ExternalValidationSubmitInput</c> (packages/api/src/dto/external-validation.ts). Constructing one
/// through <see cref="Create"/> guarantees the same bounds the TS boundary enforces, so an invalid body
/// can never reach the write path:
///   - <c>status</c> ∈ { <c>passed</c>, <c>failed</c> } (case-sensitive, matching <c>z.enum</c>);
///   - <c>result</c> is a JSON OBJECT (the TS <c>z.record(z.unknown())</c> — an array / scalar / null is
///     rejected) whose serialized length is ≤ 100_000;
///   - <c>notes</c> is optional and ≤ 5000 characters.
/// The API key is the principal — it is NEVER accepted here (nor the validation id, which the route owns).
/// A bound violation throws <see cref="ExternalValidationInvalidCommandException"/>, which the endpoint
/// maps to 400.
/// </summary>
public sealed class ExternalValidationSubmitCommand
{
    /// <summary>
    /// The maximum serialized length of the <c>result</c> payload — MATCHES the TS bound. NOTE: the bound
    /// is an APPROXIMATION for control-char-dense payloads. STJ emits the long <c>\uXXXX</c> escape for a
    /// control char (e.g. <c></c>, 6 chars) where JS <c>JSON.stringify</c> uses the short escape
    /// where one exists (<c>\t \n \r \b \f</c>, 2 chars), so C# can OVER-count vs TS for such payloads.
    /// That is the SAFE/stricter direction (C# rejects at or before TS would), so it never lets through a
    /// payload TS would reject; ordinary text / non-ASCII counts identically (UnsafeRelaxedJsonEscaping).
    /// </summary>
    public const int MaxResultSerializedLength = 100_000;

    /// <summary>The maximum length of the optional <c>notes</c> string — MATCHES the TS bound.</summary>
    public const int MaxNotesLength = 5000;

    private const string PassedStatus = "passed";
    private const string FailedStatus = "failed";

    // Reproduce `JSON.stringify(r).length` EXACTLY: compact (no whitespace, like STJ default) AND a
    // relaxed encoder that — like JSON.stringify — leaves `<`, `>`, `&`, and non-ASCII characters
    // un-escaped (default STJ escapes them to \uXXXX, which would inflate the UTF-16 length and diverge
    // from the TS bound). Only `"`, `\`, and control chars are escaped, matching JSON.stringify.
    internal static readonly JsonSerializerOptions LengthOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    private ExternalValidationSubmitCommand(string status, JsonObject result, string? notes)
    {
        Status = status;
        Result = result;
        Notes = notes;
    }

    /// <summary>The validated status — exactly <c>passed</c> or <c>failed</c>.</summary>
    public string Status { get; }

    /// <summary>The validated result payload (a JSON object within the size bound).</summary>
    public JsonObject Result { get; }

    /// <summary>The optional notes (≤ 5000 chars), or <c>null</c>.</summary>
    public string? Notes { get; }

    /// <summary>The compact JSON text of <see cref="Result"/> for the jsonb column write.</summary>
    public string SerializeResult() => JsonSerializer.Serialize(Result, LengthOptions);

    /// <summary>
    /// The SINGLE Zod-mirroring parse of a raw inbound JSON body — the wire boundary the endpoint calls.
    /// Reproduces <c>z.object({ status: z.enum(['passed','failed']), result: z.record(z.unknown()),
    /// notes: z.string().max(5000).optional() })</c> EXACTLY, including the <c>.optional()</c> semantics:
    /// <c>notes</c> may be ABSENT (→ null, the column is left untouched) but an explicitly-present
    /// <c>notes: null</c> is REJECTED (Zod <c>.optional()</c> accepts <c>undefined</c>, not <c>null</c>).
    /// The body itself must be a JSON object (a JSON <c>null</c> / array / scalar is rejected). Throws
    /// <see cref="ExternalValidationInvalidCommandException"/> (mapped to 400 by the endpoint).
    /// </summary>
    public static ExternalValidationSubmitCommand Create(JsonNode? body)
    {
        if (body is not JsonObject obj)
        {
            throw new ExternalValidationInvalidCommandException("request body must be a JSON object");
        }

        // status: required, present, a non-null JSON string. `obj["status"]` cannot distinguish absent from
        // present-null, so probe with TryGetPropertyValue and inspect the value kind explicitly.
        if (!obj.TryGetPropertyValue("status", out var statusNode)
            || statusNode is null
            || statusNode.GetValueKind() != JsonValueKind.String)
        {
            throw new ExternalValidationInvalidCommandException("status must be one of: passed, failed");
        }

        var status = statusNode.GetValue<string>();

        // result: required, present, a JSON object (an absent / null / array / scalar value is rejected).
        if (!obj.TryGetPropertyValue("result", out var resultNode) || resultNode is not JsonObject)
        {
            throw new ExternalValidationInvalidCommandException("result must be a JSON object");
        }

        // notes: OPTIONAL. Absent → null (omit the column). Present but not a string (incl. present-null) →
        // rejected — this is the `.optional()` (accepts undefined, NOT null) parity that a nullable binding
        // would silently lose.
        string? notes = null;
        if (obj.TryGetPropertyValue("notes", out var notesNode))
        {
            if (notesNode is null || notesNode.GetValueKind() != JsonValueKind.String)
            {
                throw new ExternalValidationInvalidCommandException("notes must be a string");
            }

            notes = notesNode.GetValue<string>();
        }

        return Create(status, resultNode, notes);
    }

    /// <summary>
    /// Validates already-separated fields (status / result node / notes) against the shared domain bounds,
    /// or throws <see cref="ExternalValidationInvalidCommandException"/> (mapped to 400 by the endpoint).
    /// The raw-body <see cref="Create(JsonNode?)"/> overload is the wire boundary; this overload carries the
    /// status-enum / result-shape+size / notes-length bounds shared with the unit-level callers.
    /// </summary>
    public static ExternalValidationSubmitCommand Create(string? status, JsonNode? result, string? notes)
    {
        if (status is not (PassedStatus or FailedStatus))
        {
            throw new ExternalValidationInvalidCommandException("status must be one of: passed, failed");
        }

        // z.record(z.unknown()) accepts ONLY a JSON object — an array, scalar, or null is invalid.
        if (result is not JsonObject resultObject)
        {
            throw new ExternalValidationInvalidCommandException("result must be a JSON object");
        }

        if (JsonSerializer.Serialize(resultObject, LengthOptions).Length > MaxResultSerializedLength)
        {
            throw new ExternalValidationInvalidCommandException("result payload too large");
        }

        if (notes is not null && notes.Length > MaxNotesLength)
        {
            throw new ExternalValidationInvalidCommandException("notes exceed the maximum length");
        }

        return new ExternalValidationSubmitCommand(status, resultObject, notes);
    }
}

/// <summary>
/// Thrown when an inbound vendor submission fails a domain bound (status / result shape or size / notes
/// length) — the C# analog of the TS Zod parse failure. The API layer maps it to a 400 with the message.
/// </summary>
public sealed class ExternalValidationInvalidCommandException(string message) : Exception(message);
