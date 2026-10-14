import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

// Plugins are resolved from Maven Central (the Gradle plugin portal is unreachable from this
// network), so the classic buildscript/apply mechanism is used instead of the plugins {} DSL.
buildscript {
    repositories { mavenCentral() }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21")
        classpath("org.springframework.boot:spring-boot-gradle-plugin:3.5.15")
        classpath("io.spring.gradle:dependency-management-plugin:1.1.7")
    }
}

apply(plugin = "org.jetbrains.kotlin.jvm")
apply(plugin = "java")
apply(plugin = "io.spring.dependency-management")
apply(plugin = "org.springframework.boot")

group = "com.kidsstore"
version = "0.1.0"

repositories { mavenCentral() }

dependencies {
    "implementation"("org.springframework.boot:spring-boot-starter-web")
    "implementation"("org.springframework.boot:spring-boot-starter-data-jpa")
    "implementation"("org.springframework.boot:spring-boot-starter-security")
    "implementation"("org.springframework.boot:spring-boot-starter-validation")
    "implementation"("org.springframework.boot:spring-boot-starter-actuator")
    "implementation"("com.fasterxml.jackson.module:jackson-module-kotlin")
    "implementation"("org.jetbrains.kotlin:kotlin-reflect")
    "implementation"("org.flywaydb:flyway-core")
    "implementation"("org.flywaydb:flyway-database-postgresql")
    "implementation"("io.jsonwebtoken:jjwt-api:0.12.6")
    "runtimeOnly"("io.jsonwebtoken:jjwt-impl:0.12.6")
    "runtimeOnly"("io.jsonwebtoken:jjwt-jackson:0.12.6")
    "implementation"("org.springdoc:springdoc-openapi-starter-webmvc-ui:2.8.17")
    "runtimeOnly"("org.postgresql:postgresql")

    "testImplementation"("org.springframework.boot:spring-boot-starter-test")
    "testImplementation"("org.springframework.security:spring-security-test")
    // NOTE: kotlin-test-junit5 was intentionally not added. The Kotlin plugin aligns every
    // org.jetbrains.kotlin:kotlin-test* module to the compiler version (2.0.21), which is not in the
    // offline cache (only 2.0.0 is). Tests use the JUnit 5 assertions from spring-boot-starter-test.
    "testImplementation"("org.junit.jupiter:junit-jupiter-api")
    "testImplementation"("org.junit.jupiter:junit-jupiter-params")
    "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
}

// Imperative apply() means the generated `java { }` accessor does not exist, so configure by type.
extensions.configure(JavaPluginExtension::class.java) {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

// Entities declare every mapped property as `open var`: Hibernate proxies lazy classes and
// rejects final getters. The usual fix is the allopen compiler plugin, but its Gradle artifact is
// not resolvable from Maven Central here, so the modifier is written out instead.

tasks.withType<KotlinCompile> {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        javaParameters.set(true)
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
    maxHeapSize = "1024m"
    systemProperty("spring.profiles.active", "test")
}

configure<io.spring.gradle.dependencymanagement.dsl.DependencyManagementExtension> {
    imports {
        mavenBom("org.springframework.boot:spring-boot-dependencies:3.5.15")
    }
}
