# Gradle downloads its distribution and dependencies from Maven Central, so this build needs
# network access. Building in a repo checked out with an offline Gradle cache will fail.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY build.gradle.kts settings.gradle.kts gradle.properties gradlew ./
COPY gradle ./gradle
COPY src ./src
# `sh gradlew` because zip/Windows checkouts drop the executable bit; -plain.jar is the thin jar.
RUN sh gradlew --no-daemon bootJar -x test \
 && mv "$(find build/libs -name '*.jar' ! -name '*-plain.jar' | head -1)" /app.jar

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /app.jar /app/app.jar
# Render mounts Disks root-owned and gives no uid option, so the process has to be able to write
# the mount. On a host where you control volume ownership, prefer a non-root USER + chown.
ENV STORAGE_LOCAL_DIR=/app/data/uploads
EXPOSE 10000
# Render injects PORT; the flag outranks application.yml's ${SERVER_PORT:8080}.
CMD java -XX:MaxRAMPercentage=75 -jar /app/app.jar --server.port="${PORT:-10000}"
