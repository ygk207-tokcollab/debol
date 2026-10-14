package com.kidsstore.telegram

import com.kidsstore.domain.OutboxStatus
import com.kidsstore.support.AbstractIntegrationTest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.math.BigDecimal

/**
 * Transactional-outbox resilience: with the Telegram endpoint unreachable, the order still commits
 * and the notification row survives for retry with the attempt count and error recorded. Uses the
 * injectable apiBaseUrl pointed at an unroutable port so no real Telegram server is contacted.
 *
 * Deliberately NOT @Transactional: the dispatcher reads due rows in REQUIRES_NEW transactions, so
 * the order and outbox row must be committed to be visible. Created rows are cleaned up afterwards.
 */
class OutboxResilienceIntegrationTest : AbstractIntegrationTest() {

    private var createdOrderId: Long? = null
    private var createdProductId: Long? = null
    private var createdCustomerPhone: String? = null

    private val originalEnabled get() = props.telegram.enabled
    private val originalToken get() = props.telegram.botToken
    private val originalBase get() = props.telegram.apiBaseUrl

    @AfterEach
    fun restoreWorld() {
        // Put the shared singleton config and the seeded store row back to their defaults.
        props.telegram.enabled = false
        props.telegram.botToken = null
        props.telegram.apiBaseUrl = "https://api.telegram.org"
        runCatching {
            val s = storeConfig.settings()
            s.telegramSetupComplete = false
            s.telegramChatId = null
            storeConfig.save(s)
        }
        createdOrderId?.let { runCatching { jdbcTemplate.update("delete from orders where id = ?", it) } }
        createdCustomerPhone?.let { runCatching { jdbcTemplate.update("delete from customer where phone = ?", it) } }
        createdProductId?.let { runCatching { jdbcTemplate.update("delete from product where id = ?", it) } }
    }

    @Test
    fun `a committed order keeps its outbox row for retry when telegram is unreachable`() {
        val settings = storeConfig.settings()
        settings.telegramEnabled = true
        settings.telegramSetupComplete = true
        settings.telegramChatId = 987654L
        storeConfig.save(settings)

        props.telegram.enabled = true
        props.telegram.botToken = "123456:unreachable-test-token"
        props.telegram.apiBaseUrl = "http://127.0.0.1:1" // connection refused: no real Telegram call

        val variant = createProductWithStock(BigDecimal("100.00"), 10)
        createdProductId = variant.product?.id
        val phone = "09" + (System.currentTimeMillis() % 100_000_000).toString().padStart(8, '0')
        createdCustomerPhone = phone
        val res = checkout(newCartKey(), variant.id!!, 2, phone = phone)
        val order = orders.findByOrderNumber(res.orderNumber)!!
        createdOrderId = order.id

        assertEquals(
            1,
            jdbcTemplate.queryForObject("select count(*) from orders where id = ?", Int::class.java, order.id),
            "the order must be committed regardless of Telegram availability",
        )

        // Fire the dispatcher against the unreachable endpoint.
        dispatcher.dispatch()

        val row = outbox.findByIdempotencyKey("NEW_ORDER:ORDER:${order.id}")
        assertNotNull(row, "the NEW_ORDER outbox row must still exist after a failed send")
        assertTrue(
            row!!.status == OutboxStatus.RETRY || row.status == OutboxStatus.DEAD_LETTER,
            "a retryable failure keeps the row pending for retry, got ${row.status}",
        )
        assertTrue(row.attempts >= 1, "the failed attempt must be counted, got ${row.attempts}")
        assertNotNull(row.lastError, "the failure reason must be recorded")

        // The business change is intact and still unpaid (cash is collected separately).
        val orderRow = jdbcTemplate.queryForMap("select status, payment_status from orders where id = ?", order.id)
        assertEquals("PENDING_CONFIRMATION", orderRow["status"])
        assertEquals("UNPAID", orderRow["payment_status"])
    }
}
