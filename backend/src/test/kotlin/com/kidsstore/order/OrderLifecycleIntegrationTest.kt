package com.kidsstore.order

import com.kidsstore.common.ApiException
import com.kidsstore.domain.ActorType
import com.kidsstore.domain.OrderStatus
import com.kidsstore.domain.PaymentStatus
import com.kidsstore.support.AbstractIntegrationTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal

/**
 * Order lifecycle, cash-on-delivery and cancellation-restore rules, asserted against the real
 * PostgreSQL rows (via JdbcTemplate / reload), not the returned DTOs.
 */
@Transactional
class OrderLifecycleIntegrationTest : AbstractIntegrationTest() {

    private fun placedOrder(): Pair<Long, Long> {
        val variant = createProductWithStock(BigDecimal("100.00"), 10)
        val res = checkout(newCartKey(), variant.id!!, 2)
        val order = orders.findByOrderNumber(res.orderNumber)!!
        return order.id!! to variant.id!!
    }

    @Test
    fun `a placed order is persisted pending and unpaid`() {
        val (orderId, _) = placedOrder()
        em.flush()
        val row = orderRow(orderId)
        assertEquals("PENDING_CONFIRMATION", row["status"])
        assertEquals("UNPAID", row["payment_status"])
        assertEquals(0, (row["subtotal"] as BigDecimal).compareTo(BigDecimal("200.00")))
        assertEquals(0, (row["delivery_fee"] as BigDecimal).compareTo(BigDecimal("150.00")))
        assertEquals(0, (row["total_amount"] as BigDecimal).compareTo(BigDecimal("350.00")))
    }

    @Test
    fun `the legal chain advances and stamps each stage`() {
        val (orderId, _) = placedOrder()
        orderStatusService.transition(orderId, OrderStatus.CONFIRMED, ActorType.ADMIN, "a@b.co")
        orderStatusService.transition(orderId, OrderStatus.PROCESSING, ActorType.ADMIN, "a@b.co")
        orderStatusService.transition(orderId, OrderStatus.OUT_FOR_DELIVERY, ActorType.ADMIN, "a@b.co")
        orderStatusService.deliver(orderId, ActorType.ADMIN, "a@b.co")
        em.flush(); em.clear()

        val saved = orders.findById(orderId).orElseThrow()
        assertEquals(OrderStatus.DELIVERED, saved.status)
        assertNotNull(saved.confirmedAt)
        assertNotNull(saved.processingAt)
        assertNotNull(saved.outForDeliveryAt)
        assertNotNull(saved.deliveredAt)
        // Delivered does NOT mean paid: cash is only recorded by a person who collected it.
        assertEquals(PaymentStatus.UNPAID, saved.paymentStatus)
    }

    @Test
    fun `illegal and backward transitions are rejected and leave the row untouched`() {
        val (orderId, _) = placedOrder()
        // Pending cannot jump straight to delivered.
        val e1 = assertThrows(ApiException::class.java) {
            orderStatusService.deliver(orderId, ActorType.ADMIN, "a@b.co")
        }
        assertEquals("invalid_transition", e1.code)
        // Pending cannot go backwards from confirmed.
        orderStatusService.transition(orderId, OrderStatus.CONFIRMED, ActorType.ADMIN, "a@b.co")
        val e2 = assertThrows(ApiException::class.java) {
            orderStatusService.transition(orderId, OrderStatus.PENDING_CONFIRMATION, ActorType.ADMIN, "a@b.co")
        }
        assertEquals("invalid_transition", e2.code)
        em.flush(); em.clear()
        assertEquals(OrderStatus.CONFIRMED, orders.findById(orderId).orElseThrow().status)
    }

    @Test
    fun `a delivered order cannot be transitioned backward`() {
        val (orderId, _) = placedOrder()
        orderStatusService.transition(orderId, OrderStatus.CONFIRMED, ActorType.ADMIN, "a@b.co")
        orderStatusService.transition(orderId, OrderStatus.PROCESSING, ActorType.ADMIN, "a@b.co")
        orderStatusService.transition(orderId, OrderStatus.OUT_FOR_DELIVERY, ActorType.ADMIN, "a@b.co")
        orderStatusService.deliver(orderId, ActorType.ADMIN, "a@b.co")
        val ex = assertThrows(ApiException::class.java) {
            orderStatusService.transition(orderId, OrderStatus.CONFIRMED, ActorType.ADMIN, "a@b.co")
        }
        assertEquals("invalid_transition", ex.code)
    }

    @Test
    fun `cancelling an order restores the reserved stock and flags it`() {
        val variant = createProductWithStock(BigDecimal("100.00"), 10)
        val res = checkout(newCartKey(), variant.id!!, 3)
        val order = orders.findByOrderNumber(res.orderNumber)!!
        em.flush()
        assertEquals(7, variantStock(variant.id!!))

        orderStatusService.cancel(order.id!!, "Customer changed mind", ActorType.ADMIN, "a@b.co")
        em.flush()

        assertEquals(10, variantStock(variant.id!!), "stock must return to the pre-order level")
        val row = orderRow(order.id!!)
        assertEquals("CANCELLED", row["status"])
        assertEquals(true, row["stock_restored"])
        val restored = jdbcTemplate.queryForObject(
            "select count(*) from inventory_movement where reason = 'CANCEL_RESTORED' and reference_id = ?",
            Int::class.java, order.id,
        )
        assertTrue(restored!! >= 1, "a cancel-restored movement must be recorded")
    }

    @Test
    fun `cash is only collectable after delivery and marks the order paid`() {
        val (orderId, _) = placedOrder()

        // Before delivery there is nothing to collect.
        val e = assertThrows(ApiException::class.java) {
            orderStatusService.recordCashCollection(orderId, "courier Bob", BigDecimal("350.00"))
        }
        assertEquals("not_delivered", e.code)
        em.flush()
        assertEquals("UNPAID", orderRow(orderId)["payment_status"])

        orderStatusService.transition(orderId, OrderStatus.CONFIRMED, ActorType.ADMIN, "a@b.co")
        orderStatusService.transition(orderId, OrderStatus.PROCESSING, ActorType.ADMIN, "a@b.co")
        orderStatusService.transition(orderId, OrderStatus.OUT_FOR_DELIVERY, ActorType.ADMIN, "a@b.co")
        orderStatusService.deliver(orderId, ActorType.ADMIN, "a@b.co")
        em.flush()
        assertEquals("UNPAID", orderRow(orderId)["payment_status"], "delivered is not the same as paid")

        // The cash-collection path is the only way to PAID.
        orderStatusService.recordCashCollection(orderId, "courier Bob", null)
        em.flush(); em.clear()

        val row = orderRow(orderId)
        assertEquals("PAID", row["payment_status"])
        assertEquals(0, (row["amount_collected"] as BigDecimal).compareTo(BigDecimal("350.00")))
        assertEquals("courier Bob", row["payment_collected_by"])
        assertNotNull(row["payment_collected_at"])

        // Recording cash twice is refused.
        val again = assertThrows(ApiException::class.java) {
            orderStatusService.recordCashCollection(orderId, "courier Bob", BigDecimal("10.00"))
        }
        assertEquals("already_paid", again.code)
    }

    @Test
    fun `payment status enum has no PAYMENT_FAILED state so failures stay UNPAID`() {
        // The code models cash failure by leaving the order UNPAID, not by a PAID->FAILED transition.
        assertTrue(PaymentStatus.entries.none { it.name.contains("FAILED") })
        assertEquals(listOf(PaymentStatus.UNPAID, PaymentStatus.PAID, PaymentStatus.REFUNDED), PaymentStatus.entries.toList())
    }
}
