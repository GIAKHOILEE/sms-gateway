package com.smsgateway.sms

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class LedgerEntry(
  val jobUid: String,
  val lockToken: String?,
  val recipient: String,
  val messagePreview: String,
  val state: String, // ACCEPTED | SENDING | SUBMITTED | FAILED | UNKNOWN
  val partsTotal: Int,
  val partsSent: Int,
  val partsFailed: Int,
  val partsDelivered: Int,
  val errorCode: String?,
  val errorMessage: String?,
  val partResultsJson: String,
  val createdAt: Long,
  val updatedAt: Long,
  val syncedToServer: Boolean,
  val isTestSms: Boolean
) {
  fun toJson(): JSONObject {
    return JSONObject().apply {
      put("jobUid", jobUid)
      put("lockToken", lockToken ?: JSONObject.NULL)
      put("recipient", recipient)
      put("messagePreview", messagePreview)
      put("state", state)
      put("partsTotal", partsTotal)
      put("partsSent", partsSent)
      put("partsFailed", partsFailed)
      put("partsDelivered", partsDelivered)
      put("errorCode", errorCode ?: JSONObject.NULL)
      put("errorMessage", errorMessage ?: JSONObject.NULL)
      put("partResultsJson", partResultsJson)
      put("createdAt", createdAt)
      put("updatedAt", updatedAt)
      put("syncedToServer", syncedToServer)
      put("isTestSms", isTestSms)
    }
  }

  companion object {
    fun fromJson(obj: JSONObject): LedgerEntry {
      return LedgerEntry(
        jobUid = obj.optString("jobUid", ""),
        lockToken = if (obj.isNull("lockToken")) null else obj.optString("lockToken"),
        recipient = obj.optString("recipient", ""),
        messagePreview = obj.optString("messagePreview", ""),
        state = obj.optString("state", "UNKNOWN"),
        partsTotal = obj.optInt("partsTotal", 1),
        partsSent = obj.optInt("partsSent", 0),
        partsFailed = obj.optInt("partsFailed", 0),
        partsDelivered = obj.optInt("partsDelivered", 0),
        errorCode = if (obj.isNull("errorCode")) null else obj.optString("errorCode"),
        errorMessage = if (obj.isNull("errorMessage")) null else obj.optString("errorMessage"),
        partResultsJson = obj.optString("partResultsJson", "[]"),
        createdAt = obj.optLong("createdAt", System.currentTimeMillis()),
        updatedAt = obj.optLong("updatedAt", System.currentTimeMillis()),
        syncedToServer = obj.optBoolean("syncedToServer", false),
        isTestSms = obj.optBoolean("isTestSms", false),
      )
    }
  }
}

class SmsLedgerStore(context: Context) {
  companion object {
    private const val PREFS_LEDGER = "sms_gateway_job_ledger_v1"
    private const val PREFS_CONFIG = "sms_gateway_device_config_v1"
    private const val KEY_LEDGER_MAP = "entries_json"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val KEY_ALIAS = "SmsGatewayDeviceSecretKey_v1"
    private const val MAX_LEDGER_ENTRIES = 300
  }

  private val ledgerPrefs: SharedPreferences =
    context.getSharedPreferences(PREFS_LEDGER, Context.MODE_PRIVATE)
  private val configPrefs: SharedPreferences =
    context.getSharedPreferences(PREFS_CONFIG, Context.MODE_PRIVATE)

  init {
    reconcileInterruptedSendsOnStartup()
  }

  /**
   * Any job that was left in SENDING when the app previously exited/crashed
   * is transitioned to UNKNOWN so it is never blindly resent.
   */
  @Synchronized
  fun reconcileInterruptedSendsOnStartup() {
    val all = loadAllMutable()
    var modified = false
    val now = System.currentTimeMillis()
    for ((uid, entry) in all) {
      if (entry.state == "SENDING") {
        all[uid] = entry.copy(
          state = "UNKNOWN",
          errorCode = "APP_TERMINATED_DURING_SEND",
          errorMessage = "App closed or crashed after SmsManager invocation before PendingIntent completed",
          updatedAt = now,
          syncedToServer = false,
        )
        modified = true
      }
    }
    if (modified) {
      persistAllCommit(all)
    }
  }

  @Synchronized
  fun getEntry(jobUid: String): LedgerEntry? {
    val all = loadAllMutable()
    return all[jobUid]
  }

  @Synchronized
  fun recordAccepted(
    jobUid: String,
    lockToken: String?,
    recipient: String,
    message: String,
    partsTotal: Int,
    isTestSms: Boolean
  ): LedgerEntry {
    val all = loadAllMutable()
    val existing = all[jobUid]
    if (existing != null) {
      return existing
    }
    val now = System.currentTimeMillis()
    val preview = if (message.length > 80) message.substring(0, 80) + "..." else message
    val entry = LedgerEntry(
      jobUid = jobUid,
      lockToken = lockToken,
      recipient = recipient,
      messagePreview = preview,
      state = "ACCEPTED",
      partsTotal = partsTotal,
      partsSent = 0,
      partsFailed = 0,
      partsDelivered = 0,
      errorCode = null,
      errorMessage = null,
      partResultsJson = "[]",
      createdAt = now,
      updatedAt = now,
      syncedToServer = isTestSms,
      isTestSms = isTestSms,
    )
    all[jobUid] = entry
    pruneIfNeeded(all)
    persistAllCommit(all)
    return entry
  }

  @Synchronized
  fun recordSending(
    jobUid: String,
    lockToken: String?,
    recipient: String,
    message: String,
    partsTotal: Int,
    isTestSms: Boolean
  ): LedgerEntry {
    val all = loadAllMutable()
    val now = System.currentTimeMillis()
    val preview = if (message.length > 80) message.substring(0, 80) + "..." else message
    val existing = all[jobUid]
    val entry = (existing ?: LedgerEntry(
      jobUid = jobUid,
      lockToken = lockToken,
      recipient = recipient,
      messagePreview = preview,
      state = "SENDING",
      partsTotal = partsTotal,
      partsSent = 0,
      partsFailed = 0,
      partsDelivered = 0,
      errorCode = null,
      errorMessage = null,
      partResultsJson = "[]",
      createdAt = now,
      updatedAt = now,
      syncedToServer = isTestSms,
      isTestSms = isTestSms,
    )).copy(
      state = "SENDING",
      partsTotal = partsTotal,
      updatedAt = now,
    )
    all[jobUid] = entry
    pruneIfNeeded(all)
    persistAllCommit(all)
    return entry
  }

  @Synchronized
  fun recordFinalResult(
    jobUid: String,
    state: String,
    partsTotal: Int,
    partsSent: Int,
    partsFailed: Int,
    errorCode: String?,
    errorMessage: String?,
    partResultsJson: String
  ): LedgerEntry? {
    val all = loadAllMutable()
    val existing = all[jobUid] ?: return null
    val updated = existing.copy(
      state = state,
      partsTotal = partsTotal,
      partsSent = partsSent,
      partsFailed = partsFailed,
      errorCode = errorCode,
      errorMessage = errorMessage,
      partResultsJson = partResultsJson,
      updatedAt = System.currentTimeMillis(),
      syncedToServer = existing.isTestSms,
    )
    all[jobUid] = updated
    persistAllCommit(all)
    return updated
  }

  @Synchronized
  fun incrementDelivered(jobUid: String): LedgerEntry? {
    val all = loadAllMutable()
    val existing = all[jobUid] ?: return null
    val updated = existing.copy(
      partsDelivered = (existing.partsDelivered + 1).coerceAtMost(existing.partsTotal),
      updatedAt = System.currentTimeMillis(),
    )
    all[jobUid] = updated
    persistAllCommit(all)
    return updated
  }

  @Synchronized
  fun markSynced(jobUid: String): Boolean {
    val all = loadAllMutable()
    val existing = all[jobUid] ?: return false
    all[jobUid] = existing.copy(
      syncedToServer = true,
      updatedAt = System.currentTimeMillis(),
    )
    persistAllCommit(all)
    return true
  }

  @Synchronized
  fun getUnsyncedEntries(): List<LedgerEntry> {
    val all = loadAllMutable()
    return all.values
      .filter { !it.isTestSms && !it.syncedToServer && (it.state == "SUBMITTED" || it.state == "FAILED" || it.state == "UNKNOWN") }
      .sortedBy { it.createdAt }
  }

  @Synchronized
  fun getRecentEntries(limit: Int): List<LedgerEntry> {
    val all = loadAllMutable()
    return all.values
      .sortedByDescending { it.createdAt }
      .take(limit.coerceIn(1, 200))
  }

  private fun loadAllMutable(): LinkedHashMap<String, LedgerEntry> {
    val raw = ledgerPrefs.getString(KEY_LEDGER_MAP, null) ?: return LinkedHashMap()
    val map = LinkedHashMap<String, LedgerEntry>()
    try {
      val arr = JSONArray(raw)
      for (i in 0 until arr.length()) {
        val item = arr.optJSONObject(i) ?: continue
        val entry = LedgerEntry.fromJson(item)
        if (entry.jobUid.isNotEmpty()) {
          map[entry.jobUid] = entry
        }
      }
    } catch (_: Exception) {
    }
    return map
  }

  private fun pruneIfNeeded(map: LinkedHashMap<String, LedgerEntry>) {
    if (map.size <= MAX_LEDGER_ENTRIES) return
    val sorted = map.values.sortedBy { it.createdAt }
    val toRemove = sorted.size - MAX_LEDGER_ENTRIES
    var removed = 0
    for (entry in sorted) {
      if (removed >= toRemove) break
      if (entry.syncedToServer || entry.isTestSms) {
        map.remove(entry.jobUid)
        removed++
      }
    }
  }

  /**
   * Uses synchronous commit() to guarantee durability before SmsManager is invoked.
   */
  private fun persistAllCommit(map: LinkedHashMap<String, LedgerEntry>) {
    val arr = JSONArray()
    for (entry in map.values) {
      arr.put(entry.toJson())
    }
    ledgerPrefs.edit().putString(KEY_LEDGER_MAP, arr.toString()).commit()
  }

  // ---- Encrypted Device Configuration Storage (Android Keystore AES-GCM) ----

  @Synchronized
  fun saveDeviceConfig(serverUrl: String, deviceId: String, deviceSecret: String) {
    val editor = configPrefs.edit()
      .putString("server_url", serverUrl.trim())
      .putString("device_id", deviceId.trim())

    if (deviceSecret.isNotEmpty()) {
      val encrypted = encryptSecret(deviceSecret)
      editor.putString("device_secret_enc", encrypted)
    } else {
      editor.remove("device_secret_enc")
    }
    editor.commit()
  }

  @Synchronized
  fun loadDeviceConfig(): Triple<String, String, String> {
    val serverUrl = configPrefs.getString("server_url", "") ?: ""
    val deviceId = configPrefs.getString("device_id", "") ?: ""
    val encrypted = configPrefs.getString("device_secret_enc", null)
    val secret = if (!encrypted.isNullOrEmpty()) {
      decryptSecret(encrypted)
    } else {
      ""
    }
    return Triple(serverUrl, deviceId, secret)
  }

  private fun getOrCreateSecretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
    if (existing != null) {
      return existing.secretKey
    }
    val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
    val spec = KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build()
    keyGenerator.init(spec)
    return keyGenerator.generateKey()
  }

  private fun encryptSecret(plainText: String): String {
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
      val iv = cipher.iv
      val cipherBytes = cipher.doFinal(plainText.toByteArray(StandardCharsets.UTF_8))
      val ivB64 = Base64.encodeToString(iv, Base64.NO_WRAP)
      val dataB64 = Base64.encodeToString(cipherBytes, Base64.NO_WRAP)
      "$ivB64:$dataB64"
    } catch (_: Exception) {
      ""
    }
  }

  private fun decryptSecret(encoded: String): String {
    return try {
      val parts = encoded.split(":")
      if (parts.size != 2) return ""
      val iv = Base64.decode(parts[0], Base64.NO_WRAP)
      val cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(128, iv))
      String(cipher.doFinal(cipherBytes), StandardCharsets.UTF_8)
    } catch (_: Exception) {
      ""
    }
  }
}

