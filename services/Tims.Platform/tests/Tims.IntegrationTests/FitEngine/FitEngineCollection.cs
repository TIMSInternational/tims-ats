namespace Tims.IntegrationTests.FitEngine;

/// <summary>One container for the whole FIT-engine suite; classes in the collection run sequentially.</summary>
[CollectionDefinition("FitEngine")]
public sealed class FitEngineCollection : ICollectionFixture<FitEngineFixture>;
