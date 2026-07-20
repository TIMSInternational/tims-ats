using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tims.Domain.Validation;

/// <summary>
/// A VALIDATED value object for the STAFF pre-employment-validation update — the C# port of the Zod input
/// of <c>offerValidationsRouter.updateValidation</c> (packages/api/src/routers/offer/validations.ts). Unlike
/// the external-vendor submit, this is a PARTIAL update:
///   - <c>status</c> ∈ { <c>pending</c>, <c>passed</c>, <c>failed</c>, <c>waived</c> } (case-sensitive z.enum);
///   - <c>result</c> is OPTIONAL — <c>z.record(z.unknown()).refine(len ≤ 100_000).optional()</c>: ABSENT
///     leaves the column untouched (Prisma <c>?? undefined</c>); when present it must be a JSON OBJECT within
///     the size bound (an array / scalar / explicit null is rejected);
///   - <c>notes</c> is OPTIONAL — <c>z.string().max(5000).optional()</c>: ABSENT leaves the column untouched;
///     when present it must be a string ≤ 5000 (an explicit <c>null</c> is rejected — <c>.optional()</c>
///     accepts <c>undefined</c>, not <c>null</c>).
/// The route owns the validation id; the staff user id is the principal (never accepted in the body). A
/// bound violation throws <see cref="StaffValidationInvalidCommandException"/>, mapped to 400 by the endpoint.
/// </summary>
public sealed class StaffValidationUpdateCommand
{
    /// <summary>Max serialized <c>result</c> length — MATCHES the TS <c>JSON.stringify(v ?? {}).length ≤ 100000</c>.</summary>
    public const int MaxResultSerializedLength = 100_000;

    /// <summary>Max <c>notes</c> length — MATCHES the TS <c>z.string().max(5000)</c>.</summary>
    public const int MaxNotesLength = 5000;

    private static readonly string[] AllowedStatuses = ["pending", "passed", "failed", "waived"];

    // Reproduce `JSON.stringify(r).length` EXACTLY (see ExternalValidationSubmitCommand): compact + a relaxed
    // encoder that leaves `<`, `>`, `&`, and non-ASCII un-escaped, so the UTF-16 length matches the TS bound.
    internal static readonly JsonSerializerOptions LengthOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    private StaffValidationUpdateCommand(string status, bool resultProvided, string? resultJson, bool notesProvided, string? notes)
    {
        Status = status;
        ResultProvided = resultProvided;
        ResultJson = resultJson;
        NotesProvided = notesProvided;
        Notes = notes;
    }

    /// <summary>The validated status (one of pending / passed / failed / waived).</summary>
    public string Status { get; }

    /// <summary>True when the body carried a <c>result</c> — only then is the column written (else untouched).</summary>
    public bool ResultProvided { get; }

    /// <summary>The compact jsonb text to write when <see cref="ResultProvided"/>; otherwise <c>null</c> (skip).</summary>
    public string? ResultJson { get; }

    /// <summary>True when the body carried a <c>notes</c> — only then is the column written (else untouched).</summary>
    public bool NotesProvided { get; }

    /// <summary>The notes to write when <see cref="NotesProvided"/>; otherwise <c>null</c> (skip).</summary>
    public string? Notes { get; }

    /// <summary>Whether the update completes the validation: <c>status ≠ pending</c> (drives completedAt = now vs null).</summary>
    public bool IsCompleting => Status is not "pending";

    /// <summary>
    /// The single Zod-mirroring parse of a raw inbound JSON body — the endpoint's wire boundary. The body must
    /// be a JSON object; <c>status</c> is required; <c>result</c>/<c>notes</c> are optional with the partial-update
    /// semantics documented on the type. Throws <see cref="StaffValidationInvalidCommandException"/> (→ 400).
    /// </summary>
    public static StaffValidationUpdateCommand Create(JsonNode? body)
    {
        if (body is not JsonObject obj)
        {
            throw new StaffValidationInvalidCommandException("request body must be a JSON object");
        }

        // status: required, present, a non-null JSON string in the enum.
        if (!obj.TryGetPropertyValue("status", out var statusNode)
            || statusNode is null
            || statusNode.GetValueKind() != JsonValueKind.String)
        {
            throw new StaffValidationInvalidCommandException("status must be one of: pending, passed, failed, waived");
        }

        var status = statusNode.GetValue<string>();
        if (Array.IndexOf(AllowedStatuses, status) < 0)
        {
            throw new StaffValidationInvalidCommandException("status must be one of: pending, passed, failed, waived");
        }

        // result: OPTIONAL. Absent (key not present) → skip. Present → must be a JSON object within the size
        // bound (present-null / array / scalar rejected).
        var resultProvided = false;
        string? resultJson = null;
        if (obj.TryGetPropertyValue("result", out var resultNode))
        {
            if (resultNode is not JsonObject resultObject)
            {
                throw new StaffValidationInvalidCommandException("result must be a JSON object");
            }

            resultJson = JsonSerializer.Serialize(resultObject, LengthOptions);
            if (resultJson.Length > MaxResultSerializedLength)
            {
                throw new StaffValidationInvalidCommandException("result payload too large");
            }

            resultProvided = true;
        }

        // notes: OPTIONAL. Absent → skip. Present → must be a string ≤ 5000 (present-null rejected).
        var notesProvided = false;
        string? notes = null;
        if (obj.TryGetPropertyValue("notes", out var notesNode))
        {
            if (notesNode is null || notesNode.GetValueKind() != JsonValueKind.String)
            {
                throw new StaffValidationInvalidCommandException("notes must be a string");
            }

            notes = notesNode.GetValue<string>();
            if (notes.Length > MaxNotesLength)
            {
                throw new StaffValidationInvalidCommandException("notes exceed the maximum length");
            }

            notesProvided = true;
        }

        return new StaffValidationUpdateCommand(status, resultProvided, resultJson, notesProvided, notes);
    }
}

/// <summary>
/// Thrown when a staff validation update fails a domain bound (status enum / result shape or size / notes
/// length / body shape) — the C# analog of the TS Zod parse failure. The API layer maps it to a 400.
/// </summary>
public sealed class StaffValidationInvalidCommandException(string message) : Exception(message);
