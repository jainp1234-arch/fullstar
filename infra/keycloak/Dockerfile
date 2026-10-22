# Build context: repository root (needs ./mvnw and .mvn/).
FROM --platform=$BUILDPLATFORM eclipse-temurin:21.0.12.1_1-jdk AS build
# mvnw needs unzip to verify the pinned .zip distribution (build stage only)
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY mvnw ./
COPY .mvn .mvn
COPY infra/keycloak/email-otp/pom.xml infra/keycloak/email-otp/pom.xml
COPY infra/keycloak/email-otp/src infra/keycloak/email-otp/src
RUN --mount=type=cache,target=/root/.m2 sh ./mvnw -B -ntp -q -f infra/keycloak/email-otp/pom.xml package -DskipTests

FROM quay.io/keycloak/keycloak:26.8.1
COPY --from=build /src/infra/keycloak/email-otp/target/email-otp-0.0.1-SNAPSHOT.jar /opt/keycloak/providers/email-otp.jar
