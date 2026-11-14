namespace Tims.Domain.FitEngine;

/// <summary>
/// The ATS native-quiz local norm (Assessment Player Slice 5): a percentile rank of a result within every OTHER
/// completed, fully graded result of the same organization and quiz, and its band. A C# copy of the TS
/// <c>computeNormBandFromCounts</c> (packages/shared/src/validators/assessment.ts), arithmetic for arithmetic: the
/// midpoint rank <c>(below + 0.5 × equal) / sample × 100</c> in IEEE doubles, no percentile below
/// <see cref="MinSampleSize"/> results, and the same four bands. These norms are the organization's own results, not
/// TIMS content.
/// </summary>
public static class AssessmentNormBands
{
    /// <summary>TS <c>MIN_NORM_SAMPLE_SIZE</c>: with fewer other results a percentile is meaningless (null).</summary>
    public const int MinSampleSize = 5;

    public const string BelowAverage = "below_average";
    public const string Average = "average";
    public const string AboveAverage = "above_average";
    public const string Excellent = "excellent";

    /// <summary>The percentile and band, or null when <paramref name="sampleSize"/> is below the minimum.</summary>
    public static (double Percentile, string Band)? FromCounts(long countBelow, long countEqual, long sampleSize)
    {
        if (sampleSize < MinSampleSize)
        {
            return null;
        }

        var percentile = (countBelow + (0.5 * countEqual)) / sampleSize * 100;
        return (percentile, BandFor(percentile));
    }

    /// <summary>TS <c>bandForPercentile</c>: [0,25) below average, [25,50) average, [50,75) above average, else excellent.</summary>
    public static string BandFor(double percentile) =>
        percentile < 25 ? BelowAverage
        : percentile < 50 ? Average
        : percentile < 75 ? AboveAverage
        : Excellent;
}
