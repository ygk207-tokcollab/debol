package com.kidsstore.security

import com.kidsstore.common.ApiException
import com.kidsstore.common.Tokens
import com.kidsstore.common.badRequest
import com.kidsstore.config.AppProperties
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import java.net.URLDecoder
import java.time.Duration
import java.time.Instant

/**
 * Telegram's documented Mini App initData verification:
 *   secret = HMAC_SHA256(key = "WebAppData", data = botToken)
 *   check  = HMAC_SHA256(key = secret, data = sorted "k=v" lines joined by \n, excluding `hash`)
 * A frontend-supplied Telegram user id is never accepted without this check.
 */
data class TelegramUser(
    val telegramUserId: Long,
    val firstName: String?,
    val lastName: String?,
    val username: String?,
    val languageCode: String?,
    val photoUrl: String?,
)

@Component
open class TelegramInitDataVerifier(private val props: AppProperties) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val mapper = com.fasterxml.jackson.databind.ObjectMapper()

    data class Verified(val user: TelegramUser, val authDate: Long, val startParam: String?)

    fun verify(initData: String): Verified {
        if (initData.isBlank()) throw badRequest("invalid_init_data", "Empty Telegram init data")
        val params = parseQuery(initData)
        val hash = params["hash"] ?: throw badRequest("invalid_init_data", "Missing hash in Telegram init data")
        val botToken = props.telegram.botToken
            ?: throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, "telegram_not_configured",
                "Telegram bot is not configured on this server")

        val authDate = params["auth_date"]?.toLongOrNull()
            ?: throw badRequest("invalid_init_data", "Missing auth_date in Telegram init data")
        val maxAge = props.security.initDataMaxAgeSeconds
        if (maxAge > 0 && Instant.now().epochSecond - authDate > maxAge) {
            throw badRequest("init_data_expired", "Telegram session data expired, please reopen the app")
        }

        val dataCheckString = params.entries
            .filter { (key, _) -> key != "hash" }
            .sortedBy { it.key }
            .joinToString("\n") { (key, value) -> "$key=$value" }

        val secret = hmac("WebAppData".toByteArray(Charsets.UTF_8), botToken.toByteArray(Charsets.UTF_8))
        val calculated = hmac(secret, dataCheckString.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

        if (!Tokens.constantTimeEquals(calculated, hash.lowercase())) {
            log.warn("Rejected Telegram initData: signature mismatch")
            throw ApiException(HttpStatus.UNAUTHORIZED, "invalid_init_data", "Telegram init data did not verify")
        }

        val userJson = params["user"] ?: throw badRequest("invalid_init_data", "Missing user in Telegram init data")
        val user = parseUser(userJson) ?: throw badRequest("invalid_init_data", "Malformed Telegram user payload")
        return Verified(user, authDate, params["start_param"])
    }

    private fun parseQuery(raw: String): Map<String, String> =
        raw.split("&").mapNotNull { pair ->
            val idx = pair.indexOf('=')
            if (idx <= 0) null
            else pair.substring(0, idx) to URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
        }.toMap()

    private fun parseUser(json: String): TelegramUser? = try {
        val node = mapper.readTree(json)
        val id = node.get("id")?.asLong() ?: return null
        TelegramUser(
            telegramUserId = id,
            firstName = node.get("first_name")?.asText(),
            lastName = node.get("last_name")?.asText(),
            username = node.get("username")?.asText(),
            languageCode = node.get("language_code")?.asText(),
            photoUrl = node.get("photo_url")?.asText(),
        )
    } catch (ex: Exception) {
        null
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(javax.crypto.spec.SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }
}

/**
 * Fixed-window limiter for the endpoints that matter (admin login, customer auth, checkout).
 * In-memory on purpose for a single instance; Redis-backed limiting is noted for multi-instance
 * deployments.
 */
@Component
open class RateLimiter(private val props: AppProperties) {
    private val log = LoggerFactory.getLogger(javaClass)

    enum class Kind { ADMIN_LOGIN, CUSTOMER_AUTH, CHECKOUT }

    private class Window(var count: Int, var windowStartedAt: Long)

    private val buckets = java.util.concurrent.ConcurrentHashMap<String, Window>()

    fun check(kind: Kind, clientKey: String) {
        val now = System.currentTimeMillis()
        if (buckets.size > 5000) {
            buckets.entries.removeIf { now - it.value.windowStartedAt > Duration.ofMinutes(5).toMillis() }
        }
        val key = "${kind.name}:$clientKey"
        val window = buckets.compute(key) { _, existing ->
            if (existing == null || now - existing.windowStartedAt > Duration.ofMinutes(1).toMillis()) {
                Window(1, now)
            } else {
                existing.count += 1
                existing
            }
        }!!
        if (window.count > limitFor(kind)) {
            log.warn("Rate limit exceeded for {} {}", kind, clientKey)
            throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited",
                "Too many attempts, please wait a minute")
        }
    }

    private fun limitFor(kind: Kind): Int = when (kind) {
        Kind.ADMIN_LOGIN, Kind.CUSTOMER_AUTH -> props.security.loginAttemptsPerMinute
        Kind.CHECKOUT -> props.security.checkoutAttemptsPerMinute
    }
}
