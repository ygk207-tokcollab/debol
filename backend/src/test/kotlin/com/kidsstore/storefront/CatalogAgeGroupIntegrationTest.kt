package com.kidsstore.storefront

import com.kidsstore.common.ApiException
import com.kidsstore.domain.AgeGroup
import com.kidsstore.domain.Audience
import com.kidsstore.domain.Gender
import com.kidsstore.domain.Product
import com.kidsstore.domain.ProductStatus
import com.kidsstore.domain.SizingSystem
import com.kidsstore.repo.AgeGroupRepository
import com.kidsstore.support.AbstractIntegrationTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.util.UUID

/**
 * Age band filtering is a backend concern: the bands come from a table an administrator edits,
 * a product can sit in several of them, and a value that is not a known code is rejected rather
 * than quietly ignored.
 */
@Transactional
class CatalogAgeGroupIntegrationTest : AbstractIntegrationTest() {

    @Autowired private lateinit var catalog: CatalogService
    @Autowired private lateinit var ageGroups: AgeGroupRepository

    private fun productIn(bands: List<String>): Product {
        val slug = "age-test-" + UUID.randomUUID().toString().take(12)
        val resolved = ageGroups.findAllByCodeIn(bands)
        assertEquals(bands.size, resolved.size, "every band used by a test must exist")
        val product = products.save(
            Product().apply {
                this.slug = slug
                this.category = categories.findAllActive().first()
                this.nameEn = "Age Band Probe"
                this.audience = Audience.CHILD
                this.gender = Gender.UNISEX
                this.sizingSystem = SizingSystem.AGE
                this.basePrice = BigDecimal("500.00")
                this.status = ProductStatus.PUBLISHED
                this.featured = false
                this.isSample = false
            }
        )
        product.ageGroups.addAll(resolved)
        em.flush()
        em.clear()
        return product
    }

    private fun slugsFor(band: String?): List<String> =
        catalog.listProducts(null, null, null, null, null, band, null, null, false, null, "newest", 0, 60).items
            .map { it.slug }

    @Test
    fun `the published bands are the admin table, ordered for a dropdown`() {
        val bands = catalog.ageGroupList()
        assertEquals(
            listOf(
                "NEWBORN_0_3M", "INFANT_3_12M", "TODDLER_1_2Y", "LITTLE_KID_3_4Y", "PRESCHOOL_5_6Y",
                "YOUNG_KID_7_9Y", "PRETEEN_10_12Y", "TEEN_13_17Y", "ADULT_18Y", "ALL_AGES",
            ),
            bands.map { it.code },
        )
        val toddler = bands.first { it.code == "TODDLER_1_2Y" }
        assertEquals("Toddler (1-2 years)", toddler.label)
        assertEquals(1, toddler.minAge)
        assertEquals(2, toddler.maxAge)
        assertEquals("YEAR", toddler.ageUnit)
    }

    @Test
    fun `a band filter returns only products tagged with it`() {
        val toddlerOnly = productIn(listOf("TODDLER_1_2Y"))
        val teenOnly = productIn(listOf("TEEN_13_17Y"))

        val toddlers = slugsFor("TODDLER_1_2Y")
        assertTrue(toddlers.contains(toddlerOnly.slug))
        assertFalse(toddlers.contains(teenOnly.slug), "a teen product must not leak into the toddler filter")

        val teens = slugsFor("TEEN_13_17Y")
        assertTrue(teens.contains(teenOnly.slug))
        assertFalse(teens.contains(toddlerOnly.slug))
    }

    @Test
    fun `a product tagged with several bands shows in each of them`() {
        val both = productIn(listOf("LITTLE_KID_3_4Y", "PRESCHOOL_5_6Y"))
        assertTrue(slugsFor("LITTLE_KID_3_4Y").contains(both.slug))
        assertTrue(slugsFor("PRESCHOOL_5_6Y").contains(both.slug))
        assertFalse(slugsFor("TEEN_13_17Y").contains(both.slug))
    }

    @Test
    fun `an unknown band code is rejected instead of ignored`() {
        val ex = assertThrows(ApiException::class.java) { slugsFor("NOT_A_REAL_BAND") }
        assertEquals("invalid_age_group", ex.code)
    }

    @Test
    fun `the code is matched case insensitively and a blank filter keeps the whole catalogue`() {
        val product = productIn(listOf("INFANT_3_12M"))
        assertTrue(slugsFor("infant_3_12m").contains(product.slug))

        val unfiltered = slugsFor(null)
        val blank = slugsFor("   ")
        assertEquals(unfiltered.size, blank.size, "a blank filter behaves like no filter")
        assertTrue(blank.contains(product.slug))
    }

    @Test
    fun `an all-ages product appears under every band`() {
        val openEnded = productIn(listOf("ALL_AGES"))
        assertTrue(slugsFor("TODDLER_1_2Y").contains(openEnded.slug))
        assertTrue(slugsFor("TEEN_13_17Y").contains(openEnded.slug))
    }

    @Test
    fun `a product summary carries its bands so the storefront can label them`() {
        val product = productIn(listOf("YOUNG_KID_7_9Y"))
        val detail = catalog.productBySlug(product.slug)
        assertEquals(listOf("YOUNG_KID_7_9Y"), detail.ageGroups)
    }

    @Test
    fun `an administrator can rename a band without touching product links`() {
        val band: AgeGroup = ageGroups.findByCode("PRETEEN_10_12Y") ?: error("band missing")
        band.label = "Tweens (10-12 years)"
        ageGroups.save(band)
        em.flush()
        em.clear()

        assertEquals("Tweens (10-12 years)", catalog.ageGroupList().first { it.code == "PRETEEN_10_12Y" }.label)
        assertTrue(catalog.ageGroupList().any { it.code == "PRETEEN_10_12Y" }, "the code survives the rename")
    }
}
