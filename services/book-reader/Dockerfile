# Build context: repository root (needs ./mvnw and .mvn/).
FROM --platform=$BUILDPLATFORM eclipse-temurin:21.0.12.1_1-jdk AS build
# mvnw needs unzip to verify the pinned .zip distribution (build stage only)
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY mvnw ./
COPY .mvn .mvn
COPY services/book-reader/pom.xml services/book-reader/pom.xml
COPY services/book-reader/src services/book-reader/src
RUN --mount=type=cache,target=/root/.m2 sh ./mvnw -B -ntp -q -f services/book-reader/pom.xml package -DskipTests

# Tesseract 5.5.3 (Tech Stack §7: compiled from the tag, eng + hin from tessdata_best) and cwebp from
# libwebp 1.6.0 (Plan 5.3), built for the target platform on the same base as the runtime image.
# Every download is checked against its SHA-256.
FROM eclipse-temurin:21.0.12.1_1-jre AS tools
ARG TESSERACT_VERSION=5.5.3
ARG TESSERACT_SHA256=9218e62793116d42a9f6d14cd9348518b27f382096eea3d0f2d1a24616bb5884
ARG LIBWEBP_VERSION=1.6.0
ARG LIBWEBP_SHA256=93a852c2b3efafee3723efd4636de855b46f9fe1efddd607e1f42f60fc8f2136
ARG TESSDATA_BEST=4.1.0
ARG ENG_SHA256=8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba
ARG HIN_SHA256=bd2e65a2184af08a167b0be2439e91fa5edbc4394399ca2f692b843ae26e78d6
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake pkg-config curl ca-certificates libleptonica-dev libpng-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL -o tesseract.tar.gz "https://github.com/tesseract-ocr/tesseract/archive/refs/tags/${TESSERACT_VERSION}.tar.gz" \
    && echo "${TESSERACT_SHA256}  tesseract.tar.gz" | sha256sum -c - \
    && tar xzf tesseract.tar.gz \
    && cmake -S tesseract-${TESSERACT_VERSION} -B tesseract-build -DCMAKE_BUILD_TYPE=Release \
         -DCMAKE_INSTALL_PREFIX=/opt/tools -DBUILD_SHARED_LIBS=OFF -DBUILD_TRAINING_TOOLS=OFF \
         -DGRAPHICS_DISABLED=ON -DDISABLE_ARCHIVE=ON -DDISABLE_CURL=ON -DOPENMP_BUILD=OFF -DBUILD_TESTS=OFF \
    && cmake --build tesseract-build -j"$(nproc)" \
    && cmake --install tesseract-build
RUN curl -fsSL -o libwebp.tar.gz "https://github.com/webmproject/libwebp/archive/refs/tags/v${LIBWEBP_VERSION}.tar.gz" \
    && echo "${LIBWEBP_SHA256}  libwebp.tar.gz" | sha256sum -c - \
    && tar xzf libwebp.tar.gz \
    && cmake -S libwebp-${LIBWEBP_VERSION} -B libwebp-build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
         -DWEBP_BUILD_CWEBP=ON -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF \
         -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF \
         -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_LIBWEBPMUX=OFF \
    && cmake --build libwebp-build -j"$(nproc)" --target cwebp \
    && install -m 0755 libwebp-build/cwebp /opt/tools/bin/cwebp
RUN mkdir -p /opt/tools/share/tessdata \
    && curl -fsSL -o /opt/tools/share/tessdata/eng.traineddata "https://github.com/tesseract-ocr/tessdata_best/raw/${TESSDATA_BEST}/eng.traineddata" \
    && curl -fsSL -o /opt/tools/share/tessdata/hin.traineddata "https://github.com/tesseract-ocr/tessdata_best/raw/${TESSDATA_BEST}/hin.traineddata" \
    && echo "${ENG_SHA256}  /opt/tools/share/tessdata/eng.traineddata" | sha256sum -c - \
    && echo "${HIN_SHA256}  /opt/tools/share/tessdata/hin.traineddata" | sha256sum -c -

FROM eclipse-temurin:21.0.12.1_1-jre
# Leptonica (and the image libraries it brings) is what the static tesseract and cwebp still link
RUN apt-get update && apt-get install -y --no-install-recommends libleptonica6 && rm -rf /var/lib/apt/lists/*
COPY --from=tools /opt/tools/bin/tesseract /opt/tools/bin/cwebp /usr/local/bin/
COPY --from=tools /opt/tools/share/tessdata /usr/local/share/tessdata
ENV TESSDATA_PREFIX=/usr/local/share/tessdata
WORKDIR /app
COPY --from=build /src/services/book-reader/target/book-reader-0.0.1-SNAPSHOT.jar app.jar
USER 10001
EXPOSE 8082
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
