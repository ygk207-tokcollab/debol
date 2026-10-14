package com.kidsstore.common

import java.util.regex.Pattern

/**
 * Ethiopian phone numbers: 10 digits starting 09 or 07, or +251 / 251 / 00251 forms.
 * Stored normalised to the local 0XXXXXXXXX shape used on receipts and by call centres.
 */
object EthiopianPhone {
    private val pattern = Pattern.compile("""^(?:00251|\+251|251|0)?(7|9)(\d{8})$""")

    fun normalize(raw: String): String? {
        val digits = raw.filter { it.isDigit() || it == '+' }
        val matcher = pattern.matcher(digits)
        if (!matcher.matches()) return null
        return "0${matcher.group(1)}${matcher.group(2)}"
    }

    fun isValid(raw: String): Boolean = normalize(raw) != null

    /** Contact link shown in the admin order screen. */
    fun dialUri(raw: String): String {
        val normalized = normalize(raw) ?: raw.filter { it.isDigit() }
        return if (normalized.startsWith("0")) "+251${normalized.substring(1)}" else normalized
    }
}
