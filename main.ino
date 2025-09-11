#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// WiFi credentials
const char* ssid = "Kong_Wifi";
const char* password = "Password";

// Server API (Production: set to your domain with HTTPS)
String serverHost = "https://lightlink.kongwatcharapong.in.th"; // e.g., https://your-domain
int serverPort = 443;                                          // 443 for HTTPS (use 3000 for local dev)
String authToken = "KongPassword@";                           // Must match LIGHTLINK_TOKEN

// Optional: TLS setup
WiFiClientSecure secureClient;
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
  const char* name;
  uint8_t pin;
  bool state;
  // Daily schedule (24h)
  int onHour;   // 0..23
  int onMin;    // 0..59
  int offHour;  // 0..23
  int offMin;   // 0..59
  bool scheduleEnabled;
};

Light lights[] = {
  {"kitchen", 16, false, 18, 0, 23, 0, false},
  {"living",  17, false, 18, 0, 23, 0, false},
  {"bedroom", 18, false, 21, 0, 7,  0, false}
};
const size_t NUM_LIGHTS = sizeof(lights) / sizeof(lights[0]);

int lastCheckedMinute = -1; // to avoid re-applying schedule multiple times per minute

void setup() {
  Serial.begin(115200);
  Serial.println("\nStarting LightLink...");

  // Pins
  for (size_t i = 0; i < NUM_LIGHTS; i++) {
    pinMode(lights[i].pin, OUTPUT);
    digitalWrite(lights[i].pin, LOW);
  }

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

  // Initial status push
  delay(500);
  postStatus();
}

void applyLightState(size_t idx, bool on) {
  lights[idx].state = on;
  digitalWrite(lights[idx].pin, on ? HIGH : LOW);
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
      postStatus();
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

void postStatus() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;

  StaticJsonDocument<512> doc;
  doc["device"] = "esp32-lightlink";
  JsonArray arr = doc.createNestedArray("lights");
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
  String payload;
  serializeJson(doc, payload);

  String url = buildBaseUrl("/api/status");
  if (serverHost.startsWith("https://")) {
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + authToken);
  int code = http.POST(payload);
  Serial.print("POST /api/status -> "); Serial.println(code);
  http.end();
}

int findLightIndexByName(const String& name) {
  for (size_t i = 0; i < NUM_LIGHTS; i++) {
    if (name.equalsIgnoreCase(lights[i].name)) return (int)i;
  }
  return -1;
}

void handleJsonCommand(const String& json) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Serial.print("JSON parse error: ");
    Serial.println(err.c_str());
    return;
  }

  const char* action = doc["action"] | "";
  if (strcmp(action, "get_status") == 0) { postStatus(); return; }

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
      postStatus();
      return;
    }

    int idx = findLightIndexByName(target);
    if (idx >= 0) {
      bool newState = hasState ? state : !lights[idx].state;
      applyLightState((size_t)idx, newState);
      postStatus();
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

    postStatus();
    return;
  }

  Serial.print("Unknown action: ");
  Serial.println(action);
}

void pollCommandsOnce() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = buildBaseUrl("/api/poll");
  if (serverHost.startsWith("https://")) {
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }
  http.addHeader("Authorization", String("Bearer ") + authToken);
  int code = http.GET();
  if (code == HTTP_CODE_OK) {
    String resp = http.getString();
    StaticJsonDocument<1024> doc;
    if (deserializeJson(doc, resp) == DeserializationError::Ok) {
      JsonArray cmds = doc["cmds"].as<JsonArray>();
      for (JsonVariant v : cmds) {
        String cmd;
        serializeJson(v, cmd);
        Serial.print("CMD: "); Serial.println(cmd);
        handleJsonCommand(cmd);
      }
    }
  } else {
    Serial.print("GET /api/poll -> "); Serial.println(code);
  }
  http.end();
}

void loop() {
  // Poll commands
  static unsigned long lastPoll = 0;
  unsigned long now = millis();
  if (now - lastPoll > 1000) { // every 1s
    lastPoll = now;
    pollCommandsOnce();
  }

  // Apply schedules once per minute
  checkAndApplySchedules();

  delay(10);
}