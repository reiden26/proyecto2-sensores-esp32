class ApiConstants {
  // Base URL - Cambia esta URL por la de tu backend
  static const String baseUrl = 'https://proyecto2-sensores-esp32.onrender.com';
  
  // Endpoints de autenticación
  static const String loginEndpoint = '/login';
  static const String registerEndpoint = '/register';
  static const String logoutEndpoint = '/logout';
  static const String currentUserEndpoint = '/usuario/actual';
  
  // Endpoints de usuarios
  static const String usersEndpoint = '/usuarios';
  static const String userEndpoint = '/usuarios/{id}';
  
  // Endpoints de sensores
  static const String sensorsEndpoint = '/sensores';
  static const String userSensorsEndpoint = '/usuarios/{id}/sensores';
  static const String activeSensorsEndpoint = '/sensores/activos';
  
  // Endpoints de lecturas
  static const String readingsEndpoint = '/lecturas';
  static const String myReadingsEndpoint = '/lecturas/me';
  static const String adminReadingsEndpoint = '/lecturas/admin';
  static const String deviceReadingsEndpoint = '/lecturas/device';
  
  // Endpoints de captura
  static const String activateCaptureEndpoint = '/captura/activar/{sensor_codigo}';
  static const String deactivateCaptureEndpoint = '/captura/desactivar/{sensor_codigo}';
  static const String activateAllCaptureEndpoint = '/captura/activar/1';
  static const String deactivateAllCaptureEndpoint = '/captura/desactivar';
  
  // Endpoints de sesiones
  static const String sessionHistoryEndpoint = '/sesiones/historial';
  static const String lastSessionEndpoint = '/sesiones/ultima';
  static const String cleanEmptySessionsEndpoint = '/sesiones/limpiar-vacias';
  
  // Endpoints de notificaciones
  static const String myNotificationsEndpoint = '/notificaciones/me';
  static const String adminNotificationsEndpoint = '/notificaciones/admin';
  static const String notificationsEndpoint = '/notificaciones';
  static const String markNotificationReadEndpoint = '/notificaciones/{id}/leer';
  static const String markAllNotificationsReadEndpoint = '/notificaciones/leer-todas';
  
  // Endpoints de configuración
  static const String userNotificationConfigMe = '/configuracion-notificaciones/me';
  static const String systemConfigEndpoint = '/configuracion-sistema';
  static const String userSessionConfigMe = '/configuracion-sesion/me';
  static const String userByIdEndpoint = '/usuarios/{id}';
  
  // Endpoints de reportes
  static const String dashboardStatsEndpoint = '/admin/dashboard/stats';
  static const String analyticsEndpoint = '/reportes/analitica';
  static const String alertsEndpoint = '/reportes/alertas';
  static const String usersReportEndpoint = '/reportes/usuarios';
  static const String sensorsReportEndpoint = '/reportes/sensores';
  
  // Headers
  static const String authorizationHeader = 'Authorization';
  static const String contentTypeHeader = 'Content-Type';
  static const String apiKeyHeader = 'X-API-KEY';
  
  // Content types
  static const String jsonContentType = 'application/json';
  
  // Token prefix
  static const String bearerPrefix = 'Bearer ';
}
