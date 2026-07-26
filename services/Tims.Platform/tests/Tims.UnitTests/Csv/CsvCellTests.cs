using Tims.Domain.Csv;
using Xunit;

namespace Tims.UnitTests.Csv;

public sealed class CsvCellTests
{
    [Theory]
    [InlineData("=cmd|/c calc", "\"'=cmd|/c calc\"")]
    [InlineData("+1", "\"'+1\"")]
    [InlineData("-1", "\"'-1\"")]
    [InlineData("@SUM(A1)", "\"'@SUM(A1)\"")]
    public void Escape_NeutralizesLeadingFormulaChars(string input, string expected)
    {
        Assert.Equal(expected, CsvCell.Escape(input));
    }

    [Fact]
    public void Escape_DoubleQuotesEmbeddedQuotes()
    {
        Assert.Equal("\"Jane \"\"JJ\"\" Doe\"", CsvCell.Escape("Jane \"JJ\" Doe"));
    }

    [Fact]
    public void Escape_NullIsEmptyQuotedCell()
    {
        Assert.Equal("\"\"", CsvCell.Escape(null));
    }

    [Fact]
    public void Row_JoinsEscapedCellsWithCommas()
    {
        Assert.Equal("\"a\",\"'=evil\",\"\"", CsvCell.Row(["a", "=evil", null]));
    }
}
