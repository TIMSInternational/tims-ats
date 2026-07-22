using Tims.Domain.Reporting;

namespace Tims.Domain.NineBox;

/// <summary>simulate (read #5) result — the simulated quadrant + the two bands.</summary>
public sealed record SimulateBandsResult(string SimulatedQuadrant, string PotentialBand, string PerformanceBand);

/// <summary>getQuadrantPlan (read #9) — the development plan title + actions.</summary>
public sealed record QuadrantPlanResult(string Title, IReadOnlyList<string> Actions);

/// <summary>getBenchStrength (read #10) — quadrant distribution + high-potential rollup.</summary>
public sealed record BenchStrengthResult(
    int Total,
    IReadOnlyDictionary<string, int> Distribution,
    int HighPotentialRatio,
    int BenchStrength);

/// <summary>One endpoint of a nine-box transition (read #4): { period, quadrant }.</summary>
public sealed record MovementEndpoint(string Period, string Quadrant);

/// <summary>A single nine-box quadrant transition (read #4): from → to for one employee.</summary>
public sealed record QuadrantMovement(string UserId, string UserName, MovementEndpoint From, MovementEndpoint To);

/// <summary>computeMovements input row (read #4): the evaluation scalars the movement computation needs.</summary>
public sealed record MovementEvalInput(string UserId, string FirstName, string LastName, string Period, string Quadrant);

/// <summary>
/// Pure nine-box shaping kernels — a faithful port of the pure exports in @tims/shared `ninebox.ts`
/// (Phase-5 nine-box strangler, Slice 10). No DB, no I/O, no clock. Golden-fixtured against the SAME
/// contracts/ninebox-fixtures/*.json the TS exports assert (Tims.UnitTests). The benchStrength percentage
/// uses JS half-UP via <see cref="ReportingMath.JsRound"/> (Math.Floor(x + 0.5)), NOT .NET banker's rounding.
/// </summary>
public static class NineBoxKernels
{
    // Quadrant lookup by potential/performance band (simulate) — byte-identical to @tims/shared.
    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> SimulateQuadrantMap =
        new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal)
        {
            ["high"] = new Dictionary<string, string>(StringComparer.Ordinal) { ["high"] = "star", ["medium"] = "high_potential", ["low"] = "enigma" },
            ["medium"] = new Dictionary<string, string>(StringComparer.Ordinal) { ["high"] = "solid_performer", ["medium"] = "core_player", ["low"] = "inconsistent" },
            ["low"] = new Dictionary<string, string>(StringComparer.Ordinal) { ["high"] = "workhouse", ["medium"] = "underperformer", ["low"] = "risk" },
        };

    // Map quadrant names to grid keys (potential-performance) — byte-identical to @tims/shared. Several
    // quadrants share a cell (solid_performer + consistent_performer → 2-3); an unmapped quadrant falls back
    // to itself (GridPlacement's `?? quadrant`).
    private static readonly IReadOnlyDictionary<string, string> QuadrantToGrid =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["star"] = "3-3",
            ["high_potential"] = "3-2",
            ["enigma"] = "3-1",
            ["solid_performer"] = "2-3",
            ["consistent_performer"] = "2-3",
            ["core_player"] = "2-2",
            ["inconsistent"] = "2-1",
            ["workhouse"] = "1-3",
            ["underperformer"] = "1-2",
            ["risk"] = "1-1",
        };

    // Standard development plans per quadrant — byte-identical Spanish content to @tims/shared (the golden
    // fixture asserts the full plan object, so title + actions must match exactly).
    private static readonly IReadOnlyDictionary<string, QuadrantPlanResult> QuadrantPlans =
        new Dictionary<string, QuadrantPlanResult>(StringComparer.Ordinal)
        {
            ["star"] = new("Retener y Acelerar", ["Asignar proyectos de alta visibilidad", "Incluir en plan de sucesion", "Ofrecer mentoria ejecutiva"]),
            ["high_potential"] = new("Desarrollar Rendimiento", ["Establecer metas desafiantes", "Asignar coaching de desempeno", "Rotacion de roles"]),
            ["enigma"] = new("Evaluar y Orientar", ["Asignar mentor", "Revisar encaje de rol", "Establecer metas a corto plazo"]),
            ["solid_performer"] = new("Reconocer y Desarrollar", ["Reconocimiento publico", "Plan de capacitacion en liderazgo", "Proyectos cross-funcionales"]),
            ["core_player"] = new("Motivar y Crecer", ["Feedback regular", "Capacitacion tecnica", "Metas de estiramiento"]),
            ["inconsistent"] = new("Diagnosticar y Apoyar", ["Identificar barreras", "Plan de mejora con seguimiento", "Evaluar motivacion"]),
            ["workhouse"] = new("Valorar Consistencia", ["Reconocer contribuciones", "Evaluar interes en crecimiento", "Capacitacion selectiva"]),
            ["underperformer"] = new("Plan de Mejora", ["Plan de mejora formal (PIP)", "Coaching intensivo", "Revision en 90 dias"]),
            ["risk"] = new("Accion Inmediata", ["Conversacion de retroalimentacion directa", "PIP con plazos estrictos", "Evaluar reubicacion o salida"]),
        };

    /// <summary>simulate: band thresholds ≥67 high / ≥34 medium / else low → SimulateQuadrantMap.</summary>
    public static SimulateBandsResult SimulateBands(double newPotentialScore, double newPerformanceScore)
    {
        var potentialBand = newPotentialScore >= 67 ? "high" : newPotentialScore >= 34 ? "medium" : "low";
        var performanceBand = newPerformanceScore >= 67 ? "high" : newPerformanceScore >= 34 ? "medium" : "low";
        return new SimulateBandsResult(SimulateQuadrantMap[potentialBand][performanceBand], potentialBand, performanceBand);
    }

    /// <summary>getQuadrantPlan: catalog lookup with the fixed fallback.</summary>
    public static QuadrantPlanResult ResolveQuadrantPlan(string quadrant) =>
        QuadrantPlans.TryGetValue(quadrant, out var plan)
            ? plan
            : new QuadrantPlanResult("Sin plan definido", Array.Empty<string>());

    /// <summary>getBenchStrength: distribution + highPotentialCount (star+high_potential+enigma) + half-up ratio.</summary>
    public static BenchStrengthResult BuildBenchStrength(IReadOnlyList<string> quadrants)
    {
        var distribution = BuildQuadrantDistribution(quadrants);
        var total = quadrants.Count;
        var highPotentialCount =
            (distribution.TryGetValue("star", out var s) ? s : 0)
            + (distribution.TryGetValue("high_potential", out var h) ? h : 0)
            + (distribution.TryGetValue("enigma", out var e) ? e : 0);
        var ratio = total > 0 ? (int)ReportingMath.JsRound((double)highPotentialCount / total * 100) : 0;
        return new BenchStrengthResult(total, distribution, ratio, highPotentialCount);
    }

    /// <summary>getDashboardKpis distribution: quadrant→count in first-seen (insertion) order.</summary>
    public static IReadOnlyDictionary<string, int> BuildQuadrantDistribution(IReadOnlyList<string> quadrants)
    {
        var distribution = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var q in quadrants)
        {
            distribution[q] = distribution.TryGetValue(q, out var c) ? c + 1 : 1;
        }

        return distribution;
    }

    /// <summary>
    /// gridPlacement (read #1): group items by <c>QuadrantToGrid[quadrant] ?? quadrant</c>, PRESERVING the
    /// input order within each key AND the first-seen key insertion order. Generic over the item type — the
    /// repository feeds full evaluations; the golden fixture feeds <c>{ id, quadrant }</c> items.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyList<T>> GridPlacement<T>(
        IReadOnlyList<T> items, Func<T, string> quadrantOf)
    {
        var lists = new Dictionary<string, List<T>>(StringComparer.Ordinal);
        var result = new Dictionary<string, IReadOnlyList<T>>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            var q = quadrantOf(item);
            var key = QuadrantToGrid.TryGetValue(q, out var g) ? g : q;
            if (!lists.TryGetValue(key, out var list))
            {
                list = new List<T>();
                lists[key] = list;
                result[key] = list; // same reference — subsequent Add()s are reflected; preserves first-seen key order
            }

            list.Add(item);
        }

        return result;
    }

    /// <summary>
    /// computeMovements (read #4): input rows are PRE-ORDERED (userId asc, evaluatedAt asc). Group by user
    /// (first-seen user order preserved) and emit a movement for EACH consecutive quadrant CHANGE
    /// (<c>prev.Quadrant != curr.Quadrant</c>) — none when a quadrant repeats. <c>UserName</c> = "First Last".
    /// </summary>
    public static IReadOnlyList<QuadrantMovement> ComputeMovements(IReadOnlyList<MovementEvalInput> evaluations)
    {
        var movements = new List<QuadrantMovement>();

        var byUser = new Dictionary<string, List<MovementEvalInput>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var ev in evaluations)
        {
            if (!byUser.TryGetValue(ev.UserId, out var list))
            {
                list = new List<MovementEvalInput>();
                byUser[ev.UserId] = list;
                order.Add(ev.UserId);
            }

            list.Add(ev);
        }

        foreach (var userId in order)
        {
            var userEvals = byUser[userId];
            for (var i = 1; i < userEvals.Count; i++)
            {
                var prev = userEvals[i - 1];
                var curr = userEvals[i];
                if (!string.Equals(prev.Quadrant, curr.Quadrant, StringComparison.Ordinal))
                {
                    movements.Add(new QuadrantMovement(
                        curr.UserId,
                        $"{curr.FirstName} {curr.LastName}",
                        new MovementEndpoint(prev.Period, prev.Quadrant),
                        new MovementEndpoint(curr.Period, curr.Quadrant)));
                }
            }
        }

        return movements;
    }
}
