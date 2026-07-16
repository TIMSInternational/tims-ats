# WP1.3 — container image for Tims.Api. Multi-stage: SDK builds/publishes, aspnet runs.
# Build context = services/Tims.Platform (so the project graph + lockfiles are present).
#   docker build -f src/Tims.Api/Dockerfile -t tims-platform-api .
#
# OpenApiGenerateDocumentsOnBuild is turned OFF for the image build: the build-time emit
# writes the contract into the repo's contracts/openapi (a dev/CI concern, outside the
# container context). The RUNTIME /openapi endpoint (MapOpenApi) is unaffected.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first (better layer caching): copy the project graph Tims.Api needs.
COPY Directory.Build.props ./
COPY src/Tims.Api/ src/Tims.Api/
COPY src/Tims.Application/ src/Tims.Application/
COPY src/Tims.Domain/ src/Tims.Domain/
COPY src/Tims.Infrastructure/ src/Tims.Infrastructure/

RUN dotnet restore src/Tims.Api/Tims.Api.csproj
RUN dotnet publish src/Tims.Api/Tims.Api.csproj \
      -c Release -o /app/publish \
      -p:OpenApiGenerateDocumentsOnBuild=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish ./

# Non-root runtime user (the aspnet image ships an `app` user).
USER app
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "Tims.Api.dll"]
