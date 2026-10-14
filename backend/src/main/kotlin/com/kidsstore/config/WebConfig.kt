package com.kidsstore.config

import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.info.Info
import io.swagger.v3.oas.models.security.SecurityRequirement
import io.swagger.v3.oas.models.security.SecurityScheme
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import java.nio.file.Paths

@Configuration
open class WebConfig(private val props: AppProperties) : WebMvcConfigurer {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * Uploads live in the configured directory and are read back through this mapping, so no
     * filesystem path is ever returned to the browser.
     */
    override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
        val dir = Paths.get(props.storage.localDir).toAbsolutePath().normalize()
        log.info("Serving {} from {}", props.storage.publicBaseUrl, dir)
        registry.addResourceHandler("${props.storage.publicBaseUrl.trimEnd('/')}/**")
            .addResourceLocations(dir.toUri().toString())
            .setCachePeriod(3600)
    }

    @Bean
    open fun jsonCustomizer(): Jackson2ObjectMapperBuilderCustomizer = Jackson2ObjectMapperBuilderCustomizer { builder ->
        builder.modulesToInstall(JavaTimeModule())
        builder.featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    }

    @Bean
    open fun apiInfo(): OpenAPI = OpenAPI()
        .info(Info().title("Kids Store API").version("v1")
            .description("Telegram Mini App storefront, cash-on-delivery orders and admin control panel"))
        .components(Components().addSecuritySchemes("bearerAuth",
            SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")))
        .addSecurityItem(SecurityRequirement().addList("bearerAuth"))
}
