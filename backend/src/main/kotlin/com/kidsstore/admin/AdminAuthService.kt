package com.kidsstore.admin

import com.kidsstore.common.ApiException
import com.kidsstore.common.FieldMessage
import com.kidsstore.common.badRequest
import com.kidsstore.common.unauthorized
import com.kidsstore.config.AppProperties
import com.kidsstore.domain.AdminRole
import com.kidsstore.domain.Administrator
import com.kidsstore.repo.AdministratorRepository
import com.kidsstore.security.JwtService
import com.kidsstore.security.RateLimiter
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.http.HttpStatus
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.OffsetDateTime

data class AdminLoginRequest(
    @field:NotBlank @field:Email val email: String = "",
    @field:NotBlank val password: String = "",
)

data class AdminSessionResponse(
    val token: String,
    val fullName: String,
    val email: String,
    val role: AdminRole,
    val permissions: List<String>,
)

@Service
open class AdminAuthService(
    private val administrators: AdministratorRepository,
    private val passwordEncoder: PasswordEncoder,
    private val jwtService: JwtService,
    private val rateLimiter: RateLimiter,
    private val props: AppProperties,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional
    open fun login(request: AdminLoginRequest, http: HttpServletRequest): AdminSessionResponse {
        rateLimiter.check(RateLimiter.Kind.ADMIN_LOGIN, http.remoteAddr ?: "unknown")
        val admin = administrators.findByEmailIgnoreCase(request.email)
        // Same message for unknown email and bad password: no account enumeration.
        if (admin == null || !admin.active || !passwordEncoder.matches(request.password, admin.passwordHash)) {
            log.info("Failed admin login attempt for {}", request.email)
            throw unauthorized("Email or password is incorrect")
        }
        admin.lastLoginAt = OffsetDateTime.now()
        administrators.save(admin)
        val token = jwtService.issueAdminToken(admin.id!!, admin.email, admin.fullName, admin.role, admin.tokenVersion)
        return AdminSessionResponse(token, admin.fullName, admin.email, admin.role, permissionsOf(admin.role))
    }

    /** Local-only sign-in so the panel can be developed without seeding credentials. */
    @Transactional
    open fun devLogin(http: HttpServletRequest): AdminSessionResponse {
        if (!props.security.devAuthEnabled) {
            throw ApiException(HttpStatus.FORBIDDEN, "dev_login_disabled", "Development sign-in is disabled")
        }
        rateLimiter.check(RateLimiter.Kind.ADMIN_LOGIN, http.remoteAddr ?: "unknown")
        val owner = administrators.findAllActive().firstOrNull { it.role == AdminRole.OWNER }
            ?: throw badRequest("no_owner", "No administrator exists yet")
        val token = jwtService.issueAdminToken(owner.id!!, owner.email, owner.fullName, owner.role, owner.tokenVersion)
        return AdminSessionResponse(token, owner.fullName, owner.email, owner.role, permissionsOf(owner.role))
    }

    open fun permissionsOf(role: AdminRole): List<String> = when (role) {
        AdminRole.OWNER -> listOf("dashboard", "products", "orders", "inventory", "settings", "telegram", "administrators", "audit")
        AdminRole.MANAGER -> listOf("dashboard", "products", "orders", "inventory", "delivery_zones", "notifications", "audit")
        AdminRole.DELIVERY_STAFF -> listOf("dashboard", "orders")
    }
}

/**
 * Seeds the first OWNER account from environment variables. Nothing is committed to source control,
 * and a missing configuration is surfaced loudly instead of silently creating weak credentials.
 */
@Component
open class AdminBootstrap(
    private val administrators: AdministratorRepository,
    private val passwordEncoder: PasswordEncoder,
    private val props: AppProperties,
) : ApplicationRunner {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional
    override fun run(args: ApplicationArguments) {
        if (administrators.count() > 0) return
        val email = props.store.bootstrapAdminEmail.trim()
        val password = props.store.bootstrapAdminPassword
        if (email.isBlank() || password.isBlank()) {
            log.warn("No administrator exists. Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD to create the first OWNER account.")
            return
        }
        if (password.length < 10) {
            log.error("Refusing to bootstrap an administrator: ADMIN_BOOTSTRAP_PASSWORD must be at least 10 characters")
            return
        }
        administrators.save(
            Administrator().apply {
                this.email = email.lowercase()
                this.fullName = props.store.bootstrapAdminName.ifBlank { "Store owner" }
                this.phone = props.telegram.adminContactPhone
                this.passwordHash = passwordEncoder.encode(password)
                this.role = AdminRole.OWNER
                this.active = true
                this.createdAt = OffsetDateTime.now()
            }
        )
        log.info("Bootstrapped initial OWNER account for {}", email.lowercase())
    }
}
