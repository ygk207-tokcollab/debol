package com.kidsstore.security

import com.fasterxml.jackson.databind.ObjectMapper
import com.kidsstore.common.Tokens
import com.kidsstore.config.AppProperties
import com.kidsstore.domain.AdminRole
import com.kidsstore.domain.SessionSource
import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import org.slf4j.LoggerFactory
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.stereotype.Component
import java.time.Duration
import java.time.Instant
import java.util.Date
import javax.crypto.SecretKey

/** Authenticated admin, carried in the SecurityContext for every admin request. */
data class AdminPrincipal(
    val id: Long,
    val email: String,
    val fullName: String,
    val role: AdminRole,
    val tokenVersion: Int,
) {
    val actorEmail: String get() = "$fullName <$email>"
}

/** Authenticated storefront customer (Telegram account or browser phone session). */
data class CustomerPrincipal(
    val customerId: Long,
    val phone: String,
    val source: SessionSource,
    val telegramUserId: Long?,
    val sessionTokenHash: String,
)

object Roles {
    fun authoritiesFor(role: AdminRole): List<SimpleGrantedAuthority> = when (role) {
        // OWNER and MANAGER both inherit staff permissions so one hierarchy is enough.
        AdminRole.OWNER -> listOf("ROLE_OWNER", "ROLE_MANAGER", "ROLE_STAFF")
        AdminRole.MANAGER -> listOf("ROLE_MANAGER", "ROLE_STAFF")
        AdminRole.DELIVERY_STAFF -> listOf("ROLE_STAFF")
    }.map { SimpleGrantedAuthority(it) }
}

@Component
open class JwtService(private val props: AppProperties) {
    private val log = LoggerFactory.getLogger(javaClass)

    private val key: SecretKey by lazy {
        val secret = props.security.jwtSecret
        require(secret.toByteArray(Charsets.UTF_8).size >= 32) {
            "kidsstore.security.jwt-secret must be at least 32 bytes (set JWT_SECRET)"
        }
        Keys.hmacShaKeyFor(secret.toByteArray(Charsets.UTF_8))
    }

    fun issueAdminToken(id: Long, email: String, fullName: String, role: AdminRole, tokenVersion: Int): String {
        val now = Instant.now()
        return Jwts.builder()
            .subject(id.toString())
            .claim("kind", "admin")
            .claim("email", email)
            .claim("name", fullName)
            .claim("role", role.name)
            .claim("tv", tokenVersion)
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(Duration.ofMinutes(props.security.adminTokenMinutes))))
            .signWith(key)
            .compact()
    }

    fun issueCustomerToken(customerId: Long, telegramUserId: Long?, source: SessionSource, sessionHash: String): String {
        val now = Instant.now()
        return Jwts.builder()
            .subject(customerId.toString())
            .claim("kind", "customer")
            .claim("src", source.name)
            .claim("sid", sessionHash)
            .apply { telegramUserId?.let { claim("tg", it) } }
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(Duration.ofDays(props.security.customerTokenDays))))
            .signWith(key)
            .compact()
    }

    fun claims(token: String): Map<String, Any>? = try {
        Jwts.parser().verifyWith(key).build().parseSignedClaims(token).payload
    } catch (ex: Exception) {
        log.debug("Rejected bearer token: {}", ex.message)
        null
    }

    companion object {
        fun tokenHash(raw: String): String = Tokens.sha256Hex(raw)
    }
}

/**
 * Small helper so controllers can read the current actor without duplicating casts. The principal
 * is checked against a concrete runtime type: an anonymous request carries the String "anonymousUser",
 * and a generic `as? T` would let that through because T is erased.
 */
object Actor {
    private fun current(): Any? =
        org.springframework.security.core.context.SecurityContextHolder.getContext()?.authentication?.principal

    fun adminOrNull(): AdminPrincipal? = current() as? AdminPrincipal
    fun requireAdmin(): AdminPrincipal =
        adminOrNull() ?: throw com.kidsstore.common.forbidden("Administrator login required", "admin_only")

    fun customerOrNull(): CustomerPrincipal? = current() as? CustomerPrincipal
    fun requireCustomer(): CustomerPrincipal =
        customerOrNull() ?: throw com.kidsstore.common.forbidden("Customer sign-in required", "customer_only")
}

@Component
open class Json(private val mapper: ObjectMapper) {
    fun write(value: Any?): String? = value?.let {
        try {
            mapper.writeValueAsString(it)
        } catch (ex: Exception) {
            null
        }
    }
}
