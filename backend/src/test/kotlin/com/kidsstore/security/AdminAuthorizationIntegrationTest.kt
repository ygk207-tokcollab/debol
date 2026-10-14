package com.kidsstore.security

import com.kidsstore.domain.AdminRole
import com.kidsstore.domain.SessionSource
import com.kidsstore.support.AbstractIntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.transaction.annotation.Transactional

/**
 * Role based access control exercised through the real Spring Security filter chain (MockMvc).
 * OWNER > MANAGER > DELIVERY_STAFF authority sets come from Roles.authoritiesFor.
 */
@Transactional
@AutoConfigureMockMvc
class AdminAuthorizationIntegrationTest : AbstractIntegrationTest() {

    @Autowired
    private lateinit var mockMvc: MockMvc

    private fun bearer(token: String) = mapOf("Authorization" to "Bearer $token")

    private fun adminToken(role: AdminRole): String {
        val admin = saveAdmin("${role.name.lowercase()}-${System.nanoTime()}@kidsstore.test", role)
        return jwt.issueAdminToken(admin.id!!, admin.email, admin.fullName, admin.role, admin.tokenVersion)
    }

    private fun doGet(url: String, headers: Map<String, String> = emptyMap()): ResultActions {
        val req = MockMvcRequestBuilders.get(url)
        headers.forEach { (k, v) -> req.header(k, v) }
        return mockMvc.perform(req)
    }

    @Test
    fun `unauthenticated admin calls are refused with 401`() {
        doGet("/api/v1/admin/dashboard").andExpect(status().isUnauthorized)
    }

    @Test
    fun `a customer token cannot reach an admin endpoint`() {
        val (token, _) = issueCustomerToken()
        doGet("/api/v1/admin/dashboard", bearer(token)).andExpect(status().isForbidden)
    }

    @Test
    fun `delivery staff may view the dashboard but not owner settings`() {
        val staff = adminToken(AdminRole.DELIVERY_STAFF)
        doGet("/api/v1/admin/dashboard", bearer(staff)).andExpect(status().isOk)
        doGet("/api/v1/admin/settings", bearer(staff)).andExpect(status().isForbidden)
        doGet("/api/v1/admin/delivery-zones", bearer(staff)).andExpect(status().isForbidden)
    }

    @Test
    fun `a manager may edit delivery zones but not owner settings`() {
        val manager = adminToken(AdminRole.MANAGER)
        doGet("/api/v1/admin/delivery-zones", bearer(manager)).andExpect(status().isOk)
        doGet("/api/v1/admin/dashboard", bearer(manager)).andExpect(status().isOk)
        doGet("/api/v1/admin/settings", bearer(manager)).andExpect(status().isForbidden)
    }

    @Test
    fun `the owner can reach every tier`() {
        val owner = adminToken(AdminRole.OWNER)
        doGet("/api/v1/admin/dashboard", bearer(owner)).andExpect(status().isOk)
        doGet("/api/v1/admin/delivery-zones", bearer(owner)).andExpect(status().isOk)
        doGet("/api/v1/admin/settings", bearer(owner)).andExpect(status().isOk)
    }

    @Test
    fun `a forged bearer token with no matching session is rejected`() {
        // A customer token whose session row does not exist must not authenticate.
        val forged = jwt.issueCustomerToken(999999L, null, SessionSource.WEB_PHONE, "no-such-session-hash")
        doGet("/api/v1/admin/dashboard", bearer(forged)).andExpect(status().isUnauthorized)
    }
}
