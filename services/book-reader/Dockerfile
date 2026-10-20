# Build context: repository root (needs ./mvnw and .mvn/).
FROM --platform=$BUILDPLATFORM eclipse-temurin:24.0.2_12-jdk AS build
# mvnw needs unzip to verify the pinned .zip distribution (build stage only)
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY mvnw ./
COPY .mvn .mvn
COPY services/book-reader/pom.xml services/book-reader/pom.xml
COPY services/book-reader/src services/book-reader/src
RUN --mount=type=cache,target=/root/.m2 sh ./mvnw -B -ntp -q -f services/book-reader/pom.xml package -DskipTests

FROM eclipse-temurin:24.0.2_12-jre
WORKDIR /app
COPY --from=build /src/services/book-reader/target/book-reader-0.0.1-SNAPSHOT.jar app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
