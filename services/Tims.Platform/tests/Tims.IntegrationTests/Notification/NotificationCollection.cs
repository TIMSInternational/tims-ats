namespace Tims.IntegrationTests.Notification;

/// <summary>One container for the whole notification suite; classes in the collection run sequentially.</summary>
[CollectionDefinition("Notification")]
public sealed class NotificationCollection : ICollectionFixture<NotificationFixture>;
