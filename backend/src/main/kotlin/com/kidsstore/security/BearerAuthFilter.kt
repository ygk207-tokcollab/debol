package com.kidsstore.security

import com.kidsstore.domain.SessionSource
import com.kidsstore.repo.AdministratorRepository
import com.kidsstore.repo.CustomerRepository
import com.kidsstore.repo.CustomerSessionRepository
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/**
 * Turns a bearer JWT into an AdminPrincipal or CustomerPrincipal. Tokens are checked against the
 * database so a deactivated administrator, a bumped token_version, or a revoked customer session
 * loses access immediately instead of waiting for expiry.
 */
@Component
open class BearerAuthFilter(
    private val jwtService: JwtService,
    private val administrators: AdministratorRepository,
    private val customers: CustomerRepository,
    private val sessions: CustomerSessionRepository,
) : OncePerRequestFilter() {

    private val log = LoggerFactory.getLogger(javaClass)

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        val token = request.getHeader("Authorization")?.takeIf { it.startsWith("Bearer ") }?.removePrefix("Bearer ")
        if (token != null && SecurityContextHolder.getContext().authentication == null) {
            val claims = jwtService.claims(token)
            if (claims != null) {
                val principal = when (claims["kind"]) {
                    "admin" -> adminPrincipal(claims)
                    "customer" -> customerPrincipal(claims)
                    else -> null
                }
                if (principal != null) {
                    val authorities = when (principal) {
                        is AdminPrincipal -> Roles.authoritiesFor(principal.role)
                        else -> listOf(org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_CUSTOMER"))
                    }
                    SecurityContextHolder.getContext().authentication =
                        UsernamePasswordAuthenticationToken(principal, null, authorities)
                }
            }
        }
        chain.doFilter(request, response)
    }

    private fun adminPrincipal(claims: Map<String, Any>): AdminPrincipal? {
        val id = claims["sub"]?.toString()?.toLongOrNull() ?: return null
        val admin = administrators.findById(id).orElse(null) ?: return null
        if (!admin.active) return null
        val tokenVersion = (claims["tv"] as? Number)?.toInt() ?: -1
        if (tokenVersion != admin.tokenVersion) {
            log.debug("Rejected admin token with stale version for {}", admin.email)
            return null
        }
        return AdminPrincipal(
            id = admin.id!!,
            email = admin.email,
            fullName = admin.fullName,
            role = admin.role,
            tokenVersion = admin.tokenVersion,
        )
    }

    private fun customerPrincipal(claims: Map<String, Any>): CustomerPrincipal? {
        val id = claims["sub"]?.toString()?.toLongOrNull() ?: return null
        val customer = customers.findById(id).orElse(null) ?: return null
        val sessionHash = claims["sid"]?.toString() ?: return null
        val session = sessions.findByTokenHash(sessionHash) ?: return null
        if (session.revoked || session.customer?.id != customer.id) return null
        if (session.expiresAt.isBefore(java.time.OffsetDateTime.now())) return null
        return CustomerPrincipal(
            customerId = customer.id!!,
            phone = customer.phone,
            source = session.source,
            telegramUserId = session.telegramUserId ?: (claims["tg"] as? Number)?.toLong(),
            sessionTokenHash = sessionHash,
        )
    }
}
