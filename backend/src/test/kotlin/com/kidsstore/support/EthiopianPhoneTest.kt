package com.kidsstore.support

import com.kidsstore.common.EthiopianPhone
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource

/**
 * Ethiopian phone rules: accept 0X / +251 / 251 / 00251 forms for 7|9 numbers, normalise to the
 * local 0XXXXXXXXX shape, and reject anything that is not a well formed 9-digit subscriber.
 */
class EthiopianPhoneTest {

    @ParameterizedTest
    @CsvSource(
        // raw, expected normalisation
        "0912345678, 0912345678",
        "0712345678, 0712345678",
        "+251912345678, 0912345678",
        "+251712345678, 0712345678",
        "251912345678, 0912345678",
        "00251912345678, 0912345678",
        "00251712345678, 0712345678",
        "+251 91 234 5678, 0912345678",
    )
    fun `valid numbers normalise to the local zero prefixed form`(raw: String, expected: String) {
        assertTrue(EthiopianPhone.isValid(raw), "$raw should be valid")
        assertEquals(expected, EthiopianPhone.normalize(raw))
    }

    @ParameterizedTest
    @ValueSource(strings = [
        "0812345678", // prefix not 7/9
        "091234567", // too short (8 subscriber digits)
        "09123456789", // too long
        "0123456789", // second digit not 7/9
        "09abcdefgh", // letters
        "",
        "0",
        "09",
    ])
    fun `invalid numbers are rejected`(raw: String) {
        assertFalse(EthiopianPhone.isValid(raw), "$raw should be invalid")
        assertNull(EthiopianPhone.normalize(raw))
    }

    @Test
    fun `dial uri always produces the plus 251 form`() {
        assertEquals("+251912345678", EthiopianPhone.dialUri("0912345678"))
        assertEquals("+251712345678", EthiopianPhone.dialUri("0712345678"))
        assertEquals("+251912345678", EthiopianPhone.dialUri("+251912345678"))
    }
}
