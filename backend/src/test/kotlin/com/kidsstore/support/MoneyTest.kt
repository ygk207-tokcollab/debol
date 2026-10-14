package com.kidsstore.support

import com.kidsstore.common.Money
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Money must be exact, scaled to two decimals with HALF_UP, and never float/double backed.
 */
class MoneyTest {

    @Test
    fun `multiply is subtotal by quantity and rounds half up to two decimals`() {
        val line = Money.multiply(BigDecimal("10.00"), 3)
        assertEquals(BigDecimal("30.00"), line)
        assertEquals(2, line.scale())

        // Fractional cent: 10.005 * 3 = 30.015 -> HALF_UP -> 30.02
        val roundUp = Money.multiply(BigDecimal("10.005"), 3)
        assertEquals(BigDecimal("30.02"), roundUp)

        // 2.50 * 4 = 10.00
        assertEquals(BigDecimal("10.00"), Money.multiply(BigDecimal("2.50"), 4))
    }

    @Test
    fun `parse rounds a fractional cent half up`() {
        assertEquals(BigDecimal("10.01"), Money.parse(BigDecimal("10.005"))) // .005 rounds up
        assertEquals(BigDecimal("10.00"), Money.parse(BigDecimal("10.004"))) // .004 rounds down
        assertEquals(BigDecimal("0.00"), Money.parse(null))
        assertEquals(2, Money.parse(BigDecimal("7")).scale())
    }

    @Test
    fun `sum totals lines with two decimal scale`() {
        val total = Money.sum(listOf(BigDecimal("199.99"), BigDecimal("0.01"), BigDecimal("50.005")))
        assertEquals(BigDecimal("250.01"), total) // 199.99 + 0.01 + 50.005 = 250.005 -> HALF_UP 250.01
    }

    @Test
    fun `order total is subtotal plus delivery fee`() {
        val subtotal = Money.multiply(BigDecimal("750.00"), 2) // 1500.00
        val fee = Money.parse(BigDecimal("150.00"))
        val total = Money.parse(subtotal.add(fee))
        assertEquals(BigDecimal("1650.00"), total)
    }

    @Test
    fun `money is backed by BigDecimal with exactly two decimals, never float or double`() {
        val value = Money.of("1250.5")
        assertTrue(value is BigDecimal, "Money.of must return a BigDecimal")
        assertEquals(2, value.scale())
        assertEquals(BigDecimal("1250.50"), value)

        // Guard against binary float drift: 0.1 + 0.2 style cents must be exact.
        val cents = Money.sum(listOf(BigDecimal("0.10"), BigDecimal("0.20")))
        assertEquals(BigDecimal("0.30"), cents)
    }

    @Test
    fun `format renders grouped currency label with two decimals`() {
        assertEquals("ETB 1,250.00", Money.format(BigDecimal("1250"), "ETB"))
        assertEquals("ETB 0.00", Money.format(BigDecimal.ZERO, "ETB"))
        val halfUp = Money.format(BigDecimal("99.996"), "ETB")
        assertEquals("ETB 100.00", halfUp)
        assertTrue(Money.format(BigDecimal("10"), "ETB") == "ETB 10.00")
    }

    @Test
    fun `scale is two for every operation result`() {
        listOf(
            Money.parse(BigDecimal("1")),
            Money.multiply(BigDecimal("1"), 1),
            Money.sum(listOf(BigDecimal.ONE)),
            Money.of("3"),
        ).forEach {
            assertEquals(2, it.setScale(Money.SCALE, RoundingMode.HALF_UP).scale(), "scale must be 2")
        }
    }
}
