package com.smsgateway.sms

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.view.WindowManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class SmsSenderModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "SmsSenderModule"
    private const val MAX_MESSAGE_CHARS = 1500
    private const val MAX_MESSAGE_PARTS = 10
    private const val DEFAULT_SEND_TIMEOUT_MS = 45_000L
    private val PHONE_REGEX = Regex("^\\+?[0-9]{3,15}$")
    private val requestCodeGenerator = AtomicInteger(10_000)
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val ledgerStore = SmsLedgerStore(reactContext)
  private val activeOperations = ConcurrentHashMap<String, InFlightOperation>()
  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  override fun getName(): String = NAME

  override fun invalidate() {
    super.invalidate()
    stopNetworkCallbackInternal()
    for (op in activeOperations.values) {
      cleanupOperation(op)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for RN NativeEventEmitter
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for RN NativeEventEmitter
  }

  @ReactMethod
  fun checkSmsPermission(promise: Promise) {
    try {
      val granted = ContextCompat.checkSelfPermission(
        reactContext,
        Manifest.permission.SEND_SMS
      ) == PackageManager.PERMISSION_GRANTED

      val defaultSmsSubId = SubscriptionManager.getDefaultSmsSubscriptionId()
      val hasValidSub = defaultSmsSubId != SubscriptionManager.INVALID_SUBSCRIPTION_ID

      val result = Arguments.createMap().apply {
        putBoolean("granted", granted)
        putInt("defaultSmsSubId", defaultSmsSubId)
        putBoolean("hasValidSubscription", hasValidSub)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("CHECK_PERMISSION_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun inspectMessage(recipient: String, message: String, promise: Promise) {
    try {
      val normalized = normalizePhoneNumber(recipient)
      val isValidRecipient = normalized.isNotEmpty() && PHONE_REGEX.matches(normalized)
      val smsManager = resolveSmsManager()
      val parts = if (message.isNotEmpty()) smsManager.divideMessage(message) else arrayListOf()

      val result = Arguments.createMap().apply {
        putBoolean("isValidRecipient", isValidRecipient)
        putString("normalizedRecipient", normalized)
        putInt("charCount", message.length)
        putInt("partsCount", parts.size)
        putBoolean("exceedsMaxLength", message.length > MAX_MESSAGE_CHARS || parts.size > MAX_MESSAGE_PARTS)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("INSPECT_MESSAGE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun recordJobAccepted(
    jobUid: String,
    lockToken: String?,
    recipient: String,
    message: String,
    promise: Promise
  ) {
    try {
      if (jobUid.isBlank()) {
        promise.reject("INVALID_JOB_UID", "jobUid is required")
        return
      }
      val smsManager = resolveSmsManager()
      val partsCount = if (message.isNotEmpty()) smsManager.divideMessage(message).size else 1
      val entry = ledgerStore.recordAccepted(
        jobUid = jobUid.trim(),
        lockToken = lockToken,
        recipient = normalizePhoneNumber(recipient),
        message = message,
        partsTotal = partsCount.coerceAtLeast(1),
        isTestSms = false,
      )
      promise.resolve(ledgerEntryToWritableMap(entry))
    } catch (e: Exception) {
      promise.reject("RECORD_ACCEPTED_ERROR", e.message, e)
    }
  }

  /**
   * Sends a single-part or multipart SMS through the physical SIM using Android SmsManager.
   *
   * Options map:
   * - jobUid (String, optional; generated if omitted for test SMS)
   * - lockToken (String, optional)
   * - recipient (String, required)
   * - message (String, required)
   * - isTestSms (Boolean, optional, default false)
   * - timeoutMs (Double, optional, default 45000)
   */
  @ReactMethod
  fun sendSms(options: ReadableMap, promise: Promise) {
    try {
      val rawRecipient = options.getString("recipient") ?: ""
      val message = options.getString("message") ?: ""
      val isTestSms = if (options.hasKey("isTestSms")) options.getBoolean("isTestSms") else false
      val lockToken = if (options.hasKey("lockToken") && !options.isNull("lockToken")) {
        options.getString("lockToken")
      } else {
        null
      }
      val rawJobUid = if (options.hasKey("jobUid") && !options.isNull("jobUid")) {
        options.getString("jobUid")?.trim() ?: ""
      } else {
        ""
      }
      val jobUid = if (rawJobUid.isNotEmpty()) rawJobUid else "test-${UUID.randomUUID()}"
      val timeoutMs = if (options.hasKey("timeoutMs")) {
        options.getDouble("timeoutMs").toLong().coerceIn(10_000L, 120_000L)
      } else {
        DEFAULT_SEND_TIMEOUT_MS
      }

      // 1. Idempotency check against durable ledger (prevents duplicate sends for the same jobUid)
      if (!isTestSms) {
        val existing = ledgerStore.getEntry(jobUid)
        if (existing != null && existing.state != "ACCEPTED") {
          val map = ledgerEntryToResultMap(existing, alreadyProcessed = true)
          promise.resolve(map)
          return
        }
      }

      // 2. Runtime SEND_SMS permission check
      val hasPermission = ContextCompat.checkSelfPermission(
        reactContext,
        Manifest.permission.SEND_SMS
      ) == PackageManager.PERMISSION_GRANTED

      if (!hasPermission) {
        val failEntry = completeImmediateFailure(
          jobUid = jobUid,
          lockToken = lockToken,
          recipient = rawRecipient,
          message = message,
          isTestSms = isTestSms,
          errorCode = "PERMISSION_DENIED",
          errorMessage = "SEND_SMS permission is not granted",
        )
        promise.resolve(ledgerEntryToResultMap(failEntry, alreadyProcessed = false))
        return
      }

      // 3. Recipient & message validation
      val normalizedRecipient = normalizePhoneNumber(rawRecipient)
      if (normalizedRecipient.isEmpty() || !PHONE_REGEX.matches(normalizedRecipient)) {
        val failEntry = completeImmediateFailure(
          jobUid = jobUid,
          lockToken = lockToken,
          recipient = rawRecipient,
          message = message,
          isTestSms = isTestSms,
          errorCode = "INVALID_RECIPIENT",
          errorMessage = "Recipient phone number '$rawRecipient' is invalid",
        )
        promise.resolve(ledgerEntryToResultMap(failEntry, alreadyProcessed = false))
        return
      }

      if (message.trim().isEmpty()) {
        val failEntry = completeImmediateFailure(
          jobUid = jobUid,
          lockToken = lockToken,
          recipient = normalizedRecipient,
          message = message,
          isTestSms = isTestSms,
          errorCode = "EMPTY_MESSAGE",
          errorMessage = "SMS message body cannot be empty",
        )
        promise.resolve(ledgerEntryToResultMap(failEntry, alreadyProcessed = false))
        return
      }

      if (message.length > MAX_MESSAGE_CHARS) {
        val failEntry = completeImmediateFailure(
          jobUid = jobUid,
          lockToken = lockToken,
          recipient = normalizedRecipient,
          message = message,
          isTestSms = isTestSms,
          errorCode = "MESSAGE_TOO_LONG",
          errorMessage = "Message length (${message.length}) exceeds maximum ($MAX_MESSAGE_CHARS chars)",
        )
        promise.resolve(ledgerEntryToResultMap(failEntry, alreadyProcessed = false))
        return
      }

      // 4. Divide message & check multipart limits
      val smsManager = resolveSmsManager()
      val parts = smsManager.divideMessage(message)
      if (parts == null || parts.isEmpty()) {
        val failEntry = completeImmediateFailure(
          jobUid = jobUid,
          lockToken = lockToken,
          recipient = normalizedRecipient,
          message = message,
          isTestSms = isTestSms,
          errorCode = "DIVIDE_MESSAGE_FAILED",
          errorMessage = "SmsManager.divideMessage returned no parts",
        )
        promise.resolve(ledgerEntryToResultMap(failEntry, alreadyProcessed = false))
        return
      }

      if (parts.size > MAX_MESSAGE_PARTS) {
        val failEntry = completeImmediateFailure(
          jobUid = jobUid,
          lockToken = lockToken,
          recipient = normalizedRecipient,
          message = message,
          isTestSms = isTestSms,
          errorCode = "TOO_MANY_SMS_PARTS",
          errorMessage = "Message requires ${parts.size} parts (max $MAX_MESSAGE_PARTS)",
        )
        promise.resolve(ledgerEntryToResultMap(failEntry, alreadyProcessed = false))
        return
      }

      // 5. Synchronously persist SENDING state in the durable ledger BEFORE calling SmsManager
      ledgerStore.recordSending(
        jobUid = jobUid,
        lockToken = lockToken,
        recipient = normalizedRecipient,
        message = message,
        partsTotal = parts.size,
        isTestSms = isTestSms,
      )

      // 6. Register per-operation BroadcastReceiver & PendingIntents
      val operationId = "${jobUid}_${UUID.randomUUID().toString().substring(0, 8)}"
      val secretToken = UUID.randomUUID().toString()
      val sentAction = "${reactContext.packageName}.SMS_SENT.$operationId"
      val deliveredAction = "${reactContext.packageName}.SMS_DELIVERED.$operationId"

      val operation = InFlightOperation(
        operationId = operationId,
        jobUid = jobUid,
        lockToken = lockToken,
        recipient = normalizedRecipient,
        partsTotal = parts.size,
        secretToken = secretToken,
        sentAction = sentAction,
        deliveredAction = deliveredAction,
        promise = promise,
      )

      activeOperations[operationId] = operation
      registerOperationReceivers(operation)

      val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        // Explicit package intent + FLAG_MUTABLE allows Android Telephony to populate 'errorCode' extra
        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }

      val sentIntents = ArrayList<PendingIntent>(parts.size)
      val deliveredIntents = ArrayList<PendingIntent>(parts.size)

      for (partIndex in 0 until parts.size) {
        val sentIntent = Intent(sentAction).apply {
          setPackage(reactContext.packageName)
          putExtra("operationId", operationId)
          putExtra("jobUid", jobUid)
          putExtra("partIndex", partIndex)
          putExtra("partsTotal", parts.size)
          putExtra("secretToken", secretToken)
        }
        val deliveredIntent = Intent(deliveredAction).apply {
          setPackage(reactContext.packageName)
          putExtra("operationId", operationId)
          putExtra("jobUid", jobUid)
          putExtra("partIndex", partIndex)
          putExtra("partsTotal", parts.size)
          putExtra("secretToken", secretToken)
        }

        val sentReqCode = requestCodeGenerator.incrementAndGet()
        val delivReqCode = requestCodeGenerator.incrementAndGet()

        sentIntents.add(
          PendingIntent.getBroadcast(reactContext, sentReqCode, sentIntent, pendingIntentFlags)
        )
        deliveredIntents.add(
          PendingIntent.getBroadcast(reactContext, delivReqCode, deliveredIntent, pendingIntentFlags)
        )
      }

      // Schedule timeout safeguard in case PendingIntent never returns
      val timeoutRunnable = Runnable {
        onOperationTimeout(operationId)
      }
      operation.timeoutRunnable = timeoutRunnable
      mainHandler.postDelayed(timeoutRunnable, timeoutMs)

      // 7. Invoke Android SmsManager
      try {
        if (parts.size == 1) {
          smsManager.sendTextMessage(
            normalizedRecipient,
            null,
            parts[0],
            sentIntents[0],
            deliveredIntents[0]
          )
        } else {
          smsManager.sendMultipartTextMessage(
            normalizedRecipient,
            null,
            parts,
            sentIntents,
            deliveredIntents
          )
        }
      } catch (sendEx: Exception) {
        // SmsManager threw synchronously before dispatching to modem
        cleanupOperation(operation)
        val failEntry = ledgerStore.recordFinalResult(
          jobUid = jobUid,
          state = "FAILED",
          partsTotal = parts.size,
          partsSent = 0,
          partsFailed = parts.size,
          errorCode = "SMS_MANAGER_EXCEPTION",
          errorMessage = sendEx.message ?: "SmsManager threw an exception",
          partResultsJson = "[]",
        )
        if (operation.completed.compareAndSet(false, true)) {
          if (failEntry != null) {
            promise.resolve(ledgerEntryToResultMap(failEntry, alreadyProcessed = false))
          } else {
            promise.reject("SMS_MANAGER_EXCEPTION", sendEx.message, sendEx)
          }
        }
      }
    } catch (e: Exception) {
      promise.reject("SEND_SMS_UNEXPECTED_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getJobLedgerEntry(jobUid: String, promise: Promise) {
    try {
      val entry = ledgerStore.getEntry(jobUid.trim())
      if (entry == null) {
        promise.resolve(null)
      } else {
        promise.resolve(ledgerEntryToWritableMap(entry))
      }
    } catch (e: Exception) {
      promise.reject("GET_LEDGER_ENTRY_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getUnsyncedLedgerEntries(promise: Promise) {
    try {
      val list = ledgerStore.getUnsyncedEntries()
      val arr = Arguments.createArray()
      for (entry in list) {
        arr.pushMap(ledgerEntryToWritableMap(entry))
      }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("GET_UNSYNCED_LEDGER_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun markLedgerEntrySynced(jobUid: String, promise: Promise) {
    try {
      val ok = ledgerStore.markSynced(jobUid.trim())
      promise.resolve(ok)
    } catch (e: Exception) {
      promise.reject("MARK_LEDGER_SYNCED_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getRecentLedgerEntries(limit: Int, promise: Promise) {
    try {
      val list = ledgerStore.getRecentEntries(limit)
      val arr = Arguments.createArray()
      for (entry in list) {
        arr.pushMap(ledgerEntryToWritableMap(entry))
      }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("GET_RECENT_LEDGER_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun saveDeviceConfig(serverUrl: String, deviceId: String, deviceSecret: String, promise: Promise) {
    try {
      ledgerStore.saveDeviceConfig(serverUrl, deviceId, deviceSecret)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SAVE_CONFIG_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun loadDeviceConfig(promise: Promise) {
    try {
      val (serverUrl, deviceId, deviceSecret) = ledgerStore.loadDeviceConfig()
      val map = Arguments.createMap().apply {
        putString("serverUrl", serverUrl)
        putString("deviceId", deviceId)
        putString("deviceSecret", deviceSecret)
      }
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("LOAD_CONFIG_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun setKeepScreenOn(enabled: Boolean, promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    activity.runOnUiThread {
      try {
        if (enabled) {
          activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("KEEP_SCREEN_ON_ERROR", e.message, e)
      }
    }
  }

  @ReactMethod
  fun getNetworkStatus(promise: Promise) {
    try {
      promise.resolve(readCurrentNetworkStatusMap())
    } catch (e: Exception) {
      promise.reject("NETWORK_STATUS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun setNetworkMonitoringEnabled(enabled: Boolean, promise: Promise) {
    try {
      if (enabled) {
        startNetworkCallbackInternal()
      } else {
        stopNetworkCallbackInternal()
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("NETWORK_MONITOR_ERROR", e.message, e)
    }
  }

  @Synchronized
  private fun startNetworkCallbackInternal() {
    if (networkCallback != null) return
    val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        emitJsEvent("onNetworkChanged", readCurrentNetworkStatusMap())
      }

      override fun onLost(network: Network) {
        emitJsEvent("onNetworkChanged", readCurrentNetworkStatusMap())
      }

      override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
        emitJsEvent("onNetworkChanged", readCurrentNetworkStatusMap())
      }
    }
    cm.registerDefaultNetworkCallback(cb)
    networkCallback = cb
  }

  @Synchronized
  private fun stopNetworkCallbackInternal() {
    val cb = networkCallback ?: return
    networkCallback = null
    try {
      val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      cm?.unregisterNetworkCallback(cb)
    } catch (_: Exception) {
    }
  }

  private fun readCurrentNetworkStatusMap(): WritableMap {
    val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    val activeNetwork = cm?.activeNetwork
    val caps = if (activeNetwork != null) cm.getNetworkCapabilities(activeNetwork) else null
    val hasInternet = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    val isValidated = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    val transport = when {
      caps == null -> "NONE"
      caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
      caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
      caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
      else -> "OTHER"
    }
    return Arguments.createMap().apply {
      putBoolean("isConnected", hasInternet)
      putBoolean("isValidated", isValidated)
      putString("transport", transport)
      putDouble("timestamp", System.currentTimeMillis().toDouble())
    }
  }

  // ---- Internal Helpers ----

  private fun registerOperationReceivers(operation: InFlightOperation) {
    val sentReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent == null) return
        val token = intent.getStringExtra("secretToken")
        if (token != operation.secretToken) return
        val partIndex = intent.getIntExtra("partIndex", 0)
        val radioError = intent.getIntExtra("errorCode", -1)
        handlePartSentCallback(operation, partIndex, resultCode, radioError)
      }
    }

    val deliveredReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent == null) return
        val token = intent.getStringExtra("secretToken")
        if (token != operation.secretToken) return
        val partIndex = intent.getIntExtra("partIndex", 0)
        handlePartDeliveredCallback(operation.jobUid, partIndex, operation.partsTotal, resultCode)
      }
    }

    operation.sentReceiver = sentReceiver
    operation.deliveredReceiver = deliveredReceiver

    ContextCompat.registerReceiver(
      reactContext,
      sentReceiver,
      IntentFilter(operation.sentAction),
      ContextCompat.RECEIVER_EXPORTED
    )
    ContextCompat.registerReceiver(
      reactContext,
      deliveredReceiver,
      IntentFilter(operation.deliveredAction),
      ContextCompat.RECEIVER_EXPORTED
    )
  }

  @Synchronized
  private fun handlePartSentCallback(
    operation: InFlightOperation,
    partIndex: Int,
    resultCode: Int,
    radioErrorCode: Int
  ) {
    if (partIndex !in 0 until operation.partsTotal) return
    if (operation.partStates[partIndex] != 0) {
      // Duplicate broadcast for the same part index; ignore
      return
    }

    if (resultCode == Activity.RESULT_OK) {
      operation.partStates[partIndex] = 1
      operation.partErrorCodes[partIndex] = null
    } else {
      operation.partStates[partIndex] = -1
      operation.partErrorCodes[partIndex] = mapSmsResultCodeToString(resultCode)
    }
    operation.partResultCodes[partIndex] = resultCode
    operation.partRadioErrors[partIndex] = radioErrorCode

    // Emit progress event to JS
    val progressEvent = Arguments.createMap().apply {
      putString("jobUid", operation.jobUid)
      putInt("partIndex", partIndex)
      putInt("partsTotal", operation.partsTotal)
      putBoolean("success", resultCode == Activity.RESULT_OK)
      putString("errorCode", operation.partErrorCodes[partIndex])
      putInt("resultCode", resultCode)
      putInt("radioErrorCode", radioErrorCode)
    }
    emitJsEvent("onSmsPartSent", progressEvent)

    // Check if all parts have reported back
    val allReported = operation.partStates.all { it != 0 }
    if (allReported) {
      finalizeOperation(operation, timedOut = false)
    }
  }

  private fun handlePartDeliveredCallback(
    jobUid: String,
    partIndex: Int,
    partsTotal: Int,
    resultCode: Int
  ) {
    val updated = ledgerStore.incrementDelivered(jobUid)
    val event = Arguments.createMap().apply {
      putString("jobUid", jobUid)
      putInt("partIndex", partIndex)
      putInt("partsTotal", partsTotal)
      putInt("partsDelivered", updated?.partsDelivered ?: 1)
      putBoolean("delivered", resultCode == Activity.RESULT_OK)
      putLong("timestamp", System.currentTimeMillis())
    }
    emitJsEvent("onSmsDelivered", event)
  }

  @Synchronized
  private fun onOperationTimeout(operationId: String) {
    val operation = activeOperations[operationId] ?: return
    finalizeOperation(operation, timedOut = true)
  }

  @Synchronized
  private fun finalizeOperation(operation: InFlightOperation, timedOut: Boolean) {
    if (!operation.completed.compareAndSet(false, true)) {
      return
    }

    cleanupOperation(operation)

    var partsSent = 0
    var partsFailed = 0
    var partsPending = 0
    val firstErrors = mutableListOf<String>()
    val partResultsJsonArr = JSONArray()

    for (i in 0 until operation.partsTotal) {
      val st = operation.partStates[i]
      val statusLabel = when (st) {
        1 -> {
          partsSent++
          "SENT_OK"
        }
        -1 -> {
          partsFailed++
          val err = operation.partErrorCodes[i] ?: "UNKNOWN_ERROR"
          if (!firstErrors.contains(err)) firstErrors.add(err)
          "FAILED"
        }
        else -> {
          partsPending++
          "TIMEOUT_PENDING"
        }
      }

      val partObj = JSONObject().apply {
        put("partIndex", i)
        put("status", statusLabel)
        put("resultCode", operation.partResultCodes[i])
        put("radioErrorCode", operation.partRadioErrors[i])
        put("errorCode", operation.partErrorCodes[i] ?: JSONObject.NULL)
      }
      partResultsJsonArr.put(partObj)
    }

    val finalState: String
    val finalErrorCode: String?
    val finalErrorMessage: String?

    when {
      partsSent == operation.partsTotal -> {
        finalState = "SUBMITTED"
        finalErrorCode = null
        finalErrorMessage = null
      }
      partsSent == 0 && partsFailed == operation.partsTotal && !timedOut -> {
        finalState = "FAILED"
        finalErrorCode = firstErrors.firstOrNull() ?: "SMS_SEND_FAILED"
        finalErrorMessage = "All ${operation.partsTotal} part(s) failed: ${firstErrors.joinToString(", ")}"
      }
      partsSent > 0 && partsSent < operation.partsTotal -> {
        // Partial multipart submission: some parts went through carrier, some failed or timed out
        finalState = "UNKNOWN"
        finalErrorCode = "PARTIAL_MULTIPART_SUBMISSION"
        finalErrorMessage =
          "Ambiguous multipart result: $partsSent/${operation.partsTotal} sent, $partsFailed failed, $partsPending timed out"
      }
      else -> {
        // Timed out waiting for PendingIntent callbacks
        finalState = "UNKNOWN"
        finalErrorCode = "SMS_SENT_CALLBACK_TIMEOUT"
        finalErrorMessage =
          "Timed out waiting for SmsManager PendingIntent ($partsSent/${operation.partsTotal} confirmed, $partsPending pending)"
      }
    }

    val updatedEntry = ledgerStore.recordFinalResult(
      jobUid = operation.jobUid,
      state = finalState,
      partsTotal = operation.partsTotal,
      partsSent = partsSent,
      partsFailed = partsFailed,
      errorCode = finalErrorCode,
      errorMessage = finalErrorMessage,
      partResultsJson = partResultsJsonArr.toString(),
    )

    if (updatedEntry != null) {
      operation.promise.resolve(ledgerEntryToResultMap(updatedEntry, alreadyProcessed = false))
    } else {
      val fallback = Arguments.createMap().apply {
        putString("jobUid", operation.jobUid)
        putString("status", finalState)
        putInt("partsTotal", operation.partsTotal)
        putInt("partsSent", partsSent)
        putInt("partsFailed", partsFailed)
        putString("errorCode", finalErrorCode)
        putString("errorMessage", finalErrorMessage)
      }
      operation.promise.resolve(fallback)
    }
  }

  private fun cleanupOperation(operation: InFlightOperation) {
    activeOperations.remove(operation.operationId)
    operation.timeoutRunnable?.let { mainHandler.removeCallbacks(it) }
    operation.sentReceiver?.let {
      try {
        reactContext.unregisterReceiver(it)
      } catch (_: Exception) {
      }
    }
    // Keep deliveredReceiver active for 60s to catch carrier delivery receipts while app is open
    operation.deliveredReceiver?.let { receiver ->
      mainHandler.postDelayed({
        try {
          reactContext.unregisterReceiver(receiver)
        } catch (_: Exception) {
        }
      }, 60_000L)
    }
  }

  private fun completeImmediateFailure(
    jobUid: String,
    lockToken: String?,
    recipient: String,
    message: String,
    isTestSms: Boolean,
    errorCode: String,
    errorMessage: String
  ): LedgerEntry {
    ledgerStore.recordAccepted(
      jobUid = jobUid,
      lockToken = lockToken,
      recipient = recipient,
      message = message,
      partsTotal = 1,
      isTestSms = isTestSms,
    )
    return ledgerStore.recordFinalResult(
      jobUid = jobUid,
      state = "FAILED",
      partsTotal = 1,
      partsSent = 0,
      partsFailed = 1,
      errorCode = errorCode,
      errorMessage = errorMessage,
      partResultsJson = "[]",
    )!!
  }

  private fun resolveSmsManager(): SmsManager {
    val subId = SubscriptionManager.getDefaultSmsSubscriptionId()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val baseManager = reactContext.getSystemService(SmsManager::class.java)
      if (baseManager != null) {
        return if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
          baseManager.createForSubscriptionId(subId)
        } else {
          baseManager
        }
      }
    }
    @Suppress("DEPRECATION")
    return if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
      SmsManager.getSmsManagerForSubscriptionId(subId)
    } else {
      SmsManager.getDefault()
    }
  }

  private fun normalizePhoneNumber(raw: String): String {
    val trimmed = raw.trim().replace(Regex("[\\s\\-().]"), "")
    return trimmed
  }

  private fun mapSmsResultCodeToString(resultCode: Int): String {
    return when (resultCode) {
      Activity.RESULT_OK -> "RESULT_OK"
      SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "RESULT_ERROR_GENERIC_FAILURE"
      SmsManager.RESULT_ERROR_RADIO_OFF -> "RESULT_ERROR_RADIO_OFF"
      SmsManager.RESULT_ERROR_NULL_PDU -> "RESULT_ERROR_NULL_PDU"
      SmsManager.RESULT_ERROR_NO_SERVICE -> "RESULT_ERROR_NO_SERVICE"
      SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "RESULT_ERROR_LIMIT_EXCEEDED"
      SmsManager.RESULT_ERROR_FDN_CHECK_FAILURE -> "RESULT_ERROR_FDN_CHECK_FAILURE"
      SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED -> "RESULT_ERROR_SHORT_CODE_NOT_ALLOWED"
      SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED -> "RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED"
      else -> "SMS_ERROR_CODE_$resultCode"
    }
  }

  private fun ledgerEntryToResultMap(entry: LedgerEntry, alreadyProcessed: Boolean): WritableMap {
    return Arguments.createMap().apply {
      putString("jobUid", entry.jobUid)
      putString("lockToken", entry.lockToken)
      putString("recipient", entry.recipient)
      putString("status", entry.state)
      putInt("partsTotal", entry.partsTotal)
      putInt("partsSent", entry.partsSent)
      putInt("partsFailed", entry.partsFailed)
      putInt("partsDelivered", entry.partsDelivered)
      putString("errorCode", entry.errorCode)
      putString("errorMessage", entry.errorMessage)
      putString("partResultsJson", entry.partResultsJson)
      putDouble("timestamp", entry.updatedAt.toDouble())
      putBoolean("alreadyProcessed", alreadyProcessed)
    }
  }

  private fun ledgerEntryToWritableMap(entry: LedgerEntry): WritableMap {
    return Arguments.createMap().apply {
      putString("jobUid", entry.jobUid)
      putString("lockToken", entry.lockToken)
      putString("recipient", entry.recipient)
      putString("messagePreview", entry.messagePreview)
      putString("state", entry.state)
      putInt("partsTotal", entry.partsTotal)
      putInt("partsSent", entry.partsSent)
      putInt("partsFailed", entry.partsFailed)
      putInt("partsDelivered", entry.partsDelivered)
      putString("errorCode", entry.errorCode)
      putString("errorMessage", entry.errorMessage)
      putString("partResultsJson", entry.partResultsJson)
      putDouble("createdAt", entry.createdAt.toDouble())
      putDouble("updatedAt", entry.updatedAt.toDouble())
      putBoolean("syncedToServer", entry.syncedToServer)
      putBoolean("isTestSms", entry.isTestSms)
    }
  }

  private fun emitJsEvent(eventName: String, params: WritableMap) {
    if (reactContext.hasActiveReactInstance()) {
      reactContext.emitDeviceEvent(eventName, params)
    }
  }

  private class InFlightOperation(
    val operationId: String,
    val jobUid: String,
    val lockToken: String?,
    val recipient: String,
    val partsTotal: Int,
    val secretToken: String,
    val sentAction: String,
    val deliveredAction: String,
    val promise: Promise
  ) {
    val completed = AtomicBoolean(false)
    val partStates = IntArray(partsTotal) { 0 } // 0 = pending, 1 = ok, -1 = failed
    val partResultCodes = IntArray(partsTotal) { 0 }
    val partRadioErrors = IntArray(partsTotal) { -1 }
    val partErrorCodes = Array<String?>(partsTotal) { null }
    var sentReceiver: BroadcastReceiver? = null
    var deliveredReceiver: BroadcastReceiver? = null
    var timeoutRunnable: Runnable? = null
  }
}
