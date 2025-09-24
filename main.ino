#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <WebSocketsClient.h>

// WiFi credentials
const char* ssid = "Kong_Wifi";
const char* password = "Password";

// Server API (Production: set to your domain with HTTPS)
String serverHost = "https://lightlink.kongwatcharapong.in.th"; // e.g., https://your-domain
int serverPort = 443;                                          // 443 for HTTPS (use 3000 for local dev)
String authToken = "KongPassword@";                           // Must match LIGHTLINK_TOKEN

// Optional: TLS setup
WiFiClientSecure secureClient;
WebSocketsClient wsClient;
bool wsConnected = false;
unsigned long nextWsReconnectAt = 0;
uint8_t wsReconnectAttempts = 0;
// If you have your server's root CA, set it here for certificate pinning.
// const char* rootCACert = R"CERT(
// -----BEGIN CERTIFICATE-----
// ... your CA PEM ...
// -----END CERTIFICATE-----
// )CERT";

// Time / NTP (set to GMT+7 as per user local time)
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 7 * 3600;  // GMT+7
const int daylightOffset_sec = 0;

// Light model
struct Light {
  char name[16];
  uint8_t pin;
  bool state;
  // Daily schedule (24h)
  int onHour;   // 0..23
  int onMin;    // 0..59
  int offHour;  // 0..23
  int offMin;   // 0..59
  bool scheduleEnabled;
};

// Dynamic lights loaded from server (with fallback defaults)
const size_t MAX_LIGHTS = 10;
Light lights[MAX_LIGHTS];
size_t NUM_LIGHTS = 0;

// Track GPIO pin states for allowed pins (19,21,22,23)
bool pinStates[4] = { false, false, false, false };
int pinIndex(uint8_t p) {
  if (p == 19) return 0;
  if (p == 21) return 1;
  if (p == 22) return 2;
  if (p == 23) return 3;
  return -1;
}
void recalcPinState(uint8_t p) {
  int idx = pinIndex(p);
  if (idx < 0) return;
  bool on = false;
  for (size_t i = 0; i < NUM_LIGHTS; i++) {
    if (lights[i].pin == p) { on = on || lights[i].state; }
  }
  pinStates[idx] = on;
}

// Forward declarations
bool loadLightsFromServer();
void clearLights();
bool parseTimeHM(const char* s, int& h, int& m);
bool isAllowedPin(uint8_t p);

int lastCheckedMinute = -1; // to avoid re-applying schedule multiple times per minute

void setup() {
  Serial.begin(115200);
  Serial.println("\nStarting LightLink...");

  // WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  // Time
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("Failed to obtain time");
  } else {
    Serial.printf("Time synced: %02d:%02d\n", timeinfo.tm_hour, timeinfo.tm_min);
  }

  // TLS client setup (production). If no CA provided, allow insecure (not recommended for production).
  // Uncomment rootCACert above and use setCACert for proper validation.
  // secureClient.setCACert(rootCACert);
  secureClient.setInsecure();

  // Load lights configuration from server (MongoDB)
  if (!loadLightsFromServer()) {
    Serial.println("Load lights from server failed, no lights configured");
  }

  // Now configure GPIO pins for loaded lights
  configurePinsForCurrentLights();

  // Connect WebSocket to server
  delay(200);
  warmupServer();
  delay(200);
  connectWebSocket();
}

void applyLightState(size_t idx, bool on) {
  lights[idx].state = on;
  digitalWrite(lights[idx].pin, on ? HIGH : LOW);
  recalcPinState(lights[idx].pin);
}

int timeToMinutes(int h, int m) { return h * 60 + m; }

bool isWithinSchedule(const Light& L, int curMin) {
  int onM = timeToMinutes(L.onHour, L.onMin);
  int offM = timeToMinutes(L.offHour, L.offMin);
  if (onM == offM) return false; // degenerate
  if (onM < offM) {
    // Same-day range
    return curMin >= onM && curMin < offM;
  } else {
    // Overnight range (e.g., 21:00 to 07:00)
    return (curMin >= onM) || (curMin < offM);
  }
}

void checkAndApplySchedules() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return;
  int curMinute = timeinfo.tm_hour * 60 + timeinfo.tm_min;
  if (timeinfo.tm_min == lastCheckedMinute) return; // only once per minute
  lastCheckedMinute = timeinfo.tm_min;

  for (size_t i = 0; i < NUM_LIGHTS; i++) {
    if (!lights[i].scheduleEnabled) continue;
    bool shouldBeOn = isWithinSchedule(lights[i], curMinute);
    if (shouldBeOn != lights[i].state) {
      applyLightState(i, shouldBeOn);
      sendStatusWS();
    }
  }
}

String buildBaseUrl(const String& path) {
  // Do not append default ports in URL (443 for https, 80 for http)
  bool isHttps = serverHost.startsWith("https://");
  if ((isHttps && serverPort == 443) || (!isHttps && serverPort == 80)) {
    return serverHost + path;
  }
  return serverHost + ":" + String(serverPort) + path;
}

bool parseTimeHM(const char* s, int& h, int& m) {
  if (!s || strlen(s) < 4) return false;
  int hh = atoi(String(s).substring(0, 2).c_str());
  int mm = atoi(String(s).substring(3, 5).c_str());
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return false;
  h = hh; m = mm; return true;
}

bool isAllowedPin(uint8_t p) {
  return (p == 19) || (p == 21) || (p == 22) || (p == 23);
}

void configurePinsForCurrentLights() {
  for (size_t i = 0; i < NUM_LIGHTS; i++) {
    pinMode(lights[i].pin, OUTPUT);
    digitalWrite(lights[i].pin, lights[i].state ? HIGH : LOW);
  }
  // Recompute pinStates
  pinStates[0] = pinStates[1] = pinStates[2] = pinStates[3] = false;
  for (size_t i = 0; i < NUM_LIGHTS; i++) recalcPinState(lights[i].pin);
}

void warmupServer() {
  // Touch the Socket.IO API route to let the server initialize WS upgrade handler
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = buildBaseUrl("/api/socket.io");
  if (serverHost.startsWith("https://")) {
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }
  // no need for auth here; endpoint just initializes server-side listeners
  int code = http.GET();
  Serial.print("Warmup /api/socket.io -> "); Serial.println(code);
  http.end();
}

void clearLights() {
  NUM_LIGHTS = 0;
  for (size_t i = 0; i < MAX_LIGHTS; i++) {
    lights[i].name[0] = '\0';
    lights[i].pin = 0;
    lights[i].state = false;
    lights[i].onHour = 0; lights[i].onMin = 0; lights[i].offHour = 0; lights[i].offMin = 0;
    lights[i].scheduleEnabled = false;
  }
}

bool loadLightsFromServer() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = buildBaseUrl("/api/lights");
  if (serverHost.startsWith("https://")) {
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }
  http.addHeader("Authorization", String("Bearer ") + authToken);
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.print("GET /api/lights -> "); Serial.println(code);
    http.end();
    return false;
  }
  String resp = http.getString();
  http.end();

  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.print("/api/lights JSON error: "); Serial.println(err.c_str());
    return false;
  }
  JsonArray arr = doc["lights"].as<JsonArray>();
  if (arr.isNull()) return false;

  clearLights();
  for (JsonObject o : arr) {
    if (NUM_LIGHTS >= MAX_LIGHTS) break;
    const char* name = o["name"] | nullptr;
    int pin = o["pin"] | -1;
    const char* onStr = o["on"] | "00:00";
    const char* offStr = o["off"] | "00:00";
    bool sched = o["scheduleEnabled"] | false;
    if (!name || pin < 0) continue;
    if (!isAllowedPin((uint8_t)pin)) {
      Serial.print("Skipping disallowed pin: "); Serial.println(pin);
      continue;
    }

    Light L;
    strncpy(L.name, name, sizeof(L.name) - 1);
    L.name[sizeof(L.name) - 1] = '\0';
    L.pin = (uint8_t)pin;
    L.state = false;
    int oh=0, om=0, fh=0, fm=0;
    if (!parseTimeHM(onStr, oh, om)) { oh = 0; om = 0; }
    if (!parseTimeHM(offStr, fh, fm)) { fh = 0; fm = 0; }
    L.onHour = oh; L.onMin = om; L.offHour = fh; L.offMin = fm;
    L.scheduleEnabled = sched;
    lights[NUM_LIGHTS++] = L;
  }
  Serial.print("Loaded lights: "); Serial.println(NUM_LIGHTS);
  return NUM_LIGHTS > 0;
}

void sendStatusWS() {
  if (!wsConnected) return;
  StaticJsonDocument<768> payload;
  payload["type"] = "status";
  JsonObject p = payload.createNestedObject("payload");
  p["device"] = "esp32-lightlink";
  p["updatedAt"] = (long)millis();
  JsonArray arr = p.createNestedArray("lights");
  for (size_t i = 0; i < NUM_LIGHTS; i++) {
    JsonObject o = arr.createNestedObject();
    o["name"] = lights[i].name;
    o["state"] = lights[i].state;
    o["pin"] = lights[i].pin;
    o["scheduleEnabled"] = lights[i].scheduleEnabled;
    char onbuf[6]; char offbuf[6];
    snprintf(onbuf, sizeof(onbuf), "%02d:%02d", lights[i].onHour, lights[i].onMin);
    snprintf(offbuf, sizeof(offbuf), "%02d:%02d", lights[i].offHour, lights[i].offMin);
    o["on"] = onbuf;
    o["off"] = offbuf;
  }
  // Include pins array for direct GPIO state even if no light maps to the pin
  JsonArray parr = p.createNestedArray("pins");
  struct { uint8_t pin; bool state; } ps[4] = { {19,false},{21,false},{22,false},{23,false} };
  for (int i = 0; i < 4; i++) { ps[i].state = pinStates[i]; }
  for (int i = 0; i < 4; i++) { JsonObject po = parr.createNestedObject(); po["pin"] = ps[i].pin; po["state"] = ps[i].state; }
  String out;
  serializeJson(payload, out);
  Serial.print("WS send status, bytes="); Serial.println(out.length());
  wsClient.sendTXT(out);
}

int findLightIndexByName(const String& name) {
  for (size_t i = 0; i < NUM_LIGHTS; i++) {
    if (name.equalsIgnoreCase(lights[i].name)) return (int)i;
  }
  return -1;
}

void handleJsonCommand(const String& json) {
  Serial.print("handleJsonCommand: "); Serial.println(json);
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Serial.print("JSON parse error: ");
    Serial.println(err.c_str());
    return;
  }

  const char* action = doc["action"] | "";

  if (strcmp(action, "set_pin") == 0) {
    // { action:"set_pin", pin: 19|21|22|23, state: true/false }
    int pin = doc["pin"] | -1;
    bool state = doc["state"] | false;
    if (isAllowedPin((uint8_t)pin)) {
      // Apply to any known lights sharing this pin
      bool any = false;
      for (size_t i = 0; i < NUM_LIGHTS; i++) {
        if (lights[i].pin == (uint8_t)pin) {
          applyLightState(i, state);
          any = true;
        }
      }
      // If none known, still drive the GPIO
      if (!any) {
        pinMode((uint8_t)pin, OUTPUT);
        digitalWrite((uint8_t)pin, state ? HIGH : LOW);
      }
      // Update tracked pin state
      int pidx = pinIndex((uint8_t)pin);
      if (pidx >= 0) pinStates[pidx] = state;
      sendStatusWS();
    }
    return;
  }

  if (strcmp(action, "reload_lights") == 0) {
    // Reload catalog from server and reconfigure pins
    // Optionally turn off previous pins first to avoid ghost states
    for (size_t i = 0; i < NUM_LIGHTS; i++) {
      digitalWrite(lights[i].pin, LOW);
    }
    if (loadLightsFromServer()) {
      configurePinsForCurrentLights();
    }
    sendStatusWS();
    return;
  }

  // For WS mode, translate get_status to sending current status over WS
  if (strcmp(action, "get_status") == 0) { sendStatusWS(); return; }

  if (strcmp(action, "set") == 0 || strcmp(action, "toggle") == 0) {
    // { action: "set", target: "kitchen"|"living"|"bedroom"|"all", state: true/false }
    String target = String((const char*)(doc["target"] | ""));
    bool hasState = doc.containsKey("state");
    bool state = doc["state"] | false;

    if (target.equalsIgnoreCase("all")) {
      for (size_t i = 0; i < NUM_LIGHTS; i++) {
        bool newState = hasState ? state : !lights[i].state; // toggle if no state
        applyLightState(i, newState);
      }
      Serial.println("Applied set/toggle to all");
      sendStatusWS();
      return;
    }

    int idx = findLightIndexByName(target);
    if (idx >= 0) {
      bool newState = hasState ? state : !lights[idx].state;
      applyLightState((size_t)idx, newState);
      Serial.print("Applied state to "); Serial.print(target); Serial.print(": "); Serial.println(newState);
      sendStatusWS();
    }
    return;
  }

  if (strcmp(action, "schedule") == 0) {
    // { action:"schedule", room:"kitchen", on:"HH:MM", off:"HH:MM", enabled:true }
    String room = String((const char*)(doc["room"] | ""));
    int idx = findLightIndexByName(room);
    if (idx < 0) return;

    const char* onStr = doc["on"] | nullptr;
    const char* offStr = doc["off"] | nullptr;
    bool en = doc["enabled"] | lights[idx].scheduleEnabled;

    if (onStr && strlen(onStr) >= 4) {
      int h = atoi(String(onStr).substring(0, 2).c_str());
      int m = atoi(String(onStr).substring(3, 5).c_str());
      lights[idx].onHour = constrain(h, 0, 23);
      lights[idx].onMin = constrain(m, 0, 59);
    }
    if (offStr && strlen(offStr) >= 4) {
      int h = atoi(String(offStr).substring(0, 2).c_str());
      int m = atoi(String(offStr).substring(3, 5).c_str());
      lights[idx].offHour = constrain(h, 0, 23);
      lights[idx].offMin = constrain(m, 0, 59);
    }
    lights[idx].scheduleEnabled = en;

    sendStatusWS();
    return;
  }

  Serial.print("Unknown action: ");
  Serial.println(action);
}

// WebSocket helpers
String extractHost(const String& url) {
  if (url.startsWith("https://")) return url.substring(8);
  if (url.startsWith("http://")) return url.substring(7);
  return url;
}

void wsEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.println("WS connected");
      wsReconnectAttempts = 0;
      sendStatusWS();
      break;
    case WStype_DISCONNECTED: {
      wsConnected = false;
      Serial.println("WS disconnected");
      // schedule a reconnect attempt with backoff
      unsigned long delayMs = 2000UL * (1UL << (wsReconnectAttempts > 4 ? 4 : wsReconnectAttempts));
      if (delayMs > 30000UL) delayMs = 30000UL;
      nextWsReconnectAt = millis() + delayMs;
      if (wsReconnectAttempts < 10) wsReconnectAttempts++;
      break;
    }
    case WStype_TEXT: {
      String msg = String((const char*)payload).substring(0, length);
      Serial.print("WS text received, bytes="); Serial.println(length);
      StaticJsonDocument<1024> doc;
      if (deserializeJson(doc, msg) == DeserializationError::Ok) {
        const char* typeStr = doc["type"] | "";
        if (strcmp(typeStr, "cmd") == 0) {
          String cmdStr; serializeJson(doc["payload"], cmdStr);
          Serial.print("Dispatching cmd payload -> "); Serial.println(cmdStr);
          handleJsonCommand(cmdStr);
        }
        // status messages from server are ignored by device
      }
    } break;
    default: break;
  }
}

void connectWebSocket() {
  String host = extractHost(serverHost);
  int slash = host.indexOf('/');
  if (slash >= 0) host = host.substring(0, slash);
  String path = String("/api/ws?token=") + authToken;
  bool isHttps = serverHost.startsWith("https://");
  Serial.print("Connecting WS to "); Serial.print(host); Serial.print(":"); Serial.print(serverPort); Serial.print(path); Serial.print(" via "); Serial.println(isHttps ? "wss" : "ws");
  if (isHttps) {
    wsClient.beginSSL(host.c_str(), serverPort, path.c_str());
  } else {
    wsClient.begin(host.c_str(), serverPort, path.c_str());
  }
  wsClient.onEvent(wsEvent);
  // Send ping every 15s, expect pong within 3s, allow 2 missed
  wsClient.enableHeartbeat(15000, 3000, 2);
  wsClient.setReconnectInterval(3000);
}

void loop() {
  // WebSocket loop
  wsClient.loop();

  // Reconnect logic if server has restarted or connection dropped
  if (!wsConnected && nextWsReconnectAt != 0 && (long)(millis() - nextWsReconnectAt) >= 0) {
    if (WiFi.status() != WL_CONNECTED) {
      // try to rejoin WiFi
      Serial.println("WiFi disconnected, reconnecting...");
      WiFi.disconnect();
      WiFi.begin(ssid, password);
      unsigned long t0 = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < 5000) { delay(200); Serial.print("."); }
      Serial.println();
    }
    // warm up server route so WS upgrade handlers are ready after restarts
    warmupServer();
    // force close and begin again
    wsClient.disconnect();
    delay(100);
    connectWebSocket();
    nextWsReconnectAt = 0; // wait for event callbacks to reschedule if needed
  }

  // Apply schedules once per minute
  checkAndApplySchedules();

  delay(10);
}