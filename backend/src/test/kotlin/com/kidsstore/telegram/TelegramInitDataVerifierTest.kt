package com.kidsstore.telegram

import com.kidsstore.common.ApiException
import com.kidsstore.config.AppProperties
import com.kidsstore.security.TelegramInitDataVerifier
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.URLEncoder
import java.time.Instant
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Telegram Mini App initData must be proven by the documented HMAC chain, never by a user id a
 * frontend claims. These tests build genuinely signed payloads and then break them.
 */
class TelegramInitDataVerifierTest {

    private val botToken = "123456:TEST-token-not-real"

    private fun props(maxAge: Long, token: String?): AppProperties = AppProperties().apply {
        telegram.botToken = token
        security.initDataMaxAgeSeconds = maxAge
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data)

    /** Reproduces Telegram's signing: secret = HMAC(WebAppData, token); hash = HMAC(secret, checkstring). */
    private fun sign(userJson: String, authDate: Long, token: String): String {
        val dataCheckString = "auth_date=$authDate\nuser=$userJson"
        val secret = hmac("WebAppData".toByteArray(Charsets.UTF_8), token.toByteArray(Charsets.UTF_8))
        val hash = hmac(secret, dataCheckString.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        val encodedUser = URLEncoder.encode(userJson, "UTF-8")
        return "auth_date=$authDate&user=$encodedUser&hash=$hash"
    }

    private val userJson = """{"id":424242,"first_name":"Selam","username":"selam_k"}"""

    @Test
    fun `a correctly signed initData verifies and exposes the user id`() {
        val verifier = TelegramInitDataVerifier(props(maxAge = 86400, token = botToken))
        val verified = verifier.verify(sign(userJson, Instant.now().epochSecond, botToken))
        assertEquals(424242L, verified.user.telegramUserId)
        assertEquals("Selam", verified.user.firstName)
        assertNotNull(verified.user.username)
    }

    @Test
    fun `a tampered hash is rejected`() {
        val signed = sign(userJson, Instant.now().epochSecond, botToken)
        val tampered = signed.replaceAfterLast("hash=", "deadbeef" + signed.substringAfter("hash=").drop(8))
        val verifier = TelegramInitDataVerifier(props(maxAge = 86400, token = botToken))
        val ex = assertThrows(ApiException::class.java) { verifier.verify(tampered) }
        assertEquals("invalid_init_data", ex.code)
        assertEquals(401, ex.status.value())
    }

    @Test
    fun `a payload signed with the wrong bot token is rejected`() {
        val signed = sign(userJson, Instant.now().epochSecond, "999999:OTHER-token")
        val verifier = TelegramInitDataVerifier(props(maxAge = 86400, token = botToken))
        val ex = assertThrows(ApiException::class.java) { verifier.verify(signed) }
        assertEquals(401, ex.status.value())
    }

    @Test
    fun `an auth_date older than the configured max age is rejected`() {
        val longAgo = Instant.now().epochSecond - 200_000
        val signed = sign(userJson, longAgo, botToken)
        val verifier = TelegramInitDataVerifier(props(maxAge = 86400, token = botToken))
        val ex = assertThrows(ApiException::class.java) { verifier.verify(signed) }
        assertEquals("init_data_expired", ex.code)
    }

    @Test
    fun `a bare telegram user id without a hash is never treated as identity`() {
        val verifier = TelegramInitDataVerifier(props(maxAge = 86400, token = botToken))
        val unsigned = "auth_date=${Instant.now().epochSecond}&user=" + URLEncoder.encode(userJson, "UTF-8")
        val ex = assertThrows(ApiException::class.java) { verifier.verify(unsigned) }
        assertEquals("invalid_init_data", ex.code)
        assertTrue(ex.message!!.contains("hash", ignoreCase = true))
    }

    @Test
    fun `empty init data is rejected`() {
        val verifier = TelegramInitDataVerifier(props(maxAge = 86400, token = botToken))
        assertThrows(ApiException::class.java) { verifier.verify("   ") }
    }
}
