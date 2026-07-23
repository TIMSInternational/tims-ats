using NpgsqlTypes;

namespace Tims.Infrastructure.Dei;

/// <summary>
/// CLR mirrors of the THREE NATIVE Prisma enum types on <c>employee_demographics</c> (<c>Gender</c>,
/// <c>Ethnicity</c>, <c>DisabilityStatus</c> — packages/db/prisma/schema/employee.prisma; DB type names exactly
/// <c>"Gender"</c>/<c>"Ethnicity"</c>/<c>"DisabilityStatus"</c>). The DEI reads GROUP BY these columns, so — like
/// the evaluation360 reads (Slice 7) — they are mapped as real CLR enums via <see cref="DeiReadDataSource"/>'s
/// <c>MapEnum</c>: <c>HasPostgresEnum</c> alone leaves EF materializing the grouped key as <c>int</c> (GetInt32 →
/// InvalidCastException) and emitting <c>= &lt;integer&gt;</c> (error 42883). The DB labels are pinned with
/// <see cref="PgNameAttribute"/> so the mapping is exact regardless of the default name translator;
/// <see cref="DeiEnumLabels"/> converts back to those labels for the wire + kernels (which compare gender as its
/// literal string, e.g. <c>"female"</c>/<c>"undisclosed"</c>).
/// </summary>
public enum GenderPg
{
    [PgName("female")] Female,
    [PgName("male")] Male,
    [PgName("non_binary")] NonBinary,
    [PgName("undisclosed")] Undisclosed,
}

public enum EthnicityPg
{
    [PgName("mestizo")] Mestizo,
    [PgName("afrodescendiente")] Afrodescendiente,
    [PgName("indigena")] Indigena,
    [PgName("raizal")] Raizal,
    [PgName("rom")] Rom,
    [PgName("palenquero")] Palenquero,
    [PgName("blanco")] Blanco,
    [PgName("otro")] Otro,
    [PgName("undisclosed")] Undisclosed,
}

public enum DisabilityStatusPg
{
    [PgName("none")] None,
    [PgName("has_disability")] HasDisability,
    [PgName("undisclosed")] Undisclosed,
}

/// <summary>Converts the mapped CLR enums back to their exact Prisma DB labels — the strings the TS wire uses and
/// the strings the pure <see cref="Tims.Domain.Dei.DeiKernels"/> compare on.</summary>
public static class DeiEnumLabels
{
    public static string Label(this GenderPg gender) => gender switch
    {
        GenderPg.Female => "female",
        GenderPg.Male => "male",
        GenderPg.NonBinary => "non_binary",
        GenderPg.Undisclosed => "undisclosed",
        _ => throw new ArgumentOutOfRangeException(nameof(gender), gender, "unknown Gender"),
    };

    public static string Label(this EthnicityPg ethnicity) => ethnicity switch
    {
        EthnicityPg.Mestizo => "mestizo",
        EthnicityPg.Afrodescendiente => "afrodescendiente",
        EthnicityPg.Indigena => "indigena",
        EthnicityPg.Raizal => "raizal",
        EthnicityPg.Rom => "rom",
        EthnicityPg.Palenquero => "palenquero",
        EthnicityPg.Blanco => "blanco",
        EthnicityPg.Otro => "otro",
        EthnicityPg.Undisclosed => "undisclosed",
        _ => throw new ArgumentOutOfRangeException(nameof(ethnicity), ethnicity, "unknown Ethnicity"),
    };

    public static string Label(this DisabilityStatusPg status) => status switch
    {
        DisabilityStatusPg.None => "none",
        DisabilityStatusPg.HasDisability => "has_disability",
        DisabilityStatusPg.Undisclosed => "undisclosed",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "unknown DisabilityStatus"),
    };
}
