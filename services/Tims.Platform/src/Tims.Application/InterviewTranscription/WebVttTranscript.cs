using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Tims.Application.InterviewTranscription;

/// <summary>One utterance: when it starts (seconds into the call), who said it (a ROLE, never a name), and the text.</summary>
public sealed record TranscriptSegment(int StartSeconds, string Speaker, string Text);

public sealed record ParsedTranscript(IReadOnlyList<TranscriptSegment> Segments, bool Truncated);

/// <summary>
/// Tolerant WebVTT reader for provider transcripts, plus speaker PSEUDONYMIZATION: the AI and the room never receive
/// participant names, only roles (<c>candidate</c>, <c>interviewer_1</c>, <c>participant_1</c>, <c>unknown</c>).
/// Speakers come from <c>&lt;v Name&gt;</c> voice tags, or from a leading <c>Name:</c> only when Name is a known
/// participant (free text containing a colon is never mistaken for a speaker). Pure and bounded.
/// </summary>
public static partial class WebVttTranscript
{
    public const int MaxSegments = 1_500;
    public const int MaxTotalChars = 100_000;
    public const int MaxSegmentChars = 1_200;
    public const string Candidate = "candidate";
    public const string Unknown = "unknown";

    [GeneratedRegex(@"^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})\s+-->", RegexOptions.CultureInvariant)]
    private static partial Regex Timing();

    [GeneratedRegex(@"^<v(?:\.[^\s>]+)*\s+([^>]{1,120})>(.*)$", RegexOptions.CultureInvariant | RegexOptions.Singleline)]
    private static partial Regex Voice();

    [GeneratedRegex("<[^>]{0,200}>", RegexOptions.CultureInvariant)]
    private static partial Regex Tag();

    public static ParsedTranscript Parse(string? vtt, string? candidateFirstName, string? candidateLastName,
        IReadOnlyList<TranscriptionStaffName> staff)
    {
        if (string.IsNullOrWhiteSpace(vtt)) return new([], false);
        // The candidate joins with the name the C# join mints into the guest token (bounded, sanitized).
        var candidate = Normalize(Tims.Application.InterviewJoin.CandidateInterviewJoin.DisplayName(
            candidateFirstName, candidateLastName));
        var staffNames = staff.Select(s => Normalize(DisplayName(s.FirstName, s.LastName)))
            .Where(n => n.Length > 0).ToHashSet(StringComparer.Ordinal);
        var roles = new Dictionary<string, string>(StringComparer.Ordinal);
        var interviewers = 0;
        var others = 0;
        string RoleFor(string? rawName)
        {
            var name = Normalize(rawName);
            if (name.Length == 0) return Unknown;
            if (roles.TryGetValue(name, out var known)) return known;
            var role = candidate.Length > 0 && name == candidate ? Candidate
                : staffNames.Contains(name) ? $"interviewer_{++interviewers}"
                : $"participant_{++others}";
            roles[name] = role;
            return role;
        }

        var segments = new List<TranscriptSegment>();
        var total = 0;
        var truncated = false;
        foreach (var block in vtt.Replace("\r\n", "\n").Replace('\r', '\n').Split("\n\n"))
        {
            var lines = block.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            var timingIndex = Array.FindIndex(lines, l => Timing().IsMatch(l));
            if (timingIndex < 0) continue; // WEBVTT header, NOTE, STYLE, REGION, or noise
            var start = StartSeconds(Timing().Match(lines[timingIndex]));
            var raw = string.Join(' ', lines.Skip(timingIndex + 1));
            if (raw.Length == 0) continue;
            string? speakerName = null;
            var voice = Voice().Match(raw);
            if (voice.Success)
            {
                speakerName = voice.Groups[1].Value;
                raw = voice.Groups[2].Value;
            }
            var text = Clean(raw);
            if (speakerName is null)
            {
                var colon = text.IndexOf(':');
                if (colon is > 0 and <= 80)
                {
                    var prefix = Normalize(text[..colon]);
                    if (prefix == candidate || staffNames.Contains(prefix))
                    {
                        speakerName = text[..colon];
                        text = text[(colon + 1)..].Trim();
                    }
                }
            }
            if (text.Length == 0) continue;
            var speaker = RoleFor(speakerName);
            // Consecutive cues of the same speaker become one utterance (Daily writes short cues).
            if (segments.Count > 0 && segments[^1].Speaker == speaker &&
                segments[^1].Text.Length + text.Length + 1 <= MaxSegmentChars)
            {
                var last = segments[^1];
                segments[^1] = last with { Text = last.Text + " " + text };
                total += text.Length + 1;
            }
            else
            {
                if (segments.Count >= MaxSegments) { truncated = true; break; }
                if (text.Length > MaxSegmentChars) text = text[..MaxSegmentChars];
                segments.Add(new TranscriptSegment(start, speaker, text));
                total += text.Length;
            }
            if (total >= MaxTotalChars) { truncated = true; break; }
        }
        return new(segments, truncated);
    }

    /// <summary>Same composition both stacks use for the Daily user_name (first + last, single spaces).</summary>
    public static string DisplayName(string? first, string? last) =>
        string.Join(' ', new[] { first, last }.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));

    private static string Normalize(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return string.Empty;
        var builder = new StringBuilder(name.Length);
        foreach (var ch in name.Trim().Normalize(NormalizationForm.FormC))
        {
            if (char.IsWhiteSpace(ch))
            {
                if (builder.Length > 0 && builder[^1] != ' ') builder.Append(' ');
                continue;
            }
            if (char.IsControl(ch)) continue;
            builder.Append(char.ToLowerInvariant(ch));
        }
        return builder.ToString().Trim();
    }

    private static string Clean(string raw)
    {
        var text = WebUtility.HtmlDecode(Tag().Replace(raw, string.Empty));
        var builder = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            var category = char.GetUnicodeCategory(ch);
            if (char.IsControl(ch) || category is UnicodeCategory.Format or UnicodeCategory.PrivateUse) continue;
            if (char.IsWhiteSpace(ch))
            {
                if (builder.Length > 0 && builder[^1] != ' ') builder.Append(' ');
                continue;
            }
            builder.Append(ch);
        }
        return builder.ToString().Trim();
    }

    private static int StartSeconds(Match timing)
    {
        var hours = timing.Groups[1].Success ? int.Parse(timing.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
        var minutes = int.Parse(timing.Groups[2].Value, CultureInfo.InvariantCulture);
        var seconds = int.Parse(timing.Groups[3].Value, CultureInfo.InvariantCulture);
        return hours * 3600 + minutes * 60 + seconds;
    }
}
