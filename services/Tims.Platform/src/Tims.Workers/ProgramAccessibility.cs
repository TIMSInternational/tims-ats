// The .NET 10 SDK emits the top-level-statement entry-point `Program` as PUBLIC. Tims.IntegrationTests
// references BOTH host assemblies, and Tims.Api exposes its own public global `Program` — so an unqualified
// `Program` (e.g. WebApplicationFactory<Program> in ApiSmokeTests) would be AMBIGUOUS (CS0433). Pairing the
// synthesized Program with this explicit INTERNAL partial forces the Workers entry point internal, so it is
// invisible cross-assembly and only Tims.Api's public `Program` resolves. The worker's own integration tests
// target the public WorkerHostMarker instead. Keeping Program internal is the documented WebApplicationFactory
// convention; this only counteracts the SDK's public default.
internal partial class Program;
