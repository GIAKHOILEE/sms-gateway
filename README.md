# Trạm Gửi SMS Cá Nhân (Personal SMS Gateway - Android App)

Ứng dụng di động **Trạm Gửi SMS Cá Nhân** được xây dựng bằng **React Native (TypeScript)** kết hợp **Kotlin Native Module (`SmsManager`)** trên hệ điều hành **Android**. Ứng dụng biến điện thoại Android có lắp thẻ SIM vật lý thành trạm phát tin nhắn SMS cho hệ thống **Academy Backend (`academy`)**.

---

## 1. Tại sao ứng dụng chỉ chạy trên Android (iOS không hỗ trợ)?

**Đúng vậy — ứng dụng này CHỈ hoạt động trên Android và KHÔNG thể hoạt động trên iOS (iPhone).**

Lý do kỹ thuật đến từ chính sách bảo mật phần cứng và hệ điều hành của Apple:
1. **iOS không cấp API gửi SMS tự động (`Programmatic SMS`)**:
   - Trên iOS, Apple chỉ cung cấp `MFMessageComposeViewController` (mở giao diện ứng dụng Tin nhắn mặc định của iPhone lên và **bắt buộc người dùng phải tự bấm nút Gửi tay** cho từng tin nhắn một).
   - Apple tuyệt đối cấm các ứng dụng bên thứ ba truy cập trực tiếp vào baseband/SIM để tự động gửi SMS từ danh sách hàng đợi của máy chủ.
2. **Android cung cấp quyền `SEND_SMS` và `android.telephony.SmsManager`**:
   - Trên Android, khi người dùng cấp quyền `android.permission.SEND_SMS` và cài đặt qua file APK, ứng dụng có thể gọi trực tiếp `SmsManager.sendTextMessage()` / `sendMultipartTextMessage()` ở tầng Kotlin để phát tin nhắn qua SIM vật lý và nhận lại kết quả từng phần tin nhắn qua `PendingIntent` (`SMS_SENT`, `SMS_DELIVERED`).

---

## 2. Đặc điểm & Nguyên tắc Hoạt động

- **Hoạt động theo yêu cầu (Foreground On-Demand):**
  - Ứng dụng **không chạy ngầm**, không dùng `ForegroundService`, `WorkManager` hay `FCM`.
  - Chỉ khi người dùng mở ứng dụng và bấm **Khởi động Kết nối**, ứng dụng mới giữ sáng màn hình (`FLAG_KEEP_SCREEN_ON`) và mở kết nối WebSocket (`ws://` hoặc `wss://`) tới máy chủ NestJS.
  - Khi người dùng bấm **Ngắt kết nối** hoặc đóng ứng dụng, kết nối WebSocket đóng lại ngay lập tức và thiết bị chuyển sang trạng thái `NGOẠI TUYẾN (OFFLINE)`. Các tin nhắn chờ trên máy chủ vẫn được giữ nguyên ở trạng thái `PENDING`.
- **Bảo mật Khóa Thiết bị bằng Android Keystore:**
  - `Device Secret` (64 ký tự) được mã hóa bằng thuật toán `AES/GCM/NoPadding` với khóa phần cứng lưu trong `AndroidKeyStore`.
- **Sổ cái Bền vững (Durable Local Ledger):**
  - Trước khi gọi `SmsManager`, tầng Kotlin ghi đồng bộ (`SharedPreferences.commit()`) trạng thái `ACCEPTED` của `jobUid`.
  - Nếu một `jobUid` đã từng được xử lý (`SUBMITTED`, `FAILED`, `UNKNOWN`), điện thoại sẽ trả lại kết quả cũ cho máy chủ mà **không bao giờ gửi trùng tin nhắn SMS**.
- **Tự động Kết nối lại thông minh (Exponential Backoff + Jitter):**
  - Khi mạng Wi-Fi/4G bị gián đoạn tạm thời trong lúc ứng dụng đang mở, `GatewaySocketClient` tự động thử kết nối lại theo chu kỳ `1s, 2s, 4s, 8s, 16s, 32s, tối đa 60s` (kèm độ lệch ngẫu nhiên ±20%) và tự động kết nối lại ngay khi `ConnectivityManager` phát hiện có mạng trở lại.

---

## 3. Cấu trúc 4 Màn hình Giao diện (Tiếng Việt)

1. **⚡ Trang Kết nối ([`src/screens/ConnectScreen.tsx`](./src/screens/ConnectScreen.tsx)):**
   - Vòng tròn trạng thái trực quan (`TRẠM ĐANG HOẠT ĐỘNG` / `ĐANG KẾT NỐI TỚI MÁY CHỦ` / `TRẠM ĐANG NGOẠI TUYẾN`).
   - Nút lớn **Khởi động Kết nối / Ngắt kết nối**.
   - 3 ô thống kê nhanh: **Đã gửi**, **Đang xử lý**, **Lỗi / Chưa rõ**.
   - Bảng kiểm tra nhanh: Quyền gửi SMS, Thẻ SIM mặc định, Thiết bị & Máy chủ.
   - Khung **Gửi Tin nhắn Thử nghiệm** trực tiếp qua SIM trên máy.
2. **⚙️ Trang Cấu hình ([`src/screens/ConfigScreen.tsx`](./src/screens/ConfigScreen.tsx)):**
   - Nhập và lưu `Địa chỉ Máy chủ Kết nối (WS / WSS)`, `Mã Thiết bị`, `Khóa bí mật của Thiết bị` (có nút `Hiện khóa` / `Ẩn khóa`).
   - Kiểm tra và cấp quyền hệ thống `SEND_SMS`.
3. **📋 Trang Lịch sử ([`src/screens/HistoryScreen.tsx`](./src/screens/HistoryScreen.tsx)):**
   - Bộ lọc trạng thái: `Tất cả`, `Đã gửi`, `Đang xử lý`, `Lỗi / Chưa rõ`.
   - Hiển thị chi tiết từng tin nhắn: số người nhận, số phần tin nhắn (`partsSent/partsTotal`), nội dung, trạng thái đồng bộ máy chủ và báo cáo nhận tin (`Đã nhận`).
4. **🖥️ Trang Nhật ký ([`src/screens/LogsScreen.tsx`](./src/screens/LogsScreen.tsx)):**
   - Theo dõi log thời gian thực theo các mức độ: `Thông tin`, `Thành công`, `Cảnh báo`, `Lỗi`, kèm nút `Xóa nhật ký`.

---

## 4. Cấu trúc Mã nguồn Chính

```text
SMSGateway/
├── App.tsx                                  # Khung điều hướng 4 tab & điều phối sự kiện WebSocket / Native
├── src/
│   ├── native/
│   │   └── SmsSenderNative.ts               # Bridge TypeScript giao tiếp với Kotlin Native Module
│   ├── screens/
│   │   ├── ConnectScreen.tsx                # Trang Kết nối & Gửi SMS thử nghiệm
│   │   ├── ConfigScreen.tsx                 # Trang Cấu hình thiết bị & Quyền hệ thống
│   │   ├── HistoryScreen.tsx                # Trang Lịch sử SMS trên thiết bị
│   │   └── LogsScreen.tsx                   # Trang Nhật ký hoạt động
│   ├── services/
│   │   └── GatewaySocketClient.ts           # Client WebSocket (Auth, Heartbeat, Backoff, Network recovery)
│   └── types/
│       └── sms.types.ts                     # Kiểu dữ liệu TypeScript
└── android/app/src/main/java/com/smsgateway/sms/
    ├── SmsSenderModule.kt                   # Kotlin Native Module: SmsManager, PendingIntent, ConnectivityManager
    ├── SmsLedgerStore.kt                    # Sổ cái SharedPreferences (commit đồng bộ) & Android Keystore AES-GCM
    └── SmsSenderPackage.kt                  # Đăng ký ReactPackage
```

---

## 5. Hướng dẫn Chạy Thử nghiệm (Debug qua USB / Mạng LAN)

### 5.1. Yêu cầu
- Điện thoại Android thật (có lắp SIM vật lý) đã bật **Gỡ lỗi USB (USB Debugging)**.
- Máy tính cài đặt Node.js `>= 22`, JDK 17 và Android SDK (`adb`).

### 5.2. Khởi chạy ở chế độ Phát triển
1. Cài đặt gói phụ thuộc:
   ```bash
   yarn install
   ```
2. Chuyển tiếp cổng từ điện thoại về máy tính qua cáp USB:
   ```bash
   adb reverse tcp:8081 tcp:8081
   adb reverse tcp:5000 tcp:5000
   ```
3. Biên dịch và cài đặt lên điện thoại:
   ```bash
   yarn android
   ```
4. Trong tab **⚙️ Cấu hình** của ứng dụng:
   - Nếu cắm cáp USB (đã chạy `adb reverse tcp:5000 tcp:5000`): chọn `ws://127.0.0.1:5000/ws/sms-gateway`.
   - Nếu dùng chung mạng Wi-Fi LAN với máy tính: chọn `ws://<IP_LAN_MAY_TINH>:5000/ws/sms-gateway` (ví dụ `ws://192.168.1.8:5000/ws/sms-gateway`).
   - Nhập `Mã Thiết bị` và `Khóa bí mật` lấy từ API `POST /api/v1/admin/sms-gateway/devices/register`.

---

## 6. Hướng dẫn Xuất File APK Cài đặt Trực tiếp

Để xuất file APK đem cài đặt trực tiếp lên điện thoại Android:

### 6.1. Xuất bản APK Release
```bash
cd android
./gradlew assembleRelease
```
*(Trên Windows PowerShell: `.\gradlew.bat assembleRelease`)*

File APK sau khi biên dịch sẽ nằm tại:
```text
android/app/build/outputs/apk/release/app-release.apk
```

Bạn có thể chép file `app-release.apk` này sang điện thoại để cài đặt trực tiếp hoặc cài qua lệnh:
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```
