package com.kidsstore.order

import com.kidsstore.domain.OrderStatus
import com.kidsstore.service.OrderStatusService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The forward lifecycle and the terminal/dead-end rules, read straight from the single source of
 * truth (OrderStatusService.ALLOWED) rather than a duplicated table.
 */
class OrderStatusRulesTest {

    private val allowed = OrderStatusService.ALLOWED

    @Test
    fun `the legal forward chain is reachable one hop at a time`() {
        val chain = listOf(
            OrderStatus.PENDING_CONFIRMATION,
            OrderStatus.CONFIRMED,
            OrderStatus.PROCESSING,
            OrderStatus.OUT_FOR_DELIVERY,
            OrderStatus.DELIVERED,
        )
        for (i in 0 until chain.size - 1) {
            val from = chain[i]
            val to = chain[i + 1]
            assertTrue(allowed.getValue(from).contains(to), "$from -> $to must be legal")
        }
    }

    @Test
    fun `backward transitions are illegal`() {
        assertFalse(allowed.getValue(OrderStatus.CONFIRMED).contains(OrderStatus.PENDING_CONFIRMATION))
        assertFalse(allowed.getValue(OrderStatus.PROCESSING).contains(OrderStatus.CONFIRMED))
        assertFalse(allowed.getValue(OrderStatus.OUT_FOR_DELIVERY).contains(OrderStatus.PROCESSING))
        // You cannot go straight from pending to delivered.
        assertFalse(allowed.getValue(OrderStatus.PENDING_CONFIRMATION).contains(OrderStatus.DELIVERED))
    }

    @Test
    fun `terminal states allow nothing`() {
        assertEquals(emptySet<OrderStatus>(), allowed.getValue(OrderStatus.DELIVERED))
        assertEquals(emptySet<OrderStatus>(), allowed.getValue(OrderStatus.CANCELLED))
    }

    @Test
    fun `cancellation is reachable before the order is out for delivery`() {
        assertTrue(allowed.getValue(OrderStatus.PENDING_CONFIRMATION).contains(OrderStatus.CANCELLED))
        assertTrue(allowed.getValue(OrderStatus.CONFIRMED).contains(OrderStatus.CANCELLED))
        assertTrue(allowed.getValue(OrderStatus.PROCESSING).contains(OrderStatus.CANCELLED))
        // Once it is on the road you can only deliver or record a failed attempt.
        assertFalse(allowed.getValue(OrderStatus.OUT_FOR_DELIVERY).contains(OrderStatus.CANCELLED))
    }

    @Test
    fun `a failed delivery can be retried or sent back`() {
        val from = allowed.getValue(OrderStatus.FAILED_DELIVERY)
        assertTrue(from.contains(OrderStatus.OUT_FOR_DELIVERY))
        assertTrue(from.contains(OrderStatus.PROCESSING))
        assertTrue(from.contains(OrderStatus.CANCELLED))
    }

    @Test
    fun `isTerminal marks only delivered and cancelled`() {
        assertTrue(OrderStatus.DELIVERED.isTerminal)
        assertTrue(OrderStatus.CANCELLED.isTerminal)
        assertFalse(OrderStatus.PROCESSING.isTerminal)
        assertFalse(OrderStatus.OUT_FOR_DELIVERY.isTerminal)
        assertFalse(OrderStatus.FAILED_DELIVERY.isTerminal)
    }
}
