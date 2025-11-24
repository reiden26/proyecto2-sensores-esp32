#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// Configuración del LCD I2C (dirección 0x27, 16x2)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Pines de sensores MQ - VERIFICA QUE SEAN CORRECTOS
const int mq135Pin = 35;
const int mq4Pin = 32;
const int mq7Pin = 33;

// Configuración WiFi
const char* ssid = "FAMILIA_REID";
const char* password = "granfamilia";

// Valor por defecto del servidor (ACTUALIZADO PARA PRODUCCIÓN)
const char* serverURL_default = "https://proyecto2-sensores-esp32.onrender.com/lecturas/device";
const char* API_KEY = "esp32_api_key_12345";  // API key de producción desde .env

// Variables de calibración (Ro) - USANDO VALORES DEL CÓDIGO ANTERIOR QUE FUNCIONABA
// Estos son los valores que tenías cuando funcionaba correctamente
float mq135_ro = 18032.44;  // Valor del código anterior que funcionaba
float mq4_ro = 47013.09;    // Valor del código anterior que funcionaba
float mq7_ro = 4840.42;     // Valor del código anterior que funcionaba

// Variable global para la URL que usarás en tiempo de ejecución
String serverURLstr = String(serverURL_default);

// --- funciones auxiliares ---
float readVoltage(int pin) {
  int rawValue = analogRead(pin);
  return (rawValue * 3.3) / 4095.0;
}

// Fórmula de resistencia - MANTENIENDO LA DEL CÓDIGO ANTERIOR
// Esta fórmula es: Rs = ((Vcc * RL) / Vout) - RL
// Que es equivalente a: Rs = ((Vcc - Vout) * RL) / Vout
float calculateResistance(float voltage, float loadResistance = 10000.0) {
  if (voltage <= 0) return 0; // Protección contra división por cero
  return ((3.3 * loadResistance) / voltage) - loadResistance;
}

float maxFloat(float a, float b) {
  return (a > b) ? a : b;
}

// Conversión MQ-135 (CO2) - MANTENIENDO FÓRMULA Y MULTIPLICADOR DEL CÓDIGO ANTERIOR
float mq135ToPPM(float voltage) {
  float resistance = calculateResistance(voltage);
  if (resistance <= 0 || mq135_ro <= 0) return 0;
  
  float ratio = resistance / mq135_ro;
  float ppm = pow(10, ((log10(ratio) - 0.42) / -0.92)) * 100;
  
  return maxFloat(0.0, ppm);
}

// Conversión MQ-4 (Metano) - MANTENIENDO FÓRMULA Y MULTIPLICADOR DEL CÓDIGO ANTERIOR
float mq4ToPPM(float voltage) {
  float resistance = calculateResistance(voltage);
  if (resistance <= 0 || mq4_ro <= 0) return 0;
  
  float ratio = resistance / mq4_ro;
  float ppm = pow(10, ((log10(ratio) - 0.42) / -0.92)) * 50;
  
  return maxFloat(0.0, ppm);
}

// Conversión MQ-7 (Monóxido de carbono) - MANTENIENDO FÓRMULA Y MULTIPLICADOR DEL CÓDIGO ANTERIOR
float mq7ToPPM(float voltage) {
  float resistance = calculateResistance(voltage);
  if (resistance <= 0 || mq7_ro <= 0) return 0;
  
  float ratio = resistance / mq7_ro;
  float ppm = pow(10, ((log10(ratio) - 0.42) / -0.92)) * 20;
  
  return maxFloat(0.0, ppm);
}

// Determinar estado según umbrales ajustados a valores realistas
String getEstado(float ppm, String sensorType) {
  if (sensorType == "mq135") {
    // Calidad del aire general (NO es CO₂ específico): Bueno < 20, Advertencia 20-49, Malo >= 50
    // NOTA: MQ-135 mide múltiples gases (NH3, NOx, alcohol, benceno, humo), no CO₂ con precisión
    if (ppm < 20) return "bueno";
    else if (ppm < 50) return "advertencia";
    else return "malo";
  } else if (sensorType == "mq4") {
    // Metano: Bueno < 10, Advertencia 10-49, Malo >= 50
    if (ppm < 10) return "bueno";
    else if (ppm < 50) return "advertencia";
    else return "malo";
  } else if (sensorType == "mq7") {
    // CO: Bueno < 9, Advertencia 9-34, Malo >= 35
    if (ppm < 9) return "bueno";
    else if (ppm < 35) return "advertencia";
    else return "malo";
  }
  return "bueno";
}

// Detecta si el texto es una "IP" (solo dígitos y puntos, opcional :puerto)
bool looksLikeIP(const String &s) {
  if (s.length() == 0) return false;
  for (size_t i = 0; i < s.length(); ++i) {
    char c = s[i];
    if (!( (c >= '0' && c <= '9') || c == '.' || c == ':' )) return false;
  }
  return true;
}

// Construye URL si el usuario ingresó solo la IP o IP:PUERTO
String makeURLFromIP(const String &ipInput) {
  String tmp = ipInput;
  tmp.trim();
  if (tmp.length() == 0) return String(serverURL_default);
  
  // Si incluye "http" ya es una URL completa
  if (tmp.startsWith("http://") || tmp.startsWith("https://")) return tmp;
  
  // Si parece una IP (xxx.xxx.xxx.xxx ó xxx.xxx.xxx.xxx:8000) -> construir
  if (looksLikeIP(tmp)) {
    // si no incluye puerto, añadimos 8000 por defecto
    if (tmp.indexOf(':') == -1) {
      return "http://" + tmp + ":8000/lecturas/device";
    } else {
      return "http://" + tmp + "/lecturas/device";
    }
  }
  
  // fallback: si no lo entendimos, devolver por defecto
  return String(serverURL_default);
}

// Pide la URL por Serial al iniciar (timeout en ms)
void pedirURLporSerial(unsigned long timeoutMs = 15000) {
  Serial.println();
  Serial.println("Ingresa la URL completa (ej: https://proyecto2-sensores-production.up.railway.app/lecturas/device)");
  Serial.println("O ingresa SOLO la IP o IP:PUERTO (ej: 192.168.1.10 o 192.168.1.10:8000)");
  Serial.println("Presiona ENTER para usar la URL de producción por defecto: ");
  Serial.print("> ");

  unsigned long start = millis();
  String input = "";
  while (millis() - start < timeoutMs) {
    if (Serial.available()) {
      input = Serial.readStringUntil('\n');
      input.trim();
      break;
    }
    delay(10);
  }

  if (input.length() == 0) {
    Serial.println();
    Serial.println("No se ingresó nada: usando URL de producción por defecto.");
    serverURLstr = String(serverURL_default);
  } else {
    serverURLstr = makeURLFromIP(input);
    Serial.println();
    Serial.print("Usando servidor: ");
    Serial.println(serverURLstr);
  }

  // Mostrar en LCD la URL (acortada si es muy larga)
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Servidor:");
  lcd.setCursor(0, 1);
  String toShow = serverURLstr;
  if (toShow.length() > 16) toShow = toShow.substring(0, 16); // mostrar parte
  lcd.print(toShow);
  delay(2000);
}

// --- Setup y loop ---
void setup() {
  Serial.begin(115200);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0,0);
  lcd.print("Iniciando...");
  lcd.setCursor(0,1);
  lcd.print("Conectando WiFi");

  WiFi.begin(ssid, password);
  unsigned long startWiFi = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    // opcional: timeout para WiFi (no forzamos aquí)
  }
  Serial.println();
  Serial.println("WiFi conectado!");
  Serial.print("IP del ESP: ");
  Serial.println(WiFi.localIP());

  // Pedimos la URL al usuario por Serial (timeout 15s)
  pedirURLporSerial(15000);

  // Mostrar confirmación en Serial y LCD
  Serial.print("URL final a usar: ");
  Serial.println(serverURLstr);
  lcd.clear();
  lcd.setCursor(0,0);
  lcd.print("Listo. Enviando");
  lcd.setCursor(0,1);
  lcd.print("datos a servidor");
  delay(1200);
  
  // Mostrar valores de calibración (para debugging)
  Serial.println("=== VALORES DE CALIBRACIÓN (del código anterior que funcionaba) ===");
  Serial.print("MQ135 RO: "); Serial.println(mq135_ro);
  Serial.print("MQ4 RO: "); Serial.println(mq4_ro);
  Serial.print("MQ7 RO: "); Serial.println(mq7_ro);
  Serial.println("===================================================================");
}

void loop() {
  float mq135Voltage = readVoltage(mq135Pin);
  float mq4Voltage = readVoltage(mq4Pin);
  float mq7Voltage = readVoltage(mq7Pin);

  float mq135PPM = mq135ToPPM(mq135Voltage);
  float mq4PPM = mq4ToPPM(mq4Voltage);
  float mq7PPM = mq7ToPPM(mq7Voltage);

  // Mostrar en LCD (breve)
  lcd.clear();
  lcd.setCursor(0,0);
  lcd.print("MQ135:");
  lcd.print((int)mq135PPM);
  lcd.setCursor(0,1);
  lcd.print("MQ4:");
  lcd.print((int)mq4PPM);
  delay(1500);

  lcd.clear();
  lcd.setCursor(0,0);
  lcd.print("MQ7:");
  lcd.print((int)mq7PPM);
  lcd.setCursor(0,1);
  lcd.print("Enviando...");
  delay(1500);

  // Debug: mostrar voltajes, resistencias, ratios y PPM
  Serial.println("=== LECTURAS DETALLADAS ===");
  
  float mq135Res = calculateResistance(mq135Voltage);
  float mq135Ratio = mq135Res / mq135_ro;
  Serial.print("MQ135 - V: "); Serial.print(mq135Voltage, 3);
  Serial.print("V | Rs: "); Serial.print(mq135Res);
  Serial.print("Ω | Ratio: "); Serial.print(mq135Ratio, 6);
  Serial.print(" | PPM: "); Serial.println(mq135PPM);
  
  float mq4Res = calculateResistance(mq4Voltage);
  float mq4Ratio = mq4Res / mq4_ro;
  Serial.print("MQ4 - V: "); Serial.print(mq4Voltage, 3);
  Serial.print("V | Rs: "); Serial.print(mq4Res);
  Serial.print("Ω | Ratio: "); Serial.print(mq4Ratio, 6);
  Serial.print(" | PPM: "); Serial.println(mq4PPM);
  
  float mq7Res = calculateResistance(mq7Voltage);
  float mq7Ratio = mq7Res / mq7_ro;
  Serial.print("MQ7 - V: "); Serial.print(mq7Voltage, 3);
  Serial.print("V | Rs: "); Serial.print(mq7Res);
  Serial.print("Ω | Ratio: "); Serial.print(mq7Ratio, 6);
  Serial.print(" | PPM: "); Serial.println(mq7PPM);
  Serial.println("==========================");

  Serial.print("MQ135: ");
  Serial.print(mq135PPM);
  Serial.print(" ppm | MQ4: ");
  Serial.print(mq4PPM);
  Serial.print(" ppm | MQ7: ");
  Serial.print(mq7PPM);
  Serial.println(" ppm");

  if (WiFi.status() == WL_CONNECTED) {
    sendDataToServer(mq135PPM, mq4PPM, mq7PPM);
  } else {
    Serial.println("WiFi desconectado. Reintentando conexion...");
    lcd.clear();
    lcd.setCursor(0,0);
    lcd.print("WiFi descon.");
    lcd.setCursor(0,1);
    lcd.print("reconectando...");
    WiFi.reconnect();
    delay(2000);
  }

  delay(5000);
}

void sendDataToServer(float mq135PPM, float mq4PPM, float mq7PPM) {
  HTTPClient http;
  // usa serverURLstr (String) -> pasamos c_str()
  String urlToUse = serverURLstr;
  http.begin(urlToUse.c_str());
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-KEY", API_KEY);

  DynamicJsonDocument doc(1024);
  JsonArray lecturas = doc.createNestedArray("lecturas");

  JsonObject lectura1 = lecturas.createNestedObject();
  lectura1["sensor_codigo"] = "mq135";
  lectura1["valor"] = mq135PPM;
  lectura1["estado"] = getEstado(mq135PPM, "mq135");

  JsonObject lectura2 = lecturas.createNestedObject();
  lectura2["sensor_codigo"] = "mq4";
  lectura2["valor"] = mq4PPM;
  lectura2["estado"] = getEstado(mq4PPM, "mq4");

  JsonObject lectura3 = lecturas.createNestedObject();
  lectura3["sensor_codigo"] = "mq7";
  lectura3["valor"] = mq7PPM;
  lectura3["estado"] = getEstado(mq7PPM, "mq7");

  String jsonString;
  serializeJson(doc, jsonString);

  Serial.println("=== ENVIANDO DATOS ===");
  Serial.println("URL del servidor: " + urlToUse);
  Serial.println("API Key utilizada: " + String(API_KEY));
  Serial.println("JSON a enviar: " + jsonString);
  Serial.println("Tamaño del JSON: " + String(jsonString.length()) + " bytes");

  int httpResponseCode = http.POST(jsonString);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.println("Código de respuesta HTTP: " + String(httpResponseCode));
    Serial.println("Respuesta del servidor: " + response);

    if (httpResponseCode == 200) {
      lcd.clear();
      lcd.setCursor(0,0);
      lcd.print("Datos enviados");
      lcd.setCursor(0,1);
      lcd.print("exitosamente!");
    } else {
      lcd.clear();
      lcd.setCursor(0,0);
      lcd.print("Error: ");
      lcd.setCursor(6,0);
      lcd.print(httpResponseCode);
    }
  } else {
    Serial.println("Error en la conexión HTTP");
    lcd.clear();
    lcd.setCursor(0,0);
    lcd.print("Error de");
    lcd.setCursor(0,1);
    lcd.print("conexion HTTP");
  }

  http.end();
  Serial.println("=== FIN ENVÍO ===");
}

