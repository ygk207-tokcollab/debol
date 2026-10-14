package com.kidsstore.order

import com.kidsstore.common.ApiException
import com.kidsstore.support.AbstractIntegrationTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal

/**
 * Money-critical storefront invariants: no overselling, server-authoritative delivery pricing by
 * zone, and idempotent checkout. All asserted against persisted state.
 */
@Transactional
class InventoryAndCheckoutIntegrationTest : AbstractIntegrationTest() {

    @Test
    fun `the cart refuses to add more than the available stock`() {
        val variant = createProductWithStock(BigDecimal("100.00"), 2)
        val ex = assertThrows(ApiException::class.java) {
            addToCart(newCartKey(), variant.id!!, 3)
        }
        assertEquals("insufficient_stock", ex.code)
        assertEquals(2, variantStock(variant.id!!), "stock is untouched by a rejected add")
    }

    @Test
    fun `sequential reservations can never drive stock negative`() {
        val variant = createProductWithStock(BigDecimal("100.00"), 2)
        val first = checkout(newCartKey(), variant.id!!, 2)
        em.flush()
        assertEquals(0, variantStock(variant.id!!), "both units reserved")

        // A second customer cannot reserve stock that is gone.
        assertThrows(ApiException::class.java) {
            checkout(newCartKey(), variant.id!!, 1)
        }
        assertTrue(variantStock(variant.id!!) >= 0)
        assertEquals(0, variantStock(variant.id!!))
        assertEquals("ORD-", first.orderNumber.take(4))
    }

    @Test
    fun `the database blocks negative stock directly`() {
        val variant = createProductWithStock(BigDecimal("100.00"), 1)
        val found = variants.findByIdForUpdate(variant.id!!)!!
        found.stock = -1
        assertThrows(DataIntegrityViolationException::class.java) {
            variants.saveAndFlush(found)
        }
    }

    @Test
    fun `the same idempotency key never creates a second order`() {
        val variant = createProductWithStock(BigDecimal("100.00"), 10)
        val key = randomKey("idem")

        val first = checkout(newCartKey(), variant.id!!, 2, idempotencyKey = key)
        assertFalse(first.replayed)

        val second = checkout(newCartKey(), variant.id!!, 2, idempotencyKey = key)
        assertEquals(first.orderNumber, second.orderNumber)
        assertTrue(second.replayed, "the replayed flag marks a reused key")

        val count = jdbcTemplate.queryForObject(
            "select count(*) from orders where idempotency_key = ?", Int::class.java, key,
        )
        assertEquals(1, count, "exactly one order row per idempotency key")
        em.flush()
        assertEquals(8, variantStock(variant.id!!), "stock reserved once, not twice")
    }

    @Test
    fun `delivery fee is chosen from the matched zone and added to the subtotal`() {
        val variant = createProductWithStock(BigDecimal("100.00"), 5)

        val bole = quote(variant.id!!, 1, "Addis Ababa", "Addis Ababa", "Bole")
        assertEquals(0, bole.subtotal.compareTo(BigDecimal("100.00")))
        assertEquals(0, bole.deliveryFee.compareTo(BigDecimal("150.00")))
        assertEquals(0, bole.total.compareTo(BigDecimal("250.00")))
        assertEquals("Addis Ababa - central", bole.zoneNameEn)

        val akaki = quote(variant.id!!, 1, "Addis Ababa", "Addis Ababa", "Akaki")
        assertEquals(0, akaki.deliveryFee.compareTo(BigDecimal("200.00")))

        val adama = quote(variant.id!!, 1, "Oromia", "Adama", null)
        assertEquals(0, adama.deliveryFee.compareTo(BigDecimal("350.00")))
        assertEquals(0, adama.total.compareTo(BigDecimal("450.00")))
    }

    @Test
    fun `subtotal over the zone free-over threshold drops the fee to zero`() {
        val variant = createProductWithStock(BigDecimal("1000.00"), 10)
        val big = quote(variant.id!!, 4, "Addis Ababa", "Addis Ababa", "Bole") // subtotal 4000 >= 3000
        assertEquals(0, big.subtotal.compareTo(BigDecimal("4000.00")))
        assertEquals(0, big.deliveryFee.compareTo(BigDecimal.ZERO))
        assertEquals(0, big.total.compareTo(BigDecimal("4000.00")))
    }

    @Test
    fun `an undeliverable location is rejected`() {
        val variant = createProductWithStock(BigDecimal("100.00"), 5)
        val ex = assertThrows(ApiException::class.java) {
            quote(variant.id!!, 1, "Somewhere", "Nowhere", null)
        }
        assertEquals("undeliverable_location", ex.code)
    }
}
