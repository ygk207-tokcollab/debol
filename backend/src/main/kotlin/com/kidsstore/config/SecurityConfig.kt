package com.kidsstore.config

import com.kidsstore.common.ErrorResponse
import com.kidsstore.security.BearerAuthFilter
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.cors.UrlBasedCorsConfigurationSource

@Configuration
@EnableConfigurationProperties(AppProperties::class)
@EnableMethodSecurity
open class SecurityConfig(private val props: AppProperties, private val environment: Environment) {

    private val mapper = ObjectMapper()

    @Bean
    open fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder(12)

    @Bean
    open fun securityFilterChain(http: HttpSecurity, bearerAuthFilter: BearerAuthFilter): SecurityFilterChain {
        http
            .csrf { it.disable() }
            .cors { it.configurationSource(corsConfigurationSource()) }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .httpBasic { it.disable() }
            .formLogin { it.disable() }
            .authorizeHttpRequests { auth ->
                auth
                    // ---- public storefront reads ----
                    .requestMatchers(
                        "/api/v1/store", "/api/v1/store/**", "/api/v1/categories/**", "/api/v1/products/**",
                        "/api/v1/collections/**", "/api/v1/banners", "/api/v1/delivery-zones",
                        "/api/v1/size-guides/**", "/api/v1/media/**",
                        "/api/v1/age-groups", "/api/v1/age-groups/**",
                    ).permitAll()
                    // ---- public customer actions ----
                    .requestMatchers(HttpMethod.POST, "/api/v1/telegram/auth").permitAll()
                    .requestMatchers("/api/v1/customers/auth/**").permitAll()
                    .requestMatchers("/api/v1/cart/**").permitAll()
                    .requestMatchers("/api/v1/checkout/**").permitAll()
                    .requestMatchers("/api/v1/orders/track/**").permitAll()
                    // ---- admin login ----
                    .requestMatchers(HttpMethod.POST, "/api/v1/admin/auth/login").permitAll()
                    .requestMatchers(HttpMethod.POST, "/api/v1/admin/auth/dev-login").permitAll()
                    // ---- admin control panel: role based ----
                    .requestMatchers("/api/v1/admin/auth/**").authenticated()
                    .requestMatchers("/api/v1/admin/orders/**").hasRole("STAFF")
                    .requestMatchers("/api/v1/admin/notifications/**").hasRole("MANAGER")
                    .requestMatchers("/api/v1/admin/audit/**").hasRole("MANAGER")
                    .requestMatchers("/api/v1/admin/delivery-zones/**").hasRole("MANAGER")
                    .requestMatchers("/api/v1/admin/dashboard/**").hasRole("STAFF")
                    .requestMatchers("/api/v1/admin/settings/**", "/api/v1/admin/telegram/**", "/api/v1/admin/administrators/**")
                    .hasRole("OWNER")
                    .requestMatchers("/api/v1/admin/**").hasRole("MANAGER")
                    // ---- customer private data ----
                    .requestMatchers("/api/v1/me/**").hasRole("CUSTOMER")
                    .requestMatchers("/actuator/health/**", "/actuator/info").permitAll()
                    .requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                    .anyRequest().denyAll()
            }
            .addFilterBefore(bearerAuthFilter, UsernamePasswordAuthenticationFilter::class.java)
            .exceptionHandling { handling ->
                handling.authenticationEntryPoint { _, response, _ ->
                    response.status = 401
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    response.writer.write(mapper.writeValueAsString(ErrorResponse("unauthorized", "Authentication required")))
                }
                handling.accessDeniedHandler { _, response, _ ->
                    response.status = 403
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    response.writer.write(mapper.writeValueAsString(ErrorResponse("forbidden", "Your account may not do this")))
                }
            }
        return http.build()
    }

    @Bean
    open fun corsConfigurationSource(): CorsConfigurationSource {
        val config = CorsConfiguration()
        config.allowedOrigins = props.security.allowedOrigins
        config.allowedMethods = listOf("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS")
        config.allowedHeaders = listOf("Authorization", "Content-Type", "X-Cart-Key", "X-Idempotency-Key")
        config.exposedHeaders = listOf("X-Idempotency-Replayed")
        config.allowCredentials = false
        config.maxAge = 3600
        return UrlBasedCorsConfigurationSource().apply { registerCorsConfiguration("/api/**", config) }
    }

    /**
     * Dev authentication must never leak into production: startup fails if it is enabled while a
     * production profile is active.
     */
    @Bean
    open fun devAuthGuard(): String {
        val prodLike = environment.activeProfiles.any { it.equals("prod", ignoreCase = true) || it.equals("production", ignoreCase = true) }
        if (prodLike && props.security.devAuthEnabled) {
            throw IllegalStateException("kidsstore.security.dev-auth-enabled cannot be true under a prod profile")
        }
        return "ok"
    }
}
