# Build context: repository root (needs ./mvnw and .mvn/).
FROM --platform=$BUILDPLATFORM eclipse-temurin:21.0.12.1_1-jdk AS build
# mvnw needs unzip to verify the pinned .zip distribution (build stage only)
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY mvnw ./
COPY .mvn .mvn
COPY services/api/pom.xml services/api/pom.xml
COPY services/api/src services/api/src
RUN --mount=type=cache,target=/root/.m2 sh ./mvnw -B -ntp -q -f services/api/pom.xml package -DskipTests

FROM eclipse-temurin:21.0.12.1_1-jre
WORKDIR /app
COPY --from=build /src/services/api/target/api-0.0.1-SNAPSHOT.jar app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
